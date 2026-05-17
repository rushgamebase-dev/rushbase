//! Touch-bet engine. Open + settle.
//!
//! Opens are **atomic** with respect to the user row and the global
//! exposure tracker: the row is locked `FOR UPDATE`, the exposure tracker
//! is mutated under its own lock *before* commit (and rolled back if the
//! commit fails), so concurrent opens cannot co-pass an exposure check.

use crate::arena_index::{ArenaIndex, RUSH_INDEX_SYMBOL};
use crate::chain::WithdrawSigner;
use crate::config::settings::{MultiplierConfig as MultiplierCfgToml, RiskConfig, TouchConfig};
use crate::db::repositories::{
    LedgerRepository, MarketPriceTickRepository, TouchBetRepository, UserRepository,
};
use crate::errors::TradingError;
use crate::market_feed::RealPriceFeed;
use crate::models::ledger::TransactionType;
use crate::models::touch_bet::{TouchBet, TouchDirection, TouchStatus};
use crate::models::user::User;
use crate::risk::{bd_or_zero_u256, ExposureTracker};
use crate::touch::pricing::{MultiplierCalculator, MultiplierConfig, MultiplierQuote};
use crate::utils::wei::{bd_to_q8_i64, bd_to_u256, i256_to_bd, u256_to_bd};
use crate::vrf::{
    compute_commit_hash, seed_to_hex, select_regime, sign_commit, CommitPreimage, SeedCipher,
    COMMIT_DOMAIN_TAG, PATH_CONFIG_VERSION,
};
use alloy::primitives::{Address, U256};
use bigdecimal::{BigDecimal, Zero};
use chrono::Utc;
use sqlx::PgPool;
use std::collections::HashSet;
use std::str::FromStr;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct OpenBet {
    pub user_id: Uuid,
    pub symbol: String,
    pub direction: TouchDirection,
    pub stake_wei: U256,
    pub target_row_min_q8: U256,
    pub target_row_max_q8: U256,
    pub window_start_ms: i64,
    pub window_end_ms: i64,
    /// Multiplier the client thinks they're getting. Server rejects if
    /// its own quote disagrees (no implicit slippage).
    pub expected_multiplier_bps: u32,
}

#[derive(Debug, Clone)]
pub struct ResolveOutcome {
    pub bet: TouchBet,
    pub touched: bool,
    pub realized_pnl_wei: BigDecimal,
}

pub struct TouchEngine {
    pool: PgPool,
    user_repo: UserRepository,
    bet_repo: TouchBetRepository,
    market_tick_repo: MarketPriceTickRepository,
    /// Deterministic in-process Rush Index. Provides `entry_price_q8`
    /// at quote/place time so bands can be expressed in bps and the
    /// UX can render a live "now" line. **Not consulted during bet
    /// resolution** — that's 100 % VRF path (`vrf::path`).
    arena_index: Arc<ArenaIndex>,
    /// Real-market price feed for the principal Tap Trading mode
    /// (ETH/BTC/SOL). The Rush Index remains supported as a legacy
    /// symbol through `arena_index`; all other accepted symbols come
    /// from this feed.
    real_price_feed: Arc<RealPriceFeed>,
    exposure: Arc<ExposureTracker>,
    multiplier: MultiplierCalculator,
    /// VRF seed cipher (AES-256-GCM). Used at place time to encrypt
    /// the freshly-generated seed before persisting, and at reveal
    /// time to decrypt it so the resolver can regenerate the path.
    vrf_cipher: Arc<SeedCipher>,
    /// Engine signer (same EOA as the vault's `engineSigner`). Signs
    /// the keccak256 commit at place time so the client can verify
    /// the commit against the address it knows from the vault.
    commit_signer: Arc<WithdrawSigner>,

    allowed_windows: HashSet<u64>,
    accepting_bets: bool,
    min_stake_wei: U256,
    max_stake_wei: U256,
    min_distance_bps: u32,
    max_distance_bps: u32,
    max_active_bets_per_user: i64,
    min_activation_delay_ms: i64,

    max_house_potential_payout_wei: U256,
    max_per_symbol_potential_payout_wei: U256,
    /// Cap on the sum of net potential payout (`payout - stake`)
    /// across a single user's ACTIVE bets. Enforced inside the
    /// open transaction by reading the user's current outstanding
    /// from `touch_bets WHERE user_id = $1 AND status = 'ACTIVE'`.
    max_potential_payout_per_user_wei: U256,
    max_payout_per_bet_wei: U256,
    min_house_buffer_wei: U256,
}

