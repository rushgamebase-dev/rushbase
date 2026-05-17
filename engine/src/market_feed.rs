//! Real-market price feed for the main Tap Trading mode.
//!
//! The VRF/Rush Index arena remains available as a legacy symbol, but
//! real-price Tap Trading needs one authoritative in-process feed for
//! quoting, settlement, HTTP snapshots, and WS broadcasts. This module
//! keeps a short rolling trade history per symbol and can be backed by
//! Binance's public trade stream.

use crate::config::settings::RealPriceConfig;
use crate::db::MarketPriceTickRepository;
use chrono::Utc;
use futures_util::StreamExt;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_tungstenite::connect_async;

#[derive(Debug, Clone, Serialize)]
pub struct MarketPriceSnapshot {
    pub symbol: String,
    pub price_q8: i64,
    pub timestamp_ms: i64,
    pub source: String,
    pub stale: bool,
}

#[derive(Debug, Clone)]
struct SymbolState {
    price_q8: i64,
    timestamp_ms: i64,
    history: VecDeque<(i64, f64)>,
}

#[derive(Debug, Clone)]
pub struct MarketPriceTick {
    pub symbol: String,
    pub timestamp_ms: i64,
    pub price_q8: i64,
    pub source: String,
}

#[derive(Debug)]
pub struct RealPriceFeed {
    enabled: bool,
    source: String,
    symbols: Vec<String>,
    stale_after_ms: i64,
    history_window_ms: i64,
    state: RwLock<HashMap<String, SymbolState>>,
    persistence_tx: RwLock<Option<mpsc::Sender<MarketPriceTick>>>,
}

impl RealPriceFeed {
    pub fn new(config: &RealPriceConfig) -> Self {
        let symbols = config
            .symbols
            .iter()
            .map(|s| normalize_symbol_key(s))
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>();
        Self {
            enabled: config.enabled,
            source: config.source.clone(),
            symbols,
            stale_after_ms: config.stale_after_ms,
            history_window_ms: config.history_window_ms,
            state: RwLock::new(HashMap::new()),
            persistence_tx: RwLock::new(None),
        }
    }

    pub fn enabled(&self) -> bool {
        self.enabled
    }

    pub fn symbols(&self) -> &[String] {
        &self.symbols
    }

    pub fn normalize_symbol(&self, symbol: &str) -> Option<String> {
        let key = normalize_symbol_key(symbol);
        if self.symbols.iter().any(|s| s == &key) {
            return Some(key);
        }

        // User-facing labels often omit the settlement suffix
        // (`ETHUSD`/`ETH-USD`/`ETH/USD`). Internally we store the
        // Binance pair (`ETHUSDT`) so all quote tokens stay canonical.
        if let Some(base) = key.strip_suffix("USD") {
            let usdt = format!("{base}USDT");
            if self.symbols.iter().any(|s| s == &usdt) {
                return Some(usdt);
            }
        }

        None
    }

    pub fn is_supported(&self, symbol: &str) -> bool {
        self.enabled && self.normalize_symbol(symbol).is_some()
    }

    pub fn attach_persistence(&self, tx: mpsc::Sender<MarketPriceTick>) {
        *self.persistence_tx.write() = Some(tx);
    }

    pub fn snapshot(&self, symbol: &str) -> Option<MarketPriceSnapshot> {
        let symbol = self.normalize_symbol(symbol)?;
        let state = self.state.read();
        let row = state.get(&symbol)?;
        Some(MarketPriceSnapshot {
            symbol,
            price_q8: row.price_q8,
            timestamp_ms: row.timestamp_ms,
            source: self.source.clone(),
            stale: self.is_stale_ts(row.timestamp_ms),
        })
    }

    pub fn snapshots(&self) -> Vec<MarketPriceSnapshot> {
        self.symbols
            .iter()
            .filter_map(|symbol| self.snapshot(symbol))
            .collect()
    }

    pub fn current_q8(&self, symbol: &str) -> Option<i64> {
        let snapshot = self.snapshot(symbol)?;
        if snapshot.stale {
            None
        } else {
            Some(snapshot.price_q8)
        }
    }

    pub fn path_window(&self, symbol: &str, start_ms: i64, end_ms: i64) -> Vec<(i64, f64)> {
        let Some(symbol) = self.normalize_symbol(symbol) else {
            return Vec::new();
        };
        let state = self.state.read();
        let Some(row) = state.get(&symbol) else {
            return Vec::new();
        };

        let mut out = Vec::new();
        let mut before: Option<(i64, f64)> = None;
        let mut after: Option<(i64, f64)> = None;
        for &(ts, price) in &row.history {
            if ts < start_ms {
                before = Some((ts, price));
            } else if ts <= end_ms {
                out.push((ts, price));
            } else {
                after = Some((ts, price));
                break;
            }
        }

        // Include the boundary neighbours so segment-crossing checks
        // can see a move that starts just before the window or ends
        // just after it. The resolver still clamps the segment to the
        // requested window.
        if let Some(p) = before {
            out.insert(0, p);
        }
        if let Some(p) = after {
            out.push(p);
        }
        out
    }

