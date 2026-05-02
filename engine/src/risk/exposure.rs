//! Atomic exposure tracker for touch bets.
//!
//! `reserve_potential_payout` and `release_potential_payout` are the two
//! hot-path operations. Both run under a single mutex so the
//! check-then-apply on `open_bet` cannot race against another concurrent
//! open and over-commit the house.

use crate::audit::{event, record_async, Severity};
use crate::utils::wei::bd_to_u256;
use alloy::primitives::U256;
use bigdecimal::BigDecimal;
use parking_lot::{Mutex, RwLock};
use sqlx::PgPool;
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Debug, Clone, Default)]
pub struct CircuitBreakerState {
    pub triggered: bool,
    pub reason: Option<String>,
    pub triggered_at: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct ExposureLimits {
    pub max_house_potential_payout_wei: U256,
    pub max_per_symbol_potential_payout_wei: U256,
    pub min_house_buffer_wei: U256,
    pub max_payout_per_bet_wei: U256,
    pub circuit_breaker_threshold_bps: u32,
}

#[derive(Debug, Default)]
struct State {
    per_symbol_potential_payout: HashMap<String, U256>,
    total_potential_payout: U256,
}

pub struct ExposureTracker {
    state: Arc<Mutex<State>>,
    circuit_breaker: Arc<RwLock<CircuitBreakerState>>,
    limits: ExposureLimits,
    /// When set, every breaker transition is mirrored to `house_state` so
    /// the next process start recovers the tripped state instead of
    /// silently returning to "OK". Set via [`with_persistence`].
    persist_pool: Option<PgPool>,
}

#[derive(Debug)]
pub enum ReservationError {
    PerSymbolExceeded { current: U256, limit: U256 },
    HouseExceeded { current: U256, limit: U256 },
    /// Reserving this bet's potential payout would push the available
    /// liquid buffer (vault `houseBalance` minus all outstanding potential
    /// payouts) below the configured floor.
    BufferTooLow {
        buffer_wei: U256,
        exposure_after_wei: U256,
        min_buffer_wei: U256,
    },
    CircuitBreaker,
}

impl ExposureTracker {
    pub fn new(limits: ExposureLimits) -> Self {
        Self {
            state: Arc::new(Mutex::new(State::default())),
            circuit_breaker: Arc::new(RwLock::new(CircuitBreakerState::default())),
            limits,
            persist_pool: None,
        }
    }

    /// Wire a Postgres pool for breaker persistence. Once set, every
    /// `trigger_circuit_breaker` and `reset_circuit_breaker` call also
    /// updates `house_state` and emits a `BREAKER_*` audit event.
    pub fn with_persistence(mut self, pool: PgPool) -> Self {
        self.persist_pool = Some(pool);
        self
    }

    /// Pull the persisted breaker state from `house_state` and seed the
    /// in-memory mirror. Called once at boot so a process restart
    /// doesn't silently un-trip a breaker that an operator never reset.
    pub async fn recover_from_db(
        &self,
        pool: &PgPool,
    ) -> Result<(), sqlx::Error> {
        let row: Option<(bool, Option<String>, Option<chrono::DateTime<chrono::Utc>>)> =
            sqlx::query_as(
                "SELECT circuit_breaker_triggered, circuit_breaker_reason, \
                 circuit_breaker_triggered_at FROM house_state LIMIT 1",
            )
            .fetch_optional(pool)
            .await?;
        if let Some((triggered, reason, triggered_at)) = row {
            if triggered {
                let mut cb = self.circuit_breaker.write();
                cb.triggered = true;
                cb.reason = reason;
                cb.triggered_at = triggered_at.map(|t| t.timestamp_millis());
                tracing::warn!(
                    "Circuit breaker state recovered as TRIPPED from house_state ({:?}); \
                     manual reset required to resume new bets",
                    cb.reason
                );
            } else {
                tracing::info!("Circuit breaker state recovered as OK from house_state");
            }
        }
        Ok(())
    }

    pub fn limits(&self) -> &ExposureLimits {
        &self.limits
    }