impl TouchEngine {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        pool: PgPool,
        arena_index: Arc<ArenaIndex>,
        real_price_feed: Arc<RealPriceFeed>,
        exposure: Arc<ExposureTracker>,
        vrf_cipher: Arc<SeedCipher>,
        commit_signer: Arc<WithdrawSigner>,
        touch_cfg: &TouchConfig,
        multiplier_cfg: &MultiplierCfgToml,
        risk_cfg: &RiskConfig,
    ) -> Self {
        let parse = |s: &str| U256::from_str(s).unwrap_or(U256::ZERO);
        Self {
            user_repo: UserRepository::new(pool.clone()),
            bet_repo: TouchBetRepository::new(pool.clone()),
            market_tick_repo: MarketPriceTickRepository::new(pool.clone()),
            multiplier: MultiplierCalculator::new(MultiplierConfig {
                house_edge_bps: multiplier_cfg.house_edge_bps,
                min_multiplier_bps: multiplier_cfg.min_multiplier_bps,
                max_multiplier_bps: multiplier_cfg.max_multiplier_bps,
                vol_bps_per_sqrt_sec: multiplier_cfg.vol_bps_per_sqrt_sec,
                empirical_p_touch_table: if multiplier_cfg.empirical_cells.is_empty() {
                    None
                } else {
                    Some(
                        multiplier_cfg
                            .empirical_cells
                            .iter()
                            .map(|c| {
                                (
                                    (c.distance_bps, c.duration_ms, c.window_start_offset_ms),
                                    c.p_touch,
                                )
                            })
                            .collect(),
                    )
                },
                empirical_safety_factor: multiplier_cfg.empirical_safety_factor,
            }),
            allowed_windows: touch_cfg.allowed_window_ms.iter().copied().collect(),
            accepting_bets: touch_cfg.accepting_bets,
            min_stake_wei: parse(&touch_cfg.min_stake_wei),
            max_stake_wei: parse(&touch_cfg.max_stake_wei),
            min_distance_bps: touch_cfg.min_distance_bps,
            max_distance_bps: touch_cfg.max_distance_bps,
            max_active_bets_per_user: touch_cfg.max_active_bets_per_user,
            min_activation_delay_ms: touch_cfg.min_activation_delay_ms,
            max_house_potential_payout_wei: parse(&risk_cfg.max_house_potential_payout_wei),
            max_per_symbol_potential_payout_wei: parse(
                &risk_cfg.max_per_symbol_potential_payout_wei,
            ),
            max_potential_payout_per_user_wei: parse(&risk_cfg.max_potential_payout_per_user_wei),
            max_payout_per_bet_wei: parse(&risk_cfg.max_payout_per_bet_wei),
            min_house_buffer_wei: parse(&risk_cfg.min_house_buffer_wei),
            pool,
            arena_index,
            real_price_feed,
            exposure,
            vrf_cipher,
            commit_signer,
        }
    }

    pub fn arena_index(&self) -> &Arc<ArenaIndex> {
        &self.arena_index
    }
    pub fn real_price_feed(&self) -> &Arc<RealPriceFeed> {
        &self.real_price_feed
    }
    pub fn bet_repo(&self) -> &TouchBetRepository {
        &self.bet_repo
    }
    pub fn user_repo(&self) -> &UserRepository {
        &self.user_repo
    }
    pub fn exposure(&self) -> &Arc<ExposureTracker> {
        &self.exposure
    }
    pub fn multiplier(&self) -> &MultiplierCalculator {
        &self.multiplier
    }
    pub fn min_distance_bps(&self) -> u32 {
        self.min_distance_bps
    }
    pub fn max_distance_bps(&self) -> u32 {
        self.max_distance_bps
    }
    pub fn max_payout_per_bet_wei(&self) -> U256 {
        self.max_payout_per_bet_wei
    }
    /// Allowed window durations in ms, sorted ascending — handy for
    /// frontends that surface a duration picker.
    pub fn allowed_window_ms_sorted(&self) -> Vec<u64> {
        let mut v: Vec<u64> = self.allowed_windows.iter().copied().collect();
        v.sort_unstable();
        v
    }

    pub fn accepting_bets(&self) -> bool {
        self.accepting_bets
    }

    pub fn canonical_symbol(&self, symbol: &str) -> Option<String> {
        let upper = symbol.trim().to_uppercase();
        if upper.eq_ignore_ascii_case(RUSH_INDEX_SYMBOL) {
            return Some(RUSH_INDEX_SYMBOL.to_string());
        }
        self.real_price_feed.normalize_symbol(&upper)
    }

    pub fn is_real_price_symbol(&self, symbol: &str) -> bool {
        self.canonical_symbol(symbol)
            .map_or(false, |s| !s.eq_ignore_ascii_case(RUSH_INDEX_SYMBOL))
    }

    pub fn current_entry_q8(&self, symbol: &str) -> Result<i64, TradingError> {
        let Some(symbol) = self.canonical_symbol(symbol) else {
            return Err(TradingError::InvalidSymbol(symbol.to_string()));
        };
        if symbol.eq_ignore_ascii_case(RUSH_INDEX_SYMBOL) {
            let entry = self.arena_index.current_q8();
            if entry <= 0 {
                return Err(TradingError::PriceUnavailable(symbol));
            }
            return Ok(entry);
        }
        self.real_price_feed
            .current_q8(&symbol)
            .filter(|entry| *entry > 0)
            .ok_or(TradingError::PriceUnavailable(symbol))
    }

    /// Quote the multiplier the engine *would* assign to a bet right now.
    /// `window_start_offset_ms` is the gap between "now" and the start of
    /// the window — col 1 of the grid is 0, col N is `(N-1) * duration`.
    /// First-passage pricing makes the multiplier specific to that
    /// interval, not just its duration.
    pub fn quote(
        &self,
        symbol: &str,
        direction: TouchDirection,
        target_row_min_q8: U256,
        target_row_max_q8: U256,
        window_start_offset_ms: u64,
        window_duration_ms: u64,
    ) -> Result<MultiplierQuote, TradingError> {
        let entry = self.current_entry_q8(symbol)?;
        Ok(self.multiplier.quote(
            entry as u128,
            u256_to_u128_saturating(target_row_min_q8),
            u256_to_u128_saturating(target_row_max_q8),
            direction,
            window_start_offset_ms,
            window_duration_ms,
        ))
    }

    /// Place a new touch-bet. All write effects land atomically.
    pub async fn open_bet(&self, req: OpenBet) -> Result<TouchBet, TradingError> {
        let mut req = req;
        req.symbol = self
            .canonical_symbol(&req.symbol)
            .ok_or_else(|| TradingError::InvalidSymbol(req.symbol.clone()))?;
        if !self.accepting_bets {
            return Err(TradingError::SafeMode);
        }
        if self.exposure.is_circuit_breaker_triggered() {
            return Err(TradingError::CircuitBreakerOpen);
        }
        self.validate_request(&req)?;

        // Read entry from the symbol's authoritative source. RUSH_INDEX
        // uses the deterministic arena index; real-price symbols use
        // the live market feed and fail closed when stale.
        let entry_q8 = self.current_entry_q8(&req.symbol)?;
        let now_ms = Utc::now().timestamp_millis();
        let entry_q8_u = U256::from(entry_q8 as u64);

        // Distance check.
        let near_edge = match req.direction {
            TouchDirection::Up => req.target_row_min_q8,
            TouchDirection::Down => req.target_row_max_q8,
        };
        let distance_bps = self.distance_bps(entry_q8_u, near_edge);
        if distance_bps < self.min_distance_bps || distance_bps > self.max_distance_bps {
            return Err(TradingError::InvalidBand {
                reason: format!(
                    "distance {} bps outside allowed [{}, {}]",
                    distance_bps, self.min_distance_bps, self.max_distance_bps
                ),
            });
        }

        // `direction` is legacy metadata from the bullish/bearish
        // predictor era. The current arena resolver checks first-touch
        // of the band over the window regardless of where the snake
        // sits at quote time, so a band above OR below the entry is
        // equally valid — the snake can drift either way during the
        // window. The geometric "snake already inside the band" case
        // is handled downstream by the EV+ guard in pricing.rs (which
        // sees `distance_bps == 0` and refuses the cell as too easy),
        // so no extra check is needed here.

        // Window must start meaningfully in the future. See `check_activation_gate`.
        check_activation_gate(req.window_start_ms, now_ms, self.min_activation_delay_ms)?;
        let window_duration_ms = (req.window_end_ms - req.window_start_ms) as u64;
        if !self.allowed_windows.contains(&window_duration_ms) {
            return Err(TradingError::InvalidWindow {
                reason: format!("duration {} ms is not in allowed list", window_duration_ms),
            });
        }

        // Server quote — re-prices using the SAME offset/duration the
        // client priced against, so first-passage probability matches
        // what was shown on the cell at click time.
        let window_start_offset_ms = (req.window_start_ms - now_ms).max(0) as u64;
        let quote = self.multiplier.quote(
            entry_q8 as u128,
            u256_to_u128_saturating(req.target_row_min_q8),
            u256_to_u128_saturating(req.target_row_max_q8),
            req.direction,
            window_start_offset_ms,
            window_duration_ms,
        );

        // EV+ guard. Three cases that all leak free EV to the player
        // unless we refuse the bet:
        //
        //  1. `distance_bps == 0`: the band already envelops the live
        //     price, so a touch at the start of the window is a
        //     certainty. Bachelier's `first-passage diff` returns 0
        //     for zero distance (`erfc(0) = 1` minus itself) and the
        //     floor multiplier kicks in — but the realised p is 1, not
        //     0.005, so the player still wins EV at any positive
        //     multiplier. Hard-block regardless of `min_distance_bps`.
        //
        //  2. Quoted multiplier is at the `min_multiplier_bps` floor.
        //     The floor exists to keep the UI sensible (no 1.0001×
        //     bets), not to give the player extra EV. The EV+ guard
        //     looks at the implied probability and refuses when
        //     `p × floor > 1` — i.e., the player would win money in
        //     expectation regardless of the floor.
        //
        //  3. Defense in depth: `min_distance_bps` already greys out
        //     trivial cells in the quote-grid, but a misconfigured
        //     deployment could lower it; the per-bet guard is a hard
        //     wall regardless of operator config.
        if quote.distance_bps == 0 {
            return Err(TradingError::InvalidBand {
                reason: "Band envelops the live price (distance = 0)".into(),
            });
        }
        // Refuse cells outside the calibrated empirical table.
        // Bachelier fallback under-prices wide bands against the
        // deterministic RUSH_INDEX generator, so the legacy mode still
        // requires calibrated empirical cells. Real-market symbols use
        // the model quote directly because their volatility comes from
        // live market movement instead of the VRF/index table.
        if req.symbol.eq_ignore_ascii_case(RUSH_INDEX_SYMBOL) && !quote.from_empirical {
            return Err(TradingError::InvalidBand {
                reason: format!(
                    "Cell not in calibrated table (distance={} bps, \
                     duration={} ms, offset={} ms). Run `bin/calibrate_vrf` \
                     to extend coverage.",
                    quote.distance_bps, quote.window_duration_ms, quote.window_start_offset_ms,
                ),
            });
        }
        let p_touch = quote.implied_p_touch_bps as f64 / 10_000.0;
        if self.multiplier.is_ev_positive_at_floor(p_touch) {
            return Err(TradingError::InvalidBand {
                reason: format!(
                    "EV+ trap: implied p_touch {} bps × floor multiplier > 1.0",
                    quote.implied_p_touch_bps
                ),
            });
        }

        // Tolerate 10% multiplier drift between quote and bet. The
        // arena_index can move 30-50 bps in the 100-300 ms click→submit
        // RTT and that translates to 5-10% mult swing on cells near
        // the snake. The HMAC quote_token already pins the parameters
        // to the original quote (TTL 2s), so this is just a sanity
        // check against a client tampering with `expected_multiplier_bps`.
        // The previous 1% tolerance was rejecting roughly half of all
        // honest clicks during fast price moves.
        let mult_drift_bps =
            (quote.multiplier_bps as i64 - req.expected_multiplier_bps as i64).abs();
        let mult_tolerance = (req.expected_multiplier_bps as i64 / 10).max(500); // 10% of expected, ≥500 bps
        if mult_drift_bps > mult_tolerance {
            return Err(TradingError::QuoteMismatch {
                expected_multiplier_bps: req.expected_multiplier_bps,
                actual_multiplier_bps: quote.multiplier_bps,
            });
        }
        // Use the client-quoted mult (which the token signed) for the
        // bet record, so payout matches what was shown at click time.
        let mut quote = quote;
        quote.multiplier_bps = req.expected_multiplier_bps;

        let payout = req
            .stake_wei
            .saturating_mul(U256::from(quote.multiplier_bps as u64))
            / U256::from(10_000u64);
        // House edge in absolute terms: with multiplier = (1 - edge) / p_touch,
        // expected payout = p_touch * payout = stake * (1 - edge), so the
        // house's expected take is `stake * edge_bps / 10_000`. Surfaced
        // for transparency on each ledger entry.
        let house_edge_bps = self.multiplier.config().house_edge_bps as u64;
        let house_edge_wei =
            req.stake_wei.saturating_mul(U256::from(house_edge_bps)) / U256::from(10_000u64);

        if payout > self.max_payout_per_bet_wei {
            return Err(TradingError::PayoutCapExceeded {
                max_potential_payout_wei: payout.to_string(),
                cap_wei: self.max_payout_per_bet_wei.to_string(),
            });
        }
        let net_house_exposure_for_bet = payout.saturating_sub(req.stake_wei);

        // Read the mirrored on-chain `houseBalance` and pass it into the
        // exposure tracker. The reservation either commits *with* the
        // buffer floor satisfied or fails atomically — no partial state
        // gets installed and no concurrent open can sneak past while we
        // still hold a stale snapshot.
        let house_buffer_bd: BigDecimal =
            sqlx::query_scalar("SELECT house_buffer_wei FROM house_state LIMIT 1")
                .fetch_one(&self.pool)
                .await?;
        let house_buffer_u = bd_or_zero_u256(&house_buffer_bd);

        self.exposure
            .reserve_potential_payout(
                &req.symbol,
                net_house_exposure_for_bet,
                self.max_per_symbol_potential_payout_wei,
                self.max_house_potential_payout_wei,
                house_buffer_u,
                self.min_house_buffer_wei,
            )
            .map_err(|e| match e {
                crate::risk::ReservationError::PerSymbolExceeded { current, limit } => {
                    TradingError::PerSymbolExposureLimitExceeded {
                        symbol: req.symbol.clone(),
                        current_wei: current.to_string(),
                        limit_wei: limit.to_string(),
                    }
                }
                crate::risk::ReservationError::HouseExceeded { current, limit } => {
                    TradingError::HouseSolvencyViolated {
                        required_buffer_wei: current.to_string(),
                        available_buffer_wei: limit.to_string(),
                    }
                }
                crate::risk::ReservationError::BufferTooLow {
                    buffer_wei,
                    exposure_after_wei,
                    min_buffer_wei,
                } => TradingError::HouseBufferTooLow {
                    buffer_wei: buffer_wei.to_string(),
                    exposure_after_wei: exposure_after_wei.to_string(),
                    min_buffer_wei: min_buffer_wei.to_string(),
                },
                crate::risk::ReservationError::CircuitBreaker => TradingError::CircuitBreakerOpen,
            })?;

        // Wrapper that releases the in-memory reservation if the DB write fails.
        let result = self
            .commit_open(
                req.clone(),
                entry_q8_u,
                payout,
                house_edge_wei,
                quote.multiplier_bps,
            )
            .await;
        if result.is_err() {
            self.exposure
                .release_potential_payout(&req.symbol, net_house_exposure_for_bet);
        }
        result
    }

    /// Atomic placement: lock user row, validate balance + active cap,
    /// generate VRF seed + commit + signature, lock stake, INSERT the
    /// bet with its VRF columns. Single Postgres transaction; any
    /// failure rolls back the whole thing (including the stake lock).
    async fn commit_open(
        &self,
        req: OpenBet,
        entry_q8_u: U256,
        payout: U256,
        house_edge_wei: U256,
        multiplier_bps: u32,
    ) -> Result<TouchBet, TradingError> {
        let mut tx = self.pool.begin().await?;

        let user: User = sqlx::query_as("SELECT * FROM users WHERE id = $1 FOR UPDATE")
            .bind(req.user_id)
            .fetch_one(&mut *tx)
            .await?;

        let free_before = user.free_balance_wei();
        let free_before_u = bd_or_zero_u256(&free_before);
        let stake_bd = u256_to_bd(req.stake_wei);
        if free_before_u < req.stake_wei {
            return Err(TradingError::InsufficientBalance {
                required_wei: req.stake_wei.to_string(),
                available_wei: free_before.to_string(),
            });
        }

        // Per-user concurrent bet cap.
        let active: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM touch_bets WHERE user_id = $1 AND status = 'ACTIVE'",
        )
        .bind(req.user_id)
        .fetch_one(&mut *tx)
        .await?;
        if active >= self.max_active_bets_per_user {
            return Err(TradingError::MaxActiveBetsReached {
                current: active,
                max: self.max_active_bets_per_user,
            });
        }

        // Per-user potential payout cap. Sum the net potential
        // payout (`payout - stake`) across the user's ACTIVE bets
        // and refuse if adding this bet's net would breach the cap.
        // Read happens inside the same transaction with the user
        // row locked FOR UPDATE, so two concurrent opens cannot
        // both sneak past the bound.
        let user_outstanding_bd: BigDecimal = sqlx::query_scalar(
            "SELECT COALESCE(SUM(potential_payout_wei - stake_wei), 0)::numeric \
             FROM touch_bets WHERE user_id = $1 AND status = 'ACTIVE'",
        )
        .bind(req.user_id)
        .fetch_one(&mut *tx)
        .await?;
        let user_outstanding = bd_or_zero_u256(&user_outstanding_bd);
        let new_net = payout.saturating_sub(req.stake_wei);
        if user_outstanding.saturating_add(new_net) > self.max_potential_payout_per_user_wei {
            return Err(TradingError::UserPayoutCapExceeded {
                user_outstanding_wei: user_outstanding.to_string(),
                new_net_wei: new_net.to_string(),
                cap_wei: self.max_potential_payout_per_user_wei.to_string(),
            });
        }

        // VRF: generate the bet_id locally so it can go into the
        // commit preimage and the INSERT in lockstep — no round-trip
        // to the DB to reserve an id, no chance of mismatch between
        // the signed commit and the row that ends up persisted.
        let bet_id = Uuid::new_v4();
        let user_addr = Address::from_str(user.wallet_address.trim_start_matches("0x"))
            .map_err(|e| TradingError::SignerError(format!("user wallet address parse: {}", e)))?;
        let seed_bytes = self.vrf_cipher.generate_secret_seed();
        let preimage = CommitPreimage {
            bet_id,
            user_wallet: user_addr,
            p_min_q8: req.target_row_min_q8,
            p_max_q8: req.target_row_max_q8,
            window_start_ms: req.window_start_ms,
            window_end_ms: req.window_end_ms,
            domain_tag: COMMIT_DOMAIN_TAG,
        };
        let commit_hash = compute_commit_hash(&seed_bytes, &preimage);
        let commit_signature = sign_commit(&self.commit_signer, &commit_hash)
            .await
            .map_err(|e| TradingError::SignerError(e.to_string()))?;
        let seed_encrypted = self.vrf_cipher.encrypt_seed(&seed_bytes);
        // Path regime is derived from the seed (deterministic). We
        // record it on the bet for analytics without revealing the
        // path itself — the regime is one of six labels and leaks
        // negligible information about the actual path shape.
        let path_regime_label = select_regime(&seed_to_hex(&seed_bytes))
            .as_str()
            .to_string();
        // Best-effort scrub of the seed from the local stack. The
        // copy already lives inside `seed_encrypted` (encrypted) and
        // will be decrypted only at reveal. Rust doesn't guarantee
        // physical erasure, but explicit drop signals intent.
        // Best-effort: signal intent to drop the plaintext from this
        // scope. `[u8; 32]` is `Copy` so this is a hint, not a
        // guarantee — switching to `zeroize::Zeroize` would harden
        // it. The encrypted copy remains the durable artifact.
        let _ = seed_bytes;

        // Lock the stake.
        sqlx::query(
            r#"
            UPDATE users
               SET locked_margin_wei = locked_margin_wei + $2,
                   updated_at = NOW()
             WHERE id = $1
            "#,
        )
        .bind(req.user_id)
        .bind(&stake_bd)
        .execute(&mut *tx)
        .await?;

        LedgerRepository::create_in_tx(
            &mut *tx,
            req.user_id,
            TransactionType::StakeLock,
            &(-&stake_bd),
            &free_before,
            Some(bet_id),
            Some("touch_bet"),
            Some("Stake locked for touch bet"),
        )
        .await?;

        let payout_bd = u256_to_bd(payout);
        let house_edge_bd = u256_to_bd(house_edge_wei);
        let entry_bd = u256_to_bd(entry_q8_u);
        let band_min_bd = u256_to_bd(req.target_row_min_q8);
        let band_max_bd = u256_to_bd(req.target_row_max_q8);
        let commit_hash_bytes: &[u8] = commit_hash.as_slice();
        let commit_sig_bytes: &[u8] = &commit_signature;

        let bet: TouchBet = sqlx::query_as(
            r#"
            INSERT INTO touch_bets (
                id, user_id, symbol, direction, status,
                stake_wei, multiplier_bps, potential_payout_wei, house_edge_wei,
                entry_price_q8, target_row_min_q8, target_row_max_q8,
                window_start_ms, window_end_ms,
                seed_encrypted, commit_hash, commit_signature,
                path_config_version, path_regime
            )
            VALUES ($1, $2, $3, $4::touch_direction, 'ACTIVE',
                    $5, $6, $7, $8,
                    $9, $10, $11,
                    $12, $13,
                    $14, $15, $16,
                    $17, $18)
            RETURNING *
            "#,
        )
        .bind(bet_id)
        .bind(req.user_id)
        .bind(&req.symbol)
        .bind(req.direction.as_str())
        .bind(&stake_bd)
        .bind(multiplier_bps as i32)
        .bind(&payout_bd)
        .bind(&house_edge_bd)
        .bind(&entry_bd)
        .bind(&band_min_bd)
        .bind(&band_max_bd)
        .bind(req.window_start_ms)
        .bind(req.window_end_ms)
        .bind(seed_encrypted)
        .bind(commit_hash_bytes)
        .bind(commit_sig_bytes)
        .bind(PATH_CONFIG_VERSION)
        .bind(&path_regime_label)
        .fetch_one(&mut *tx)
        .await?;

        tx.commit().await?;

        tracing::info!(
            user_id = %req.user_id,
            bet_id = %bet.id,
            symbol = %req.symbol,
            direction = ?req.direction,
            stake_wei = %req.stake_wei,
            multiplier_bps,
            window_ms = bet.window_end_ms - bet.window_start_ms,
            commit_hash = %hex::encode(commit_hash_bytes),
            path_regime = %path_regime_label,
            "Touch bet placed (VRF commit sealed)"
        );

        Ok(bet)
    }

    /// Resolve a bet that's past its window. Idempotent for `ACTIVE` rows;
    /// returns `BetAlreadyResolved` otherwise.
    ///
    /// VRF reveal: the bet stores an AES-encrypted seed, an EIP-191
    /// signed keccak256 commit, and the path config version. The
    /// resolver:
    ///
    ///  1. confirms the path config version matches what's compiled
    ///     in (otherwise the path generator could produce a
    ///     different sequence than what was committed to);
    ///  2. decrypts the seed and regenerates the path
    ///     deterministically;
    ///  3. checks first-touch of the band inside the window;
    ///  4. records `revealed_seed`, `path_points_hash`, and the
    ///     touch outcome in `settle`.
    ///
    /// No real price feed is consulted — the path is the sole source
    /// of truth. The reveal is broadcast via WS in `BetResolved` so
    /// the client can re-derive the path and verify.
    pub async fn resolve_bet(&self, bet_id: Uuid) -> Result<ResolveOutcome, TradingError> {
        let bet = self
            .bet_repo
            .find_by_id(bet_id)
            .await?
            .ok_or(TradingError::BetNotFound(bet_id))?;
        if bet.status != TouchStatus::Active {
            return Err(TradingError::BetAlreadyResolved);
        }

        let now_ms = Utc::now().timestamp_millis();
        if now_ms < bet.window_end_ms {
            return Err(TradingError::InvalidWindow {
                reason: "window has not elapsed".into(),
            });
        }

        // Resolution against the same line the player watched. Legacy
        // RUSH_INDEX bets replay the deterministic arena history;
        // real-price bets replay the market feed history for their
        // symbol.
        //
        // The legacy commit/reveal VRF code is left in `vrf/` for
        // historical reference and was the resolver until 2026-05-04.
        let p_min = (bd_to_q8_i64(&bet.target_row_min_q8) as f64) / 1e8;
        let p_max = (bd_to_q8_i64(&bet.target_row_max_q8) as f64) / 1e8;

        let path = if bet.symbol.eq_ignore_ascii_case(RUSH_INDEX_SYMBOL) {
            self.arena_index
                .path_window(bet.window_start_ms, bet.window_end_ms)
        } else {
            let persisted = self
                .market_tick_repo
                .path_window(&bet.symbol, bet.window_start_ms, bet.window_end_ms)
                .await?;
            if persisted.is_empty() {
                self.real_price_feed.path_window(
                    &bet.symbol,
                    bet.window_start_ms,
                    bet.window_end_ms,
                )
            } else {
                persisted
            }
        };
        if path.is_empty() {
            // History buffer evicted before we got around to settling.
            // Two cases:
            //   1. Bet's window ended < HISTORY_WINDOW_MS ago and the
            //      buffer just hasn't filled yet (engine restart) —
            //      retry next tick.
            //   2. Window ended > HISTORY_WINDOW_MS ago — history is
            //      gone forever. Auto-cancel so the bet doesn't loop
            //      in the resolution sweep until the operator notices.
            //      Cancellation refunds the stake; no PnL is realised
            //      because we cannot prove which side touched.
            const HISTORY_WINDOW_MS: i64 = 120_000;
            if now_ms - bet.window_end_ms > HISTORY_WINDOW_MS {
                tracing::warn!(
                    bet = %bet.id,
                    window_end_ms = bet.window_end_ms,
                    age_ms = now_ms - bet.window_end_ms,
                    "Cancelling unresolvable bet — history evicted"
                );
                return self.cancel_unresolvable(bet).await;
            }
            return Err(TradingError::ResolverError(
                "arena index history missing for bet window".into(),
            ));
        }

        let touch = first_touch_in_path(&path, p_min, p_max);
        let won = touch.is_some();
        let touched_at_ms = touch;

        // Hash of the path the resolver actually used, so audits can
        // confirm later that we didn't regenerate the line. Same
        // shape as the previous VRF `path_points_hash` so downstream
        // schemas stay backwards compatible.
        let path_hash_hex = hash_index_path(&path);

        // No per-bet seed any more — the index seed itself is the
        // server commit, hashed at startup and exposed via
        // `arena_index::seed_hash`. We pass an empty byte vec to the
        // settle path so the column stays NULL on new bets without
        // schema churn.
        self.settle(bet, won, touched_at_ms, Vec::new(), path_hash_hex)
            .await
    }

    /// Refund-only path for bets the resolver cannot honestly settle
    /// (history evicted from the arena_index buffer). Status flips to
    /// CANCELLED, stake is released back to the player, no PnL is
    /// realised. Idempotent under the FOR UPDATE re-check inside the
    /// transaction.
    async fn cancel_unresolvable(&self, bet: TouchBet) -> Result<ResolveOutcome, TradingError> {
        let mut tx = self.pool.begin().await?;
        let row: TouchBet = sqlx::query_as("SELECT * FROM touch_bets WHERE id = $1 FOR UPDATE")
            .bind(bet.id)
            .fetch_one(&mut *tx)
            .await?;
        if row.status != TouchStatus::Active {
            return Err(TradingError::BetAlreadyResolved);
        }

        let user: User = sqlx::query_as("SELECT * FROM users WHERE id = $1 FOR UPDATE")
            .bind(bet.user_id)
            .fetch_one(&mut *tx)
            .await?;
        let free_before = user.free_balance_wei();

        sqlx::query(
            r#"
            UPDATE users
               SET locked_margin_wei = locked_margin_wei - $2,
                   updated_at = NOW()
             WHERE id = $1
            "#,
        )
        .bind(bet.user_id)
        .bind(&bet.stake_wei)
        .execute(&mut *tx)
        .await?;

        LedgerRepository::create_in_tx(
            &mut *tx,
            bet.user_id,
            TransactionType::StakeRelease,
            &bet.stake_wei,
            &free_before,
            Some(bet.id),
            Some("touch_bet"),
            Some("Stake released — bet cancelled (resolver history evicted)"),
        )
        .await?;

        let cancelled: TouchBet = sqlx::query_as(
            r#"
            UPDATE touch_bets
               SET status = 'CANCELLED'::touch_status,
                   resolved_at = NOW(),
                   updated_at = NOW()
             WHERE id = $1
            RETURNING *
            "#,
        )
        .bind(bet.id)
        .fetch_one(&mut *tx)
        .await?;

        tx.commit().await?;

        Ok(ResolveOutcome {
            bet: cancelled,
            touched: false,
            realized_pnl_wei: BigDecimal::from(0),
        })
    }

    async fn settle(
        &self,
        bet: TouchBet,
        won: bool,
        touched_at_ms: Option<i64>,
        revealed_seed_bytes: Vec<u8>,
        path_points_hash_hex: String,
    ) -> Result<ResolveOutcome, TradingError> {
        let stake_u = bd_to_u256(&bet.stake_wei).unwrap_or(U256::ZERO);
        let payout_u = bd_to_u256(&bet.potential_payout_wei).unwrap_or(U256::ZERO);
        let net_user_pnl_signed = if won {
            // user gains (payout - stake); house loses (payout - stake)
            alloy::primitives::I256::from_raw(payout_u.saturating_sub(stake_u))
        } else {
            -alloy::primitives::I256::from_raw(stake_u)
        };
        let pnl_bd = i256_to_bd(net_user_pnl_signed);

        let mut tx = self.pool.begin().await?;

        // Re-load + re-check status under FOR UPDATE to avoid double-settle.
        let row: TouchBet = sqlx::query_as("SELECT * FROM touch_bets WHERE id = $1 FOR UPDATE")
            .bind(bet.id)
            .fetch_one(&mut *tx)
            .await?;
        if row.status != TouchStatus::Active {
            return Err(TradingError::BetAlreadyResolved);
        }

        let user: User = sqlx::query_as("SELECT * FROM users WHERE id = $1 FOR UPDATE")
            .bind(bet.user_id)
            .fetch_one(&mut *tx)
            .await?;
        let free_before = user.free_balance_wei();

        // Always release the stake; PnL is applied separately so the
        // `realized_pnl_wei` ledger remains a clean signed accumulator.
        sqlx::query(
            r#"
            UPDATE users
               SET locked_margin_wei = locked_margin_wei - $2,
                   realized_pnl_wei  = realized_pnl_wei + $3,
                   updated_at = NOW()
             WHERE id = $1
            "#,
        )
        .bind(bet.user_id)
        .bind(&bet.stake_wei)
        .bind(&pnl_bd)
        .execute(&mut *tx)
        .await?;

        LedgerRepository::create_in_tx(
            &mut *tx,
            bet.user_id,
            TransactionType::StakeRelease,
            &bet.stake_wei,
            &free_before,
            Some(bet.id),
            Some("touch_bet"),
            Some("Stake released after bet resolution"),
        )
        .await?;
        let after_release = &free_before + &bet.stake_wei;

        let pnl_tx_type = if won {
            TransactionType::BetPayout
        } else {
            TransactionType::BetLoss
        };
        if !pnl_bd.is_zero() {
            LedgerRepository::create_in_tx(
                &mut *tx,
                bet.user_id,
                pnl_tx_type,
                &pnl_bd,
                &after_release,
                Some(bet.id),
                Some("touch_bet"),
                Some(if won { "Bet won" } else { "Bet lost" }),
            )
            .await?;
        }

        // House PnL is the opposite.
        let house_pnl = -&pnl_bd;
        sqlx::query(
            r#"
            UPDATE house_state
               SET realized_pnl_wei = realized_pnl_wei + $1,
                   total_volume_wei = total_volume_wei + $2,
                   total_trades = total_trades + 1,
                   updated_at = NOW()
            "#,
        )
        .bind(&house_pnl)
        .bind(&bet.stake_wei)
        .execute(&mut *tx)
        .await?;

        // User stats.
        if won {
            sqlx::query(
                r#"
                UPDATE users
                   SET total_trades = total_trades + 1,
                       total_wins = total_wins + 1,
                       current_win_streak = current_win_streak + 1,
                       best_win_streak = GREATEST(best_win_streak, current_win_streak + 1),
                       updated_at = NOW()
                 WHERE id = $1
                "#,
            )
            .bind(bet.user_id)
            .execute(&mut *tx)
            .await?;
        } else {
            sqlx::query(
                r#"
                UPDATE users
                   SET total_trades = total_trades + 1,
                       total_losses = total_losses + 1,
                       current_win_streak = 0,
                       updated_at = NOW()
                 WHERE id = $1
                "#,
            )
            .bind(bet.user_id)
            .execute(&mut *tx)
            .await?;
        }

        let new_status = if won {
            TouchStatus::Won
        } else {
            TouchStatus::Lost
        };
        // Honest touched_at: VRF gives us the exact (interpolated)
        // millisecond the band was first crossed. Persist that
        // instead of `now`, so the verifier (which regenerates the
        // same path from the revealed seed) can compare against an
        // authoritative timestamp.
        let touched_at = touched_at_ms
            .map(|ms| chrono::DateTime::<Utc>::from_timestamp_millis(ms).unwrap_or_else(Utc::now));
        // The `revealed_seed_size` check requires NULL or exactly 32
        // bytes. Under the arena_index resolver there is no per-bet
        // seed, so map the empty vector to NULL instead of binding a
        // zero-byte BYTEA.
        let revealed_seed_opt: Option<&[u8]> = if revealed_seed_bytes.is_empty() {
            None
        } else {
            Some(&revealed_seed_bytes)
        };
        let resolved: TouchBet = sqlx::query_as(
            r#"
            UPDATE touch_bets
               SET status = $2::touch_status,
                   resolved_at = NOW(),
                   touched_at = $3,
                   realized_pnl_wei = $4,
                   revealed_seed = $5,
                   path_points_hash = $6,
                   updated_at = NOW()
             WHERE id = $1
            RETURNING *
            "#,
        )
        .bind(bet.id)
        .bind(new_status.as_str())
        .bind(touched_at)
        .bind(&pnl_bd)
        .bind(revealed_seed_opt)
        .bind(&path_points_hash_hex)
        .fetch_one(&mut *tx)
        .await?;

        tx.commit().await?;

        // Free the in-memory exposure reservation.
        let net_exposure = payout_u.saturating_sub(stake_u);
        self.exposure
            .release_potential_payout(&bet.symbol, net_exposure);

        tracing::info!(
            user_id = %bet.user_id,
            bet_id = %bet.id,
            won,
            pnl_wei = %pnl_bd,
            "Touch bet resolved"
        );

        Ok(ResolveOutcome {
            bet: resolved,
            touched: won,
            realized_pnl_wei: pnl_bd,
        })
    }

    fn validate_request(&self, req: &OpenBet) -> Result<(), TradingError> {
        if self.canonical_symbol(&req.symbol).is_none() {
            return Err(TradingError::InvalidSymbol(req.symbol.clone()));
        }
        if req.stake_wei < self.min_stake_wei || req.stake_wei > self.max_stake_wei {
            return Err(TradingError::InvalidStakeAmount {
                amount_wei: req.stake_wei.to_string(),
                min_wei: self.min_stake_wei.to_string(),
                max_wei: self.max_stake_wei.to_string(),
            });
        }
        if req.target_row_max_q8 <= req.target_row_min_q8 {
            return Err(TradingError::InvalidBand {
                reason: "max must be > min".into(),
            });
        }
        if req.window_end_ms <= req.window_start_ms {
            return Err(TradingError::InvalidWindow {
                reason: "end must be > start".into(),
            });
        }
        Ok(())
    }

    fn distance_bps(&self, entry: U256, edge: U256) -> u32 {
        if entry.is_zero() {
            return 0;
        }
        let diff = if edge >= entry {
            edge - entry
        } else {
            entry - edge
        };
        let bps = diff.saturating_mul(U256::from(10_000u64)) / entry;
        bps.try_into().unwrap_or(u32::MAX)
    }
}

