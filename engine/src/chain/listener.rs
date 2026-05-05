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

        // ── Catchup pass ─────────────────────────────────────────────
        // `subscribe_logs` over WS is real-time only — it does NOT
        // replay the [from_block, head] range, even with `from_block`
        // set on the filter. Without this catchup, every restart drops
        // any event that arrived between the previous engine stop and
        // this subscribe. We back-fill via `eth_getLogs` first.
        let head = provider
            .get_block_number()
            .await
            .map_err(|e| ListenerError::Provider(e.to_string()))?;
        let safe_head = head.saturating_sub(self.min_confirmations);
        if safe_head > from_block {
            let filter = Filter::new()
                .address(self.vault)
                .from_block(from_block)
                .to_block(safe_head);
            match provider.get_logs(&filter).await {
                Ok(logs) if !logs.is_empty() => {
                    tracing::info!(
                        from_block,
                        safe_head,
                        count = logs.len(),
                        "Vault listener catchup sweep"
                    );
                    let mut latest_block: u64 = from_block;
                    for log in logs {
                        let log_block = log.block_number.unwrap_or(0);
                        let tx_hash = log
                            .transaction_hash
                            .map(|h| format!("0x{:x}", h))
                            .unwrap_or_default();
                        let log_index = log.log_index.unwrap_or(0);
                        self.dispatch(&log, log_block, &tx_hash, log_index).await;
                        if log_block > latest_block {
                            latest_block = log_block;
                        }
                    }
                    let _ = self.handler.advance_cursor(latest_block).await;
                }
                Ok(_) => {}
                Err(e) => {
                    tracing::warn!(from_block, safe_head, "catchup getLogs failed: {}", e);
                }
            }
        }

        // ── Live subscription + periodic poll fallback ───────────────
        // The Chainstack WS subscription has been observed to go
        // silent — connection stays open, no events delivered, no
        // error returned. Relying solely on `subscribe_logs` then
        // means deposits stop crediting until the engine restarts.
        // We multiplex the WS stream with a 30 s `eth_getLogs` poll
        // tick that re-runs the same catchup sweep, so the cursor
        // advances even if the WS is dead. Idempotent on the unique
        // `(chain_tx_hash, chain_log_index)` index in `ledger`.
        let filter = Filter::new()
            .address(self.vault)
            .from_block(from_block);

        let sub = provider
            .subscribe_logs(&filter)
            .await
            .map_err(|e| ListenerError::Subscription(e.to_string()))?;
        let mut stream = sub.into_stream();

        tracing::info!(vault = %self.vault, from_block, "Vault listener subscribed");

        let mut poll_interval = tokio::time::interval(Duration::from_secs(5));
        // Skip the first immediate tick — the catchup pass above
        // already covered everything up to safe_head.
        poll_interval.tick().await;
        let mut last_polled_block = safe_head;

        loop {
            tokio::select! {
                maybe_log = stream.next() => {
                    let Some(log) = maybe_log else {
                        tracing::warn!("Vault listener WS stream closed; restart loop will reconnect");
                        return Ok(());
                    };
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
                    self.dispatch(&log, log_block, &tx_hash, log_index).await;
                    let _ = self.handler.advance_cursor(log_block).await;
                    if log_block > last_polled_block {
                        last_polled_block = log_block;
                    }
                }
                _ = poll_interval.tick() => {
                    let head = match provider.get_block_number().await {
                        Ok(n) => n,
                        Err(e) => {
                            tracing::warn!("poll: get_block_number failed: {}", e);
                            continue;
                        }
                    };
                    let safe_head = head.saturating_sub(self.min_confirmations);
                    if safe_head <= last_polled_block {
                        continue;
                    }
                    let from_block = last_polled_block + 1;
                    let poll_filter = Filter::new()
                        .address(self.vault)
                        .from_block(from_block)
                        .to_block(safe_head);
                    match provider.get_logs(&poll_filter).await {
                        Ok(logs) if !logs.is_empty() => {
                            tracing::info!(
                                from_block,
                                safe_head,
                                count = logs.len(),
                                "Vault listener poll-tick caught missed events"
                            );
                            let mut latest_block: u64 = last_polled_block;
                            for log in logs {
                                let log_block = log.block_number.unwrap_or(0);
                                let tx_hash = log
                                    .transaction_hash
                                    .map(|h| format!("0x{:x}", h))
                                    .unwrap_or_default();
                                let log_index = log.log_index.unwrap_or(0);
                                self.dispatch(&log, log_block, &tx_hash, log_index).await;
                                if log_block > latest_block {
                                    latest_block = log_block;
                                }
                            }
                            let _ = self.handler.advance_cursor(latest_block).await;
                            last_polled_block = latest_block;
                        }
                        Ok(_) => {
                            // No new events — still advance the
                            // poll cursor so we don't re-scan the
                            // same range every tick. The DB cursor
                            // only moves on actual events (so a
                            // restart restarts from the last
                            // *event* block, not the last poll).
                            last_polled_block = safe_head;
                        }
                        Err(e) => {
                            tracing::warn!(from_block, safe_head, "poll getLogs failed: {}", e);
                        }
                    }
                }
            }
        }
    }

    /// Decode + handler dispatch shared between the streaming and the
    /// catchup paths. Idempotent: the unique index on
    /// `(chain_tx_hash, chain_log_index)` in the ledger keeps any
    /// double-delivery harmless.
    async fn dispatch(
        &self,
        log: &alloy::rpc::types::Log,
        log_block: u64,
        tx_hash: &str,
        log_index: u64,
    ) {
        // Loud surface for every dispatch attempt. The previous version
        // swallowed handler errors and silently dropped logs that didn't
        // decode against any of the four event types — leading to
        // missed deposits with NO trace in the engine log. We log every
        // outcome (success or failure) so a missed credit always leaves
        // a breadcrumb.
        let topic0 = log
            .topics()
            .first()
            .map(|t| format!("0x{:x}", t))
            .unwrap_or_else(|| "<no-topic>".to_string());

        if let Ok(ev) = log.log_decode::<TradingVault::Deposited>() {
            let inner = ev.inner.data;
            match self
                .handler
                .on_deposit(DepositObserved {
                    user: inner.user,
                    amount_wei: inner.amount,
                    block_number: log_block,
                    tx_hash: tx_hash.to_string(),
                    log_index,
                })
                .await
            {
                Ok(()) => tracing::info!(block = log_block, tx = %tx_hash, "Deposit dispatched"),
                Err(e) => tracing::error!(block = log_block, tx = %tx_hash, error = %e, "Deposit handler failed"),
            }
        } else if let Ok(ev) = log.log_decode::<TradingVault::Withdrawn>() {
            let inner = ev.inner.data;
            match self
                .handler
                .on_withdraw(WithdrawObserved {
                    user: inner.user,
                    amount_wei: inner.amount,
                    nonce: inner.nonce,
                    block_number: log_block,
                    tx_hash: tx_hash.to_string(),
                    log_index,
                })
                .await
            {
                Ok(()) => tracing::info!(block = log_block, tx = %tx_hash, "Withdraw dispatched"),
                Err(e) => tracing::error!(block = log_block, tx = %tx_hash, error = %e, "Withdraw handler failed"),
            }
        } else if let Ok(ev) = log.log_decode::<TradingVault::HouseFunded>() {
            let inner = ev.inner.data;
            match self
                .handler
                .on_house_funded(HouseFundedObserved {
                    from: inner.from,
                    amount_wei: inner.amount,
                    block_number: log_block,
                    tx_hash: tx_hash.to_string(),
                    log_index,
                })
                .await
            {
                Ok(()) => tracing::info!(block = log_block, tx = %tx_hash, "HouseFunded dispatched"),
                Err(e) => tracing::error!(block = log_block, tx = %tx_hash, error = %e, "HouseFunded handler failed"),
            }
        } else if let Ok(ev) = log.log_decode::<TradingVault::HouseWithdrawn>() {
            let inner = ev.inner.data;
            match self
                .handler
                .on_house_withdrawn(HouseWithdrawnObserved {
                    to: inner.to,
                    amount_wei: inner.amount,
                    block_number: log_block,
                    tx_hash: tx_hash.to_string(),
                    log_index,
                })
                .await
            {
                Ok(()) => tracing::info!(block = log_block, tx = %tx_hash, "HouseWithdrawn dispatched"),
                Err(e) => tracing::error!(block = log_block, tx = %tx_hash, error = %e, "HouseWithdrawn handler failed"),
            }
        } else {
            tracing::warn!(
                block = log_block,
                tx = %tx_hash,
                topic0 = %topic0,
                "Vault log did not decode against any known event — credit potentially lost"
            );
        }
    }
}
