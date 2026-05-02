//! Oracle sanity check: cross-checks the hot-path price feed (Binance WS)
//! against an on-chain reference (Chainlink/Pyth) at a fixed cadence.
//! When the absolute deviation exceeds `max_deviation_bps`, the engine
//! flips into safe mode: new positions are rejected, but liquidations
//! and closes continue to fire so users can exit.

use alloy::primitives::{Address, U256};
use alloy::providers::Provider;
use alloy::sol;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum SanityError {
    #[error("Provider error: {0}")]
    Provider(String),
    #[error("Decode error: {0}")]
    Decode(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SanityVerdict {
    Ok,
    Diverged,
}

sol! {
    /// Chainlink AggregatorV3 minimal interface.
    #[sol(rpc)]
    interface AggregatorV3 {
        function latestRoundData() external view returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
        function decimals() external view returns (uint8);
    }
}

/// Per-symbol sanity config: which Chainlink feed to read and what
/// deviation tolerance applies. Loaded from `config/default.toml`.
#[derive(Debug, Clone)]
pub struct SymbolSanityConfig {
    pub symbol: String,
    pub aggregator: Address,
    pub max_deviation_bps: u32,
    pub max_staleness_secs: u64,
}

pub struct OracleSanity<P: Provider + 'static> {
    provider: Arc<P>,
    cfg: Vec<SymbolSanityConfig>,
    interval: Duration,
}

impl<P: Provider + 'static> OracleSanity<P> {
    pub fn new(provider: Arc<P>, cfg: Vec<SymbolSanityConfig>, interval_secs: u64) -> Self {
        Self {
            provider,
            cfg,
            interval: Duration::from_secs(interval_secs),
        }
    }

    /// Compare a hot-path price against the on-chain reference.
    /// Returns `Diverged` if |hot - chain| / chain * 10_000 > max_deviation_bps,
    /// or if the round was last updated longer than `max_staleness_secs` ago.
    pub async fn check_symbol(
        &self,
        symbol: &str,
        hot_price_q8: U256,
    ) -> Result<SanityVerdict, SanityError> {
        let cfg = match self.cfg.iter().find(|c| c.symbol == symbol) {
            Some(c) => c,
            None => return Ok(SanityVerdict::Ok), // no oracle configured = skip
        };

        let agg = AggregatorV3::new(cfg.aggregator, &*self.provider);
        let round = agg
            .latestRoundData()
            .call()
            .await
            .map_err(|e| SanityError::Provider(e.to_string()))?;

        // staleness
        let now = chrono::Utc::now().timestamp() as u64;
        let updated_at: u64 = round.updatedAt.try_into().unwrap_or(0);
        if now.saturating_sub(updated_at) > cfg.max_staleness_secs {
            return Ok(SanityVerdict::Diverged);
        }

        // Chainlink answers are int256, scaled by `decimals()`. Engine prices
        // are scaled by 1e8. We assume Chainlink BTC/USD and ETH/USD use
        // 8 decimals on Base — same scale, so direct compare works.
        let chain_q8: i128 = round.answer.try_into().unwrap_or(0);
        if chain_q8 <= 0 {
            return Ok(SanityVerdict::Diverged);
        }
        let chain_q8 = chain_q8 as u128;

        let hot: u128 = match U256::try_into(hot_price_q8) {
            Ok(v) => v,
            Err(_) => return Ok(SanityVerdict::Diverged),
        };

        let diff = if hot > chain_q8 { hot - chain_q8 } else { chain_q8 - hot };
        let bps = (diff.saturating_mul(10_000)) / chain_q8;
        if bps as u32 > cfg.max_deviation_bps {
            tracing::warn!(
                symbol,
                hot_price = hot,
                chain_price = chain_q8,
                bps,
                "Oracle deviation exceeded threshold"
            );
            Ok(SanityVerdict::Diverged)
        } else {
            Ok(SanityVerdict::Ok)
        }
    }

    pub fn interval(&self) -> Duration {
        self.interval
    }
}

/// Helper for parsing a hex address from config.
pub fn parse_address(s: &str) -> Result<Address, SanityError> {
    Address::from_str(s).map_err(|e| SanityError::Decode(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deviation_bps_arithmetic() {
        // 1% deviation = 100 bps.
        let chain: u128 = 50_000_000_000_000; // BTC at 500_000.00000000 (1e8 scale)
        let hot: u128 = 50_500_000_000_000; // 1% higher
        let diff = hot - chain;
        let bps = (diff * 10_000) / chain;
        assert_eq!(bps, 100);

        // 0.05% = 5 bps
        let hot2: u128 = 50_025_000_000_000;
        let bps2 = ((hot2 - chain) * 10_000) / chain;
        assert_eq!(bps2, 5);
    }
}
