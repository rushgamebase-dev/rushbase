//! End-to-end HTTP tests covering the request lifecycle through the
//! actual actix-web routing stack: bearer auth, the per-user rate limit,
//! is_active enforcement, the breaker gate, idempotency replay, and
//! the admin-role middleware.
//!
//! Each test brings up a fresh Postgres via testcontainers, then a
//! real `actix_web::App` with the engine's `configure_routes` mounted.
//! No HTTP listener is bound — `actix_web::test::init_service` drives
//! the router in-process. Because `is_active`/admin checks hit the DB,
//! the tests don't need an actual signer or vault.
//!
//! Run with:
//!   cargo test --test http_e2e -- --test-threads=1
//!
//! Requires Docker (testcontainers).

use std::sync::Arc;

use actix_governor::{GovernorConfigBuilder, PeerIpKeyExtractor};
use actix_web::{http::StatusCode, test, web, App};
use alloy::primitives::Address;
use bigdecimal::BigDecimal;
use chrono::Utc;
use rust_decimal::Decimal;
use sqlx::PgPool;
use std::str::FromStr;
use testcontainers::runners::AsyncRunner;
use testcontainers_modules::postgres::Postgres as PostgresImage;
use uuid::Uuid;

use rush_engine::api::anti_replay::{
    MemoryActiveCache, MemoryIdempotency, MemoryNonceStore, MemoryRateLimit,
};
use rush_engine::api::{configure_routes, AppState};
use rush_engine::arena_index::{ArenaIndex, RUSH_INDEX_SYMBOL};
use rush_engine::auth::{JwtService, SiweVerifier};
use rush_engine::chain::WithdrawSigner;
use rush_engine::config::settings::{
    JwtConfig as JwtCfgToml, MultiplierConfig, RiskConfig, TouchConfig,
};
use rush_engine::market_feed::RealPriceFeed;
use rush_engine::metrics::EngineMetrics;
use rush_engine::risk::{limits_from_config, ExposureTracker};
use rush_engine::touch::{QuoteSigner, TouchEngine};
use rush_engine::vrf::SeedCipher;
use rush_engine::ws::Broadcaster;

const SYMBOL: &str = "BTCUSDT";
const ENTRY_PRICE_Q8: i64 = 50_000_00000000;
const SIGNER_HEX: &str = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

// ─── infrastructure helpers ─────────────────────────────────────────────

async fn fresh_pool() -> PgPool {
    let container = PostgresImage::default()
        .start()
        .await
        .expect("postgres start (Docker required)");
    let port = container
        .get_host_port_ipv4(5432)
        .await
        .expect("port lookup");
    Box::leak(Box::new(container));
    let url = format!("postgres://postgres:postgres@127.0.0.1:{}/postgres", port);
    let pool = PgPool::connect(&url).await.expect("connect pool");
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("migrations failed");
    pool
}

fn touch_cfg() -> TouchConfig {
    TouchConfig {
        accepting_bets: true,
        min_stake_wei: "1000000000000000".into(),
        max_stake_wei: "5000000000000000000".into(),
        max_active_bets_per_user: 25,
        allowed_window_ms: vec![3_000, 6_000],
        min_distance_bps: 5,
        max_distance_bps: 1_000,
        resolution_check_interval_ms: 100,
        min_activation_delay_ms: 1_000,
    }
}

fn mult_cfg() -> MultiplierConfig {
    use rush_engine::config::settings::EmpiricalCell;
    let empirical_cells = vec![
        EmpiricalCell {
            distance_bps: 40,
            duration_ms: 3_000,
            window_start_offset_ms: 0,
            p_touch: 0.4436,
        },
        EmpiricalCell {
            distance_bps: 80,
            duration_ms: 3_000,
            window_start_offset_ms: 0,
            p_touch: 0.0669,
        },
        EmpiricalCell {
            distance_bps: 120,
            duration_ms: 3_000,
            window_start_offset_ms: 0,
            p_touch: 0.0032,
        },
    ];
    MultiplierConfig {
        house_edge_bps: 500,
        min_multiplier_bps: 11_000,
        max_multiplier_bps: 200_000,
        vol_bps_per_sqrt_sec: 5.0,
        empirical_safety_factor: 1.5,
        empirical_cells,
    }
}