    /// Atomically reserve `net_exposure_wei` against `symbol`. The caller
    /// is expected to release on bet resolution (win or loss).
    ///
    /// Solvency check: after the reservation, the available liquid buffer
    /// (`house_buffer_wei − total_potential_payout`) must remain at or
    /// above `min_house_buffer_wei`. This is the *primary* solvency gate
    /// — caps and threshold-trip are secondary guardrails.
    pub fn reserve_potential_payout(
        &self,
        symbol: &str,
        net_exposure_wei: U256,
        per_symbol_limit: U256,
        house_limit: U256,
        house_buffer_wei: U256,
        min_house_buffer_wei: U256,
    ) -> Result<(), ReservationError> {
        if self.is_circuit_breaker_triggered() {
            return Err(ReservationError::CircuitBreaker);
        }
        let mut s = self.state.lock();
        let current_symbol = s
            .per_symbol_potential_payout
            .get(symbol)
            .copied()
            .unwrap_or(U256::ZERO);
        let next_symbol = current_symbol.saturating_add(net_exposure_wei);
        if next_symbol > per_symbol_limit {
            return Err(ReservationError::PerSymbolExceeded {
                current: next_symbol,
                limit: per_symbol_limit,
            });
        }
        let next_total = s.total_potential_payout.saturating_add(net_exposure_wei);
        if next_total > house_limit {
            return Err(ReservationError::HouseExceeded {
                current: next_total,
                limit: house_limit,
            });
        }

        // Buffer floor: after this reservation, the house must still hold
        // `min_house_buffer_wei` of liquid headroom against worst-case
        // payouts. `house_buffer_wei` mirrors the on-chain `houseBalance`
        // and is updated by the vault listener.
        //
        // Dev escape hatch: when `min_house_buffer_wei` is zero the
        // operator is explicitly opting out of buffer tracking (e.g.
        // running against a placeholder vault address that returns
        // `houseBalance = 0`). Skipping the check keeps local play
        // working without forging mirror values in the DB.
        if !min_house_buffer_wei.is_zero() {
            let required_floor = next_total.saturating_add(min_house_buffer_wei);
            if house_buffer_wei < required_floor {
                return Err(ReservationError::BufferTooLow {
                    buffer_wei: house_buffer_wei,
                    exposure_after_wei: next_total,
                    min_buffer_wei: min_house_buffer_wei,
                });
            }
        }

        // Trip the breaker if we crossed the threshold ratio of the
        // configured house cap. Once tripped, subsequent reservations
        // short-circuit on the `is_circuit_breaker_triggered` check above.
        let threshold = (house_limit
            .saturating_mul(U256::from(self.limits.circuit_breaker_threshold_bps as u64)))
            / U256::from(10_000u64);
        if next_total >= threshold {
            self.trigger_circuit_breaker(format!(
                "Total potential payout {} reached {}bps threshold",
                next_total, self.limits.circuit_breaker_threshold_bps
            ));
        }

        s.per_symbol_potential_payout
            .insert(symbol.to_string(), next_symbol);
        s.total_potential_payout = next_total;
        Ok(())
    }

    pub fn release_potential_payout(&self, symbol: &str, net_exposure_wei: U256) {
        let mut s = self.state.lock();
        let current_symbol = s
            .per_symbol_potential_payout
            .get(symbol)
            .copied()
            .unwrap_or(U256::ZERO);
        let next_symbol = current_symbol.saturating_sub(net_exposure_wei);
        if next_symbol.is_zero() {
            s.per_symbol_potential_payout.remove(symbol);
        } else {
            s.per_symbol_potential_payout
                .insert(symbol.to_string(), next_symbol);
        }
        s.total_potential_payout = s.total_potential_payout.saturating_sub(net_exposure_wei);
    }

    /// Replace in-memory exposure with values reconstructed from the DB.
    /// Called on startup so a process restart cannot under-count
    /// outstanding payouts and let the next bet violate the buffer floor.
    pub fn seed(&self, per_symbol: HashMap<String, U256>, total: U256) {
        let mut s = self.state.lock();
        s.per_symbol_potential_payout = per_symbol;
        s.total_potential_payout = total;
    }

    pub fn total_potential_payout_wei(&self) -> U256 {
        self.state.lock().total_potential_payout
    }

    pub fn symbol_potential_payout_wei(&self, symbol: &str) -> U256 {
        self.state
            .lock()
            .per_symbol_potential_payout
            .get(symbol)
            .copied()
            .unwrap_or(U256::ZERO)
    }

