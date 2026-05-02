//! OpenAPI 3.1 spec for the engine. Built statically from `utoipa`
//! derives on the DTOs. Served at `GET /api/v1/openapi.json`. Frontends
//! can pipe this into `openapi-typescript` to generate types instead of
//! hand-mirroring shapes in `lib/api.ts`.

use crate::api::dto::touch::{
    BetHistoryQuery, BetListResponse, BetResponse, EmpiricalCellDto, MultiplierConfigResponse,
    OpenBetRequest, QuoteRequest, QuoteResponse,
};
use actix_web::HttpResponse;
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Rush Touch Trading Engine",
        version = env!("CARGO_PKG_VERSION"),
        description = "Touch-in-window perpetuals on Base. Off-chain matching, on-chain ETH settlement against the TradingVault contract.",
    ),
    paths(
        crate::api::handlers::touch::quote,
        crate::api::handlers::touch::multiplier_config,
        crate::api::handlers::touch::open_bet,
        crate::api::handlers::touch::list_active,
        crate::api::handlers::touch::list_history,
    ),
    components(
        schemas(
            QuoteRequest,
            QuoteResponse,
            OpenBetRequest,
            BetResponse,
            BetListResponse,
            BetHistoryQuery,
            MultiplierConfigResponse,
            EmpiricalCellDto,
        )
    ),
    tags(
        (name = "trade", description = "Quote, place and resolve touch bets")
    ),
)]
pub struct ApiDoc;

pub async fn openapi_json() -> HttpResponse {
    let doc = ApiDoc::openapi();
    HttpResponse::Ok()
        .content_type("application/json")
        .body(doc.to_pretty_json().unwrap_or_default())
}