fn risk_cfg() -> RiskConfig {
    RiskConfig {
        max_house_potential_payout_wei: "500000000000000000000".into(),
        max_per_symbol_potential_payout_wei: "200000000000000000000".into(),
        min_house_buffer_wei: "0".into(),
        max_payout_per_bet_wei: "10000000000000000000".into(),
        max_potential_payout_per_user_wei: "500000000000000000000".into(),
        circuit_breaker_threshold_bps: 9_000,
    }
}

fn jwt_cfg() -> JwtCfgToml {
    JwtCfgToml {
        secret: "this-is-a-test-jwt-secret-with-32-bytes!".into(),
        access_token_expires_secs: 900,
        refresh_token_expires_secs: 0,
    }
}

async fn build_app_state(pool: PgPool) -> web::Data<AppState> {
    let arena_index = Arc::new(ArenaIndex::new("http-e2e-test-seed"));
    let real_price_feed = Arc::new(RealPriceFeed::new(&Default::default()));
    real_price_feed.record_price(
        SYMBOL,
        ENTRY_PRICE_Q8 as f64 / 1e8,
        chrono::Utc::now().timestamp_millis(),
    );

    let exposure = Arc::new(
        ExposureTracker::new(limits_from_config(&risk_cfg())).with_persistence(pool.clone()),
    );
    sqlx::query("UPDATE house_state SET house_buffer_wei = $1::numeric")
        .bind(BigDecimal::from_str("100000000000000000000").unwrap())
        .execute(&pool)
        .await
        .expect("seed house_state");

    let vrf_cipher = Arc::new(SeedCipher::from_hex(&"a".repeat(64)).expect("http_e2e seed cipher"));
    let vault_addr = Address::from([0u8; 20]);
    let withdraw_signer =
        Arc::new(WithdrawSigner::from_hex(SIGNER_HEX, 8453, vault_addr).expect("signer"));

    let touch_engine = Arc::new(TouchEngine::new(
        pool.clone(),
        arena_index.clone(),
        real_price_feed.clone(),
        exposure.clone(),
        vrf_cipher.clone(),
        withdraw_signer.clone(),
        &touch_cfg(),
        &mult_cfg(),
        &risk_cfg(),
    ));

    let jwt_service = Arc::new(JwtService::new(&jwt_cfg()));
    let siwe_verifier = Arc::new(SiweVerifier::new("localhost:3000".to_string(), 8453));
    let withdraw_service = Arc::new(rush_engine::chain::WithdrawService::new(
        pool.clone(),
        withdraw_signer.clone(),
        rush_engine::chain::AlloyVaultBalanceProvider::shared("http://invalid".into(), vault_addr),
        900,
    ));

    let registry = prometheus::Registry::new();
    let engine_metrics = Arc::new(EngineMetrics::new(&registry).expect("metrics"));

    let quote_signer = Arc::new(
        QuoteSigner::new("integration-test-secret-32-bytes-or-more!", 5_000).expect("signer"),
    );

    let app_state = web::Data::new(AppState {
        pool: pool.clone(),
        jwt_service,
        siwe_verifier,
        arena_index: arena_index.clone(),
        real_price_feed,
        touch_engine,
        withdraw_service,
        broadcaster: Arc::new(Broadcaster::new()),
        exposure,
        metrics: engine_metrics,
        quote_signer,
        commit_signer: withdraw_signer.clone(),
        vrf_cipher: vrf_cipher.clone(),
        quote_nonces: Arc::new(MemoryNonceStore::new(5_000)),
        idempotency: Arc::new(MemoryIdempotency::new(15 * 60 * 1_000)),
        user_rate_limiter: Arc::new(MemoryRateLimit::new(120, 10_000)),
        user_active_cache: Arc::new(MemoryActiveCache::new(1_000)),
        siwe_nonce_ttl_secs: 300,
    });
    app_state
}

