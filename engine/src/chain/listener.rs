//! Vault event listener.
//!
//! Subscribes to `Deposited`, `Withdrawn`, and `HouseFunded` from the
//! deployed `TradingVault`. Each event waits `min_confirmations` blocks
//! before being mirrored into Postgres (idempotent on
//! `(chain_tx_hash, chain_log_index)`).
//!
//! This module owns the *subscription loop only*. The actual ledger write
//! is delegated to `EventHandler`, implemented by the trading service —
//! keeping this module free of repository details.

use crate::chain::types::TradingVault;
use alloy::primitives::Address;
use alloy::providers::{Provider, ProviderBuilder, WsConnect};
use alloy::rpc::types::Filter;
use async_trait::async_trait;
use futures_util::StreamExt;
use std::sync::Arc;
use std::time::Duration;
use thiserror::Error;
use url::Url;

#[derive(Debug, Error)]
pub enum ListenerError {
    #[error("Provider error: {0}")]
    Provider(String),
    #[error("Subscription error: {0}")]
    Subscription(String),
    #[error("Handler error: {0}")]
    Handler(String),
}

#[derive(Debug, Clone)]
pub struct DepositObserved {
    pub user: Address,
    pub amount_wei: alloy::primitives::U256,
    pub block_number: u64,
    pub tx_hash: String,
    pub log_index: u64,
}

#[derive(Debug, Clone)]
pub struct WithdrawObserved {
    pub user: Address,
    pub amount_wei: alloy::primitives::U256,
    pub nonce: alloy::primitives::U256,
    pub block_number: u64,
    pub tx_hash: String,
    pub log_index: u64,
}

#[derive(Debug, Clone)]
pub struct HouseFundedObserved {
    pub from: Address,
    pub amount_wei: alloy::primitives::U256,
    pub block_number: u64,
    pub tx_hash: String,
    pub log_index: u64,
}

#[derive(Debug, Clone)]
pub struct HouseWithdrawnObserved {
    pub to: Address,
    pub amount_wei: alloy::primitives::U256,
    pub block_number: u64,
    pub tx_hash: String,
    pub log_index: u64,
}

/// Persistence side of the listener — implemented by the service layer so
/// this module stays decoupled from `sqlx`.
#[async_trait]
pub trait EventHandler: Send + Sync {
    async fn on_deposit(&self, ev: DepositObserved) -> Result<(), ListenerError>;
    async fn on_withdraw(&self, ev: WithdrawObserved) -> Result<(), ListenerError>;
    async fn on_house_funded(&self, ev: HouseFundedObserved) -> Result<(), ListenerError>;
    async fn on_house_withdrawn(
        &self,
        ev: HouseWithdrawnObserved,
    ) -> Result<(), ListenerError>;
    async fn cursor(&self) -> Result<u64, ListenerError>;
    async fn advance_cursor(&self, block: u64) -> Result<(), ListenerError>;
}

pub struct VaultListener {
    ws_url: Url,
    vault: Address,
    min_confirmations: u64,
    handler: Arc<dyn EventHandler>,
}

impl VaultListener {
    pub fn new(
        ws_url: Url,
        vault: Address,
        min_confirmations: u64,
        handler: Arc<dyn EventHandler>,
    ) -> Self {
        Self {
            ws_url,
            vault,
            min_confirmations,
            handler,
        }
    }

    /// Run forever, reconnecting on disconnect with exponential backoff.
    pub async fn run(self) {
        let mut backoff_ms = 1_000u64;
        loop {
            match self.run_once().await {
                Ok(()) => {
                    tracing::info!("Vault listener exited cleanly; reconnecting");
                    backoff_ms = 1_000;
                }
                Err(e) => {
                    tracing::error!(error = %e, "Vault listener error; backing off {}ms", backoff_ms);
                }
            }
            tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
            backoff_ms = (backoff_ms * 2).min(30_000);
        }
    }

    async fn run_once(&self) -> Result<(), ListenerError> {
        let ws = WsConnect::new(self.ws_url.as_str());
        let provider = ProviderBuilder::new()
            .on_ws(ws)
            .await
            .map_err(|e| ListenerError::Provider(e.to_string()))?;

        let from_block = self.handler.cursor().await?.saturating_sub(self.min_confirmations);

        let filter = Filter::new()
            .address(self.vault)
            .from_block(from_block);

        let sub = provider
            .subscribe_logs(&filter)
            .await
            .map_err(|e| ListenerError::Subscription(e.to_string()))?;
        let mut stream = sub.into_stream();

        tracing::info!(vault = %self.vault, from_block, "Vault listener subscribed");

        while let Some(log) = stream.next().await {
            // Skip until the log has the required confirmation depth.
            let head = match provider.get_block_number().await {
                Ok(n) => n,
                Err(e) => {
                    tracing::warn!("get_block_number failed: {}", e);
                    continue;
                }
            };
            let log_block = log.block_number.unwrap_or(0);
            if head.saturating_sub(log_block) < self.min_confirmations {
                tokio::time::sleep(Duration::from_millis(500)).await;
                continue;
            }

            let tx_hash = log
                .transaction_hash
                .map(|h| format!("0x{:x}", h))
                .unwrap_or_default();
            let log_index = log.log_index.unwrap_or(0);

            // Decode the event by topic[0].
            if let Ok(ev) = log.log_decode::<TradingVault::Deposited>() {
                let inner = ev.inner.data;
                let _ = self
                    .handler
                    .on_deposit(DepositObserved {
                        user: inner.user,
                        amount_wei: inner.amount,
                        block_number: log_block,
                        tx_hash: tx_hash.clone(),
                        log_index,
                    })
                    .await;
            } else if let Ok(ev) = log.log_decode::<TradingVault::Withdrawn>() {
                let inner = ev.inner.data;
                let _ = self
                    .handler
                    .on_withdraw(WithdrawObserved {
                        user: inner.user,
                        amount_wei: inner.amount,
                        nonce: inner.nonce,
                        block_number: log_block,
                        tx_hash: tx_hash.clone(),
                        log_index,
                    })
                    .await;
            } else if let Ok(ev) = log.log_decode::<TradingVault::HouseFunded>() {
                let inner = ev.inner.data;
                let _ = self
                    .handler
                    .on_house_funded(HouseFundedObserved {
                        from: inner.from,
                        amount_wei: inner.amount,
                        block_number: log_block,
                        tx_hash: tx_hash.clone(),
                        log_index,
                    })
                    .await;
            } else if let Ok(ev) = log.log_decode::<TradingVault::HouseWithdrawn>() {
                let inner = ev.inner.data;
                let _ = self
                    .handler
                    .on_house_withdrawn(HouseWithdrawnObserved {
                        to: inner.to,
                        amount_wei: inner.amount,
                        block_number: log_block,
                        tx_hash: tx_hash.clone(),
                        log_index,
                    })
                    .await;
            }

            let _ = self.handler.advance_cursor(log_block).await;
        }

        Ok(())
    }
}
