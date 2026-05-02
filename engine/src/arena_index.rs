//! Internal Rush Index — deterministic visual anchor for the
//! TapTrading arena.
//!
//! TapTrading is a verifiable VRF arena, not a market touch product.
//! Resolution is 100% via the per-bet VRF path (see `vrf::path`).
//! No external feed (Binance, Chainlink, oracle of any kind) is
//! consulted in the resolution hot path.
//!
//! But a bet still needs an `entry_price_q8` at placement so the
//! band can be expressed in basis points and the UX has a "now"
//! line scrolling across the grid before the user taps. The Rush
//! Index serves that role: a single-symbol (`RUSH_INDEX`)
//! deterministic price computed in-process from a seeded RNG that
//! advances at a fixed cadence.
//!
//! The seed is hashed at startup and the hash is published as
//! `server_seed_hash`; users can audit the index movement off-line
//! by reproducing the RNG. The real seed is held only in memory and
//! is rotated when the operator decides to.
//!
//! Design notes:
//!  - The index is intentionally distinct from any per-bet path.
//!    Per-bet paths use their own VRF seeds (see `vrf::seed`).
//!    The index only anchors the visual grid and the entry price.
//!  - Mean reversion + soft/hard band keep the index inside a
//!    playable zone (~±150 bps from `INITIAL_PRICE`).
//!  - The index is **not** part of bet resolution — changing the
//!    index parameters here does not change any bet outcome.

use parking_lot::RwLock;
use rand::Rng;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use std::time::Duration;

/// Cadence at which the index advances. 150 ms = ~6.7 ticks/sec,
/// dense enough for a smooth scrolling line in the UX.
pub const TICK_MS: i64 = 150;

/// Anchor price. Bands are quoted in bps relative to this; clients
/// render the grid centred on this value.
pub const INITIAL_PRICE: f64 = 1_245.73;

/// Past this distance (bps) from `INITIAL_PRICE`, mean reversion
/// ramps up to keep the line in the playable zone.
const SOFT_BAND_BPS: f64 = 60.0;

/// Past this distance, an extra elastic pull is added so the line
/// can never escape into a region outside the catalog of cells.
const HARD_CAP_BPS: f64 = 150.0;

/// Symbol the engine uses for the Rush Index. Bets must reference
/// this; the engine no longer accepts BTCUSDT/ETHUSDT etc. in the
/// VRF arena.
pub const RUSH_INDEX_SYMBOL: &str = "RUSH_INDEX";

/// Public snapshot of the index — what's broadcast on WS and
/// returned by `/prices` handlers.
#[derive(Debug, Clone)]
pub struct ArenaIndexSnapshot {
    pub symbol: String,
    pub price_q8: i64,
    pub price: f64,
    pub tick: u64,
    pub timestamp_ms: i64,
    pub server_seed_hash: String,
}

pub struct ArenaIndex {
    state: RwLock<IndexState>,
    seed_hash: String,
}

#[derive(Debug, Clone)]
struct IndexState {
    price: f64,
    velocity: f64,
    tick: u64,
    last_update_ms: i64,
    rng_state: u32,
}

impl ArenaIndex {
    /// Construct the arena index from a textual seed. The seed
    /// hash (`SHA-256(seed)`) is exposed via [`Self::seed_hash`]
    /// so users can audit the index movement.
    pub fn new(seed: &str) -> Self {
        let hash = Sha256::digest(seed.as_bytes());
        let seed_hash_hex = hex::encode(hash);
        // Derive a 32-bit RNG state from the seed hash. Cheap PRNG
        // (xorshift32) is fine here: nothing in bet resolution
        // depends on this entropy — it's purely for the visual
        // line. Cryptographic randomness happens in `vrf::seed` for
        // the actual paths.
        let mut bytes = [0u8; 4];
        bytes.copy_from_slice(&hash[..4]);
        let rng_state = u32::from_be_bytes(bytes).max(1); // xorshift requires non-zero

        Self {
            state: RwLock::new(IndexState {
                price: INITIAL_PRICE,
                velocity: 0.0,
                tick: 0,
                last_update_ms: chrono::Utc::now().timestamp_millis(),
                rng_state,
            }),
            seed_hash: seed_hash_hex,
        }
    }

    /// Random seed at startup. Convenience for environments where
    /// the operator doesn't want to manage a fixed seed; the
    /// resulting `seed_hash` is still deterministic-once-chosen so
    /// audits can verify the historical index from a captured
    /// snapshot of the hash.
    pub fn random() -> Self {
        let mut buf = [0u8; 32];
        rand::rngs::OsRng.fill(&mut buf);
        Self::new(&hex::encode(buf))
    }

    pub fn seed_hash(&self) -> &str {
        &self.seed_hash
    }

    pub fn current_q8(&self) -> i64 {
        let s = self.state.read();
        (s.price * 1e8).round() as i64
    }

    pub fn current_price(&self) -> f64 {
        self.state.read().price
    }

    pub fn current_tick(&self) -> u64 {
        self.state.read().tick
    }

    pub fn last_update_ms(&self) -> i64 {
        self.state.read().last_update_ms
    }

    pub fn snapshot(&self) -> ArenaIndexSnapshot {
        let s = self.state.read();
        ArenaIndexSnapshot {
            symbol: RUSH_INDEX_SYMBOL.to_string(),
            price_q8: (s.price * 1e8).round() as i64,
            price: s.price,
            tick: s.tick,
            timestamp_ms: s.last_update_ms,
            server_seed_hash: self.seed_hash.clone(),
        }
    }