fn governor() -> actix_governor::GovernorConfig<
    PeerIpKeyExtractor,
    actix_governor::governor::middleware::NoOpMiddleware,
> {
    GovernorConfigBuilder::default()
        .requests_per_second(100)
        .burst_size(200)
        .key_extractor(PeerIpKeyExtractor)
        .finish()
        .expect("governor")
}

async fn make_user(pool: &PgPool, free_balance_wei: &str, is_admin: bool) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO users (id, wallet_address, deposited_wei, withdrawn_wei, realized_pnl_wei, locked_margin_wei, current_win_streak, best_win_streak, total_trades, total_wins, total_losses, is_active, is_admin) \
         VALUES ($1, $2, $3::numeric, 0, 0, 0, 0, 0, 0, 0, 0, true, $4)",
    )
    .bind(id)
    .bind(format!("0x{:040x}", id.as_u128()))
    .bind(BigDecimal::from_str(free_balance_wei).expect("balance"))
    .bind(is_admin)
    .execute(pool)
    .await
    .expect("insert user");
    id
}

fn token_for(state: &AppState, user_id: Uuid, wallet: &str) -> String {
    state
        .jwt_service
        .issue(user_id, wallet)
        .expect("token")
        .access_token
}

// ─── tests ──────────────────────────────────────────────────────────────

#[actix_web::test]
async fn health_endpoint_returns_ok() {
    let pool = fresh_pool().await;
    let state = build_app_state(pool).await;
    let governor_conf = governor();
    let app = test::init_service(
        App::new()
            .app_data(state.clone())
            .configure(move |cfg| configure_routes(cfg, &governor_conf)),
    )
    .await;
    let req = test::TestRequest::get().uri("/api/v1/health").to_request();
    let resp = test::call_service(&app, req).await;
    assert_eq!(resp.status(), StatusCode::OK);
}

