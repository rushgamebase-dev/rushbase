//! End-to-end VRF arena integration tests.
//!
//! Each test boots a fresh Postgres via testcontainers, applies the
//! engine migrations, builds a real `TouchEngine` with deterministic
//! cipher + signer + arena_index, and exercises the full flow:
//!
//!   open_bet → window elapses → resolve_bet → settle → ledger.
//!
//! Tests assert behaviour, not specific outcomes — the per-bet path
//! is generated from a fresh OsRng seed each run, so whether the
//! bet WINS or LOSES is non-deterministic. The invariants we pin
//! ARE deterministic: commit columns populated, reveal verifies
//! against the original commit, ledger entries balance to the wei,
//! status flips at most once.
//!
//! Run with:
//!   cargo test --test touch_integration -- --test-threads=1
//!
//! Requires Docker (testcontainers).

use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;

use alloy::primitives::{Address, U256};
use bigdecimal::BigDecimal;
use rush_engine::arena_index::{ArenaIndex, RUSH_INDEX_SYMBOL};
use rush_engine::chain::WithdrawSigner;
use rush_engine::config::settings::{MultiplierConfig, RiskConfig, TouchConfig};
use rush_engine::errors::TradingError;
use rush_engine::models::touch_bet::{TouchDirection, TouchStatus};
use rush_engine::risk::{limits_from_config, ExposureTracker};
use rush_engine::touch::{OpenBet, TouchEngine};
use rush_engine::vrf::{
    compute_commit_hash, generate_vrf_path, path_points_hash, verify_commit, CommitPreimage,
    SeedCipher, VrfPathInput, COMMIT_DOMAIN_TAG, PATH_CONFIG_VERSION,
};
use sqlx::PgPool;
use testcontainers::runners::AsyncRunner;
use testcontainers_modules::postgres::Postgres as PostgresImage;
use uuid::Uuid;

const SIGNER_HEX: &str =
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
/// Fixed test cipher key — every container in this file decrypts
/// with the same key so reveal verification is reproducible.
const CIPHER_KEY_HEX: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const VAULT_ADDR_HEX: &str = "0x5b04F3DFaE780A7e109066E754d27f491Af55Af9";

// ─── infra helpers ──────────────────────────────────────────────────────

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
    // Seed the house buffer to a generous value so exposure tests
    // don't trip on solvency bounds unrelated to what they're
    // checking.
    sqlx::query("UPDATE house_state SET house_buffer_wei = $1::numeric")
        .bind(BigDecimal::from_str("100000000000000000000").unwrap()) // 100 ETH
        .execute(&pool)
        .await
        .expect("seed house_buffer_wei");
    pool
}

fn touch_cfg() -> TouchConfig {
    TouchConfig {
        min_stake_wei: "1000000000000000".into(),    // 0.001 ETH
        max_stake_wei: "5000000000000000000".into(), // 5 ETH
        max_active_bets_per_user: 25,
        allowed_window_ms: vec![3_000, 6_000, 9_000],
        min_distance_bps: 5,
        max_distance_bps: 1_000,
        resolution_check_interval_ms: 100,
        // 0 ms gate so tests don't have to sleep for activation —
        // the resolver still requires `now >= window_end_ms` so
        // there is no real anti-snipe loss here.
        min_activation_delay_ms: 0,
    }
}

