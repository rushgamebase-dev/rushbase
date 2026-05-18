use crate::api::handlers;
use crate::api::middleware::{admin_validator, validator};
use crate::api::openapi::openapi_json;
use actix_governor::governor::middleware::NoOpMiddleware;
use actix_governor::{Governor, GovernorConfig, PeerIpKeyExtractor};
use actix_web::web;
use actix_web_httpauth::middleware::HttpAuthentication;

pub type RateLimit = GovernorConfig<PeerIpKeyExtractor, NoOpMiddleware>;

pub fn configure_routes(cfg: &mut web::ServiceConfig, governor: &RateLimit) {
    cfg.service(
        web::scope("/api/v1")
            .route("/health", web::get().to(handlers::health_check))
            .route("/ready", web::get().to(handlers::readiness_check))
            // Static OpenAPI 3.1 spec built from the utoipa derives.
            // Frontends can `openapi-typescript` this into typed clients.
            .route("/openapi.json", web::get().to(openapi_json))
            // Rate-limited unauthenticated endpoints — anti brute-force
            // (SIWE nonce/verify) and anti quote-flood.
            .service(
                web::scope("/auth")
                    .wrap(Governor::new(governor))
                    .route("/siwe/nonce", web::post().to(handlers::siwe_nonce))
                    .route("/siwe/verify", web::post().to(handlers::siwe_verify))
                    // Logout requires a valid bearer; the per-IP gov on
                    // /auth still applies as DoS belt-and-braces.
                    .service(
                        web::resource("/logout")
                            .wrap(HttpAuthentication::bearer(validator))
                            .route(web::post().to(handlers::logout)),
                    ),
            )
            .service(
                web::scope("/prices")
                    .route("", web::get().to(handlers::get_prices))
                    .route("/symbols", web::get().to(handlers::get_symbols))
                    .route("/{symbol}", web::get().to(handlers::get_price_by_symbol)),
            )
            .route("/leaderboard", web::get().to(handlers::get_leaderboard))
            // Public quote — rate-limited; placed BEFORE the authenticated
            // /trade scope so its more-specific path matches first.
            .service(
                web::resource("/trade/quote")
                    .wrap(Governor::new(governor))
                    .route(web::post().to(handlers::quote)),
            )
            // Public, rate-limited grid quote: prices the entire visible
            // catalog in one round-trip, with disabled_reason flags. The
            // frontend polls this every ~250 ms while a user is on the
            // trade screen — the rate limiter caps the impact of a
            // misbehaving client.
            .service(
                web::resource("/trade/quote-grid")
                    .wrap(Governor::new(governor))
                    .route(web::post().to(handlers::quote_grid)),
            )
            // Euphoria-style compact matrix: server builds the whole
            // visible multiplier rectangle and the frontend only decodes
            // Uint16 values. This is the primary quote feed for Tap
            // Trading going forward.
            .service(
                web::resource("/trade/quote-matrix")
                    .wrap(Governor::new(governor))
                    .route(web::post().to(handlers::quote_matrix)),
            )
            // Public, cacheable: pricing-config snapshot so the frontend
            // can replicate `multiplierFor` locally with the empirical
            // table. Not rate-limited — single response per UI session.
            .route(
                "/trade/multiplier_config",
                web::get().to(handlers::multiplier_config),
            )
            // Public social-proof feeds — anonymised, no auth. The
            // canvas polls these every few seconds to render the
            // "Active Bets" and "Recent Wins" panels with real data.
            // Not rate-limited individually because the queries are
            // small and the table is bounded by `LIMIT` in the repo.
            .route(
                "/trade/bets/public",
                web::get().to(handlers::list_public_active),
            )
            .route(
                "/trade/wins/public",
                web::get().to(handlers::list_public_wins),
            )
            .route(
                "/trade/heatmap",
                web::get().to(handlers::get_heatmap),
            )
            .service(
                web::scope("/user")
                    .wrap(HttpAuthentication::bearer(validator))
                    .route("/balance", web::get().to(handlers::get_balance))
                    .route("/profile", web::get().to(handlers::get_profile))
                    .route("/profile", web::patch().to(handlers::update_profile))
                    .route("/ledger", web::get().to(handlers::get_ledger_history)),
            )
            .service(
                web::scope("/trade")
                    .wrap(HttpAuthentication::bearer(validator))
                    .route("/bets", web::post().to(handlers::open_bet))
                    .route("/bets", web::get().to(handlers::list_active))
                    // More-specific routes first so actix matches
                    // `/bets/:id/verify` before `/bets/:id`.
                    .route("/bets/{id}/verify", web::get().to(handlers::verify_bet))
                    .route("/bets/{id}", web::get().to(handlers::get_bet))
                    .route("/history", web::get().to(handlers::list_history))
                    .route("/withdraw/sign", web::post().to(handlers::sign_withdraw)),
            )
            // Admin-only — every route gated by both bearer + is_admin.
            // Banning yourself is rejected at the handler level. Resetting
            // the breaker without checking the cause is a foot-gun; the
            // operator runbook calls out the precondition.
            .service(
                web::scope("/admin")
                    .wrap(HttpAuthentication::bearer(admin_validator))
                    .route("/breaker", web::get().to(handlers::get_breaker_state))
                    .route("/breaker/reset", web::post().to(handlers::reset_breaker))
                    .route("/users/{id}/ban", web::post().to(handlers::ban_user))
                    .route("/users/{id}/unban", web::post().to(handlers::unban_user))
                    .route(
                        "/users/{id}/revoke_all_tokens",
                        web::post().to(handlers::revoke_all_tokens),
                    )
                    .route("/audit", web::get().to(handlers::list_audit))
                    .route("/house/treasury", web::get().to(handlers::get_treasury)),
            ),
    );
}