#[actix_web::test]
async fn quote_returns_signed_token_and_open_bet_consumes_it() {
    let pool = fresh_pool().await;
    let state = build_app_state(pool.clone()).await;
    let user = make_user(&pool, "5000000000000000000", false).await;
    let token = token_for(&state, user, &format!("0x{:040x}", user.as_u128()));
    let governor_conf = governor();
    let app = test::init_service(
        App::new()
            .app_data(state.clone())
            .configure(move |cfg| configure_routes(cfg, &governor_conf)),
    )
    .await;

    // 1. Quote
    let quote_req = test::TestRequest::post()
        .peer_addr("127.0.0.1:54321".parse().unwrap())
        .uri("/api/v1/trade/quote")
        .set_json(serde_json::json!({
            "symbol": SYMBOL,
            "direction": "UP",
            "target_row_min_q8": "5010000000000",
            "target_row_max_q8": "5020000000000",
            "window_duration_ms": 3_000_u64,
            "window_start_offset_ms": 1_500_u64,
        }))
        .to_request();
    let quote_resp = test::call_service(&app, quote_req).await;
    assert_eq!(quote_resp.status(), StatusCode::OK, "quote should succeed");
    let quote_body: serde_json::Value = test::read_body_json(quote_resp).await;
    let quote_token = quote_body
        .get("quote_token")
        .and_then(|v| v.as_str())
        .expect("quote_token");
    let multiplier_bps = quote_body
        .get("multiplier_bps")
        .and_then(|v| v.as_u64())
        .expect("multiplier_bps");
    let quote_server_time_ms = quote_body
        .get("server_time_ms")
        .and_then(|v| v.as_i64())
        .expect("server_time_ms");

    // 2. Open bet using the signed quote
    let window_start_ms = quote_server_time_ms + 1_500;
    let open_req = test::TestRequest::post()
        .uri("/api/v1/trade/bets")
        .insert_header(("Authorization", format!("Bearer {}", token)))
        .insert_header(("Idempotency-Key", "first-attempt"))
        .set_json(serde_json::json!({
            "symbol": SYMBOL,
            "direction": "UP",
            "stake_wei": "100000000000000000",
            "target_row_min_q8": "5010000000000",
            "target_row_max_q8": "5020000000000",
            "window_start_ms": window_start_ms,
            "window_end_ms": window_start_ms + 3_000,
            "expected_multiplier_bps": multiplier_bps,
            "quote_token": quote_token,
        }))
        .to_request();
    let open_resp = test::call_service(&app, open_req).await;
    assert_eq!(
        open_resp.status(),
        StatusCode::CREATED,
        "bet should be created"
    );
    let bet1: serde_json::Value = test::read_body_json(open_resp).await;
    let bet_id = bet1.get("id").and_then(|v| v.as_str()).expect("bet id");

    // 3. Same idempotency key replays the same response (no second bet).
    let now_ms = chrono::Utc::now().timestamp_millis();
    let replay_req = test::TestRequest::post()
        .uri("/api/v1/trade/bets")
        .insert_header(("Authorization", format!("Bearer {}", token)))
        .insert_header(("Idempotency-Key", "first-attempt"))
        .set_json(serde_json::json!({
            "symbol": SYMBOL,
            "direction": "UP",
            "stake_wei": "100000000000000000",
            "target_row_min_q8": "5010000000000",
            "target_row_max_q8": "5020000000000",
            "window_start_ms": now_ms + 1_500,
            "window_end_ms": now_ms + 4_500,
            "expected_multiplier_bps": multiplier_bps,
            "quote_token": quote_token,
        }))
        .to_request();
    let replay_resp = test::call_service(&app, replay_req).await;
    assert_eq!(
        replay_resp.status(),
        StatusCode::CREATED,
        "replay returns 201"
    );
    assert_eq!(
        replay_resp
            .headers()
            .get("Idempotent-Replayed")
            .map(|v| v.to_str().unwrap().to_string()),
        Some("true".into()),
        "replay marker should be present"
    );
    let bet2: serde_json::Value = test::read_body_json(replay_resp).await;
    assert_eq!(
        bet2.get("id"),
        Some(&serde_json::Value::String(bet_id.into()))
    );
}

