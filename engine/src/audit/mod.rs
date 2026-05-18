//! Append-only event log for the touch engine.
//!
//! Writes go to `engine_events` (migration 010). The free-form
//! `event_type` keeps this future-proof — we don't have to ship a
//! migration to log a new domain event. Reads are intentionally
//! unimplemented here: ops queries Postgres directly, or the engine
//! exposes a focused admin endpoint when needed.
//!
//! Design choices:
//!  - All inserts are best-effort. A failed audit write logs at warn
//!    level but never propagates an error to the caller — losing an
//!    audit row is preferable to failing a user-facing request.
//!  - Severity is a tag, not a level filter — every event is recorded
//!    regardless. Filter at query time.
//!  - Payload is `serde_json::Value` so callers don't fight types.

use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, Copy)]
pub enum Severity {
    Info,
    Warn,
    Error,
}

impl Severity {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Info => "info",
            Self::Warn => "warn",
            Self::Error => "error",
        }
    }
}

/// Common event types. Adding a new one is just a new const — no
/// migration required, no enum refactor. Keep names `<DOMAIN>_<ACTION>`.
pub mod event {
    pub const SIWE_LOGIN_OK: &str = "SIWE_LOGIN_OK";
    pub const SIWE_LOGIN_FAILED: &str = "SIWE_LOGIN_FAILED";
    pub const TOUCH_BET_OPENED: &str = "TOUCH_BET_OPENED";
    pub const TOUCH_BET_RESOLVED: &str = "TOUCH_BET_RESOLVED";
    pub const TAP_SHADOW_BET_OPENED: &str = "TAP_SHADOW_BET_OPENED";
    pub const TAP_SHADOW_BETS_RESOLVED: &str = "TAP_SHADOW_BETS_RESOLVED";
    pub const WITHDRAW_AUTHORIZED: &str = "WITHDRAW_AUTHORIZED";
    pub const PROFILE_UPDATED: &str = "PROFILE_UPDATED";
    pub const BREAKER_TRIPPED: &str = "BREAKER_TRIPPED";
    pub const BREAKER_RESET: &str = "BREAKER_RESET";
    pub const SIGNER_ROTATED: &str = "SIGNER_ROTATED";
}

/// Best-effort insert. Fire-and-forget: failures log at warn but don't
/// propagate. Caller can `.await` to checkpoint or just ignore the
/// future on hot paths.
pub async fn record(
    pool: &PgPool,
    user_id: Option<Uuid>,
    event_type: &str,
    severity: Severity,
    payload: Option<Value>,
) {
    let res = sqlx::query(
        "INSERT INTO engine_events (user_id, event_type, severity, payload) \
         VALUES ($1, $2, $3, $4)",
    )
    .bind(user_id)
    .bind(event_type)
    .bind(severity.as_str())
    .bind(payload)
    .execute(pool)
    .await;
    if let Err(e) = res {
        tracing::warn!(
            error = %e,
            event_type,
            "Audit write failed (best-effort, continuing)"
        );
    }
}

/// Synchronous spawn — useful when the caller doesn't want to await.
/// The `pool` is cloned (cheap, just an Arc bump).
pub fn record_async(
    pool: PgPool,
    user_id: Option<Uuid>,
    event_type: &'static str,
    severity: Severity,
    payload: Option<Value>,
) {
    tokio::spawn(async move {
        record(&pool, user_id, event_type, severity, payload).await;
    });
}
