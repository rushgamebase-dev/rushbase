//! Public price endpoints. In the VRF arena there is exactly one
//! "price" — the in-process Rush Index. The endpoints below
//! preserve the legacy shape (`{symbol, price_q8, timestamp}`) so
//! existing frontends keep working without a rewrite, but they only
//! ever surface the index.
//!
//! No external feed, no Binance, no oracle. Bet resolution is via
//! per-bet VRF path (`vrf::path`); the price returned here is *only*
//! the visual anchor.

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
}

#[derive(Serialize)]
pub struct PricesResponse {
    pub prices: Vec<PriceResponse>,
}

pub async fn get_prices(app_state: web::Data<AppState>) -> Result<HttpResponse, ApiError> {
    let snapshot = app_state.arena_index.snapshot();
    let prices = vec![PriceResponse {
        symbol: snapshot.symbol,
        price_q8: snapshot.price_q8.to_string(),
        timestamp: snapshot.timestamp_ms,
        server_seed_hash: snapshot.server_seed_hash,
    }];
    Ok(HttpResponse::Ok().json(PricesResponse { prices }))
}

pub async fn get_price_by_symbol(
    app_state: web::Data<AppState>,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let symbol = path.into_inner().to_uppercase();
    if !symbol.eq_ignore_ascii_case(RUSH_INDEX_SYMBOL) {
        return Err(ApiError::not_found(
            "Only RUSH_INDEX is supported in the VRF arena",
        ));
    }
    let snapshot = app_state.arena_index.snapshot();
    Ok(HttpResponse::Ok().json(PriceResponse {
        symbol: snapshot.symbol,
        price_q8: snapshot.price_q8.to_string(),
        timestamp: snapshot.timestamp_ms,
        server_seed_hash: snapshot.server_seed_hash,
    }))
}

pub async fn get_symbols() -> HttpResponse {
    let symbols = vec![serde_json::json!({
        "symbol": RUSH_INDEX_SYMBOL,
        "kind": "vrf_arena",
        "description": "Rush Index — deterministic in-process arena anchor. \
                        Bet resolution is via per-bet VRF path, not this index.",
    })];
    HttpResponse::Ok().json(serde_json::json!({ "symbols": symbols }))
}