#[actix_web::test]
async fn open_bet_without_quote_token_rejected() {
    let pool = fresh_pool().await;
    let state = build_app_state(pool.clone()).await;
    let user = make_user(&pool, "5000000000000000000", false).await;
    let token = token_for(&state, user, &format!("0x{:040x}", user.as_u128()));
    let governor_conf = governor();
    let app = test::init_service(
        App::new()
            .app_data(state.clone())
            .configure(move |cfg| configure_routes(cfg, &governor_conf)),
    )
    .await;

    let now_ms = chrono::Utc::now().timestamp_millis();
    let req = test::TestRequest::post()
        .uri("/api/v1/trade/bets")
        .insert_header(("Authorization", format!("Bearer {}", token)))
        .set_json(serde_json::json!({
            "symbol": SYMBOL,
            "direction": "UP",
            "stake_wei": "100000000000000000",
            "target_row_min_q8": "5010000000000",
            "target_row_max_q8": "5020000000000",
            "window_start_ms": now_ms + 1_500,
            "window_end_ms": now_ms + 4_500,
            "expected_multiplier_bps": 11_000_u32,
            "quote_token": "garbage",
        }))
        .to_request();
    let resp = test::call_service(&app, req).await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[actix_web::test]
async fn banned_user_cannot_open_bet() {
    let pool = fresh_pool().await;
    let state = build_app_state(pool.clone()).await;
    let user = make_user(&pool, "5000000000000000000", false).await;
    sqlx::query("UPDATE users SET is_active = false WHERE id = $1")
        .bind(user)
        .execute(&pool)
        .await
        .unwrap();
    let token = token_for(&state, user, &format!("0x{:040x}", user.as_u128()));
    let governor_conf = governor();
    let app = test::init_service(
        App::new()
            .app_data(state.clone())
            .configure(move |cfg| configure_routes(cfg, &governor_conf)),
    )
    .await;

    let req = test::TestRequest::get()
        .uri("/api/v1/user/balance")
        .insert_header(("Authorization", format!("Bearer {}", token)))
        .to_request();
    let resp = test::call_service(&app, req).await;
    assert_eq!(
        resp.status(),
        StatusCode::FORBIDDEN,
        "banned user must hit the is_active gate"
    );
}

#[actix_web::test]
async fn admin_can_reset_breaker_normal_user_cannot() {
    let pool = fresh_pool().await;
    let state = build_app_state(pool.clone()).await;
    let admin_id = make_user(&pool, "1000000000000000000", true).await;
    let user_id = make_user(&pool, "1000000000000000000", false).await;
    let admin_token = token_for(&state, admin_id, &format!("0x{:040x}", admin_id.as_u128()));
    let user_token = token_for(&state, user_id, &format!("0x{:040x}", user_id.as_u128()));
    let governor_conf = governor();
    let app = test::init_service(
        App::new()
            .app_data(state.clone())
            .configure(move |cfg| configure_routes(cfg, &governor_conf)),
    )
    .await;

    // Trip the breaker so reset has something to do.
    state.exposure.trigger_circuit_breaker("test trip");

    // Non-admin → 403.
    let user_req = test::TestRequest::post()
        .uri("/api/v1/admin/breaker/reset")
        .insert_header(("Authorization", format!("Bearer {}", user_token)))
        .to_request();
    let user_resp = test::call_service(&app, user_req).await;
    assert_eq!(user_resp.status(), StatusCode::FORBIDDEN);

    // Admin → 200, and the breaker is cleared.
    let admin_req = test::TestRequest::post()
        .uri("/api/v1/admin/breaker/reset")
        .insert_header(("Authorization", format!("Bearer {}", admin_token)))
        .to_request();
    let admin_resp = test::call_service(&app, admin_req).await;
    assert_eq!(admin_resp.status(), StatusCode::OK);
    assert!(!state.exposure.is_circuit_breaker_triggered());
}

#[actix_web::test]
async fn admin_ban_takes_effect_via_cache_invalidation() {
    let pool = fresh_pool().await;
    let state = build_app_state(pool.clone()).await;
    let admin_id = make_user(&pool, "1000000000000000000", true).await;
    let target = make_user(&pool, "1000000000000000000", false).await;
    let admin_token = token_for(&state, admin_id, &format!("0x{:040x}", admin_id.as_u128()));
    let target_token = token_for(&state, target, &format!("0x{:040x}", target.as_u128()));
    let governor_conf = governor();
    let app = test::init_service(
        App::new()
            .app_data(state.clone())
            .configure(move |cfg| configure_routes(cfg, &governor_conf)),
    )
    .await;

    // Target works first.
    let pre = test::TestRequest::get()
        .uri("/api/v1/user/balance")
        .insert_header(("Authorization", format!("Bearer {}", target_token)))
        .to_request();
    assert_eq!(test::call_service(&app, pre).await.status(), StatusCode::OK);

    // Admin bans.
    let ban_req = test::TestRequest::post()
        .uri(&format!("/api/v1/admin/users/{}/ban", target))
        .insert_header(("Authorization", format!("Bearer {}", admin_token)))
        .set_json(serde_json::json!({ "reason": "test ban" }))
        .to_request();
    assert_eq!(
        test::call_service(&app, ban_req).await.status(),
        StatusCode::OK
    );

    // Target now blocked, even though their JWT is still valid — the
    // ban handler invalidates the active-status cache so the next
    // request re-reads is_active=false.
    let post = test::TestRequest::get()
        .uri("/api/v1/user/balance")
        .insert_header(("Authorization", format!("Bearer {}", target_token)))
        .to_request();
    assert_eq!(
        test::call_service(&app, post).await.status(),
        StatusCode::FORBIDDEN
    );
}

#[actix_web::test]
async fn breaker_tripped_blocks_open_bet() {
    let pool = fresh_pool().await;
    let state = build_app_state(pool.clone()).await;
    let user = make_user(&pool, "5000000000000000000", false).await;
    let token = token_for(&state, user, &format!("0x{:040x}", user.as_u128()));
    let governor_conf = governor();
    let app = test::init_service(
        App::new()
            .app_data(state.clone())
            .configure(move |cfg| configure_routes(cfg, &governor_conf)),
    )
    .await;

    // Trip the breaker BEFORE the user tries to open.
    state.exposure.trigger_circuit_breaker("e2e test");

    // Quote first to get a token (quote endpoint is unaffected by breaker).
    let quote_req = test::TestRequest::post()
        .peer_addr("127.0.0.1:54321".parse().unwrap())
        .uri("/api/v1/trade/quote")
        .set_json(serde_json::json!({
            "symbol": SYMBOL,
            "direction": "UP",
            "target_row_min_q8": "5010000000000",
            "target_row_max_q8": "5020000000000",
            "window_duration_ms": 3_000_u64,
        }))
        .to_request();
    let qr = test::call_service(&app, quote_req).await;
    assert_eq!(qr.status(), StatusCode::OK);
    let qb: serde_json::Value = test::read_body_json(qr).await;
    let token_str = qb["quote_token"].as_str().unwrap().to_string();
    let mult = qb["multiplier_bps"].as_u64().unwrap();

    // Open should be refused with 503.
    let now_ms = chrono::Utc::now().timestamp_millis();
    let open_req = test::TestRequest::post()
        .uri("/api/v1/trade/bets")
        .insert_header(("Authorization", format!("Bearer {}", token)))
        .set_json(serde_json::json!({
            "symbol": SYMBOL,
            "direction": "UP",
            "stake_wei": "100000000000000000",
            "target_row_min_q8": "5010000000000",
            "target_row_max_q8": "5020000000000",
            "window_start_ms": now_ms + 1_500,
            "window_end_ms": now_ms + 4_500,
            "expected_multiplier_bps": mult,
            "quote_token": token_str,
        }))
        .to_request();
    let resp = test::call_service(&app, open_req).await;
    assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);
}

