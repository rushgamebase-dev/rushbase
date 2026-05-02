//! Admin-only operations. Reset the breaker, ban/unban users, query
//! the engine event log. Every action emits its own `engine_events`
//! row keyed by the admin's user_id so the audit trail is complete.

use crate::api::middleware::AuthenticatedAdmin;
use crate::api::state::AppState;
use crate::audit::{event, record_async, Severity};
use crate::errors::ApiError;
use actix_web::{web, HttpResponse};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize)]
pub struct BreakerStateResponse {
    pub tripped: bool,
    pub reason: Option<String>,
    pub triggered_at_ms: Option<i64>,
}

/// `GET /api/v1/admin/breaker` — read the current breaker state.
pub async fn get_breaker_state(
    app_state: web::Data<AppState>,
    _admin: AuthenticatedAdmin,
) -> Result<HttpResponse, ApiError> {
    let row: Option<(bool, Option<String>, Option<chrono::DateTime<chrono::Utc>>)> =
        sqlx::query_as(
            "SELECT circuit_breaker_triggered, circuit_breaker_reason, \
             circuit_breaker_triggered_at FROM house_state LIMIT 1",
        )
        .fetch_optional(&app_state.pool)
        .await
        .map_err(|e| ApiError::internal(format!("Failed to read breaker state: {}", e)))?;

    let (tripped, reason, triggered_at) = row.unwrap_or((false, None, None));
    Ok(HttpResponse::Ok().json(BreakerStateResponse {
        tripped,
        reason,
        triggered_at_ms: triggered_at.map(|t| t.timestamp_millis()),
    }))
}

/// `POST /api/v1/admin/breaker/reset` — clear the breaker. Requires
/// having verified the underlying cause (Binance feed healthy, vault
/// solvent, etc.) before calling. The DB write is what makes the reset
/// survive a process restart.
pub async fn reset_breaker(
    app_state: web::Data<AppState>,
    admin: AuthenticatedAdmin,
) -> Result<HttpResponse, ApiError> {
    let was_tripped = app_state.exposure.is_circuit_breaker_triggered();
    app_state.exposure.reset_circuit_breaker();
    record_async(
        app_state.pool.clone(),
        Some(admin.user_id),
        event::BREAKER_RESET,
        Severity::Warn,
        Some(serde_json::json!({
            "by_admin": admin.user_id,
            "was_tripped": was_tripped,
        })),
    );
    Ok(HttpResponse::Ok().json(serde_json::json!({
        "ok": true,
        "was_tripped": was_tripped,
    })))
}

#[derive(Debug, Deserialize)]
pub struct BanRequest {
    pub reason: Option<String>,
}

/// `POST /api/v1/admin/users/{id}/ban` — flip `is_active` to false and
/// invalidate the cached row so the next authenticated request from
/// that user is rejected.
pub async fn ban_user(
    app_state: web::Data<AppState>,
    admin: AuthenticatedAdmin,
    path: web::Path<Uuid>,
    body: web::Json<BanRequest>,
) -> Result<HttpResponse, ApiError> {
    let target = path.into_inner();
    if target == admin.user_id {
        return Err(ApiError::bad_request(
            "An admin cannot ban themselves; ask another admin",
        ));
    }
    let result = sqlx::query(
        "UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1",
    )
    .bind(target)
    .execute(&app_state.pool)
    .await
    .map_err(|e| ApiError::internal(format!("Ban write failed: {}", e)))?;
    if result.rows_affected() == 0 {
        return Err(ApiError::not_found("User not found"));
    }
    app_state.user_active_cache.invalidate(target).await;
    record_async(
        app_state.pool.clone(),
        Some(admin.user_id),
        "USER_BANNED",
        Severity::Warn,
        Some(serde_json::json!({
            "target": target,
            "reason": body.reason.clone(),
        })),
    );
    Ok(HttpResponse::Ok().json(serde_json::json!({ "ok": true })))
}

