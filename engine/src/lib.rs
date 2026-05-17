// Rush trading engine — touch-in-window bets on the Base mainnet vault.

pub mod api;
pub mod arena_index;
pub mod audit;
pub mod auth;
pub mod chain;
pub mod config;
pub mod db;
pub mod errors;
pub mod ledger;
pub mod market_feed;
pub mod metrics;
pub mod models;
pub mod monitors;
pub mod risk;
pub mod touch;
pub mod utils;
pub mod vrf;
pub mod ws;

pub use config::Settings;
pub use errors::{ApiError, TradingError};
