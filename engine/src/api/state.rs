//! HTTP/WebSocket shared state. Wired up in `main.rs` and injected into
//! every handler via `web::Data<AppState>`.

use crate::api::anti_replay::{
    ActiveStatusStore, IdempotencyStore, NonceStore, RateLimitStore,
};
use crate::arena_index::ArenaIndex;
use crate::auth::{JwtService, SiweVerifier};
use crate::chain::WithdrawService;
use crate::metrics::EngineMetrics;
use crate::risk::ExposureTracker;
use crate::touch::{QuoteSigner, TouchEngine};
use crate::vrf::SeedCipher;
use crate::ws::Broadcaster;
use sqlx::PgPool;
use std::sync::Arc;

pub struct AppState {
    pub pool: PgPool,
    pub jwt_service: Arc<JwtService>,
    pub siwe_verifier: Arc<SiweVerifier>,
    /// Deterministic in-process Rush Index (arena anchor). Replaces
    /// the old `price_aggregator`/`window_aggregator` pair that fed
    /// off Binance. Bet resolution is 100 % VRF path; the index is
    /// only the visual reference for `entry_price_q8` and the
    /// scrolling line.
    pub arena_index: Arc<ArenaIndex>,
    pub touch_engine: Arc<TouchEngine>,
    pub withdraw_service: Arc<WithdrawService>,
    pub broadcaster: Arc<Broadcaster>,
    pub exposure: Arc<ExposureTracker>,
    pub metrics: Arc<EngineMetrics>,
    pub quote_signer: Arc<QuoteSigner>,
    /// Engine signer used for VRF commit/reveal signatures. Same EOA
    /// the user already trusts via the vault contract's
    /// `engineSigner`, so a single signature scheme covers both
    /// withdraw authorizations and provably-fair commits.
    pub commit_signer: Arc<crate::chain::WithdrawSigner>,
    /// AES-256-GCM cipher for at-rest encryption of VRF seeds. Loaded
    /// once at startup from `APP_VRF__ENCRYPTION_KEY`; the plaintext
    /// key never leaves the process.
    pub vrf_cipher: Arc<SeedCipher>,
    pub quote_nonces: Arc<dyn NonceStore>,
    pub idempotency: Arc<dyn IdempotencyStore>,
    pub user_rate_limiter: Arc<dyn RateLimitStore>,
    pub user_active_cache: Arc<dyn ActiveStatusStore>,
    pub siwe_nonce_ttl_secs: i64,
}