pub(crate) fn u256_to_u128_saturating(v: U256) -> u128 {
    v.try_into().unwrap_or(u128::MAX)
}

/// Resolver-side clamp: a bet should never count price action observed
/// before placement, even if `window_start_ms` claims otherwise. Pulled
/// out of `resolve_bet` so it can be unit-tested without a database.
pub fn effective_window_start_ms(window_start_ms: i64, placed_at_ms: i64) -> i64 {
    window_start_ms.max(placed_at_ms)
}

/// Anti-snipe gate. A bet whose window starts now (or in the past) lets a
/// sniping client win on price action it already observed, since the
/// resolver looks at the aggregator's min/max within
/// `[window_start_ms, window_end_ms]`. This pure helper is the placement-
/// time enforcement; the resolver also clamps to `placed_at` as defense
/// in depth (`effective_window_start_ms`).
pub fn check_activation_gate(
    window_start_ms: i64,
    now_ms: i64,
    min_activation_delay_ms: i64,
) -> Result<(), TradingError> {
    if window_start_ms < now_ms + min_activation_delay_ms {
        return Err(TradingError::InvalidWindow {
            reason: format!(
                "window must start at least {} ms in the future (got {} ms)",
                min_activation_delay_ms,
                window_start_ms - now_ms
            ),
        });
    }
    Ok(())
}

