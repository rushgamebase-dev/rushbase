use bigdecimal::BigDecimal;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// User account. Identity = wallet_address (lowercased 0x...).
/// All monetary fields are in wei. The serialized JSON uses string
/// representation to preserve uint256 precision across the wire.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct User {
    pub id: Uuid,

    pub wallet_address: String,
    pub username: Option<String>,

    #[serde(with = "bigdecimal_as_string")]
    pub deposited_wei: BigDecimal,
    #[serde(with = "bigdecimal_as_string")]
    pub withdrawn_wei: BigDecimal,
    #[serde(with = "bigdecimal_as_string")]
    pub realized_pnl_wei: BigDecimal,
    #[serde(with = "bigdecimal_as_string")]
    pub locked_margin_wei: BigDecimal,

    pub is_active: bool,

    #[serde(with = "bigdecimal_as_string_opt")]
    pub max_position_size_wei: Option<BigDecimal>,
    pub max_leverage: Option<i32>,

    pub next_withdraw_nonce: i64,

    pub total_trades: i32,
    pub total_wins: i32,
    pub total_losses: i32,
    pub current_win_streak: i32,
    pub best_win_streak: i32,

    pub last_login_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl User {
    /// Free balance in wei = deposited + realized_pnl - withdrawn - locked_margin.
    /// May be negative briefly during settlement; engine treats negative as
    /// "insufficient" and refuses new locks.
    pub fn free_balance_wei(&self) -> BigDecimal {
        &self.deposited_wei + &self.realized_pnl_wei - &self.withdrawn_wei - &self.locked_margin_wei
    }

    pub fn win_rate(&self) -> f64 {
        if self.total_trades == 0 {
            0.0
        } else {
            (self.total_wins as f64 / self.total_trades as f64) * 100.0
        }
    }
}

/// Public-facing balance view (all wei as decimal strings).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserBalance {
    pub deposited_wei: String,
    pub withdrawn_wei: String,
    pub realized_pnl_wei: String,
    pub locked_margin_wei: String,
    pub free_balance_wei: String,
}

impl From<&User> for UserBalance {
    fn from(u: &User) -> Self {
        Self {
            deposited_wei: u.deposited_wei.to_string(),
            withdrawn_wei: u.withdrawn_wei.to_string(),
            realized_pnl_wei: u.realized_pnl_wei.to_string(),
            locked_margin_wei: u.locked_margin_wei.to_string(),
            free_balance_wei: u.free_balance_wei().to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct LeaderboardEntry {
    pub rank: i64,
    pub id: Uuid,
    pub wallet_address: String,
    pub username: Option<String>,
    #[serde(with = "bigdecimal_as_string")]
    pub realized_pnl_wei: BigDecimal,
    pub total_trades: i32,
    pub total_wins: i32,
    pub win_rate: f64,
    pub best_win_streak: i32,
}

// ─── serde helpers ─────────────────────────────────────────────────────

mod bigdecimal_as_string {
    use bigdecimal::BigDecimal;
    use serde::{Deserialize, Deserializer, Serialize, Serializer};
    use std::str::FromStr;

    pub fn serialize<S: Serializer>(value: &BigDecimal, ser: S) -> Result<S::Ok, S::Error> {
        value.to_string().serialize(ser)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(de: D) -> Result<BigDecimal, D::Error> {
        let s = String::deserialize(de)?;
        BigDecimal::from_str(&s).map_err(serde::de::Error::custom)
    }
}

mod bigdecimal_as_string_opt {
    use bigdecimal::BigDecimal;
    use serde::{Deserialize, Deserializer, Serialize, Serializer};
    use std::str::FromStr;

    pub fn serialize<S: Serializer>(value: &Option<BigDecimal>, ser: S) -> Result<S::Ok, S::Error> {
        match value {
            Some(v) => v.to_string().serialize(ser),
            None => ser.serialize_none(),
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(de: D) -> Result<Option<BigDecimal>, D::Error> {
        let opt = Option::<String>::deserialize(de)?;
        opt.map(|s| BigDecimal::from_str(&s).map_err(serde::de::Error::custom))
            .transpose()
    }
}
