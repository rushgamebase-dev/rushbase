use crate::api::dto::{
    BalanceResponse, LeaderboardEntry, LeaderboardQuery, LeaderboardResponse,
    LedgerEntryResponse, LedgerHistoryQuery, LedgerHistoryResponse, ProfileResponse,
    UpdateProfileRequest,
};
use crate::api::middleware::AuthenticatedUser;
use crate::api::state::AppState;
use crate::audit::{event, record_async, Severity};
use crate::db::repositories::UserRepository;
use crate::errors::ApiError;
use crate::ledger::LedgerService;
use actix_web::{web, HttpResponse};

pub async fn get_balance(
    app_state: web::Data<AppState>,
    user: AuthenticatedUser,
) -> Result<HttpResponse, ApiError> {
    let repo = UserRepository::new(app_state.pool.clone());
    let u = repo
        .find_by_id(user.user_id)
        .await
        .map_err(|e| ApiError::internal(format!("Failed to load user: {}", e)))?
        .ok_or_else(|| ApiError::not_found("User not found"))?;

    Ok(HttpResponse::Ok().json(BalanceResponse {
        deposited_wei: u.deposited_wei.to_string(),
        withdrawn_wei: u.withdrawn_wei.to_string(),
        realized_pnl_wei: u.realized_pnl_wei.to_string(),
        locked_margin_wei: u.locked_margin_wei.to_string(),
        free_balance_wei: u.free_balance_wei().to_string(),
    }))
}

pub async fn get_profile(
    app_state: web::Data<AppState>,
    user: AuthenticatedUser,
) -> Result<HttpResponse, ApiError> {
    let repo = UserRepository::new(app_state.pool.clone());
    let u = repo
        .find_by_id(user.user_id)
        .await
        .map_err(|e| ApiError::internal(format!("Failed to load user: {}", e)))?
        .ok_or_else(|| ApiError::not_found("User not found"))?;

    let win_rate = u.win_rate();
    Ok(HttpResponse::Ok().json(ProfileResponse {
        id: u.id,
        wallet_address: u.wallet_address.clone(),
        username: u.username.clone(),
        deposited_wei: u.deposited_wei.to_string(),
        withdrawn_wei: u.withdrawn_wei.to_string(),
        realized_pnl_wei: u.realized_pnl_wei.to_string(),
        locked_margin_wei: u.locked_margin_wei.to_string(),
        free_balance_wei: u.free_balance_wei().to_string(),
        total_trades: u.total_trades,
        total_wins: u.total_wins,
        total_losses: u.total_losses,
        win_rate,
        current_streak: u.current_win_streak,
        max_streak: u.best_win_streak,
        created_at: u.created_at.timestamp_millis(),
    }))
}

/// Update mutable profile fields. Currently only `username` — must be
/// 3-20 chars, alphanumeric / underscore / hyphen, lowercased before
/// storage to keep `unique_username` simple. Returns the refreshed
/// profile so clients don't have to re-fetch.
pub async fn update_profile(
    app_state: web::Data<AppState>,
    user: AuthenticatedUser,
    body: web::Json<UpdateProfileRequest>,
) -> Result<HttpResponse, ApiError> {
    if let Some(ref raw) = body.username {
        let candidate = raw.trim().to_lowercase();
        validate_username(&candidate)?;
        // Conflict if another user already has it. We let Postgres
        // enforce the UNIQUE constraint and translate the duplicate-key
        // error into a 409.
        let result = sqlx::query("UPDATE users SET username = $2, updated_at = NOW() WHERE id = $1")
            .bind(user.user_id)
            .bind(&candidate)
            .execute(&app_state.pool)
            .await;
        match result {
            Ok(_) => {}
            Err(sqlx::Error::Database(db_err)) if db_err.constraint().is_some() => {
                return Err(ApiError::conflict("Username already taken"));
            }
            Err(e) => return Err(ApiError::internal(format!("Failed to update profile: {}", e))),
        }
        record_async(
            app_state.pool.clone(),
            Some(user.user_id),
            event::PROFILE_UPDATED,
            Severity::Info,
            Some(serde_json::json!({ "field": "username", "value": candidate })),
        );
    }

    // Re-fetch and return the canonical profile.
    get_profile(app_state, user).await
}

fn validate_username(s: &str) -> Result<(), ApiError> {
    if s.len() < 3 || s.len() > 20 {
        return Err(ApiError::validation_error(
            "username must be 3-20 characters",
        ));
    }
    if !s
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(ApiError::validation_error(
            "username may contain only ASCII letters, digits, underscore and hyphen",
        ));
    }
    if !s.chars().next().is_some_and(|c| c.is_ascii_alphanumeric()) {
        return Err(ApiError::validation_error(
            "username must start with a letter or digit",
        ));
    }
    Ok(())
}

pub async fn get_leaderboard(
    app_state: web::Data<AppState>,
    query: web::Query<LeaderboardQuery>,
) -> Result<HttpResponse, ApiError> {
    let repo = UserRepository::new(app_state.pool.clone());
    let limit = query.limit.unwrap_or(100).clamp(1, 500);
    let entries = repo
        .get_leaderboard(limit, 0)
        .await
        .map_err(|e| ApiError::internal(format!("Failed to load leaderboard: {}", e)))?;
    let period = query.period.clone().unwrap_or_else(|| "all_time".to_string());

    Ok(HttpResponse::Ok().json(LeaderboardResponse {
        entries: entries
            .into_iter()
            .map(|e| LeaderboardEntry {
                rank: e.rank,
                wallet_address: e.wallet_address,
                username: e.username,
                realized_pnl_wei: e.realized_pnl_wei.to_string(),
                win_rate: e.win_rate,
                total_trades: e.total_trades,
                best_win_streak: e.best_win_streak,
            })
            .collect(),
        period,
    }))
}

pub async fn get_ledger_history(
    app_state: web::Data<AppState>,
    user: AuthenticatedUser,
    query: web::Query<LedgerHistoryQuery>,
) -> Result<HttpResponse, ApiError> {
    let svc = LedgerService::new(app_state.pool.clone());
    let limit = query.limit.unwrap_or(50).clamp(1, 200);
    let offset = query.offset.unwrap_or(0).max(0);
    let entries = svc
        .get_user_history(user.user_id, limit, offset)
        .await
        .map_err(|e| ApiError::internal(format!("Failed to load ledger: {}", e)))?;

    Ok(HttpResponse::Ok().json(LedgerHistoryResponse {
        entries: entries
            .into_iter()
            .map(|e| LedgerEntryResponse {
                id: e.id,
                tx_type: e.tx_type.as_str().to_string(),
                amount_wei: e.amount_wei.to_string(),
                free_balance_before_wei: e.free_balance_before_wei.to_string(),
                free_balance_after_wei: e.free_balance_after_wei.to_string(),
                reference_id: e.reference_id,
                reference_type: e.reference_type,
                chain_tx_hash: e.chain_tx_hash,
                description: e.description,
                created_at: e.created_at.timestamp_millis(),
            })
            .collect(),
    }))
}
