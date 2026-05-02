//! Solvency monitor.
//!
//! Periodically reads the vault's on-chain `houseBalance` and compares it
//! to the off-chain mirror in `house_state.house_buffer_wei`. If the
//! on-chain balance falls below the configured floor, or diverges from
//! the mirror by more than `tolerance_bps`, the circuit breaker is
//! tripped and new bets are refused until the breaker is reset.
//!
//! Withdrawals stay open while the breaker is tripped — users must
//! always be able to exit. The vault-balance check inside
//! `WithdrawService` is the only on-chain guard for them.

use crate::chain::vault_balance::VaultBalanceProvider;
use crate::risk::{bd_or_zero_u256, ExposureTracker};
use alloy::primitives::U256;
use sqlx::PgPool;
use std::sync::Arc;
use std::time::Duration;

#[derive(Debug, Clone, Copy)]
pub struct SolvencyMonitorConfig {
    pub tick_secs: u64,
    /// If `|on_chain − mirror| / mirror > tolerance_bps`, trip the breaker.
    pub tolerance_bps: u32,
    /// Mirror is also checked against this floor.
    pub min_house_buffer_wei: U256,
}

pub struct SolvencyMonitor {
    pool: PgPool,
    vault_balance: Arc<dyn VaultBalanceProvider>,
    exposure: Arc<ExposureTracker>,
    cfg: SolvencyMonitorConfig,
}

impl SolvencyMonitor {
    pub fn new(
        pool: PgPool,
        vault_balance: Arc<dyn VaultBalanceProvider>,
        exposure: Arc<ExposureTracker>,
        cfg: SolvencyMonitorConfig,
    ) -> Self {
        Self {
            pool,
            vault_balance,
            exposure,
            cfg,
        }
    }

    pub async fn run(self) {
        tracing::info!(
            tick_secs = self.cfg.tick_secs,
            tolerance_bps = self.cfg.tolerance_bps,
            "Solvency monitor starting"
        );
        let mut interval = tokio::time::interval(Duration::from_secs(self.cfg.tick_secs.max(1)));
        loop {
            interval.tick().await;
            if let Err(e) = self.check().await {
                tracing::warn!(error = %e, "Solvency check error");
            }
        }
    }

    async fn check(&self) -> Result<(), String> {
        let on_chain = self
            .vault_balance
            .house_balance()
            .await
            .map_err(|e| e.to_string())?;

        let mirror_bd: bigdecimal::BigDecimal =
            sqlx::query_scalar("SELECT house_buffer_wei FROM house_state LIMIT 1")
                .fetch_one(&self.pool)
                .await
                .map_err(|e| e.to_string())?;
        let mirror = bd_or_zero_u256(&mirror_bd);

        // Floor check — `on_chain < min` means the vault has too little
        // capital to honor the configured exposure cap.
        if on_chain < self.cfg.min_house_buffer_wei {
            self.exposure.trigger_circuit_breaker(format!(
                "On-chain houseBalance {} below min {}",
                on_chain, self.cfg.min_house_buffer_wei
            ));
            return Ok(());
        }

        // Divergence check — mirror should track on-chain. Anything bigger
        // than `tolerance_bps` means the listener missed events or the
        // owner moved funds out of band.
        if let Some(divergence_bps) = relative_divergence_bps(on_chain, mirror) {
            if divergence_bps > self.cfg.tolerance_bps as u128 {
                self.exposure.trigger_circuit_breaker(format!(
                    "Vault buffer divergence: on-chain={}, mirror={}, diff={}bps",
                    on_chain, mirror, divergence_bps
                ));
                return Ok(());
            }
        }

        tracing::debug!(
            on_chain = %on_chain,
            mirror = %mirror,
            "Solvency OK"
        );
        Ok(())
    }
}

/// Returns `|a - b| * 10_000 / max(a, b)` as `u128`. None if both zero.
fn relative_divergence_bps(a: U256, b: U256) -> Option<u128> {
    let denom = a.max(b);
    if denom.is_zero() {
        return None;
    }
    let diff = if a > b { a - b } else { b - a };
    let bps = diff.saturating_mul(U256::from(10_000u64)) / denom;
    Some(bps.try_into().unwrap_or(u128::MAX))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn divergence_bps_basic() {
        assert_eq!(
            relative_divergence_bps(U256::from(10_000u64), U256::from(10_000u64)),
            Some(0)
        );
        // 10_000 vs 10_100 → 1% = 100 bps (relative to 10_100 max)
        let bps = relative_divergence_bps(U256::from(10_000u64), U256::from(10_100u64)).unwrap();
        assert!((bps as i128 - 99).abs() <= 1);
        assert_eq!(relative_divergence_bps(U256::ZERO, U256::ZERO), None);
    }
}
