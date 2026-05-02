//! VRF commit/reveal for touch bets.
//!
//! Replaces the Binance-feed resolver with a provably-fair scheme:
//!
//!   1. At placement, the engine generates a 256-bit secret seed,
//!      computes `commit_hash = keccak256(seed || bet_id || user_wallet
//!      || p_min_q8 || p_max_q8 || window_start_ms || window_end_ms)`,
//!      signs it with the engine signer (EIP-191), and persists the
//!      seed encrypted at rest. The client receives only `commit_hash`
//!      + signature — never the seed, never the path.
//!
//!   2. After `window_end_ms`, the resolver decrypts the seed,
//!      regenerates the path deterministically from the seed (same
//!      algorithm the client will use to verify), checks intersection
//!      with the bet's band, and records WON/LOST. The reveal is
//!      broadcast on `BetResolved` with the seed.
//!
//!   3. The client recomputes `keccak256(seed || ...)`, confirms it
//!      matches the original `commit_hash`, regenerates the path, and
//!      independently verifies the result. The signature ties the
//!      commit to the engine signer that the user knows from the vault
//!      contract — no off-line trust needed.
//!
//! Submodules:
//!  - `path`   — deterministic SHA256-driven path generator (regimes,
//!               first-touch detection, interpolation between ticks)
//!  - `seed`   — 256-bit secret seed generation (OsRng) + AES-GCM
//!               encryption for at-rest persistence
//!  - `commit` — keccak256 commitment + EIP-191 signing/verification
//!
//! No real price feed is consulted in the resolution hot path.

pub mod commit;
pub mod path;
pub mod seed;

pub use commit::{
    compute_commit_hash, eip191_envelope, sign_commit, verify_commit, CommitError,
    CommitPreimage, COMMIT_DOMAIN_TAG,
};
pub use path::{
    first_touch_ms, generate_vrf_path, path_points_hash, select_regime, PathRegime,
    VrfPathInput, VrfPathPoint, PATH_CONFIG_VERSION,
};
pub use seed::{seed_from_hex, seed_to_hex, SeedCipher, SeedError, SEED_BYTES};
