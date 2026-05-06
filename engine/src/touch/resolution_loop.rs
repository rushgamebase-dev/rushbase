//! Background sweep that resolves bets whose window has elapsed.

use crate::audit::{event as audit_event, record, Severity};
use crate::metrics::EngineMetrics;
use crate::touch::engine::TouchEngine;
use crate::ws::broadcaster::Broadcaster;
use crate::ws::messages::ServerMessage;
use chrono::Utc;
use std::sync::Arc;
use std::time::Duration;

pub struct ResolutionLoop {
    engine: Arc<TouchEngine>,
    broadcaster: Arc<Broadcaster>,
    metrics: Option<Arc<EngineMetrics>>,
    tick_ms: u64,
}

impl ResolutionLoop {
    pub fn new(engine: Arc<TouchEngine>, broadcaster: Arc<Broadcaster>, tick_ms: u64) -> Self {
        Self {
            engine,
            broadcaster,
            metrics: None,
            tick_ms,
        }
    }

    pub fn with_metrics(mut self, metrics: Arc<EngineMetrics>) -> Self {
        self.metrics = Some(metrics);
        self
    }

    pub async fn run(self) {
        tracing::info!(tick_ms = self.tick_ms, "Resolution loop starting");
        let mut interval = tokio::time::interval(Duration::from_millis(self.tick_ms));
        loop {
            interval.tick().await;
            if let Err(e) = self.sweep().await {
                tracing::error!(error = %e, "Resolution sweep error");
            }
        }
    }

    async fn sweep(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let now = Utc::now().timestamp_millis();
        let bets = self.engine.bet_repo().get_resolvable(now).await?;
        for bet in bets {
            // No feed-lag gate here: the VRF arena resolves from
            // the per-bet seed (encrypted at place time, decrypted
            // at reveal). There is no external price feed to lag,
            // so any bet whose window has elapsed is safe to settle.

            match self.engine.resolve_bet(bet.id).await {
                Ok(outcome) => {
                    if let Some(m) = &self.metrics {
                        let outcome_label = if outcome.touched { "won" } else { "lost" };
                        m.bets_resolved_total
                            .with_label_values(&[outcome.bet.symbol.as_str(), outcome_label])
                            .inc();
                        if let Some(resolved_at) = outcome.bet.resolved_at {
                            let latency_ms =
                                resolved_at.timestamp_millis() - outcome.bet.window_end_ms;
                            if latency_ms >= 0 {
                                m.settle_latency_ms.observe(latency_ms as f64);
                            }
                        }
                    }
                    // Pull the VRF reveal off the resolved bet. After
                    // a successful `resolve_bet` these are always
                    // populated; if any is missing the resolver wrote
                    // an inconsistent row, which we log loudly and
                    // refuse to broadcast (the client would fail to
                    // verify and end up confused).
                    // Post-VRF era: `revealed_seed` is always NULL
                    // (the resolver uses the global arena_index path,
                    // not a per-bet seed). `path_points_hash` is set
                    // for arena_index resolutions. Broadcast whatever
                    // we have; clients drop missing fields gracefully.
                    self.broadcaster.broadcast_to_channel(
                        &format!("bets:{}", outcome.bet.user_id),
                        ServerMessage::BetResolved {
                            bet_id: outcome.bet.id,
                            status: outcome.bet.status.as_str().to_string(),
                            touched_at: outcome
                                .bet
                                .touched_at
                                .map(|t| t.timestamp_millis()),
                            realized_pnl_wei: outcome.realized_pnl_wei.to_string(),
                            revealed_seed_hex: outcome
                                .bet
                                .revealed_seed
                                .as_deref()
                                .map(hex::encode)
                                .unwrap_or_default(),
                            path_points_hash: outcome
                                .bet
                                .path_points_hash
                                .clone()
                                .unwrap_or_default(),
                            path_config_version: outcome
                                .bet
                                .path_config_version
                                .clone()
                                .unwrap_or_default(),
                            path_regime: outcome.bet.path_regime.clone(),
                        },
                    );
                    record(
                        self.engine.bet_repo().pool(),
                        Some(outcome.bet.user_id),
                        audit_event::TOUCH_BET_RESOLVED,
                        Severity::Info,
                        Some(serde_json::json!({
                            "bet_id": outcome.bet.id,
                            "symbol": outcome.bet.symbol,
                            "outcome": if outcome.touched { "won" } else { "lost" },
                            "realized_pnl_wei": outcome.realized_pnl_wei.to_string(),
                        })),
                    )
                    .await;
                }
                Err(e) => tracing::warn!(bet = %bet.id, error = %e, "Resolve attempt failed"),
            }
        }
        Ok(())
    }
}
