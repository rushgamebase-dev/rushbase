//! Periodically re-check authenticated WebSocket sessions against
//! `users.is_active`. A user banned via the admin API would otherwise
//! keep their already-open WS session forever (until their JWT expires
//! at next reconnect). This loop kicks them inside one tick.
//!
//! Cheap by design: we only inspect users with live sessions, batch the
//! lookup, and rely on the existing `UserActiveCache` for hot users.

use crate::api::anti_replay::{ActiveLookup, ActiveStatusStore};
use crate::ws::messages::ServerMessage;
use crate::ws::Broadcaster;
use sqlx::PgPool;
use std::sync::Arc;
use std::time::Duration;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct WsRevalidateConfig {
    /// How often to sweep. 30 s matches the active-cache TTL.
    pub tick_secs: u64,
}

impl Default for WsRevalidateConfig {
    fn default() -> Self {
        Self { tick_secs: 30 }
    }
}

pub fn spawn_ws_revalidator(
    cfg: WsRevalidateConfig,
    pool: PgPool,
    cache: Arc<dyn ActiveStatusStore>,
    broadcaster: Arc<Broadcaster>,
) {
    tokio::spawn(async move {
        tracing::info!(tick_secs = cfg.tick_secs, "WS revalidator starting");
        let mut tick = tokio::time::interval(Duration::from_secs(cfg.tick_secs.max(5)));
        loop {
            tick.tick().await;
            let user_ids = broadcaster.active_user_ids();
            for user_id in user_ids {
                let active = match cache.get(user_id).await {
                    Some(v) => v,
                    None => match fetch_active(&pool, user_id).await {
                        Some(true) => {
                            cache.put(user_id, true).await;
                            ActiveLookup::Active
                        }
                        Some(false) => {
                            cache.put(user_id, false).await;
                            ActiveLookup::Inactive
                        }
                        None => ActiveLookup::Unknown,
                    },
                };
                match active {
                    ActiveLookup::Active => {} // healthy, leave the session alone
                    ActiveLookup::Inactive | ActiveLookup::Unknown => {
                        tracing::warn!(user_id = %user_id, "Force-disconnecting banned/unknown user from WS");
                        broadcaster.force_disconnect_user(
                            user_id,
                            Some(ServerMessage::Error {
                                code: "ACCOUNT_INACTIVE".into(),
                                message: "Your session was terminated by the engine.".into(),
                            }),
                        );
                    }
                }
            }
        }
    });
}

async fn fetch_active(pool: &PgPool, user_id: Uuid) -> Option<bool> {
    sqlx::query_scalar("SELECT is_active FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
}