fn mult_cfg() -> MultiplierConfig {
    use rush_engine::config::settings::EmpiricalCell;
    // Mirror enough of the calibrated 3D table to satisfy the
    // bet fixture (offset=0, distance=40, duration=3000 ms). The
    // full grid lives in `config/default.toml`; tests load just
    // the cells they touch.
    let empirical_cells = vec![
        EmpiricalCell {
            distance_bps: 40, duration_ms: 3_000,
            window_start_offset_ms: 0, p_touch: 0.4436,
        },
        EmpiricalCell {
            distance_bps: 40, duration_ms: 6_000,
            window_start_offset_ms: 0, p_touch: 0.6907,
        },
        EmpiricalCell {
            distance_bps: 80, duration_ms: 3_000,
            window_start_offset_ms: 0, p_touch: 0.0669,
        },
        EmpiricalCell {
            distance_bps: 120, duration_ms: 3_000,
            window_start_offset_ms: 0, p_touch: 0.0032,
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
        max_house_potential_payout_wei: "500000000000000000000".into(), // 500 ETH
        max_per_symbol_potential_payout_wei: "200000000000000000000".into(), // 200 ETH
        min_house_buffer_wei: "0".into(),
        max_payout_per_bet_wei: "10000000000000000000".into(), // 10 ETH
        // Tests intentionally use a very loose cap so the user-cap
        // gate doesn't interfere with what each test specifically
        // checks (balance, idempotency, reveal). A dedicated test
        // exercises the cap below.
        max_potential_payout_per_user_wei: "500000000000000000000".into(),
        circuit_breaker_threshold_bps: 9_000,
    }
}

/// Build a test engine. Returns the engine, the arena_index (for
/// reading `current_q8`), the cipher and signer (for verification),
/// and the cached signer address (for `verify_commit`).
async fn build_engine(
    pool: PgPool,
) -> (
    Arc<TouchEngine>,
    Arc<ArenaIndex>,
    Arc<SeedCipher>,
    Arc<WithdrawSigner>,
    Address,
) {
    let arena_index = Arc::new(ArenaIndex::new("integration-test-arena-v1"));
    let exposure = Arc::new(ExposureTracker::new(limits_from_config(&risk_cfg())));
    let vrf_cipher = Arc::new(
        SeedCipher::from_hex(CIPHER_KEY_HEX).expect("integration test cipher key"),
    );
    let vault_addr = Address::from_str(VAULT_ADDR_HEX).expect("test vault");
    let commit_signer = Arc::new(
        WithdrawSigner::from_hex(SIGNER_HEX, 8453, vault_addr)
            .expect("integration test signer"),
    );
    let signer_addr = commit_signer.signer_address();
    let engine = Arc::new(TouchEngine::new(
        pool,
        arena_index.clone(),
        exposure,
        vrf_cipher.clone(),
        commit_signer.clone(),
        &touch_cfg(),
        &mult_cfg(),
        &risk_cfg(),
    ));
    (engine, arena_index, vrf_cipher, commit_signer, signer_addr)
}

/// Insert a user with `free_balance_wei` of free credit. Returns
/// `(user_id, wallet_address)`. Wallet address is derived
/// deterministically from a counter so concurrent tests don't
/// collide on the unique constraint when run with `--test-threads=1`.
async fn make_user(pool: &PgPool, free_balance_wei: &str) -> (Uuid, Address) {
    // Use a random byte for the wallet so the same container can
    // hold multiple users without violating the unique index.
    let mut bytes = [0u8; 20];
    rand::Rng::fill(&mut rand::rngs::OsRng, &mut bytes[..]);
    let wallet = format!("0x{}", hex::encode(bytes));
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO users (id, wallet_address, deposited_wei) VALUES ($1, $2, $3::numeric)",
    )
    .bind(id)
    .bind(&wallet)
    .bind(BigDecimal::from_str(free_balance_wei).expect("parse balance"))
    .execute(pool)
    .await
    .expect("insert user");
    let addr = Address::from_str(&wallet).expect("addr parse");
    (id, addr)
}

/// Build a placement request anchored on the current arena index.
/// Direction is UP, band is `+40..+80 bps` from entry — that's
/// row 1 of the UX grid (`PRICE_STEP_BPS = 40`) and lives in the
/// calibrated empirical table at offset=0. The engine refuses
/// off-table geometries since the calibration P0 fix.
fn open_bet_for(
    user_id: Uuid,
    arena_index: &ArenaIndex,
    stake_wei: U256,
    window_start_ms: i64,
    window_end_ms: i64,
) -> OpenBet {
    let entry_q8 = arena_index.current_q8() as u64;
    let entry_u = U256::from(entry_q8);
    // Band: +40 bps to +80 bps above entry — calibrated cell.
    let band_min = entry_u + entry_u * U256::from(40u64) / U256::from(10_000u64);
    let band_max = entry_u + entry_u * U256::from(80u64) / U256::from(10_000u64);
    OpenBet {
        user_id,
        symbol: RUSH_INDEX_SYMBOL.to_string(),
        direction: TouchDirection::Up,
        stake_wei,
        target_row_min_q8: band_min,
        target_row_max_q8: band_max,
        window_start_ms,
        window_end_ms,
        // The engine refuses opens whose multiplier deviates more
        // than ~1 % from the recomputed quote; we re-quote here
        // and pass the result so the gate accepts.
        expected_multiplier_bps: 0, // filled below
    }
}