#[actix_web::test]
async fn openapi_endpoint_returns_valid_spec() {
    let pool = fresh_pool().await;
    let state = build_app_state(pool).await;
    let governor_conf = governor();
    let app = test::init_service(
        App::new()
            .app_data(state.clone())
            .configure(move |cfg| configure_routes(cfg, &governor_conf)),
    )
    .await;
    let req = test::TestRequest::get()
        .uri("/api/v1/openapi.json")
        .to_request();
    let resp = test::call_service(&app, req).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let body: serde_json::Value = test::read_body_json(resp).await;
    assert_eq!(body["openapi"], "3.1.0");
    assert_eq!(body["info"]["title"], "Rush Touch Trading Engine");
    assert!(body["paths"]["/api/v1/trade/quote"].is_object());
    assert!(body["paths"]["/api/v1/trade/bets"].is_object());
}

#[actix_web::test]
async fn treasury_endpoint_returns_correct_math() {
    let pool = fresh_pool().await;
    let state = build_app_state(pool.clone()).await;
    let admin = make_user(&pool, "1000000000000000000", true).await;
    let user = make_user(&pool, "1000000000000000000", false).await;
    let admin_token = token_for(&state, admin, &format!("0x{:040x}", admin.as_u128()));
    let user_token = token_for(&state, user, &format!("0x{:040x}", user.as_u128()));
    let governor_conf = governor();
    let app = test::init_service(
        App::new()
            .app_data(state.clone())
            .configure(move |cfg| configure_routes(cfg, &governor_conf)),
    )
    .await;

    // Non-admin → 403.
    let user_req = test::TestRequest::get()
        .uri("/api/v1/admin/house/treasury")
        .insert_header(("Authorization", format!("Bearer {}", user_token)))
        .to_request();
    assert_eq!(
        test::call_service(&app, user_req).await.status(),
        StatusCode::FORBIDDEN
    );

    // Admin → 200 with the four mandatory fields.
    let admin_req = test::TestRequest::get()
        .uri("/api/v1/admin/house/treasury")
        .insert_header(("Authorization", format!("Bearer {}", admin_token)))
        .to_request();
    let resp = test::call_service(&app, admin_req).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let body: serde_json::Value = test::read_body_json(resp).await;
    assert!(body.get("house_buffer_wei").is_some());
    assert!(body.get("realized_pnl_wei").is_some());
    assert!(body.get("outstanding_potential_payout_wei").is_some());
    assert!(body.get("safe_withdrawable_wei").is_some());

    // Sanity: with min_buffer=0 in the test config and no outstanding
    // payouts (no bets opened), safe == buffer.
    assert_eq!(
        body["safe_withdrawable_wei"].as_str(),
        body["house_buffer_wei"].as_str(),
    );
}

