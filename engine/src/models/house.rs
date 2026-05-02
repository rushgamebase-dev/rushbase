use bigdecimal::BigDecimal;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// House solvency snapshot — singleton row from `house_state` (migration 005).
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct HouseState {
    pub id: Uuid,

    /// On-chain `houseBalance` mirrored off-chain. Refreshed by the vault
    /// listener on `HouseFunded` / `HouseWithdrawn`.
    pub house_buffer_wei: BigDecimal,

    /// Cumulative house P&L in wei (signed).
    pub realized_pnl_wei: BigDecimal,

    pub total_volume_wei: BigDecimal,
    pub total_trades: i32,

    pub circuit_breaker_triggered: bool,
    pub circuit_breaker_reason: Option<String>,
    pub circuit_breaker_triggered_at: Option<DateTime<Utc>>,

    pub updated_at: DateTime<Utc>,
}

/// In-memory exposure tracker per symbol — not persisted directly; the
/// `ExposureTracker` keeps a `DashMap<symbol, SymbolExposure>` populated
/// from open positions at startup and updated on each open/close.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SymbolExposure {
    pub symbol: String,

    pub long_position_count: u64,
    pub short_position_count: u64,

    pub total_long_notional_wei: BigDecimal,
    pub total_short_notional_wei: BigDecimal,

    pub total_long_margin_wei: BigDecimal,
    pub total_short_margin_wei: BigDecimal,

    pub house_unrealized_pnl_wei: BigDecimal,
    pub house_realized_pnl_wei: BigDecimal,

    pub current_price_q8: BigDecimal,
    pub last_updated: i64,
}

impl SymbolExposure {
    pub fn new(symbol: String) -> Self {
        Self {
            symbol,
            ..Default::default()
        }
    }

    pub fn gross_exposure_wei(&self) -> BigDecimal {
        &self.total_long_notional_wei + &self.total_short_notional_wei
    }

    pub fn net_exposure_wei(&self) -> BigDecimal {
        &self.total_long_notional_wei - &self.total_short_notional_wei
    }

    pub fn total_position_count(&self) -> u64 {
        self.long_position_count + self.short_position_count
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HouseStateSummary {
    pub buffer_wei: String,
    pub realized_pnl_wei: String,
    pub total_gross_exposure_wei: String,
    pub total_net_exposure_wei: String,
    pub total_position_count: u64,
    pub circuit_breaker_triggered: bool,
}
