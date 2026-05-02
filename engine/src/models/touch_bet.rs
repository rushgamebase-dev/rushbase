use bigdecimal::BigDecimal;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Type};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[sqlx(type_name = "touch_direction", rename_all = "UPPERCASE")]
pub enum TouchDirection {
    Up,
    Down,
}

impl TouchDirection {
    pub fn as_str(&self) -> &'static str {
        match self {
            TouchDirection::Up => "UP",
            TouchDirection::Down => "DOWN",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[sqlx(type_name = "touch_status", rename_all = "UPPERCASE")]
pub enum TouchStatus {
    Active,
    Won,
    Lost,
    Cancelled,
}

impl TouchStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            TouchStatus::Active => "ACTIVE",
            TouchStatus::Won => "WON",
            TouchStatus::Lost => "LOST",
            TouchStatus::Cancelled => "CANCELLED",
        }
    }
}

/// Touch-in-window bet. Wins iff the deterministic VRF path crosses the
/// `[target_row_min_q8, target_row_max_q8]` band at any point inside
/// `[window_start_ms, window_end_ms]`. Multiplier and payout are fixed
/// at placement; the VRF seed used to generate the path is sealed
/// behind a keccak256 commit + EIP-191 signature until `window_end_ms`,
/// then revealed for client-side verification.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct TouchBet {
    pub id: Uuid,
    pub user_id: Uuid,

    pub symbol: String,
    pub direction: TouchDirection,
    pub status: TouchStatus,

    pub stake_wei: BigDecimal,
    pub multiplier_bps: i32,
    pub potential_payout_wei: BigDecimal,
    pub house_edge_wei: BigDecimal,

    pub entry_price_q8: BigDecimal,
    pub target_row_min_q8: BigDecimal,
    pub target_row_max_q8: BigDecimal,

    pub window_start_ms: i64,
    pub window_end_ms: i64,

    pub placed_at: DateTime<Utc>,
    pub resolved_at: Option<DateTime<Utc>>,
    pub touched_at: Option<DateTime<Utc>>,
    pub realized_pnl_wei: Option<BigDecimal>,

    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,

    // VRF commit/reveal columns. Optional on the type so `FromRow`
    // works for legacy bets that predate the migration; the active
    // engine populates them on every new INSERT.
    pub seed_encrypted: Option<Vec<u8>>,
    pub commit_hash: Option<Vec<u8>>,
    pub commit_signature: Option<Vec<u8>>,
    pub path_config_version: Option<String>,
    pub revealed_seed: Option<Vec<u8>>,
    pub path_points_hash: Option<String>,
    pub path_regime: Option<String>,
}

impl TouchBet {
    /// Window duration in milliseconds.
    pub fn window_ms(&self) -> i64 {
        self.window_end_ms - self.window_start_ms
    }

    /// Convenience: bet is currently resolvable (window has elapsed).
    pub fn is_window_elapsed(&self, now_ms: i64) -> bool {
        now_ms >= self.window_end_ms
    }
}

/// Live snapshot broadcast over WS while a bet is still ACTIVE.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TouchBetTick {
    pub bet_id: Uuid,
    pub current_price_q8: String,
    /// True if the band has been touched at least once already (preview only;
    /// authoritative resolution still waits for `window_end_ms`).
    pub provisionally_touched: bool,
    pub ms_until_resolution: i64,
    pub timestamp: i64,
}
