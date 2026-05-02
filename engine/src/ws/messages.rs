use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum ClientMessage {
    Authenticate { token: String },
    SubscribePrices { symbols: Vec<String> },
    UnsubscribePrices { symbols: Vec<String> },
    SubscribeBets,
    UnsubscribeBets,
    SubscribeAccount,
    Ping { timestamp: i64 },
    GetPrices,
    GetActiveBets,
    GetBalance,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum ServerMessage {
    AuthResult {
        success: bool,
        user_id: Option<Uuid>,
        wallet: Option<String>,
        error: Option<String>,
    },
    Subscribed {
        channel: String,
    },
    Unsubscribed {
        channel: String,
    },

    PriceUpdate {
        symbol: String,
        price_q8: String,
        timestamp: i64,
    },
    PricesSnapshot {
        prices: Vec<PriceData>,
    },

    /// Pushed to `bets:{user_id}` when the engine accepts an open.
    /// Carries the public commit so the client can store it locally
    /// for later verification — it doesn't have to call /verify
    /// after settle to learn what was committed at place time.
    BetPlaced {
        bet: BetData,
    },
    /// Pushed when the resolution loop settles a bet. Includes the
    /// VRF reveal so the client can independently verify:
    ///
    ///   1. recompute keccak256(domain || revealed_seed || bet_id ||
    ///      wallet || band || window) and confirm == commit_hash
    ///      received at place time;
    ///   2. recover the signer address from `commit_signature` and
    ///      confirm it equals the vault contract's `engineSigner`;
    ///   3. regenerate the path from `revealed_seed_hex` and confirm
    ///      `path_points_hash` matches what the engine recorded.
    ///
    /// Only emitted after `window_end_ms`. The client can also fetch
    /// the same payload from `GET /trade/bets/:id/verify`.
    BetResolved {
        bet_id: Uuid,
        status: String,
        touched_at: Option<i64>,
        realized_pnl_wei: String,
        revealed_seed_hex: String,
        path_points_hash: String,
        path_config_version: String,
        path_regime: Option<String>,
    },
    BetsSnapshot {
        bets: Vec<BetData>,
    },

    BalanceUpdate {
        deposited_wei: String,
        withdrawn_wei: String,
        realized_pnl_wei: String,
        locked_margin_wei: String,
        free_balance_wei: String,
    },

    Error {
        code: String,
        message: String,
    },
    Pong {
        timestamp: i64,
        server_time: i64,
    },

    /// Server is going down. Clients receive this and the close frame
    /// soon after; reconnect after `retry_in_ms` to land on the next
    /// instance once the orchestrator has rolled forward.
    Shutdown {
        reason: String,
        retry_in_ms: u64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceData {
    pub symbol: String,
    pub price_q8: String,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BetData {
    pub id: Uuid,
    pub symbol: String,
    pub direction: String,
    pub status: String,
    pub stake_wei: String,
    pub multiplier_bps: i32,
    pub potential_payout_wei: String,
    pub entry_price_q8: String,
    pub target_row_min_q8: String,
    pub target_row_max_q8: String,
    pub window_start_ms: i64,
    pub window_end_ms: i64,
}

impl From<&crate::models::touch_bet::TouchBet> for BetData {
    fn from(b: &crate::models::touch_bet::TouchBet) -> Self {
        Self {
            id: b.id,
            symbol: b.symbol.clone(),
            direction: b.direction.as_str().to_string(),
            status: b.status.as_str().to_string(),
            stake_wei: b.stake_wei.to_string(),
            multiplier_bps: b.multiplier_bps,
            potential_payout_wei: b.potential_payout_wei.to_string(),
            entry_price_q8: b.entry_price_q8.to_string(),
            target_row_min_q8: b.target_row_min_q8.to_string(),
            target_row_max_q8: b.target_row_max_q8.to_string(),
            window_start_ms: b.window_start_ms,
            window_end_ms: b.window_end_ms,
        }
    }
}