    pub fn is_circuit_breaker_triggered(&self) -> bool {
        self.circuit_breaker.read().triggered
    }

    pub fn trigger_circuit_breaker(&self, reason: impl Into<String>) {
        let reason_str = reason.into();
        let mut cb = self.circuit_breaker.write();
        if cb.triggered {
            // Already tripped — preserve the original reason and
            // timestamp so ops sees the FIRST cause, not a recurring one.
            return;
        }
        cb.triggered = true;
        cb.reason = Some(reason_str.clone());
        let ts_ms = chrono::Utc::now().timestamp_millis();
        cb.triggered_at = Some(ts_ms);
        tracing::error!(
            reason = %reason_str,
            "CIRCUIT BREAKER TRIPPED — new bets refused until manual reset"
        );
        drop(cb);
        if let Some(pool) = &self.persist_pool {
            let pool = pool.clone();
            let reason_clone = reason_str.clone();
            tokio::spawn(async move {
                let res = sqlx::query(
                    "UPDATE house_state SET \
                     circuit_breaker_triggered = true, \
                     circuit_breaker_reason = $1, \
                     circuit_breaker_triggered_at = NOW(), \
                     updated_at = NOW()",
                )
                .bind(&reason_clone)
                .execute(&pool)
                .await;
                if let Err(e) = res {
                    tracing::error!(error = %e, "Failed to persist breaker trip; in-memory state still tripped");
                }
                record_async(
                    pool,
                    None,
                    event::BREAKER_TRIPPED,
                    Severity::Error,
                    Some(serde_json::json!({ "reason": reason_clone, "triggered_at_ms": ts_ms })),
                );
            });
        }
    }