// ─── tests ──────────────────────────────────────────────────────────────

#[actix_rt::test]
async fn placement_persists_commit_columns_and_locks_stake() {
    let pool = fresh_pool().await;
    let (engine, arena, _cipher, _signer, _signer_addr) = build_engine(pool.clone()).await;
    let stake = U256::from(10_000_000_000_000_000_u128); // 0.01 ETH
    let (user_id, _wallet) = make_user(&pool, "100000000000000000").await; // 0.1 ETH free

    let now_ms = chrono::Utc::now().timestamp_millis();
    let window_start = now_ms;
    let window_end = now_ms + 3_000;
    let mut req = open_bet_for(user_id, &arena, stake, window_start, window_end);
    let q = engine
        .quote(
            &req.symbol,
            req.direction,
            req.target_row_min_q8,
            req.target_row_max_q8,
            0,
            (window_end - window_start) as u64,
        )
        .expect("quote");
    req.expected_multiplier_bps = q.multiplier_bps;

    let bet = engine.open_bet(req).await.expect("open");

    // VRF commit columns populated.
    let row: (Option<Vec<u8>>, Option<Vec<u8>>, Option<Vec<u8>>, Option<String>, Option<String>, Option<Vec<u8>>, Option<String>) =
        sqlx::query_as(
            "SELECT seed_encrypted, commit_hash, commit_signature, path_config_version, \
             path_regime, revealed_seed, path_points_hash FROM touch_bets WHERE id = $1",
        )
        .bind(bet.id)
        .fetch_one(&pool)
        .await
        .expect("read bet");
    let (seed_enc, commit, sig, cfg_ver, regime, revealed, path_hash) = row;
    assert!(seed_enc.is_some(), "seed_encrypted populated");
    assert_eq!(commit.as_ref().map(|c| c.len()), Some(32));
    assert_eq!(sig.as_ref().map(|s| s.len()), Some(65));
    assert_eq!(cfg_ver.as_deref(), Some(PATH_CONFIG_VERSION));
    assert!(regime.is_some(), "regime label populated");
    // Reveal columns NULL while bet is ACTIVE.
    assert!(revealed.is_none(), "revealed_seed must be NULL pre-resolve");
    assert!(path_hash.is_none(), "path_points_hash must be NULL pre-resolve");

    // Stake locked: users.locked_margin_wei == stake; ledger has a
    // single StakeLock entry with -stake.
    let locked: BigDecimal =
        sqlx::query_scalar("SELECT locked_margin_wei FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let stake_bd = BigDecimal::from_str(&stake.to_string()).unwrap();
    assert_eq!(locked, stake_bd);

    let ledger_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM ledger WHERE user_id = $1 AND tx_type = 'STAKE_LOCK'",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(ledger_count, 1);
}

#[actix_rt::test]
async fn resolve_after_window_reveals_seed_and_settles_status() {
    let pool = fresh_pool().await;
    let (engine, arena, cipher, _signer, signer_addr) = build_engine(pool.clone()).await;
    let stake = U256::from(10_000_000_000_000_000_u128); // 0.01 ETH
    let (user_id, wallet) = make_user(&pool, "100000000000000000").await;

    let now_ms = chrono::Utc::now().timestamp_millis();
    let window_start = now_ms;
    let window_end = now_ms + 3_000;
    let mut req = open_bet_for(user_id, &arena, stake, window_start, window_end);
    let q = engine
        .quote(
            &req.symbol,
            req.direction,
            req.target_row_min_q8,
            req.target_row_max_q8,
            0,
            (window_end - window_start) as u64,
        )
        .expect("quote");
    req.expected_multiplier_bps = q.multiplier_bps;
    let p_min = req.target_row_min_q8;
    let p_max = req.target_row_max_q8;

    let bet = engine.open_bet(req).await.expect("open");

    // Wait for window to elapse, then resolve.
    tokio::time::sleep(Duration::from_millis(3_500)).await;
    let outcome = engine.resolve_bet(bet.id).await.expect("resolve");
    assert!(matches!(
        outcome.bet.status,
        TouchStatus::Won | TouchStatus::Lost
    ));

    // Reveal columns now populated.
    let resolved = engine
        .bet_repo()
        .find_by_id(bet.id)
        .await
        .unwrap()
        .unwrap();
    let revealed_seed = resolved.revealed_seed.clone().expect("revealed_seed set");
    let path_hash_db = resolved.path_points_hash.clone().expect("path_hash set");
    assert_eq!(revealed_seed.len(), 32);

    // 1. Recomputed commit hash matches what was persisted.
    let mut seed_arr = [0u8; 32];
    seed_arr.copy_from_slice(&revealed_seed);
    let recomputed = compute_commit_hash(
        &seed_arr,
        &CommitPreimage {
            bet_id: bet.id,
            user_wallet: wallet,
            p_min_q8: p_min,
            p_max_q8: p_max,
            window_start_ms: bet.window_start_ms,
            window_end_ms: bet.window_end_ms,
            domain_tag: COMMIT_DOMAIN_TAG,
        },
    );
    assert_eq!(
        recomputed.as_slice(),
        resolved.commit_hash.as_deref().unwrap(),
        "client-recomputed commit must equal what was persisted at place time"
    );

    // 2. Signature recovers the engine signer's address.
    verify_commit(
        &recomputed,
        resolved.commit_signature.as_deref().unwrap(),
        signer_addr,
    )
    .expect("commit signature verifies under the engine signer");

    // 3. Regen path from the revealed seed and confirm
    // path_points_hash matches the engine's record.
    let entry_q8 = i64::try_from(
        rush_engine::utils::wei::bd_to_u256(&resolved.entry_price_q8)
            .unwrap_or(U256::ZERO),
    )
    .unwrap_or(0);
    let regen = generate_vrf_path(VrfPathInput {
        seed: rush_engine::vrf::seed_to_hex(&seed_arr),
        start_price: entry_q8 as f64 / 1e8,
        start_time_ms: resolved.window_start_ms,
        end_time_ms: resolved.window_end_ms,
        tick_ms: 100,
        volatility_bps: 2.8,
        bound_bps: 190.0,
    });
    assert_eq!(
        path_points_hash(&regen),
        path_hash_db,
        "client-regenerated path hash must equal engine's record"
    );

    // Decryption check: cipher reads back the same seed that was
    // committed to.
    let dec = cipher
        .decrypt_seed(resolved.seed_encrypted.as_deref().unwrap())
        .expect("decrypt");
    assert_eq!(dec, seed_arr, "encrypted seed round-trips through AES-GCM");
}

#[actix_rt::test]
async fn resolve_before_window_end_rejected() {
    let pool = fresh_pool().await;
    let (engine, arena, _c, _s, _a) = build_engine(pool.clone()).await;
    let stake = U256::from(10_000_000_000_000_000_u128);
    let (user_id, _w) = make_user(&pool, "100000000000000000").await;

    let now_ms = chrono::Utc::now().timestamp_millis();
    let window_start = now_ms;
    // Window=3 s is the only calibrated cell at distance=40 that
    // survives the EV+ guard. Test still verifies "resolve before
    // window_end" because resolve_bet is called immediately,
    // ~3 s ahead of window_end.
    let window_end = now_ms + 3_000;
    let mut req = open_bet_for(user_id, &arena, stake, window_start, window_end);
    let q = engine
        .quote(
            &req.symbol,
            req.direction,
            req.target_row_min_q8,
            req.target_row_max_q8,
            0,
            (window_end - window_start) as u64,
        )
        .expect("quote");
    req.expected_multiplier_bps = q.multiplier_bps;
    let bet = engine.open_bet(req).await.expect("open");

    // Try to resolve immediately. Must refuse.
    let result = engine.resolve_bet(bet.id).await;
    assert!(matches!(
        result,
        Err(TradingError::InvalidWindow { .. })
    ));
}

#[actix_rt::test]
async fn double_resolve_returns_already_resolved() {
    let pool = fresh_pool().await;
    let (engine, arena, _c, _s, _a) = build_engine(pool.clone()).await;
    let stake = U256::from(10_000_000_000_000_000_u128);
    let (user_id, _w) = make_user(&pool, "100000000000000000").await;

    let now_ms = chrono::Utc::now().timestamp_millis();
    let window_start = now_ms;
    let window_end = now_ms + 3_000;
    let mut req = open_bet_for(user_id, &arena, stake, window_start, window_end);
    let q = engine
        .quote(
            &req.symbol,
            req.direction,
            req.target_row_min_q8,
            req.target_row_max_q8,
            0,
            (window_end - window_start) as u64,
        )
        .expect("quote");
    req.expected_multiplier_bps = q.multiplier_bps;
    let bet = engine.open_bet(req).await.expect("open");

    tokio::time::sleep(Duration::from_millis(3_500)).await;
    let _first = engine.resolve_bet(bet.id).await.expect("first resolve");
    let second = engine.resolve_bet(bet.id).await;
    assert!(matches!(second, Err(TradingError::BetAlreadyResolved)));
}

#[actix_rt::test]
async fn insufficient_balance_rejects_open() {
    let pool = fresh_pool().await;
    let (engine, arena, _c, _s, _a) = build_engine(pool.clone()).await;
    // User with too little to cover the 0.01 ETH stake.
    let (user_id, _w) = make_user(&pool, "1000000000000000").await; // 0.001 ETH
    let stake = U256::from(10_000_000_000_000_000_u128); // 0.01 ETH

    let now_ms = chrono::Utc::now().timestamp_millis();
    let mut req = open_bet_for(user_id, &arena, stake, now_ms, now_ms + 3_000);
    let q = engine
        .quote(
            &req.symbol,
            req.direction,
            req.target_row_min_q8,
            req.target_row_max_q8,
            0,
            3_000,
        )
        .expect("quote");
    req.expected_multiplier_bps = q.multiplier_bps;
    let result = engine.open_bet(req).await;
    assert!(
        matches!(result, Err(TradingError::InsufficientBalance { .. })),
        "expected InsufficientBalance, got: {:?}",
        result.as_ref().err().map(|e| e.to_string())
    );

    // Stake must NOT be locked when open fails.
    let locked: BigDecimal =
        sqlx::query_scalar("SELECT locked_margin_wei FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(locked.to_string(), "0");
}

#[actix_rt::test]
async fn ledger_balances_to_the_wei_after_settle() {
    let pool = fresh_pool().await;
    let (engine, arena, _c, _s, _a) = build_engine(pool.clone()).await;
    let stake = U256::from(10_000_000_000_000_000_u128);
    let (user_id, _w) = make_user(&pool, "100000000000000000").await;

    let now_ms = chrono::Utc::now().timestamp_millis();
    let window_start = now_ms;
    let window_end = now_ms + 3_000;
    let mut req = open_bet_for(user_id, &arena, stake, window_start, window_end);
    let q = engine
        .quote(
            &req.symbol,
            req.direction,
            req.target_row_min_q8,
            req.target_row_max_q8,
            0,
            (window_end - window_start) as u64,
        )
        .expect("quote");
    req.expected_multiplier_bps = q.multiplier_bps;
    let bet = engine.open_bet(req).await.expect("open");
    tokio::time::sleep(Duration::from_millis(3_500)).await;
    let outcome = engine.resolve_bet(bet.id).await.expect("resolve");

    // Sum of all ledger amounts for this user must equal:
    //   start_balance_change = realized_pnl_wei (signed)
    // That is, post-settle the user's net position differs from
    // start by exactly the realized PnL, regardless of the path
    // it took (lock + release + payout/loss).
    let sum: BigDecimal = sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount_wei), 0)::numeric FROM ledger WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        sum, outcome.realized_pnl_wei,
        "ledger sum equals realized PnL (lock-release cancels out)"
    );

    // No rogue locked_margin: after settle, the locked balance must
    // return to zero.
    let locked: BigDecimal =
        sqlx::query_scalar("SELECT locked_margin_wei FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        locked,
        BigDecimal::from(0u32),
        "stake fully released on settle"
    );

    // realized_pnl_wei on users matches outcome.
    let pnl: BigDecimal = sqlx::query_scalar("SELECT realized_pnl_wei FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(pnl, outcome.realized_pnl_wei);
}