/// `POST /api/v1/admin/users/{id}/revoke_all_tokens` — kill every
/// in-flight token for this user without enumerating sessions.
///
/// Sets `users.tokens_invalidated_before_ms` to NOW; the validator
/// rejects every JWT whose `iat` is older. Used in:
///  - suspected wallet-key compromise (preempt damage even if the
///    attacker has already minted tokens),
///  - JWT signing-key rotation (kick everyone, force re-SIWE).
///
/// Idempotent: setting it forward again costs nothing.
pub async fn revoke_all_tokens(
    app_state: web::Data<AppState>,
    admin: AuthenticatedAdmin,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let target = path.into_inner();
    let now_ms = chrono::Utc::now().timestamp_millis();
    let result = sqlx::query(
        "UPDATE users SET tokens_invalidated_before_ms = $2, updated_at = NOW() \
         WHERE id = $1 AND tokens_invalidated_before_ms < $2",
    )
    .bind(target)
    .bind(now_ms)
    .execute(&app_state.pool)
    .await
    .map_err(|e| ApiError::internal(format!("revoke_all write failed: {}", e)))?;
    if result.rows_affected() == 0 {
        // Either user doesn't exist, or watermark is already at/after
        // `now_ms`. Distinguish so the admin sees a clear status.
        let exists: Option<i32> = sqlx::query_scalar("SELECT 1::int FROM users WHERE id = $1")
            .bind(target)
            .fetch_optional(&app_state.pool)
            .await
            .ok()
            .flatten();
        if exists.is_none() {
            return Err(ApiError::not_found("User not found"));
        }
    }
    record_async(
        app_state.pool.clone(),
        Some(admin.user_id),
        "AUTH_TOKENS_REVOKED",
        Severity::Warn,
        Some(serde_json::json!({
            "target": target,
            "watermark_ms": now_ms,
        })),
    );
    Ok(HttpResponse::Ok().json(serde_json::json!({
        "ok": true,
        "tokens_invalidated_before_ms": now_ms,
    })))
}

/// `POST /api/v1/admin/users/{id}/unban` — restore `is_active` so the
/// user can authenticate again.
pub async fn unban_user(
    app_state: web::Data<AppState>,
    admin: AuthenticatedAdmin,
    path: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let target = path.into_inner();
    let result = sqlx::query(
        "UPDATE users SET is_active = true, updated_at = NOW() WHERE id = $1",
    )
    .bind(target)
    .execute(&app_state.pool)
    .await
    .map_err(|e| ApiError::internal(format!("Unban write failed: {}", e)))?;
    if result.rows_affected() == 0 {
        return Err(ApiError::not_found("User not found"));
    }
    app_state.user_active_cache.invalidate(target).await;
    record_async(
        app_state.pool.clone(),
        Some(admin.user_id),
        "USER_UNBANNED",
        Severity::Info,
        Some(serde_json::json!({ "target": target })),
    );
    Ok(HttpResponse::Ok().json(serde_json::json!({ "ok": true })))
}