/// First-passage check on the Rush Index history. Returns the
/// timestamp (ms) of the first sample whose price falls inside the
/// closed band `[p_min, p_max]`, or `None` if the band was never
/// touched during the bet window. Linear scan; the history slice
/// for any single bet is bounded by the window duration / TICK_MS
/// (≤ 60 000 / 150 = 400 entries).
fn first_touch_in_path(path: &[(i64, f64)], p_min: f64, p_max: f64) -> Option<i64> {
    let mut iter = path.iter();
    let mut prev = *iter.next()?;
    if prev.1 >= p_min && prev.1 <= p_max {
        return Some(prev.0);
    }

    for &current in iter {
        if current.1 >= p_min && current.1 <= p_max {
            return Some(current.0);
        }
        let low = prev.1.min(current.1);
        let high = prev.1.max(current.1);
        if high >= p_min && low <= p_max && current.0 > prev.0 {
            // The sampled line crossed through the band between two
            // feed events. Approximate the first boundary touch by
            // linear interpolation so narrow real-price bands don't
            // miss obvious crossings.
            let boundary = if prev.1 < p_min && current.1 >= p_min {
                p_min
            } else if prev.1 > p_max && current.1 <= p_max {
                p_max
            } else {
                p_min.max(low).min(high)
            };
            let denom = current.1 - prev.1;
            if denom.abs() > f64::EPSILON {
                let ratio = ((boundary - prev.1) / denom).clamp(0.0, 1.0);
                return Some(prev.0 + ((current.0 - prev.0) as f64 * ratio).round() as i64);
            }
            return Some(current.0);
        }
        prev = current;
    }
    None
}

