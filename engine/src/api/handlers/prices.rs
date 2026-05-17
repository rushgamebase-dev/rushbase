//! Public price endpoints. RUSH_INDEX remains exposed for the legacy
//! VRF/index arena, while the principal Tap Trading mode also exposes
//! real-market symbols from `RealPriceFeed`.

use crate::api::state::AppState;
use crate::arena_index::RUSH_INDEX_SYMBOL;
use crate::errors::ApiError;
use actix_web::{web, HttpResponse};
use serde::Serialize;

#[derive(Serialize)]
pub struct PriceResponse {
    pub symbol: String,
    pub price_q8: String,
    pub timestamp: i64,
    /// SHA-256 of the seed driving the index. Lets clients cache /
    /// audit the index trajectory without trusting the live feed.
    /// Stable for the lifetime of the engine process.
    pub server_seed_hash: String,
    pub kind: String,
    pub source: String,
    pub stale: bool,
}

#[derive(Serialize)]
pub struct PricesResponse {
    pub prices: Vec<PriceResponse>,
}

pub async fn get_prices(app_state: web::Data<AppState>) -> Result<HttpResponse, ApiError> {
    let snapshot = app_state.arena_index.snapshot();
    let mut prices = vec![PriceResponse {
        symbol: snapshot.symbol,
        price_q8: snapshot.price_q8.to_string(),
        timestamp: snapshot.timestamp_ms,
        server_seed_hash: snapshot.server_seed_hash,
        kind: "rush_index".into(),
        source: "arena_index".into(),
        stale: false,
    }];
    prices.extend(
        app_state
            .real_price_feed
            .snapshots()
            .into_iter()
            .map(|p| PriceResponse {
                symbol: p.symbol,
                price_q8: p.price_q8.to_string(),
                timestamp: p.timestamp_ms,
                server_seed_hash: String::new(),
                kind: "real_price".into(),
                source: p.source,
                stale: p.stale,
            }),
    );
    Ok(HttpResponse::Ok().json(PricesResponse { prices }))
}

pub async fn get_price_by_symbol(
    app_state: web::Data<AppState>,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let symbol = path.into_inner().to_uppercase();
    if !symbol.eq_ignore_ascii_case(RUSH_INDEX_SYMBOL) {
        let Some(snapshot) = app_state.real_price_feed.snapshot(&symbol) else {
            return Err(ApiError::not_found("Unsupported price symbol"));
        };
        return Ok(HttpResponse::Ok().json(PriceResponse {
            symbol: snapshot.symbol,
            price_q8: snapshot.price_q8.to_string(),
            timestamp: snapshot.timestamp_ms,
            server_seed_hash: String::new(),
            kind: "real_price".into(),
            source: snapshot.source,
            stale: snapshot.stale,
        }));
    }
    let snapshot = app_state.arena_index.snapshot();
    Ok(HttpResponse::Ok().json(PriceResponse {
        symbol: snapshot.symbol,
        price_q8: snapshot.price_q8.to_string(),
        timestamp: snapshot.timestamp_ms,
        server_seed_hash: snapshot.server_seed_hash,
        kind: "rush_index".into(),
        source: "arena_index".into(),
        stale: false,
    }))
}

pub async fn get_symbols(app_state: web::Data<AppState>) -> HttpResponse {
    let mut symbols = vec![serde_json::json!({
        "symbol": RUSH_INDEX_SYMBOL,
        "kind": "rush_index",
        "description": "Rush Index — deterministic in-process arena anchor. \
                        Bet resolution is via per-bet VRF path, not this index.",
    })];
    symbols.extend(app_state.real_price_feed.symbols().iter().map(|symbol| {
        serde_json::json!({
            "symbol": symbol,
            "kind": "real_price",
            "source": "binance",
            "description": "Real-market Tap Trading symbol. Bets quote and settle against the engine market feed."
        })
    }));
    HttpResponse::Ok().json(serde_json::json!({ "symbols": symbols }))
}