#[derive(Debug, Deserialize)]
pub struct AuditQuery {
    /// Filter by `event_type` (exact match).
    pub event_type: Option<String>,
    /// Filter by `severity` (`info`, `warn`, `error`).
    pub severity: Option<String>,
    /// Filter by `user_id`.
    pub user_id: Option<Uuid>,
    /// Pagination — default 100, capped at 1000.
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct AuditEntry {
    pub id: Uuid,
    pub user_id: Option<Uuid>,
    pub event_type: String,
    pub severity: String,
    pub payload: Option<serde_json::Value>,
    pub created_at_ms: i64,
}

#[derive(Debug, Serialize)]
pub struct AuditResponse {
    pub entries: Vec<AuditEntry>,
    pub total: i64,
}

#[derive(Debug, Serialize)]
pub struct TreasuryResponse {
    /// On-chain `houseBalance()` mirrored by the vault listener.
    pub house_buffer_wei: String,
    /// Configured floor — withdrawals must leave at least this much in
    /// the buffer to keep the engine accepting new bets.
    pub min_house_buffer_wei: String,
    /// Cumulative engine-side house PnL: `Σ -realized_pnl_wei` across
    /// resolved bets. Positive = engine accumulating, negative = users
    /// netting wins. Diverges from realized payout flow only by user
    /// stakes that haven't yet been resolved.
    pub realized_pnl_wei: String,
    /// Sum of (potential_payout − stake) across ACTIVE bets — the
    /// worst-case the engine still owes to users in flight.
    pub outstanding_potential_payout_wei: String,
    /// Cumulative volume + trade counters (audit/health visibility).
    pub total_volume_wei: String,
    pub total_trades: i32,
    /// Maximum amount it would be safe to `houseWithdraw` *right now*
    /// without violating the buffer floor:
    /// `max(0, house_buffer − min_buffer − outstanding_payout)`.
    pub safe_withdrawable_wei: String,
}

/// `GET /api/v1/admin/house/treasury` — single source of truth for
/// "how much can ops sweep into the cold wallet?". Combines the
/// in-memory exposure tracker with the on-chain mirror in
/// `house_state`. Read-only and idempotent.
pub async fn get_treasury(
    app_state: web::Data<AppState>,
    _admin: AuthenticatedAdmin,
) -> Result<HttpResponse, ApiError> {
    use bigdecimal::{BigDecimal, Zero};
    use std::str::FromStr;

    #[derive(sqlx::FromRow)]
    struct Row {
        house_buffer_wei: BigDecimal,
        realized_pnl_wei: BigDecimal,
        total_volume_wei: BigDecimal,
        total_trades: i32,
    }
    let row: Row = sqlx::query_as(
        "SELECT house_buffer_wei, realized_pnl_wei, total_volume_wei, total_trades \
         FROM house_state LIMIT 1",
    )
    .fetch_one(&app_state.pool)
    .await
    .map_err(|e| ApiError::internal(format!("Failed to read house_state: {}", e)))?;

    let outstanding = app_state.exposure.total_potential_payout_wei();
    let outstanding_bd = BigDecimal::from_str(&outstanding.to_string()).unwrap_or_else(|_| BigDecimal::zero());

    // Configured min buffer floor (mirrored from settings into the
    // tracker at construction). Re-read here so the response matches
    // exactly what reservations enforce at open_bet time.
    let min_buffer = app_state.exposure.limits().min_house_buffer_wei;
    let min_buffer_bd = BigDecimal::from_str(&min_buffer.to_string()).unwrap_or_else(|_| BigDecimal::zero());

    // safe = max(0, buffer - min_buffer - outstanding)
    let safe = (&row.house_buffer_wei - &min_buffer_bd - &outstanding_bd).max(BigDecimal::zero());

    // Normalise every BigDecimal to a plain integer string so JSON
    // doesn't mix scientific-notation values (e.g. `"1e+20"`) with
    // canonical wei integers. Clients want one shape regardless of how
    // sqlx happened to round-trip through Postgres NUMERIC.
    Ok(HttpResponse::Ok().json(TreasuryResponse {
        house_buffer_wei: bd_int_string(&row.house_buffer_wei),
        min_house_buffer_wei: bd_int_string(&min_buffer_bd),
        realized_pnl_wei: bd_int_string(&row.realized_pnl_wei),
        outstanding_potential_payout_wei: bd_int_string(&outstanding_bd),
        total_volume_wei: bd_int_string(&row.total_volume_wei),
        total_trades: row.total_trades,
        safe_withdrawable_wei: bd_int_string(&safe),
    }))
}

/// Render a `BigDecimal` as a plain integer string. `BigDecimal::to_string`
/// can use scientific notation (`1e+20`) depending on internal scale;
/// we normalise via the i256 pipeline so wei values always come out
/// canonical (e.g. `100000000000000000000`).
fn bd_int_string(bd: &bigdecimal::BigDecimal) -> String {
    use crate::utils::wei::bd_to_i256;
    match bd_to_i256(bd) {
        Ok(i) => i.to_string(),
        Err(_) => bd.with_scale(0).to_string(),
    }
}

/// `GET /api/v1/admin/audit?event_type=...&severity=...&user_id=...&limit=&offset=`
pub async fn list_audit(
    app_state: web::Data<AppState>,
    _admin: AuthenticatedAdmin,
    query: web::Query<AuditQuery>,
) -> Result<HttpResponse, ApiError> {
    let limit = query.limit.unwrap_or(100).clamp(1, 1_000);
    let offset = query.offset.unwrap_or(0).max(0);

    let rows: Vec<(Uuid, Option<Uuid>, String, String, Option<serde_json::Value>, chrono::DateTime<chrono::Utc>)> =
        sqlx::query_as(
            "SELECT id, user_id, event_type, severity, payload, created_at \
             FROM engine_events \
             WHERE ($1::text IS NULL OR event_type = $1) \
               AND ($2::text IS NULL OR severity = $2) \
               AND ($3::uuid IS NULL OR user_id = $3) \
             ORDER BY created_at DESC \
             LIMIT $4 OFFSET $5",
        )
        .bind(query.event_type.as_deref())
        .bind(query.severity.as_deref())
        .bind(query.user_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&app_state.pool)
        .await
        .map_err(|e| ApiError::internal(format!("Audit query failed: {}", e)))?;

    let entries: Vec<AuditEntry> = rows
        .into_iter()
        .map(|(id, user_id, event_type, severity, payload, created_at)| AuditEntry {
            id,
            user_id,
            event_type,
            severity,
            payload,
            created_at_ms: created_at.timestamp_millis(),
        })
        .collect();
    let total = entries.len() as i64;
    Ok(HttpResponse::Ok().json(AuditResponse { entries, total }))
}