/// Stable digest of an index slice used in the bet's resolution
/// trace. Format mirrors what the legacy `vrf::path::path_points_hash`
/// produced so downstream consumers (the `path_points_hash_hex`
/// column on `touch_bets`) keep the same shape: SHA-256 of
/// space-separated `ts:price_q8` pairs in hex.
fn hash_index_path(path: &[(i64, f64)]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    for (t, p) in path {
        let q8 = (p * 1e8).round() as i64;
        hasher.update(format!("{}:{} ", t, q8).as_bytes());
    }
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn activation_gate_rejects_window_starting_now() {
        let now = 1_000_000_000_i64;
        // Right at NOW: rejected.
        assert!(check_activation_gate(now, now, 1_000).is_err());
        // 999 ms in the future: still rejected.
        assert!(check_activation_gate(now + 999, now, 1_000).is_err());
        // Exactly the gate: accepted.
        assert!(check_activation_gate(now + 1_000, now, 1_000).is_ok());
        // Comfortably in the future: accepted.
        assert!(check_activation_gate(now + 5_000, now, 1_000).is_ok());
        // In the past: rejected.
        assert!(check_activation_gate(now - 100, now, 1_000).is_err());
    }

    #[test]
    fn activation_gate_with_zero_delay_allows_now() {
        // Sanity: setting min_activation_delay_ms = 0 disables the gate.
        // This must NEVER be the production default — the resolver clamp
        // only protects clock-skew scenarios, not adversarial sniping.
        let now = 1_000_000_000_i64;
        assert!(check_activation_gate(now, now, 0).is_ok());
        assert!(check_activation_gate(now - 1, now, 0).is_err());
    }

    #[test]
    fn first_touch_detects_segment_crossing_between_ticks() {
        let path = vec![(1_000, 99.0), (2_000, 101.0)];
        let touched = first_touch_in_path(&path, 100.0, 100.5);
        assert_eq!(touched, Some(1_500));
    }

    #[test]
    fn effective_start_clamps_to_placed_at() {
        // Resolver must never read price data from before placement.
        assert_eq!(effective_window_start_ms(100, 200), 200);
        assert_eq!(effective_window_start_ms(300, 200), 300);
        assert_eq!(effective_window_start_ms(200, 200), 200);
    }
}
