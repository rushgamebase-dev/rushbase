use config::{Config, ConfigError, Environment, File};
use serde::Deserialize;
use std::sync::Arc;

#[derive(Debug, Clone, Deserialize)]
pub struct Settings {
    pub server: ServerConfig,
    pub database: DatabaseConfig,
    pub redis: RedisConfig,
    pub jwt: JwtConfig,
    pub siwe: SiweConfig,
    pub chain: ChainConfig,
    pub touch: TouchConfig,
    pub multiplier: MultiplierConfig,
    pub risk: RiskConfig,
    #[serde(default)]
    pub quote: QuoteSigningConfig,
    #[serde(default)]
    pub storage: StorageConfig,
    #[serde(default)]
    pub vrf: VrfConfig,
}

/// VRF commit/reveal configuration.
///
/// The `encryption_key` is a 32-byte AES-256-GCM key (64 hex chars)
/// used to encrypt secret seeds at rest before persisting them to
/// `touch_bets.seed_encrypted`. The plaintext seed is generated from
/// the OS RNG at place_bet time, used in-memory to compute the
/// commit, then encrypted and dropped from the handler stack. Only
/// the resolver (after `window_end_ms`) decrypts.
///
/// Operators must:
///  - set `APP_VRF__ENCRYPTION_KEY` to `openssl rand -hex 32` output
///  - rotate ONLY in maintenance windows when `vrf_commits` has zero
///    ACTIVE rows (rotation invalidates encrypted seeds)
///  - never log this key, never check it into source
///
/// The default value is a sentinel that the production guard refuses
/// to boot with — same pattern as JWT secret and signer key.
#[derive(Debug, Clone, Deserialize)]
pub struct VrfConfig {
    pub encryption_key: String,
}

impl Default for VrfConfig {
    fn default() -> Self {
        Self {
            // Sentinel — production guard panics if this leaks past dev.
            encryption_key:
                "00000000000000000000000000000000000000000000000000000000000000ff"
                    .to_string(),
        }
    }
}

/// Storage backend selection for short-lived stores (idempotency cache,
/// quote nonces, per-user rate limit, active-status cache). `memory`
/// keeps everything in-process and is correct for single-instance
/// deploys. `redis` is required as soon as more than one engine
/// replica fronts the same load balancer.
#[derive(Debug, Clone, Deserialize)]
pub struct StorageConfig {
    #[serde(default = "default_storage_backend")]
    pub backend: String,
    /// Common prefix for all engine keys in Redis. Lets multiple
    /// environments share a Redis cluster (`engine.dev`, `engine.prod`).
    #[serde(default = "default_storage_prefix")]
    pub prefix: String,
}

impl Default for StorageConfig {
    fn default() -> Self {
        Self {
            backend: default_storage_backend(),
            prefix: default_storage_prefix(),
        }
    }
}

fn default_storage_backend() -> String {
    "memory".into()
}

fn default_storage_prefix() -> String {
    "rush_engine".into()
}

#[derive(Debug, Clone, Deserialize)]
pub struct QuoteSigningConfig {
    /// HMAC-SHA256 secret for signing quote tokens. Must be ≥32 bytes.
    /// Override via `APP_QUOTE__SIGNING_SECRET` in production.
    pub signing_secret: String,
    /// Quote token TTL. Short enough to make replay impractical; long
    /// enough to absorb a confirm-modal user pause + RTT.
    #[serde(default = "default_quote_ttl_ms")]
    pub ttl_ms: i64,
}

impl Default for QuoteSigningConfig {
    fn default() -> Self {
        Self {
            signing_secret: "dev-quote-signing-secret-change-in-production-32+".into(),
            ttl_ms: default_quote_ttl_ms(),
        }
    }
}

fn default_quote_ttl_ms() -> i64 {
    2_000
}

#[derive(Debug, Clone, Deserialize)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    pub workers: usize,
    /// Origins allowed to hit the API. Empty = wildcard (development only).
    /// Override via `APP_SERVER__ALLOWED_ORIGINS=https://app.example.com,...`
    /// (comma-separated).
    #[serde(default, deserialize_with = "deserialize_csv")]
    pub allowed_origins: Vec<String>,
    /// Maximum JSON body size accepted. Defaults to 32 KiB — enough for any
    /// engine RPC body, kills payload-DoS at the front door.
    #[serde(default = "default_max_body_bytes")]
    pub max_body_bytes: usize,
    /// Per-IP rate limit for unauthenticated endpoints (auth nonce, quote).
    /// Burst = `rate_limit_burst`, refilling at `rate_limit_per_sec` rps.
    #[serde(default = "default_rate_limit_per_sec")]
    pub rate_limit_per_sec: u32,
    #[serde(default = "default_rate_limit_burst")]
    pub rate_limit_burst: u32,
}