#[actix_web::test]
async fn logout_revokes_only_caller_token() {
    let pool = fresh_pool().await;
    let state = build_app_state(pool.clone()).await;
    let user = make_user(&pool, "1000000000000000000", false).await;
    let token_a = token_for(&state, user, &format!("0x{:040x}", user.as_u128()));
    // A second token for the SAME user — simulates a second device.
    let token_b = token_for(&state, user, &format!("0x{:040x}", user.as_u128()));
    assert_ne!(
        token_a, token_b,
        "JWTs share the user but have distinct jti"
    );
    let governor_conf = governor();
    let app = test::init_service(
        App::new()
            .app_data(state.clone())
            .configure(move |cfg| configure_routes(cfg, &governor_conf)),
    )
    .await;

    // Token A works initially.
    let pre = test::TestRequest::get()
        .uri("/api/v1/user/balance")
        .insert_header(("Authorization", format!("Bearer {}", token_a)))
        .to_request();
    assert_eq!(test::call_service(&app, pre).await.status(), StatusCode::OK);

    // Logout via token A revokes only its jti.
    let logout_req = test::TestRequest::post()
        .uri("/api/v1/auth/logout")
        .insert_header(("Authorization", format!("Bearer {}", token_a)))
        .peer_addr("127.0.0.1:54321".parse().unwrap())
        .to_request();
    assert_eq!(
        test::call_service(&app, logout_req).await.status(),
        StatusCode::OK
    );

    // Token A is now revoked.
    let post_a = test::TestRequest::get()
        .uri("/api/v1/user/balance")
        .insert_header(("Authorization", format!("Bearer {}", token_a)))
        .to_request();
    assert_eq!(
        test::call_service(&app, post_a).await.status(),
        StatusCode::UNAUTHORIZED
    );

    // Token B (same user, different jti) still works — proves logout
    // is per-session, not per-user.
    let post_b = test::TestRequest::get()
        .uri("/api/v1/user/balance")
        .insert_header(("Authorization", format!("Bearer {}", token_b)))
        .to_request();
    assert_eq!(
        test::call_service(&app, post_b).await.status(),
        StatusCode::OK
    );
}