    /// Advance one tick. Called from the spawned advancer task at
    /// `TICK_MS` cadence. The math mirrors the VRF path generator's
    /// "calm" regime so the visual feel matches what the per-bet
    /// path will look like, without the regime variation (the
    /// background line stays stable; only bets carry the volatile
    /// trajectories).
    pub fn advance(&self) {
        let mut s = self.state.write();
        s.tick = s.tick.wrapping_add(1);

        let deviation_bps = ((s.price - INITIAL_PRICE) / INITIAL_PRICE) * 10_000.0;
        let abs_dev = deviation_bps.abs();

        // Slow cyclical so the line has texture without periodic
        // patterns the user could exploit (the user can't bet on
        // the index itself — bets always resolve via per-bet VRF).
        let cyclical = (s.tick as f64 / 19.0).sin() * 0.000_06
            + (s.tick as f64 / 61.0).sin() * 0.000_04;

        // Mean reversion: linear inside the soft band, quadratic
        // beyond it. Stops the line from running away.
        let base_reversion = -deviation_bps / 10_000.0 * 0.000_3;
        let overflow =
            ((abs_dev - SOFT_BAND_BPS).max(0.0) / (HARD_CAP_BPS - SOFT_BAND_BPS).max(1.0))
                .clamp(0.0, 1.0);
        let elastic = -deviation_bps.signum() * overflow * overflow * 0.001_8;

        let impulse = normal_sample(&mut s.rng_state) * 0.000_50 + cyclical
            + base_reversion
            + elastic;

        s.velocity = (s.velocity * 0.86 + impulse).clamp(-0.002_4, 0.002_4);
        s.price *= 1.0 + s.velocity;

        // Hard wall: if the path ever escapes despite mean
        // reversion, snap it back inside the playable band on the
        // same tick. The wall is conservative — overflow handles
        // the gradient, this is just a safety net.
        let cap_price = INITIAL_PRICE * HARD_CAP_BPS / 10_000.0;
        if s.price > INITIAL_PRICE + cap_price {
            s.price = INITIAL_PRICE + cap_price;
            s.velocity = -s.velocity.abs() * 0.5;
        } else if s.price < INITIAL_PRICE - cap_price {
            s.price = INITIAL_PRICE - cap_price;
            s.velocity = s.velocity.abs() * 0.5;
        }
        s.price = s.price.max(100.0);

        s.last_update_ms = chrono::Utc::now().timestamp_millis();
    }
}

/// Spawn a tokio task that advances `arena_index` every TICK_MS
/// milliseconds. Returns immediately; the task runs forever.
pub fn spawn_advancer(arena_index: Arc<ArenaIndex>) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(TICK_MS as u64));
        loop {
            interval.tick().await;
            arena_index.advance();
        }
    });
}

fn xorshift32(state: &mut u32) -> u32 {
    let mut x = *state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    *state = x;
    x
}

fn uniform(state: &mut u32) -> f64 {
    let v = xorshift32(state);
    (v as f64 + 0.5) / (u32::MAX as f64 + 1.0)
}

fn normal_sample(state: &mut u32) -> f64 {
    let u = uniform(state).max(1e-9);
    let v = uniform(state).max(1e-9);
    (-2.0 * u.ln()).sqrt() * (2.0 * std::f64::consts::PI * v).cos()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seed_hash_is_deterministic() {
        let a = ArenaIndex::new("rush-arena-test");
        let b = ArenaIndex::new("rush-arena-test");
        assert_eq!(a.seed_hash(), b.seed_hash());
    }

    #[test]
    fn different_seeds_yield_different_hashes() {
        let a = ArenaIndex::new("seed-a");
        let b = ArenaIndex::new("seed-b");
        assert_ne!(a.seed_hash(), b.seed_hash());
    }

    #[test]
    fn initial_price_anchors_at_constant() {
        let idx = ArenaIndex::new("anchor-test");
        let q8 = idx.current_q8();
        let expected = (INITIAL_PRICE * 1e8).round() as i64;
        assert_eq!(q8, expected);
    }

    #[test]
    fn advance_changes_tick_and_keeps_price_finite() {
        let idx = ArenaIndex::new("advance-test");
        let t0 = idx.current_tick();
        for _ in 0..100 {
            idx.advance();
        }
        assert_eq!(idx.current_tick(), t0 + 100);
        let p = idx.current_price();
        assert!(p.is_finite());
        assert!(p > 0.0);
    }

    #[test]
    fn price_never_escapes_hard_cap_after_long_run() {
        // Run 10_000 ticks (~25 minutes of real time at 150 ms tick).
        // Mean reversion + hard wall must keep the price inside
        // ±HARD_CAP_BPS around INITIAL_PRICE.
        let idx = ArenaIndex::new("escape-test");
        let cap = INITIAL_PRICE * HARD_CAP_BPS / 10_000.0;
        let lo = INITIAL_PRICE - cap;
        let hi = INITIAL_PRICE + cap;
        for _ in 0..10_000 {
            idx.advance();
            let p = idx.current_price();
            assert!(p >= lo - 0.01 && p <= hi + 0.01, "price escaped: {p}");
        }
    }

    #[test]
    fn snapshot_carries_seed_hash() {
        let idx = ArenaIndex::new("snapshot-test");
        let s = idx.snapshot();
        assert_eq!(s.symbol, RUSH_INDEX_SYMBOL);
        assert_eq!(s.server_seed_hash, idx.seed_hash());
        assert!(s.price > 0.0);
    }
}
