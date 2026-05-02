//! Read-side accessor for the on-chain vault state. Wrapped behind a
//! trait so the WithdrawService and the solvency monitor can be tested
//! without an RPC.

use alloy::primitives::{Address, U256};
use async_trait::async_trait;
use std::sync::Arc;
use thiserror::Error;
use url::Url;

#[derive(Debug, Error)]
pub enum VaultBalanceError {
    #[error("RPC error: {0}")]
    Rpc(String),
    #[error("Decode error: {0}")]
    Decode(String),
    #[error("Invalid URL: {0}")]
    InvalidUrl(String),
}

#[async_trait]
pub trait VaultBalanceProvider: Send + Sync {
    /// Total ETH held in the vault contract (`address(this).balance`).
    async fn vault_eth_balance(&self) -> Result<U256, VaultBalanceError>;
    /// `houseBalance()` storage variable — the part of the vault marked
    /// as house-owned (winners are paid out of this bucket).
    async fn house_balance(&self) -> Result<U256, VaultBalanceError>;
}

/// Production implementation that goes over JSON-RPC. We call
/// `eth_getBalance` and `eth_call` directly with `reqwest` rather than
/// instantiating a full alloy `Provider` per call — keeps this module
/// independent of the alloy provider type wiring.
pub struct AlloyVaultBalanceProvider {
    rpc_url: String,
    vault: Address,
    client: reqwest::Client,
}

impl AlloyVaultBalanceProvider {
    pub fn new(rpc_url: String, vault: Address) -> Self {
        Self {
            rpc_url,
            vault,
            client: reqwest::Client::new(),
        }
    }

    pub fn shared(rpc_url: String, vault: Address) -> Arc<Self> {
        Arc::new(Self::new(rpc_url, vault))
    }

    async fn rpc(&self, body: serde_json::Value) -> Result<serde_json::Value, VaultBalanceError> {
        let _: Url = self
            .rpc_url
            .parse()
            .map_err(|e: url::ParseError| VaultBalanceError::InvalidUrl(e.to_string()))?;
        let resp: serde_json::Value = self
            .client
            .post(&self.rpc_url)
            .json(&body)
            .send()
            .await
            .map_err(|e| VaultBalanceError::Rpc(e.to_string()))?
            .json()
            .await
            .map_err(|e| VaultBalanceError::Decode(e.to_string()))?;
        if let Some(err) = resp.get("error") {
            return Err(VaultBalanceError::Rpc(err.to_string()));
        }
        Ok(resp)
    }
}

fn parse_hex_u256(s: &str) -> Result<U256, VaultBalanceError> {
    let trimmed = s.trim_start_matches("0x");
    U256::from_str_radix(trimmed, 16).map_err(|e| VaultBalanceError::Decode(e.to_string()))
}

#[async_trait]
impl VaultBalanceProvider for AlloyVaultBalanceProvider {
    async fn vault_eth_balance(&self) -> Result<U256, VaultBalanceError> {
        let body = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "eth_getBalance",
            "params": [format!("0x{:x}", self.vault), "latest"],
            "id": 1
        });
        let resp = self.rpc(body).await?;
        let result = resp
            .get("result")
            .and_then(|v| v.as_str())
            .ok_or_else(|| VaultBalanceError::Decode("missing result".into()))?;
        parse_hex_u256(result)
    }

    async fn house_balance(&self) -> Result<U256, VaultBalanceError> {
        // selector(houseBalance()) = keccak256("houseBalance()")[..4]
        // = 0x67084eb3 (verified by selector_test below)
        let body = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "eth_call",
            "params": [{
                "to": format!("0x{:x}", self.vault),
                "data": "0x67084eb3"
            }, "latest"],
            "id": 1
        });
        let resp = self.rpc(body).await?;
        let result = resp
            .get("result")
            .and_then(|v| v.as_str())
            .ok_or_else(|| VaultBalanceError::Decode("missing result".into()))?;
        parse_hex_u256(result)
    }
}

/// Test fake — wraps an `Arc<Mutex<(eth, house)>>` you can mutate from
/// tests. The whole point is to avoid spinning a fake JSON-RPC server.
#[cfg(any(test, feature = "test-helpers"))]
pub struct MockVaultBalanceProvider {
    inner: parking_lot::Mutex<(U256, U256)>,
}

#[cfg(any(test, feature = "test-helpers"))]
impl MockVaultBalanceProvider {
    pub fn new(eth_balance: U256, house_balance: U256) -> Self {
        Self {
            inner: parking_lot::Mutex::new((eth_balance, house_balance)),
        }
    }

    pub fn set(&self, eth_balance: U256, house_balance: U256) {
        let mut g = self.inner.lock();
        *g = (eth_balance, house_balance);
    }
}

#[cfg(any(test, feature = "test-helpers"))]
#[async_trait]
impl VaultBalanceProvider for MockVaultBalanceProvider {
    async fn vault_eth_balance(&self) -> Result<U256, VaultBalanceError> {
        Ok(self.inner.lock().0)
    }
    async fn house_balance(&self) -> Result<U256, VaultBalanceError> {
        Ok(self.inner.lock().1)
    }
}

/// Verify selector at compile time.
#[cfg(test)]
mod selector_test {
    use alloy::primitives::keccak256;

    #[test]
    fn house_balance_selector_is_correct() {
        let sel = &keccak256("houseBalance()")[..4];
        assert_eq!(sel, &[0x67, 0x08, 0x4e, 0xb3]);
    }

    #[test]
    fn parse_hex_u256_basic() {
        let v = super::parse_hex_u256("0x10").unwrap();
        assert_eq!(v, alloy::primitives::U256::from(16u64));
    }
}

#[cfg(test)]
fn _silence_unused_url_import() {
    // ensures `Url` import is exercised even when the trait is the only
    // thing called.
    let _ = url::Url::parse("https://example.com").unwrap();
}
