use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize)]
pub struct BalanceResponse {
    pub deposited_wei: String,
    pub withdrawn_wei: String,
    pub realized_pnl_wei: String,
    pub locked_margin_wei: String,
    pub free_balance_wei: String,
}

#[derive(Debug, Serialize)]
pub struct ProfileResponse {
    pub id: Uuid,
    pub wallet_address: String,
    pub username: Option<String>,
    pub deposited_wei: String,
    pub withdrawn_wei: String,
    pub realized_pnl_wei: String,
    pub locked_margin_wei: String,
    pub free_balance_wei: String,
    pub total_trades: i32,
    pub total_wins: i32,
    pub total_losses: i32,
    pub win_rate: f64,
    pub current_streak: i32,
    pub max_streak: i32,
    pub created_at: i64,
}

#[derive(Debug, Serialize)]
pub struct LeaderboardEntry {
    pub rank: i64,
    pub wallet_address: String,
    pub username: Option<String>,
    pub realized_pnl_wei: String,
    pub win_rate: f64,
    pub total_trades: i32,
    pub best_win_streak: i32,
}

#[derive(Debug, Serialize)]
pub struct LeaderboardResponse {
    pub entries: Vec<LeaderboardEntry>,
    pub period: String,
}

#[derive(Debug, Deserialize)]
pub struct LeaderboardQuery {
    pub period: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct LedgerEntryResponse {
    pub id: Uuid,
    pub tx_type: String,
    pub amount_wei: String,
    pub free_balance_before_wei: String,
    pub free_balance_after_wei: String,
    pub reference_id: Option<Uuid>,
    pub reference_type: Option<String>,
    pub chain_tx_hash: Option<String>,
    pub description: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Deserialize)]
pub struct LedgerHistoryQuery {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct LedgerHistoryResponse {
    pub entries: Vec<LedgerEntryResponse>,
}

/// Updatable user-profile fields. All optional — partial updates allowed.
/// `username` is currently the only mutable field; add more here as
/// product surfaces them.
#[derive(Debug, Deserialize)]
pub struct UpdateProfileRequest {
    pub username: Option<String>,
}