    pub fn reset_circuit_breaker(&self) {
        let mut cb = self.circuit_breaker.write();
        if !cb.triggered {
            return;
        }
        let prev_reason = cb.reason.clone();
        cb.triggered = false;
        cb.reason = None;
        cb.triggered_at = None;
        tracing::info!(prev_reason = ?prev_reason, "Circuit breaker reset");
        drop(cb);
        if let Some(pool) = &self.persist_pool {
            let pool = pool.clone();
            tokio::spawn(async move {
                let res = sqlx::query(
                    "UPDATE house_state SET \
                     circuit_breaker_triggered = false, \
                     circuit_breaker_reason = NULL, \
                     circuit_breaker_triggered_at = NULL, \
                     updated_at = NOW()",
                )
                .execute(&pool)
                .await;
                if let Err(e) = res {
                    tracing::error!(error = %e, "Failed to persist breaker reset");
                }
                record_async(
                    pool,
                    None,
                    event::BREAKER_RESET,
                    Severity::Warn,
                    Some(serde_json::json!({ "prev_reason": prev_reason })),
                );
            });
        }
    }
}

pub fn limits_from_config(cfg: &crate::config::settings::RiskConfig) -> ExposureLimits {
    use std::str::FromStr;
    let parse = |s: &str| U256::from_str(s).unwrap_or(U256::ZERO);
    ExposureLimits {
        max_house_potential_payout_wei: parse(&cfg.max_house_potential_payout_wei),
        max_per_symbol_potential_payout_wei: parse(&cfg.max_per_symbol_potential_payout_wei),
        min_house_buffer_wei: parse(&cfg.min_house_buffer_wei),
        max_payout_per_bet_wei: parse(&cfg.max_payout_per_bet_wei),
        circuit_breaker_threshold_bps: cfg.circuit_breaker_threshold_bps,
    }
}

pub fn bd_or_zero_u256(v: &BigDecimal) -> U256 {
    bd_to_u256(v).unwrap_or(U256::ZERO)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn limits() -> ExposureLimits {
        ExposureLimits {
            max_house_potential_payout_wei: U256::from(1_000_000u64),
            max_per_symbol_potential_payout_wei: U256::from(500_000u64),
            min_house_buffer_wei: U256::from(100_000u64),
            max_payout_per_bet_wei: U256::from(50_000u64),
            circuit_breaker_threshold_bps: 9_000, // 90%
        }
    }

    #[test]
    fn buffer_check_rejects_when_too_low() {
        let t = ExposureTracker::new(limits());
        // House buffer is 200k, min is 100k → free room is 100k. Reserving
        // 150k would leave only 50k liquid, below the 100k floor.
        let res = t.reserve_potential_payout(
            "BTCUSDT",
            U256::from(150_000u64),
            U256::from(500_000u64),
            U256::from(1_000_000u64),
            U256::from(200_000u64),
            U256::from(100_000u64),
        );
        match res {
            Err(ReservationError::BufferTooLow { .. }) => {}
            other => panic!("expected BufferTooLow, got {:?}", other),
        }
    }

    #[test]
    fn buffer_check_passes_when_room_remains() {
        let t = ExposureTracker::new(limits());
        let res = t.reserve_potential_payout(
            "BTCUSDT",
            U256::from(50_000u64),
            U256::from(500_000u64),
            U256::from(1_000_000u64),
            U256::from(200_000u64),
            U256::from(100_000u64),
        );
        assert!(res.is_ok());
        // 50k now reserved → next 50k still passes (total 100k, buffer 200-100=100, still floor).
        let res = t.reserve_potential_payout(
            "BTCUSDT",
            U256::from(50_000u64),
            U256::from(500_000u64),
            U256::from(1_000_000u64),
            U256::from(200_000u64),
            U256::from(100_000u64),
        );
        assert!(res.is_ok());
        // The third one would push exposure to 150k, leaving 50k liquid → reject.
        let res = t.reserve_potential_payout(
            "BTCUSDT",
            U256::from(50_000u64),
            U256::from(500_000u64),
            U256::from(1_000_000u64),
            U256::from(200_000u64),
            U256::from(100_000u64),
        );
        match res {
            Err(ReservationError::BufferTooLow { .. }) => {}
            other => panic!("expected BufferTooLow on third reserve, got {:?}", other),
        }
    }

    #[test]
    fn release_frees_room_for_subsequent_reserve() {
        let t = ExposureTracker::new(limits());
        t.reserve_potential_payout(
            "BTCUSDT",
            U256::from(80_000u64),
            U256::from(500_000u64),
            U256::from(1_000_000u64),
            U256::from(200_000u64),
            U256::from(100_000u64),
        )
        .unwrap();
        t.release_potential_payout("BTCUSDT", U256::from(80_000u64));
        assert_eq!(t.total_potential_payout_wei(), U256::ZERO);
        // Now we can reserve up to 100k against a 200k buffer with 100k floor.
        let res = t.reserve_potential_payout(
            "BTCUSDT",
            U256::from(100_000u64),
            U256::from(500_000u64),
            U256::from(1_000_000u64),
            U256::from(200_000u64),
            U256::from(100_000u64),
        );
        assert!(res.is_ok());
    }

    #[test]
    fn circuit_breaker_trips_on_threshold() {
        let t = ExposureTracker::new(limits());
        // 90% of 1_000_000 = 900_000. Buffer 1_000_000, min 0 to isolate
        // the threshold logic.
        let _ = t.reserve_potential_payout(
            "BTCUSDT",
            U256::from(900_000u64),
            U256::from(1_000_000u64),
            U256::from(1_000_000u64),
            U256::from(1_000_000u64),
            U256::ZERO,
        );
        assert!(t.is_circuit_breaker_triggered());
        // Once tripped, further reservations are refused.
        let res = t.reserve_potential_payout(
            "BTCUSDT",
            U256::from(1u64),
            U256::from(1_000_000u64),
            U256::from(1_000_000u64),
            U256::from(1_000_000u64),
            U256::ZERO,
        );
        assert!(matches!(res, Err(ReservationError::CircuitBreaker)));
    }

    #[test]
    fn per_symbol_cap_isolated_from_buffer() {
        let t = ExposureTracker::new(limits());
        // Buffer is healthy but per-symbol cap is the binding constraint.
        let res = t.reserve_potential_payout(
            "BTCUSDT",
            U256::from(600_000u64),
            U256::from(500_000u64), // cap below requested
            U256::from(1_000_000u64),
            U256::from(10_000_000u64),
            U256::from(0u64),
        );
        assert!(matches!(res, Err(ReservationError::PerSymbolExceeded { .. })));
    }
}