fn default_max_body_bytes() -> usize {
    32 * 1024
}

fn default_rate_limit_per_sec() -> u32 {
    20
}

fn default_rate_limit_burst() -> u32 {
    40
}

fn deserialize_csv<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::Deserialize;
    // Accept either a JSON list or a comma-separated string. Env-var values
    // arrive as strings; TOML config can use either form.
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Form {
        List(Vec<String>),
        Csv(String),
    }
    Ok(match Form::deserialize(deserializer)? {
        Form::List(v) => v.into_iter().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect(),
        Form::Csv(s) => s
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect(),
    })
}

#[derive(Debug, Clone, Deserialize)]
pub struct DatabaseConfig {
    pub url: String,
    pub max_connections: u32,
    pub min_connections: u32,
    #[serde(default = "default_connect_timeout")]
    pub connect_timeout_secs: u64,
    #[serde(default = "default_idle_timeout")]
    pub idle_timeout_secs: u64,
}

fn default_connect_timeout() -> u64 {
    30
}

fn default_idle_timeout() -> u64 {
    600
}

#[derive(Debug, Clone, Deserialize)]
pub struct RedisConfig {
    pub url: String,
    pub pool_size: usize,
}

#[derive(Debug, Clone, Deserialize)]
pub struct JwtConfig {
    pub secret: String,
    pub access_token_expires_secs: i64,
    #[serde(default)]
    pub refresh_token_expires_secs: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SiweConfig {
    pub domain: String,
    #[serde(default = "default_siwe_nonce_ttl")]
    pub nonce_ttl_secs: i64,
}

fn default_siwe_nonce_ttl() -> i64 {
    300
}

#[derive(Debug, Clone, Deserialize)]
pub struct ChainConfig {
    pub chain_id: u64,
    pub rpc_http_url: String,
    pub rpc_ws_url: String,
    pub vault_address: String,
    /// Hex-encoded ECDSA secret key used by the local signer backend.
    /// Required when `signer_kms_key_id` is unset; ignored otherwise.
    pub signer_private_key: String,
    /// AWS KMS key id (e.g. `alias/rush-engine-prod` or
    /// `arn:aws:kms:region:acct:key/uuid`). When set, the engine routes
    /// withdraw signing through `kms:Sign` instead of the in-process
    /// hex key. Build with `--features aws-kms`; without the feature
    /// the engine refuses to boot rather than silently fall back.
    #[serde(default)]
    pub signer_kms_key_id: Option<String>,
    #[serde(default = "default_min_confirmations")]
    pub min_confirmations: u64,
    #[serde(default = "default_withdraw_auth_ttl")]
    pub withdraw_auth_ttl_secs: i64,
}

fn default_min_confirmations() -> u64 {
    5
}

fn default_withdraw_auth_ttl() -> i64 {
    900
}

/// Touch-bet placement and resolution parameters.
#[derive(Debug, Clone, Deserialize)]
pub struct TouchConfig {
    pub min_stake_wei: String,
    pub max_stake_wei: String,
    /// Hard cap on simultaneously open bets per wallet.
    pub max_active_bets_per_user: i64,
    /// Allowed window durations in milliseconds. Client must request a
    /// duration in this list (else the request is rejected).
    pub allowed_window_ms: Vec<u64>,
    /// Distance from `entry_price` to the *near* edge of the target band,
    /// expressed in basis points. Anything closer than `min` would already
    /// be inside the band; anything farther than `max` rounds out at
    /// `max_multiplier`.
    pub min_distance_bps: u32,
    pub max_distance_bps: u32,
    /// Resolution loop tick.
    pub resolution_check_interval_ms: u64,
    /// Minimum delay between placement time and `window_start_ms`.
    /// Anti-snipe gate: a bet whose window starts immediately would
    /// be priced on a Rush Index value the user could observe right
    /// before clicking, so we require the window to start a beat
    /// later. The VRF path itself is independent of any observed
    /// price, but pinning the entry rules out an entry-price snipe.
    #[serde(default = "default_min_activation_delay_ms")]
    pub min_activation_delay_ms: i64,
}

fn default_min_activation_delay_ms() -> i64 {
    1_000
}

#[derive(Debug, Clone, Deserialize)]
pub struct MultiplierConfig {
    pub house_edge_bps: u32,
    pub min_multiplier_bps: u32,
    pub max_multiplier_bps: u32,
    pub vol_bps_per_sqrt_sec: f64,
    /// Multiplicative pad on the empirical p_touch before the multiplier
    /// is computed. `1.0` trusts the calibration; values above 1 give
    /// the house additional buffer against vol regime shifts. Defaults
    /// to 1.0 for backwards compat with configs that have no empirical
    /// table.
    #[serde(default = "default_empirical_safety_factor")]
    pub empirical_safety_factor: f64,
    /// Pre-computed `(distance_bps, duration_ms) → realised p_touch`
    /// table from `cargo run --release --bin calibrate_vol -- <SYMBOL>
    /// <DAYS>`. Empty by default; populating it switches the engine to
    /// empirical pricing (with Bachelier as fallback for off-grid cells).
    #[serde(default)]
    pub empirical_cells: Vec<EmpiricalCell>,
}

impl Default for MultiplierConfig {
    fn default() -> Self {
        Self {
            house_edge_bps: 500,
            min_multiplier_bps: 11_000,
            max_multiplier_bps: 200_000,
            vol_bps_per_sqrt_sec: 5.0,
            empirical_safety_factor: 1.0,
            empirical_cells: Vec::new(),
        }
    }
}

fn default_empirical_safety_factor() -> f64 {
    1.0
}

/// One entry of the empirical p_touch table. The TOML form is:
/// ```toml
/// [[multiplier.empirical_cells]]
/// distance_bps = 40
/// duration_ms = 9000
/// window_start_offset_ms = 6000  # col 3 of the UX grid
/// p_touch = 0.582
/// ```
///
/// `window_start_offset_ms` defaults to `0` so older configs that
/// only calibrated col 1 of the grid keep working. New calibrations
/// (`bin/calibrate_vrf`) emit the field explicitly for every cell.
#[derive(Debug, Clone, Deserialize)]
pub struct EmpiricalCell {
    pub distance_bps: u32,
    pub duration_ms: u64,
    #[serde(default)]
    pub window_start_offset_ms: u64,
    pub p_touch: f64,
}

/// Risk knobs — all in wei. Engine refuses bets if any limit would be
/// crossed.
#[derive(Debug, Clone, Deserialize)]
pub struct RiskConfig {
    pub max_house_potential_payout_wei: String,
    pub max_per_symbol_potential_payout_wei: String,
    pub min_house_buffer_wei: String,
    pub max_payout_per_bet_wei: String,
    /// Maximum sum of net potential payout (`payout - stake`) across
    /// a single user's currently-active bets. Caps a Sybil-coordinated
    /// drain attempt at a fixed wei amount per wallet. Defaults to the
    /// global cap when not set so legacy configs keep working.
    #[serde(default = "default_max_potential_payout_per_user_wei")]
    pub max_potential_payout_per_user_wei: String,
    #[serde(default = "default_circuit_breaker_threshold_bps")]
    pub circuit_breaker_threshold_bps: u32,
}

fn default_max_potential_payout_per_user_wei() -> String {
    // Match the global cap when unset — same operational result as
    // before this field existed (no per-user limit beyond the global).
    "500000000000000000000".to_string()
}

fn default_circuit_breaker_threshold_bps() -> u32 {
    9_000
}

impl Settings {
    pub fn new() -> Result<Self, ConfigError> {
        let run_mode = std::env::var("RUN_MODE").unwrap_or_else(|_| "development".into());
        let s = Config::builder()
            .add_source(File::with_name("config/default"))
            .add_source(File::with_name(&format!("config/{}", run_mode)).required(false))
            .add_source(File::with_name("config/local").required(false))
            .add_source(
                Environment::with_prefix("APP")
                    .prefix_separator("_")
                    .separator("__"),
            )
            .build()?;
        s.try_deserialize()
    }

    pub fn from_env() -> Result<Self, ConfigError> {
        dotenvy::dotenv().ok();
        Self::new()
    }
}

pub type AppSettings = Arc<Settings>;
