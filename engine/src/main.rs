//! Rush trading engine entry point.
//!
//! Wires up: Postgres + migrations → JWT/SIWE → Binance hot-path price
//! feed (Decimal aggregator + q8 window aggregator) → vault listener →
//! withdraw signer → touch engine → resolution loop → HTTP API +
//! WebSocket server.

use std::str::FromStr;
use std::sync::Arc;

use actix_cors::Cors;
use actix_governor::{GovernorConfigBuilder, PeerIpKeyExtractor};
use actix_web::{middleware, web, App, HttpServer};
use actix_web_prom::PrometheusMetricsBuilder;
use alloy::primitives::{Address, U256};
use bigdecimal::BigDecimal;
use prometheus::Registry;
use std::collections::HashMap;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use url::Url;

use rush_engine::api::anti_replay::{
    spawn_memory_evictors, ActiveStatusStore, IdempotencyStore, MemoryActiveCache,
    MemoryIdempotency, MemoryNonceStore, MemoryRateLimit, NonceStore, RateLimitStore,
    RedisActiveCache, RedisIdempotency, RedisNonceStore, RedisRateLimit, RedisStores,
};
use rush_engine::api::{configure_routes, AppState};
use rush_engine::arena_index::{spawn_advancer as spawn_arena_advancer, ArenaIndex};
use rush_engine::auth::{JwtService, SiweVerifier};
use rush_engine::chain::{
    AlloyVaultBalanceProvider, SolvencyMonitor, SolvencyMonitorConfig, VaultEventHandler,
    VaultListener, WithdrawService, WithdrawSigner,
};
use rush_engine::config::Settings;
use rush_engine::db::create_pool;
use rush_engine::metrics::{spawn_sampler, EngineMetrics};
use rush_engine::monitors::{spawn_ws_revalidator, WsRevalidateConfig};
use rush_engine::risk::{bd_or_zero_u256, limits_from_config, ExposureTracker};
use rush_engine::touch::{QuoteSigner, ResolutionLoop, TouchEngine};
use rush_engine::vrf::SeedCipher;
use rush_engine::ws::{
    server::{start_price_broadcaster, ws_handler},
    Broadcaster,
};

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    // Pull `.env` (if present) before anything else so config can read
    // overrides like `APP_CHAIN__RPC_HTTP_URL`, signer key, JWT secret,
    // etc. Production deploys typically set these via the orchestrator.
    let _ = dotenvy::dotenv();

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "rush_engine=debug,actix_web=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    tracing::info!("Rush engine starting");

    let settings = Settings::new().expect("Failed to load configuration");
    tracing::info!(
        host = %settings.server.host,
        port = %settings.server.port,
        chain_id = settings.chain.chain_id,
        vault = %settings.chain.vault_address,
        siwe_domain = %settings.siwe.domain,
        "Configuration loaded"
    );

    // Refuse to boot when production-mode secrets are still the sentinel
    // values shipped in `config/default.toml`. In dev (`RUN_MODE` unset
    // or `development`) we accept them so contributors can `cargo run`
    // without ceremony.
    let run_mode = std::env::var("RUN_MODE").unwrap_or_else(|_| "development".into());
    let is_prod = run_mode == "production" || run_mode == "prod";
    if is_prod {
        let mut bad = Vec::new();
        if settings.jwt.secret.contains("change-this-in-production")
            || settings.jwt.secret.len() < 32
        {
            bad.push("APP_JWT__SECRET");
        }
        if settings.quote.signing_secret.contains("change-in-production")
            || settings.quote.signing_secret.len() < 32
        {
            bad.push("APP_QUOTE__SIGNING_SECRET");
        }
        if settings.chain.vault_address == "0x0000000000000000000000000000000000000000" {
            bad.push("APP_CHAIN__VAULT_ADDRESS");
        }
        if settings.chain.signer_private_key
            == "0x0000000000000000000000000000000000000000000000000000000000000001"
        {
            bad.push("APP_CHAIN__SIGNER_PRIVATE_KEY");
        }
        // VRF seed encryption key: refuse the sentinel in prod. A
        // wrong key in prod doesn't merely leak — it makes every seed
        // unrecoverable and every active bet unresolvable. Catching
        // this at boot is cheaper than catching it at the first
        // resolve.
        if settings.vrf.encryption_key
            == "00000000000000000000000000000000000000000000000000000000000000ff"
            || settings.vrf.encryption_key.trim().is_empty()
        {
            bad.push("APP_VRF__ENCRYPTION_KEY");
        }
        if !bad.is_empty() {
            panic!(
                "Refusing to boot in production with default-sentinel secrets: {}. Set them via env or `config/production.toml` and rotate before exposing the API.",
                bad.join(", ")
            );
        }
        tracing::info!("Production secret guards passed");
    }

    let pool = create_pool(&settings.database)
        .await
        .expect("Failed to create database pool");
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("Failed to run database migrations");
    tracing::info!("Database migrations applied");

    let jwt_service = Arc::new(JwtService::new(&settings.jwt));
    let siwe_verifier = Arc::new(SiweVerifier::new(
        settings.siwe.domain.clone(),
        settings.chain.chain_id,
    ));

    // Arena Index — deterministic in-process price line that
    // anchors `entry_price_q8` and the visual grid. No Binance, no
    // Chainlink, no oracle. Bet resolution remains 100 % VRF path
    // (see `vrf::path`); the index only sets the band reference.
    //
    // Seed comes from env when set, else random per-boot — operators
    // who want auditable index movement across restarts must pin
    // APP_VRF__ARENA_INDEX_SEED.
    let arena_index = Arc::new(
        std::env::var("APP_VRF__ARENA_INDEX_SEED")
            .ok()
            .map(|s| ArenaIndex::new(&s))
            .unwrap_or_else(ArenaIndex::random),
    );
    spawn_arena_advancer(arena_index.clone());
    tracing::info!(
        seed_hash = %arena_index.seed_hash(),
        "Rush Index advancer started"
    );
    // ExposureTracker mirrors breaker transitions to `house_state` so a
    // process restart doesn't silently un-trip the breaker.
    let exposure = Arc::new(
        ExposureTracker::new(limits_from_config(&settings.risk)).with_persistence(pool.clone()),
    );
    if let Err(e) = exposure.recover_from_db(&pool).await {
        tracing::error!(error = %e, "Failed to recover breaker state from house_state");
    }

    // Reconcile in-memory exposure with what's still on the books — bets
    // ACTIVE from before this restart represent real outstanding payouts
    // the engine must honour. Without this reconciliation a fresh process
    // would allow the next bet to violate the buffer floor.
    match sqlx::query_as::<_, (String, BigDecimal)>(
        "SELECT symbol, COALESCE(SUM(potential_payout_wei - stake_wei), 0)::numeric AS exposure \
         FROM touch_bets WHERE status = 'ACTIVE' GROUP BY symbol",
    )
    .fetch_all(&pool)
    .await
    {
        Ok(rows) => {
            let mut per_symbol: HashMap<String, U256> = HashMap::new();
            let mut total = U256::ZERO;
            for (sym, exp) in &rows {
                let v = bd_or_zero_u256(exp);
                per_symbol.insert(sym.clone(), v);
                total = total.saturating_add(v);
            }
            exposure.seed(per_symbol.clone(), total);
            tracing::info!(
                symbols = per_symbol.len(),
                total_exposure_wei = %total,
                "Exposure tracker reconciled with active bets in DB"
            );
        }
        Err(e) => {
            tracing::error!(error = %e, "Exposure recovery query failed; starting from zero");
        }
    }

    let quote_signer = Arc::new(
        QuoteSigner::new(&settings.quote.signing_secret, settings.quote.ttl_ms)
            .expect("APP_QUOTE__SIGNING_SECRET must be at least 32 bytes; rotate in prod"),
    );

    // VRF seed cipher. Built once at startup; cloned via Arc into
    // both the touch engine (encrypts at place_bet) and the resolver
    // path (decrypts at reveal). Failing to load here is fatal — we
    // don't accept bets we can't later resolve.
    let vrf_cipher = Arc::new(
        SeedCipher::from_hex(&settings.vrf.encryption_key)
            .expect("APP_VRF__ENCRYPTION_KEY must be 64 hex chars (32 bytes). Generate with `openssl rand -hex 32`."),
    );

    // Pick the storage backend up-front so every short-lived store
    // (idempotency, nonce, rate limit, active cache) routes to the same
    // place. Single-instance deploys keep everything in-process; the
    // moment we run multiple replicas, `backend = "redis"` lets a
    // retry land on any pod and still hit the cache.
    let idempotency_ttl_ms: i64 = 15 * 60 * 1_000;
    let nonce_ttl_ms: i64 = settings.quote.ttl_ms;
    let rate_window_ms: i64 = 10_000;
    let rate_max: u64 = 120;
    let active_ttl_ms: i64 = 30_000;

    let (idempotency, quote_nonces, user_rate_limiter, user_active_cache): (
        Arc<dyn IdempotencyStore>,
        Arc<dyn NonceStore>,
        Arc<dyn RateLimitStore>,
        Arc<dyn ActiveStatusStore>,
    ) = match settings.storage.backend.as_str() {
        "redis" => {
            tracing::info!(prefix = %settings.storage.prefix, "Using Redis storage backend");
            let redis_pool = rush_engine::db::redis::create_pool(&settings.redis)
                .expect("Failed to create Redis pool");
            let redis = RedisStores::new(
                redis_pool,
                settings.storage.prefix.clone(),
                idempotency_ttl_ms,
                nonce_ttl_ms,
                rate_window_ms,
                rate_max,
                active_ttl_ms,
            );
            redis
                .ping()
                .await
                .expect("Redis ping failed at boot — check `redis.url` and reachability");
            (
                Arc::new(RedisIdempotency::new(redis.clone())),
                Arc::new(RedisNonceStore::new(redis.clone())),
                Arc::new(RedisRateLimit::new(redis.clone())),
                Arc::new(RedisActiveCache::new(redis)),
            )
        }
        "memory" | _ => {
            tracing::info!("Using in-memory storage backend (single-instance only)");
            let mi = Arc::new(MemoryIdempotency::new(idempotency_ttl_ms));
            let mn = Arc::new(MemoryNonceStore::new(nonce_ttl_ms));
            let mr = Arc::new(MemoryRateLimit::new(rate_max as usize, rate_window_ms));
            let ma = Arc::new(MemoryActiveCache::new(active_ttl_ms));
            spawn_memory_evictors(mi.clone(), mn.clone(), mr.clone(), ma.clone());
            (
                mi as Arc<dyn IdempotencyStore>,
                mn as Arc<dyn NonceStore>,
                mr as Arc<dyn RateLimitStore>,
                ma as Arc<dyn ActiveStatusStore>,
            )
        }
    };

    // The signer must exist before `TouchEngine::new` so the engine
    // can seal VRF commits at place_bet, and before
    // `WithdrawService::new` for withdraw authorizations. Same EOA
    // serves both purposes — the user's "engine signer" identity is a
    // single address, not two.
    //
    // KMS takes priority when configured — falling back to a hex key
    // in production would erode the key-custody story. The boot
    // panics with a clear message if KMS is requested but the binary
    // wasn't built with `--features aws-kms`.
    let vault_addr = Address::from_str(&settings.chain.vault_address)
        .expect("Invalid vault_address in config");
    let withdraw_signer = if let Some(kms_id) = settings.chain.signer_kms_key_id.clone() {
        tracing::info!(kms_key_id = %kms_id, "Initializing KMS-backed engine signer");
        Arc::new(
            WithdrawSigner::from_kms(&kms_id, settings.chain.chain_id, vault_addr)
                .await
                .expect("Failed to initialize KMS signer"),
        )
    } else {
        tracing::warn!(
            "Using in-process hex signer key — acceptable for dev/staging only. \
             Set APP_CHAIN__SIGNER_KMS_KEY_ID and rebuild with `--features aws-kms` for production."
        );
        Arc::new(
            WithdrawSigner::from_hex(
                &settings.chain.signer_private_key,
                settings.chain.chain_id,
                vault_addr,
            )
            .expect("Invalid signer private key"),
        )
    };

    let touch_engine = Arc::new(TouchEngine::new(
        pool.clone(),
        arena_index.clone(),
        exposure.clone(),
        vrf_cipher.clone(),
        withdraw_signer.clone(),
        &settings.touch,
        &settings.multiplier,
        &settings.risk,
    ));
    let signer_addr_str = format!("0x{:x}", withdraw_signer.signer_address());
    tracing::info!(signer = %signer_addr_str, "Withdraw signer ready");

    // Record / look up activation time so we can surface signer age as
    // a metric. New signer (first time seen) → insert with kind='boot'
    // and age = 0. Existing signer → no insert, just read the oldest
    // activation row.
    let existing_first_seen: Option<chrono::DateTime<chrono::Utc>> = sqlx::query_scalar(
        "SELECT MIN(activated_at) FROM signer_audit WHERE signer_address = $1",
    )
    .bind(&signer_addr_str)
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten();
    let signer_age_days: i64 = match existing_first_seen {
        Some(ts) => (chrono::Utc::now() - ts).num_days().max(0),
        None => {
            // First time we see this signer — log it.
            let _ = sqlx::query(
                "INSERT INTO signer_audit (signer_address, activation_kind, activated_at) \
                 VALUES ($1, 'boot', NOW())",
            )
            .bind(&signer_addr_str)
            .execute(&pool)
            .await;
            0
        }
    };
    if signer_age_days > 90 {
        tracing::warn!(
            signer = %signer_addr_str,
            age_days = signer_age_days,
            "Withdraw signer key is older than 90 days — schedule a rotation"
        );
    }

    let metrics_registry = Registry::new();
    let engine_metrics = Arc::new(
        EngineMetrics::new(&metrics_registry).expect("failed to register engine metrics"),
    );
    engine_metrics.signer_age_days.set(signer_age_days);
    spawn_sampler(
        (*engine_metrics).clone(),
        pool.clone(),
        exposure.clone(),
        arena_index.clone(),
    );

    // Vault read accessor — used by the withdraw service and the
    // solvency monitor. Plain JSON-RPC over the configured HTTP URL so we
    // don't need a long-lived alloy `Provider`.
    let vault_balance_provider: Arc<dyn rush_engine::chain::VaultBalanceProvider> =
        AlloyVaultBalanceProvider::shared(
            settings.chain.rpc_http_url.clone(),
            vault_addr,
        );

    let withdraw_service = Arc::new(WithdrawService::new(
        pool.clone(),
        withdraw_signer.clone(),
        vault_balance_provider.clone(),
        settings.chain.withdraw_auth_ttl_secs,
    ));

    let broadcaster = Arc::new(Broadcaster::new());

    // No Binance feed: TapTrading is a verifiable VRF arena, the
    // visual line is the in-process Rush Index (`arena_index`),
    // and bet resolution is via per-bet VRF path. There is no
    // external market feed.

    // Vault listener.
    let event_handler = VaultEventHandler::shared(
        pool.clone(),
        settings.chain.chain_id,
        settings.chain.vault_address.clone(),
    );
    if let Ok(ws_url) = Url::parse(&settings.chain.rpc_ws_url) {
        let listener = VaultListener::new(
            ws_url,
            vault_addr,
            settings.chain.min_confirmations,
            event_handler,
        );
        tokio::spawn(async move { listener.run().await });
        tracing::info!("Vault listener spawned");
    } else {
        tracing::warn!(
            "Skipping vault listener: invalid rpc_ws_url '{}'",
            settings.chain.rpc_ws_url
        );
    }

    // Resolution loop.
    let resolution = ResolutionLoop::new(
        touch_engine.clone(),
        broadcaster.clone(),
        settings.touch.resolution_check_interval_ms,
    )
    .with_metrics(engine_metrics.clone());
    tokio::spawn(async move { resolution.run().await });

    // Price broadcaster — pushes Rush Index ticks to subscribed WS
    // clients. No real market feed; the index is in-process.
    let price_broadcaster = broadcaster.clone();
    let arena_for_ws = arena_index.clone();
    tokio::spawn(async move {
        start_price_broadcaster(price_broadcaster, arena_for_ws).await
    });

    // Withdraw-authorization expiration sweep.
    let ws_clone = withdraw_service.clone();
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(60));
        loop {
            tick.tick().await;
            if let Ok(n) = ws_clone.expire_stale().await {
                if n > 0 {
                    tracing::debug!(expired = n, "Withdraw authorizations expired");
                }
            }
        }
    });

    // JWT revocation GC. Once a revoked jti's underlying JWT has expired,
    // the row is no longer load-bearing — the validator rejects on `exp`
    // without it. Sweep keeps the `jwt_revocations` table compact at any
    // realistic ban volume. We run it every 5 min; the table is keyed on
    // jti so reads stay constant-time regardless of size.
    let revoke_pool = pool.clone();
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(300));
        loop {
            tick.tick().await;
            let res = sqlx::query("DELETE FROM jwt_revocations WHERE expires_at < NOW()")
                .execute(&revoke_pool)
                .await;
            match res {
                Ok(r) if r.rows_affected() > 0 => {
                    tracing::debug!(pruned = r.rows_affected(), "jwt_revocations GC");
                }
                Ok(_) => {}
                Err(e) => tracing::warn!(error = %e, "jwt_revocations GC failed"),
            }
        }
    });

    // Solvency monitor — trips the breaker on under-funding or mirror
    // divergence. Withdrawals stay open even when tripped; new bets are
    // refused until the breaker is reset by an admin.
    //
    // Dev short-circuit: when `vault_address == 0x0…0` the contract is
    // not deployed, so the on-chain `houseBalance()` call always returns
    // 0 and any non-zero DB mirror would trip the breaker on the first
    // tick. We skip the monitor entirely in that case — bets still go
    // through the exposure tracker, which is the actual safety net.
    if vault_addr == alloy::primitives::Address::ZERO {
        tracing::warn!(
            "vault_address is 0x0 — solvency monitor disabled (dev mode). \
             Deploy TradingVault.sol and set APP_CHAIN__VAULT_ADDRESS to enable."
        );
    } else {
        let solvency_monitor = SolvencyMonitor::new(
            pool.clone(),
            vault_balance_provider.clone(),
            exposure.clone(),
            SolvencyMonitorConfig {
                tick_secs: 30,
                tolerance_bps: 50, // 0.5% mirror divergence tolerance
                min_house_buffer_wei: alloy::primitives::U256::from_str(
                    &settings.risk.min_house_buffer_wei,
                )
                .unwrap_or(alloy::primitives::U256::ZERO),
            },
        );
        tokio::spawn(async move { solvency_monitor.run().await });
    }

    // No feed-stale monitor: the Rush Index is in-process and never
    // stales (the advancer task can fail, but that's a local crash,
    // not a feed gap).
    //
    // No oracle-sanity loop: there is no external oracle to compare
    // against. Provably-fair guarantee is the per-bet commit/reveal
    // (`vrf::commit`), not a Chainlink cross-check.

    // WS revalidator — kicks banned users off open sockets within one
    // tick instead of waiting for JWT expiry on reconnect.
    spawn_ws_revalidator(
        WsRevalidateConfig::default(),
        pool.clone(),
        user_active_cache.clone(),
        broadcaster.clone(),
    );

    let app_state = web::Data::new(AppState {
        pool: pool.clone(),
        jwt_service: jwt_service.clone(),
        siwe_verifier: siwe_verifier.clone(),
        arena_index: arena_index.clone(),
        touch_engine: touch_engine.clone(),
        withdraw_service: withdraw_service.clone(),
        broadcaster: broadcaster.clone(),
        exposure: exposure.clone(),
        metrics: engine_metrics.clone(),
        quote_signer: quote_signer.clone(),
        // The same EOA signs both withdraw authorizations and VRF
        // commits. Keeping a single signer means the user verifies
        // both kinds of signatures against `engineSigner` from the
        // vault contract — one source of trust.
        commit_signer: withdraw_signer.clone(),
        vrf_cipher: vrf_cipher.clone(),
        quote_nonces: quote_nonces.clone(),
        idempotency: idempotency.clone(),
        user_rate_limiter: user_rate_limiter.clone(),
        user_active_cache: user_active_cache.clone(),
        siwe_nonce_ttl_secs: settings.siwe.nonce_ttl_secs,
    });

    let server_host = settings.server.host.clone();
    let server_port = settings.server.port;
    let workers = settings.server.workers;
    let allowed_origins = settings.server.allowed_origins.clone();
    let max_body_bytes = settings.server.max_body_bytes;

    // Per-IP token-bucket rate limit for unauthenticated endpoints
    // (auth nonce/verify, public quote). Burst absorbs UI behaviour like
    // re-quoting on price tick; refill rate cuts off DoS.
    let governor_conf = GovernorConfigBuilder::default()
        .requests_per_second(settings.server.rate_limit_per_sec.max(1) as u64)
        .burst_size(settings.server.rate_limit_burst.max(1))
        .key_extractor(PeerIpKeyExtractor)
        .finish()
        .expect("invalid governor config");

    // Prometheus metrics at /metrics. The middleware reuses our registry
    // so per-handler latencies, custom engine gauges, and counters all
    // appear in a single scrape target.
    let prometheus = PrometheusMetricsBuilder::new("rush_engine")
        .registry(metrics_registry.clone())
        .endpoint("/metrics")
        .build()
        .expect("failed to build prometheus middleware");

    tracing::info!(
        host = %server_host,
        port = server_port,
        workers,
        cors_origins = ?allowed_origins,
        body_limit_bytes = max_body_bytes,
        "Starting HTTP server"
    );

    let server = HttpServer::new(move || {
        let cors = if allowed_origins.is_empty() {
            // Wildcard only when explicitly empty — flagged in startup log.
            Cors::default()
                .allow_any_origin()
                .allow_any_method()
                .allow_any_header()
                .supports_credentials()
                .max_age(3600)
        } else {
            let mut c = Cors::default()
                .allow_any_method()
                .allow_any_header()
                .supports_credentials()
                .max_age(3600);
            for origin in &allowed_origins {
                c = c.allowed_origin(origin);
            }
            c
        };

        let json_cfg = web::JsonConfig::default()
            .limit(max_body_bytes)
            .error_handler(|err, _req| {
                actix_web::error::InternalError::from_response(
                    err,
                    actix_web::HttpResponse::BadRequest().json(serde_json::json!({
                        "code": "INVALID_BODY",
                        "message": "Request body invalid or exceeds size limit",
                    })),
                )
                .into()
            });
        let payload_cfg = web::PayloadConfig::default().limit(max_body_bytes);

        let governor = governor_conf.clone();

        App::new()
            .app_data(app_state.clone())
            .app_data(json_cfg)
            .app_data(payload_cfg)
            .wrap(cors)
            .wrap(prometheus.clone())
            .wrap(middleware::Logger::default())
            .wrap(middleware::Compress::default())
            .route("/ws", web::get().to(ws_handler))
            .configure(move |cfg| configure_routes(cfg, &governor))
    })
    .bind((server_host.as_str(), server_port))?
    .workers(workers)
    // Allow up to 15 s for in-flight requests (quote, openBet, settle
    // commit) to drain on SIGTERM/SIGINT before the process exits.
    .shutdown_timeout(15)
    .run();

    let server_handle = server.handle();

    // Forward SIGTERM (Kubernetes/systemd) to actix's graceful stop. We
    // also broadcast a `Shutdown` WS frame BEFORE tearing down so clients
    // can reconnect to the next instance instead of churning through
    // failed retries during the rolling deploy. SIGINT is already wired
    // by actix-web; this adds SIGTERM and the WS-aware drain.
    #[cfg(unix)]
    {
        let drain_broadcaster = broadcaster.clone();
        tokio::spawn(async move {
            use tokio::signal::unix::{signal, SignalKind};
            let mut term = match signal(SignalKind::terminate()) {
                Ok(s) => s,
                Err(e) => {
                    tracing::warn!(error = %e, "Could not install SIGTERM handler");
                    return;
                }
            };
            if term.recv().await.is_some() {
                tracing::info!("SIGTERM received — broadcasting shutdown to WS clients");
                drain_broadcaster.broadcast_all(
                    rush_engine::ws::messages::ServerMessage::Shutdown {
                        reason: "rolling-deploy".into(),
                        retry_in_ms: 2_000,
                    },
                );
                // Give clients ~1.5 s to flush the Shutdown frame and
                // start their reconnect timers BEFORE we close the
                // listener. After this, `server.stop(true)` drains
                // in-flight HTTP up to `shutdown_timeout`.
                tokio::time::sleep(std::time::Duration::from_millis(1_500)).await;
                tracing::info!("Initiating actix graceful stop (15 s drain)");
                server_handle.stop(true).await;
            }
        });
    }

    server.await
}