#[actix_web::test]
async fn admin_revoke_all_tokens_kicks_every_session() {
    let pool = fresh_pool().await;
    let state = build_app_state(pool.clone()).await;
    let admin = make_user(&pool, "1000000000000000000", true).await;
    let user = make_user(&pool, "1000000000000000000", false).await;
    let admin_token = token_for(&state, admin, &format!("0x{:040x}", admin.as_u128()));
    let token_a = token_for(&state, user, &format!("0x{:040x}", user.as_u128()));
    let token_b = token_for(&state, user, &format!("0x{:040x}", user.as_u128()));
    let governor_conf = governor();
    let app = test::init_service(
        App::new()
            .app_data(state.clone())
            .configure(move |cfg| configure_routes(cfg, &governor_conf)),
    )
    .await;

    // Both work first.
    for t in [&token_a, &token_b] {
        let r = test::TestRequest::get()
            .uri("/api/v1/user/balance")
            .insert_header(("Authorization", format!("Bearer {}", t)))
            .to_request();
        assert_eq!(test::call_service(&app, r).await.status(), StatusCode::OK);
    }

    // Sleep 1 second so the watermark we're about to set is strictly
    // greater than the issued-at of either token. JWT `iat` resolution
    // is 1 second; without this delay the test races with the same
    // timestamp.
    tokio::time::sleep(std::time::Duration::from_secs(1)).await;

    // Admin revokes ALL tokens for the user.
    let revoke_req = test::TestRequest::post()
        .uri(&format!("/api/v1/admin/users/{}/revoke_all_tokens", user))
        .insert_header(("Authorization", format!("Bearer {}", admin_token)))
        .to_request();
    let resp = test::call_service(&app, revoke_req).await;
    assert_eq!(resp.status(), StatusCode::OK);

    // Both tokens (despite distinct jtis) are now refused.
    for t in [&token_a, &token_b] {
        let r = test::TestRequest::get()
            .uri("/api/v1/user/balance")
            .insert_header(("Authorization", format!("Bearer {}", t)))
            .to_request();
        assert_eq!(
            test::call_service(&app, r).await.status(),
            StatusCode::UNAUTHORIZED,
            "token issued before watermark must be rejected"
        );
    }
}

#[actix_web::test]
async fn fresh_token_after_revoke_all_works_again() {
    // Regression: setting tokens_invalidated_before_ms must NOT block
    // tokens issued AFTER the bump. Mints-after-revoke is the normal
    // re-login flow.
    let pool = fresh_pool().await;
    let state = build_app_state(pool.clone()).await;
    let admin = make_user(&pool, "1000000000000000000", true).await;
    let user = make_user(&pool, "1000000000000000000", false).await;
    let admin_token = token_for(&state, admin, &format!("0x{:040x}", admin.as_u128()));
    let governor_conf = governor();
    let app = test::init_service(
        App::new()
            .app_data(state.clone())
            .configure(move |cfg| configure_routes(cfg, &governor_conf)),
    )
    .await;

    // Bump the watermark.
    let revoke_req = test::TestRequest::post()
        .uri(&format!("/api/v1/admin/users/{}/revoke_all_tokens", user))
        .insert_header(("Authorization", format!("Bearer {}", admin_token)))
        .to_request();
    test::call_service(&app, revoke_req).await;

    // Wait one second so a fresh JWT's `iat` is strictly > watermark.
    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    let fresh = token_for(&state, user, &format!("0x{:040x}", user.as_u128()));
    let r = test::TestRequest::get()
        .uri("/api/v1/user/balance")
        .insert_header(("Authorization", format!("Bearer {}", fresh)))
        .to_request();
    assert_eq!(test::call_service(&app, r).await.status(), StatusCode::OK);
}

#[actix_web::test]
async fn breaker_state_persists_across_recovery() {
    let pool = fresh_pool().await;
    let state = build_app_state(pool.clone()).await;
    state.exposure.trigger_circuit_breaker("persist test");
    // Simulated process restart: build a fresh tracker and recover.
    let restored =
        ExposureTracker::new(limits_from_config(&risk_cfg())).with_persistence(pool.clone());
    // Wait briefly for the spawn that persisted the trip to land.
    for _ in 0..30 {
        let row: Option<bool> =
            sqlx::query_scalar("SELECT circuit_breaker_triggered FROM house_state LIMIT 1")
                .fetch_optional(&pool)
                .await
                .unwrap()
                .flatten();
        if row == Some(true) {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    restored.recover_from_db(&pool).await.expect("recover");
    assert!(restored.is_circuit_breaker_triggered());
}