    pub fn record_price(&self, symbol: &str, price: f64, timestamp_ms: i64) {
        if !self.enabled || !price.is_finite() || price <= 0.0 {
            return;
        }
        let Some(symbol) = self.normalize_symbol(symbol) else {
            return;
        };
        let price_q8 = (price * 1e8).round() as i64;
        {
            let cutoff = timestamp_ms - self.history_window_ms;
            let mut state = self.state.write();
            let row = state.entry(symbol.clone()).or_insert_with(|| SymbolState {
                price_q8,
                timestamp_ms,
                history: VecDeque::new(),
            });
            if timestamp_ms < row.timestamp_ms {
                return;
            }
            row.price_q8 = price_q8;
            row.timestamp_ms = timestamp_ms;
            row.history.push_back((timestamp_ms, price));
            while row.history.front().map_or(false, |(ts, _)| *ts < cutoff) {
                row.history.pop_front();
            }
        }

        if let Some(tx) = self.persistence_tx.read().as_ref() {
            let _ = tx.try_send(MarketPriceTick {
                symbol,
                timestamp_ms,
                price_q8,
                source: self.source.clone(),
            });
        }
    }

    fn is_stale_ts(&self, timestamp_ms: i64) -> bool {
        Utc::now().timestamp_millis() - timestamp_ms > self.stale_after_ms
    }
}

pub fn spawn_market_tick_writer(pool: PgPool, feed: Arc<RealPriceFeed>) {
    let (tx, mut rx) = mpsc::channel::<MarketPriceTick>(8192);
    feed.attach_persistence(tx);

    tokio::spawn(async move {
        let repo = MarketPriceTickRepository::new(pool);
        let mut prune = tokio::time::interval(Duration::from_secs(60 * 60));
        loop {
            tokio::select! {
                Some(tick) = rx.recv() => {
                    if let Err(err) = repo
                        .insert_tick(&tick.symbol, tick.timestamp_ms, tick.price_q8, &tick.source)
                        .await
                    {
                        tracing::warn!(
                            symbol = %tick.symbol,
                            timestamp_ms = tick.timestamp_ms,
                            error = %err,
                            "Failed to persist market price tick"
                        );
                    }
                }
                _ = prune.tick() => {
                    let cutoff_ms = Utc::now().timestamp_millis() - 24 * 60 * 60 * 1_000;
                    match repo.prune_older_than(cutoff_ms).await {
                        Ok(rows) if rows > 0 => {
                            tracing::info!(rows, "Pruned old market price ticks");
                        }
                        Ok(_) => {}
                        Err(err) => {
                            tracing::warn!(error = %err, "Failed to prune market price ticks");
                        }
                    }
                }
            }
        }
    });
}

pub fn spawn_binance_feed(feed: Arc<RealPriceFeed>, config: RealPriceConfig) {
    if !feed.enabled() || feed.symbols().is_empty() {
        tracing::info!("Real-price feed disabled");
        return;
    }

    let rest_feed = feed.clone();
    let rest_config = config.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(30));
        loop {
            interval.tick().await;
            refresh_rest_prices(rest_feed.clone(), &rest_config).await;
        }
    });

    tokio::spawn(async move {
        refresh_rest_prices(feed.clone(), &config).await;
        loop {
            if let Err(err) = run_binance_ws(feed.clone(), &config).await {
                tracing::warn!(error = %err, "Real-price Binance stream disconnected");
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    });
}

async fn refresh_rest_prices(feed: Arc<RealPriceFeed>, config: &RealPriceConfig) {
    let client = reqwest::Client::new();
    for symbol in feed.symbols() {
        let url = format!(
            "{}/api/v3/ticker/price?symbol={}",
            config.binance_rest_base_url.trim_end_matches('/'),
            symbol
        );
        match client.get(&url).send().await {
            Ok(resp) => match resp.json::<BinanceTicker>().await {
                Ok(ticker) => {
                    if let Ok(price) = ticker.price.parse::<f64>() {
                        feed.record_price(&ticker.symbol, price, Utc::now().timestamp_millis());
                    }
                }
                Err(err) => tracing::debug!(symbol, error = %err, "Failed to decode ticker price"),
            },
            Err(err) => tracing::debug!(symbol, error = %err, "Failed to fetch ticker price"),
        }
    }
}

async fn run_binance_ws(feed: Arc<RealPriceFeed>, config: &RealPriceConfig) -> anyhow::Result<()> {
    let streams = feed
        .symbols()
        .iter()
        .map(|s| format!("{}@trade", s.to_lowercase()))
        .collect::<Vec<_>>()
        .join("/");
    let url = format!(
        "{}/stream?streams={}",
        config.binance_ws_base_url.trim_end_matches('/'),
        streams
    );
    tracing::info!(url = %url, "Connecting real-price Binance stream");
    let (ws, _) = connect_async(&url).await?;
    let (_, mut read) = ws.split();
    while let Some(msg) = read.next().await {
        let msg = msg?;
        if !msg.is_text() {
            continue;
        }
        let event: BinanceCombinedTrade = serde_json::from_str(msg.to_text()?)?;
        if let Ok(price) = event.data.price.parse::<f64>() {
            feed.record_price(&event.data.symbol, price, event.data.trade_time_ms);
        }
    }
    Ok(())
}

fn normalize_symbol_key(symbol: &str) -> String {
    symbol
        .trim()
        .to_uppercase()
        .replace('/', "")
        .replace('-', "")
        .replace('_', "")
}

#[derive(Debug, Deserialize)]
struct BinanceTicker {
    symbol: String,
    price: String,
}

#[derive(Debug, Deserialize)]
struct BinanceCombinedTrade {
    data: BinanceTrade,
}

#[derive(Debug, Deserialize)]
struct BinanceTrade {
    #[serde(rename = "s")]
    symbol: String,
    #[serde(rename = "p")]
    price: String,
    #[serde(rename = "T")]
    trade_time_ms: i64,
}
