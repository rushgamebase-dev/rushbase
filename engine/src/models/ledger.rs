use bigdecimal::BigDecimal;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Type};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[sqlx(type_name = "transaction_type", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TransactionType {
    Deposit,
    Withdrawal,
    StakeLock,
    StakeRelease,
    BetPayout,
    BetLoss,
    HouseEdgeFee,
    Adjustment,
}

impl TransactionType {
    pub fn as_str(&self) -> &'static str {
        match self {
            TransactionType::Deposit => "DEPOSIT",
            TransactionType::Withdrawal => "WITHDRAWAL",
            TransactionType::StakeLock => "STAKE_LOCK",
            TransactionType::StakeRelease => "STAKE_RELEASE",
            TransactionType::BetPayout => "BET_PAYOUT",
            TransactionType::BetLoss => "BET_LOSS",
            TransactionType::HouseEdgeFee => "HOUSE_EDGE_FEE",
            TransactionType::Adjustment => "ADJUSTMENT",
        }
    }
}

/// Ledger row mirroring the `ledger` table (migration 003). Every wei
/// movement on a user account produces exactly one entry. The
/// `chain_tx_hash`/`chain_log_index` pair is unique when present, giving
/// idempotency for on-chain DEPOSIT/WITHDRAWAL events.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct LedgerEntry {
    pub id: Uuid,
    pub user_id: Uuid,

    pub tx_type: TransactionType,
    /// Signed delta in wei.
    pub amount_wei: BigDecimal,

    pub free_balance_before_wei: BigDecimal,
    pub free_balance_after_wei: BigDecimal,

    pub reference_id: Option<Uuid>,
    pub reference_type: Option<String>,

    pub chain_tx_hash: Option<String>,
    pub chain_log_index: Option<i32>,
    pub chain_block_number: Option<i64>,

    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LedgerSummary {
    pub total_deposits_wei: String,
    pub total_withdrawals_wei: String,
    pub total_realized_pnl_wei: String,
    pub total_fees_wei: String,
    /// Net change to free balance (signed).
    pub net_balance_change_wei: String,
}

/// House ledger entry.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct HouseLedgerEntry {
    pub id: Uuid,
    pub tx_type: String,
    pub amount_wei: BigDecimal,
    pub buffer_before_wei: BigDecimal,
    pub buffer_after_wei: BigDecimal,
    pub position_id: Option<Uuid>,
    pub user_id: Option<Uuid>,
    pub chain_tx_hash: Option<String>,
    pub chain_log_index: Option<i32>,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
}
