//! Prometheus metrics for the touch engine.
//!
//! Per-handler counters/histograms are emitted automatically by
//! `actix-web-prom`. This module owns engine-internal metrics that are
//! sampled by a background task: total active bets, in-memory exposure,
//! circuit-breaker state, and per-symbol price-feed lag.
//!
//! Naming follows Prometheus best practice: `<namespace>_<subsystem>_<unit>`.

use prometheus::{
    register_histogram_with_registry, register_int_counter_vec_with_registry,
    register_int_gauge_vec_with_registry, register_int_gauge_with_registry, Histogram,
    IntCounterVec, IntGauge, IntGaugeVec, Registry,
};
use std::sync::Arc;
use std::time::Duration;

use crate::risk::ExposureTracker;

#[derive(Clone)]
pub struct EngineMetrics {
    pub bets_placed_total: IntCounterVec,    // labels: symbol, direction
    pub bets_resolved_total: IntCounterVec,  // labels: symbol, outcome (won|lost)
    pub active_bets: IntGauge,
    pub potential_payout_wei_log10: IntGauge,
    pub circuit_breaker: IntGauge, // 0 = normal, 1 = tripped
    pub price_feed_lag_ms: IntGaugeVec, // labels: symbol
    /// Time from `window_end_ms` to `resolved_at`, in milliseconds.
    /// p99 should sit within `max_resolution_lag_ms` (3 s default); a
    /// rising tail = the resolution loop is falling behind.
    pub settle_latency_ms: Histogram,
    /// Days since the active withdraw signer was first seen by this
    /// engine instance. Recovered from `signer_audit` at boot. Pages
    /// once it crosses the rotation policy threshold.
    pub signer_age_days: IntGauge,
}

impl EngineMetrics {
    pub fn new(registry: &Registry) -> Result<Self, prometheus::Error> {
        Ok(Self {
            bets_placed_total: register_int_counter_vec_with_registry!(
                "rush_engine_bets_placed_total",
                "Touch bets opened, by symbol and direction",
                &["symbol", "direction"],
                registry
            )?,
            bets_resolved_total: register_int_counter_vec_with_registry!(
                "rush_engine_bets_resolved_total",
                "Touch bets resolved, by symbol and outcome",
                &["symbol", "outcome"],
                registry
            )?,
            active_bets: register_int_gauge_with_registry!(
                "rush_engine_active_bets",
                "Bets currently in ACTIVE status",
                registry
            )?,
            potential_payout_wei_log10: register_int_gauge_with_registry!(
                "rush_engine_potential_payout_wei_log10",
                "log10 of total outstanding potential payout in wei (avoids overflow)",
                registry
            )?,
            circuit_breaker: register_int_gauge_with_registry!(
                "rush_engine_circuit_breaker_tripped",
                "1 if the exposure circuit breaker is tripped, else 0",
                registry
            )?,
            price_feed_lag_ms: register_int_gauge_vec_with_registry!(
                "rush_engine_price_feed_lag_ms",
                "Milliseconds since the last bucket-end update from the Binance feed",
                &["symbol"],
                registry
            )?,
            settle_latency_ms: register_histogram_with_registry!(
                prometheus::HistogramOpts::new(
                    "rush_engine_settle_latency_ms",
                    "Latency from a bet's window_end to its resolved_at, in ms",
                )
                // Buckets cover the typical `max_resolution_lag_ms` window
                // (3 s) plus a long tail to make a stuck loop visible.
                .buckets(vec![
                    50.0, 100.0, 250.0, 500.0, 1_000.0, 2_000.0, 3_000.0, 5_000.0,
                    10_000.0, 30_000.0, 60_000.0,
                ]),
                registry
            )?,
            signer_age_days: register_int_gauge_with_registry!(
                "rush_engine_signer_age_days",
                "Days since the active withdraw signer key was first activated",
                registry
            )?,
        })
    }
}

/// Periodically refresh the gauge metrics from engine state. The counters
/// are incremented at the call site; only gauges are sampled here.
pub fn spawn_sampler(
    metrics: EngineMetrics,
    pool: sqlx::PgPool,
    exposure: Arc<ExposureTracker>,
    arena_index: Arc<crate::arena_index::ArenaIndex>,
) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(10));
        loop {
            tick.tick().await;

            // Active bets — cheap aggregate count.
            if let Ok(count) = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*)::bigint FROM touch_bets WHERE status = 'ACTIVE'",
            )
            .fetch_one(&pool)
            .await
            {
                metrics.active_bets.set(count);
            }

            // Potential payout. U256 → log10(value) so a single i64 covers
            // values up to 2^63-1 (≈ 9.2e18 wei = 9.2 ETH; we expect much
            // larger). Take base-10 log of the decimal magnitude instead.
            let payout = exposure.total_potential_payout_wei();
            let log10 = if payout.is_zero() {
                0
            } else {
                payout.to_string().len() as i64 // crude but bounded
            };
            metrics.potential_payout_wei_log10.set(log10);

            metrics
                .circuit_breaker
                .set(if exposure.is_circuit_breaker_triggered() { 1 } else { 0 });

            // Arena Index lag: if the advancer task dies, this gauge
            // climbs and ops can alert. There's no per-symbol fan-out
            // any more — single-symbol arena.
            let now_ms = chrono::Utc::now().timestamp_millis();
            let lag = (now_ms - arena_index.last_update_ms()).max(0);
            metrics
                .price_feed_lag_ms
                .with_label_values(&[crate::arena_index::RUSH_INDEX_SYMBOL])
                .set(lag);
        }
    });
}
