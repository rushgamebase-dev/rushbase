//! Single-instance and Redis-backed stores for short-lived state.
//!
//! Four storage surfaces are abstracted behind async traits so the
//! engine can run as a single process (memory backend) or scale
//! horizontally (Redis backend) with no callsite changes:
//!
//!  - [`IdempotencyStore`] — replay the same response when a client
//!    retries `POST /trade/bets` with the same `Idempotency-Key`.
//!  - [`NonceStore`] — single-use ticket per signed quote token.
//!  - [`RateLimitStore`] — per-user sliding-window cap on authenticated
//!    request volume.
//!  - [`ActiveStatusStore`] — short-lived cache of `users.is_active` so
//!    the JWT validator stays off the DB hot path.
//!
//! Both backends ship in this module:
//!   - `Memory*` — the original `DashMap`-based implementations.
//!   - `Redis*` — `deadpool_redis` + `Lua` for atomic ops (sliding
//!     window via ZADD/ZRANGEBYSCORE, single-use SET NX).
//!
//! The Redis path uses Lua scripts where multiple operations have to be
//! atomic from Redis's perspective (rate limit and nonce); GET/SET/EX
//! patterns cover the simpler caches.

use async_trait::async_trait;
use chrono::Utc;
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use uuid::Uuid;

// ─── shared types ───────────────────────────────────────────────────────

/// Cached HTTP response keyed by `(user_id, idempotency_key)`.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CachedResponse {
    pub status: u16,
    pub body: Vec<u8>,
    pub expires_at_ms: i64,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum NonceError {
    #[error("quote nonce already consumed")]
    AlreadyUsed,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum RateLimitError {
    #[error("rate limit exceeded ({0} requests in window)")]
    Exceeded(u64),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActiveLookup {
    Active,
    Inactive,
    Unknown,
}

// ─── trait surfaces ─────────────────────────────────────────────────────

#[async_trait]
pub trait IdempotencyStore: Send + Sync {
    async fn get(&self, key: &str) -> Option<CachedResponse>;
    async fn put(&self, key: String, status: u16, body: Vec<u8>);
}

#[async_trait]
pub trait NonceStore: Send + Sync {
    async fn consume(&self, quote_id: Uuid) -> Result<(), NonceError>;
}

#[async_trait]
pub trait RateLimitStore: Send + Sync {
    async fn check(&self, user_id: Uuid) -> Result<(), RateLimitError>;
}

#[async_trait]
pub trait ActiveStatusStore: Send + Sync {
    async fn get(&self, user_id: Uuid) -> Option<ActiveLookup>;
    async fn put(&self, user_id: Uuid, active: bool);
    async fn invalidate(&self, user_id: Uuid);
}

// ─── helpers ────────────────────────────────────────────────────────────

pub fn idempotency_key(user_id: Uuid, raw: &str) -> String {
    format!("{}:{}", user_id, raw)
}

// ─── memory backend ─────────────────────────────────────────────────────

/// In-process backend. Single-instance only; loses state on restart.
pub struct MemoryIdempotency {
    map: DashMap<String, CachedResponse>,
    ttl_ms: i64,
}

impl MemoryIdempotency {
    pub fn new(ttl_ms: i64) -> Self {
        Self {
            map: DashMap::new(),
            ttl_ms: ttl_ms.max(1_000),
        }
    }

    pub fn ttl_ms(&self) -> i64 {
        self.ttl_ms
    }

    pub fn evict_expired(&self) {
        let now = Utc::now().timestamp_millis();
        self.map.retain(|_, v| v.expires_at_ms > now);
    }
}

#[async_trait]
impl IdempotencyStore for MemoryIdempotency {
    async fn get(&self, key: &str) -> Option<CachedResponse> {
        let now = Utc::now().timestamp_millis();
        let entry = self.map.get(key)?;
        if entry.expires_at_ms > now {
            Some(entry.clone())
        } else {
            None
        }
    }

    async fn put(&self, key: String, status: u16, body: Vec<u8>) {
        let now = Utc::now().timestamp_millis();
        self.map.insert(
            key,
            CachedResponse {
                status,
                body,
                expires_at_ms: now + self.ttl_ms,
            },
        );
    }
}

pub struct MemoryNonceStore {
    seen: DashMap<Uuid, i64>,
    ttl_ms: i64,
}

impl MemoryNonceStore {
    pub fn new(ttl_ms: i64) -> Self {
        Self {
            seen: DashMap::new(),
            ttl_ms: ttl_ms.max(100),
        }
    }

    pub fn evict_expired(&self) {
        let now = Utc::now().timestamp_millis();
        self.seen.retain(|_, expires| *expires > now);
    }
}

#[async_trait]
impl NonceStore for MemoryNonceStore {
    async fn consume(&self, quote_id: Uuid) -> Result<(), NonceError> {
        let now = Utc::now().timestamp_millis();
        let mut already_used = false;
        self.seen
            .entry(quote_id)
            .and_modify(|expires| {
                if *expires > now {
                    already_used = true;
                } else {
                    *expires = now + self.ttl_ms;
                }
            })
            .or_insert(now + self.ttl_ms);
        if already_used {
            Err(NonceError::AlreadyUsed)
        } else {
            Ok(())
        }
    }
}

pub struct MemoryRateLimit {
    state: DashMap<Uuid, parking_lot::Mutex<Vec<i64>>>,
    max_per_window: usize,
    window_ms: i64,
}

impl MemoryRateLimit {
    pub fn new(max_per_window: usize, window_ms: i64) -> Self {
        Self {
            state: DashMap::new(),
            max_per_window: max_per_window.max(1),
            window_ms: window_ms.max(1_000),
        }
    }

    pub fn evict_old(&self) {
        let now = Utc::now().timestamp_millis();
        let cutoff = now - self.window_ms;
        self.state.retain(|_, mtx| {
            let mut ts_list = mtx.lock();
            ts_list.retain(|&ts| ts > cutoff);
            !ts_list.is_empty()
        });
    }
}

#[async_trait]
impl RateLimitStore for MemoryRateLimit {
    async fn check(&self, user_id: Uuid) -> Result<(), RateLimitError> {
        let now = Utc::now().timestamp_millis();
        let cutoff = now - self.window_ms;
        let entry = self
            .state
            .entry(user_id)
            .or_insert_with(|| parking_lot::Mutex::new(Vec::new()));
        let mut ts_list = entry.lock();
        ts_list.retain(|&ts| ts > cutoff);
        if ts_list.len() >= self.max_per_window {
            return Err(RateLimitError::Exceeded(ts_list.len() as u64));
        }
        ts_list.push(now);
        Ok(())
    }
}

pub struct MemoryActiveCache {
    map: DashMap<Uuid, (bool, i64)>,
    ttl_ms: i64,
}

impl MemoryActiveCache {
    pub fn new(ttl_ms: i64) -> Self {
        Self {
            map: DashMap::new(),
            ttl_ms,
        }
    }

    pub fn evict_expired(&self) {
        let now = Utc::now().timestamp_millis();
        self.map.retain(|_, (_, expires)| *expires > now);
    }
}

#[async_trait]
impl ActiveStatusStore for MemoryActiveCache {
    async fn get(&self, user_id: Uuid) -> Option<ActiveLookup> {
        if self.ttl_ms <= 0 {
            return None;
        }
        let now = Utc::now().timestamp_millis();
        let entry = self.map.get(&user_id)?;
        if entry.1 <= now {
            return None;
        }
        Some(if entry.0 { ActiveLookup::Active } else { ActiveLookup::Inactive })
    }

    async fn put(&self, user_id: Uuid, active: bool) {
        if self.ttl_ms <= 0 {
            return;
        }
        let now = Utc::now().timestamp_millis();
        self.map.insert(user_id, (active, now + self.ttl_ms));
    }

    async fn invalidate(&self, user_id: Uuid) {
        self.map.remove(&user_id);
    }
}

// ─── Redis backend ──────────────────────────────────────────────────────

/// Atomic single-use INSERT via `SET key value NX EX ttl`. Returns
/// `Ok(true)` on first insert, `Ok(false)` on replay. The Lua call
/// keeps the operation atomic so two concurrent consumers can't both
/// see "first time".
const NONCE_LUA: &str = r#"
local ok = redis.call('SET', KEYS[1], '1', 'NX', 'EX', ARGV[1])
if ok then return 1 else return 0 end
"#;

/// Sliding-window rate limiter via sorted set. Adds the current ts,
/// drops anything older than the window, returns the post-add count.
/// If count > limit, the caller bills the violation; we deliberately
/// keep the just-inserted ts so the offender's window doesn't reset
/// on rejection.
const RATE_LUA: &str = r#"
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window + 1000)
return redis.call('ZCARD', key)
"#;

#[derive(Clone)]
pub struct RedisStores {
    pool: deadpool_redis::Pool,
    /// Common namespace prefix so multiple environments can share a Redis.
    prefix: String,
    /// TTLs in milliseconds for the relevant stores.
    pub idempotency_ttl_ms: i64,
    pub nonce_ttl_ms: i64,
    pub rate_window_ms: i64,
    pub rate_max: u64,
    pub active_ttl_ms: i64,
}

impl RedisStores {
    pub fn new(
        pool: deadpool_redis::Pool,
        prefix: impl Into<String>,
        idempotency_ttl_ms: i64,
        nonce_ttl_ms: i64,
        rate_window_ms: i64,
        rate_max: u64,
        active_ttl_ms: i64,
    ) -> Self {
        Self {
            pool,
            prefix: prefix.into(),
            idempotency_ttl_ms: idempotency_ttl_ms.max(1_000),
            nonce_ttl_ms: nonce_ttl_ms.max(100),
            rate_window_ms: rate_window_ms.max(1_000),
            rate_max: rate_max.max(1),
            active_ttl_ms,
        }
    }

    fn key(&self, suffix: &str) -> String {
        format!("{}:{}", self.prefix, suffix)
    }

    /// Round-trip ping to fail loud at boot if Redis is unreachable.
    pub async fn ping(&self) -> Result<(), String> {
        let mut conn = self
            .pool
            .get()
            .await
            .map_err(|e| format!("redis pool: {}", e))?;
        let pong: String = redis::cmd("PING")
            .query_async(&mut *conn)
            .await
            .map_err(|e| format!("redis ping: {}", e))?;
        if pong == "PONG" {
            Ok(())
        } else {
            Err(format!("unexpected ping response: {}", pong))
        }
    }
}

pub struct RedisIdempotency {
    inner: RedisStores,
}

impl RedisIdempotency {
    pub fn new(inner: RedisStores) -> Self {
        Self { inner }
    }
}

#[async_trait]
impl IdempotencyStore for RedisIdempotency {
    async fn get(&self, key: &str) -> Option<CachedResponse> {
        use redis::AsyncCommands;
        let mut conn = self.inner.pool.get().await.ok()?;
        let key = self.inner.key(&format!("idem:{}", key));
        let raw: Option<Vec<u8>> = conn.get(&key).await.ok();
        let bytes = raw?;
        serde_json::from_slice::<CachedResponse>(&bytes).ok()
    }

    async fn put(&self, key: String, status: u16, body: Vec<u8>) {
        use redis::AsyncCommands;
        let now = Utc::now().timestamp_millis();
        let payload = CachedResponse {
            status,
            body,
            expires_at_ms: now + self.inner.idempotency_ttl_ms,
        };
        let bytes = match serde_json::to_vec(&payload) {
            Ok(b) => b,
            Err(e) => {
                tracing::warn!(error = %e, "Idempotency cache serialise failed");
                return;
            }
        };
        let key = self.inner.key(&format!("idem:{}", key));
        if let Ok(mut conn) = self.inner.pool.get().await {
            // SETEX in milliseconds for tighter TTL alignment with the payload.
            let ttl_secs = (self.inner.idempotency_ttl_ms / 1_000).max(1) as u64;
            let _: Result<(), _> = conn.set_ex(&key, bytes, ttl_secs).await;
        }
    }
}

pub struct RedisNonceStore {
    inner: RedisStores,
}

impl RedisNonceStore {
    pub fn new(inner: RedisStores) -> Self {
        Self { inner }
    }
}

#[async_trait]
impl NonceStore for RedisNonceStore {
    async fn consume(&self, quote_id: Uuid) -> Result<(), NonceError> {
        let mut conn = match self.inner.pool.get().await {
            Ok(c) => c,
            Err(e) => {
                tracing::error!(error = %e, "Redis nonce pool acquire failed; failing closed");
                // Fail closed: if Redis is unreachable, refuse the bet.
                return Err(NonceError::AlreadyUsed);
            }
        };
        let key = self.inner.key(&format!("nonce:{}", quote_id));
        let ttl_secs = (self.inner.nonce_ttl_ms / 1_000).max(1) as i64;
        let r: Result<i64, redis::RedisError> = redis::Script::new(NONCE_LUA)
            .key(&key)
            .arg(ttl_secs)
            .invoke_async(&mut *conn)
            .await;
        match r {
            Ok(1) => Ok(()),
            Ok(_) => Err(NonceError::AlreadyUsed),
            Err(e) => {
                tracing::error!(error = %e, "Redis nonce script failed; failing closed");
                Err(NonceError::AlreadyUsed)
            }
        }
    }
}

pub struct RedisRateLimit {
    inner: RedisStores,
}

impl RedisRateLimit {
    pub fn new(inner: RedisStores) -> Self {
        Self { inner }
    }
}

#[async_trait]
impl RateLimitStore for RedisRateLimit {
    async fn check(&self, user_id: Uuid) -> Result<(), RateLimitError> {
        let mut conn = match self.inner.pool.get().await {
            Ok(c) => c,
            Err(e) => {
                // Fail open on RL — better degraded service than full outage.
                tracing::warn!(error = %e, "Redis rate-limit pool acquire failed; allowing");
                return Ok(());
            }
        };
        let key = self.inner.key(&format!("rl:{}", user_id));
        let now = Utc::now().timestamp_millis();
        // Member must be unique to avoid ZADD treating retries as one entry.
        let member = format!("{}-{}", now, Uuid::new_v4());
        let res: Result<i64, redis::RedisError> = redis::Script::new(RATE_LUA)
            .key(&key)
            .arg(now)
            .arg(self.inner.rate_window_ms)
            .arg(self.inner.rate_max as i64)
            .arg(&member)
            .invoke_async(&mut *conn)
            .await;
        match res {
            Ok(count) if (count as u64) <= self.inner.rate_max => Ok(()),
            Ok(count) => Err(RateLimitError::Exceeded(count as u64)),
            Err(e) => {
                tracing::warn!(error = %e, "Redis rate-limit script failed; allowing");
                Ok(())
            }
        }
    }
}

pub struct RedisActiveCache {
    inner: RedisStores,
}

impl RedisActiveCache {
    pub fn new(inner: RedisStores) -> Self {
        Self { inner }
    }
}

#[async_trait]
impl ActiveStatusStore for RedisActiveCache {
    async fn get(&self, user_id: Uuid) -> Option<ActiveLookup> {
        if self.inner.active_ttl_ms <= 0 {
            return None;
        }
        use redis::AsyncCommands;
        let mut conn = self.inner.pool.get().await.ok()?;
        let key = self.inner.key(&format!("active:{}", user_id));
        let raw: Option<String> = conn.get(&key).await.ok();
        match raw.as_deref() {
            Some("1") => Some(ActiveLookup::Active),
            Some("0") => Some(ActiveLookup::Inactive),
            _ => None,
        }
    }

    async fn put(&self, user_id: Uuid, active: bool) {
        if self.inner.active_ttl_ms <= 0 {
            return;
        }
        use redis::AsyncCommands;
        if let Ok(mut conn) = self.inner.pool.get().await {
            let key = self.inner.key(&format!("active:{}", user_id));
            let value = if active { "1" } else { "0" };
            let ttl_secs = (self.inner.active_ttl_ms / 1_000).max(1) as u64;
            let _: Result<(), _> = conn.set_ex(&key, value, ttl_secs).await;
        }
    }

    async fn invalidate(&self, user_id: Uuid) {
        use redis::AsyncCommands;
        if let Ok(mut conn) = self.inner.pool.get().await {
            let key = self.inner.key(&format!("active:{}", user_id));
            let _: Result<(), _> = conn.del::<_, ()>(&key).await;
        }
    }
}

// ─── memory evictor task helpers (only useful for memory backend) ──────

pub fn spawn_memory_evictors(
    idempotency: Arc<MemoryIdempotency>,
    nonces: Arc<MemoryNonceStore>,
    rate_limit: Arc<MemoryRateLimit>,
    active_cache: Arc<MemoryActiveCache>,
) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(30));
        loop {
            tick.tick().await;
            idempotency.evict_expired();
            nonces.evict_expired();
            rate_limit.evict_old();
            active_cache.evict_expired();
        }
    });
}

// ─── tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn memory_idempotency_roundtrip() {
        let store = MemoryIdempotency::new(60_000);
        let user = Uuid::new_v4();
        let key = idempotency_key(user, "k");
        assert!(store.get(&key).await.is_none());
        store.put(key.clone(), 201, b"hello".to_vec()).await;
        let cached = store.get(&key).await.unwrap();
        assert_eq!(cached.status, 201);
        assert_eq!(&cached.body[..], b"hello");
    }

    #[tokio::test]
    async fn memory_nonce_first_then_replay() {
        let store = MemoryNonceStore::new(2_000);
        let id = Uuid::new_v4();
        assert!(store.consume(id).await.is_ok());
        assert_eq!(store.consume(id).await, Err(NonceError::AlreadyUsed));
    }

    #[tokio::test]
    async fn memory_rate_limit_caps_per_user() {
        let limiter = MemoryRateLimit::new(2, 10_000);
        let u = Uuid::new_v4();
        assert!(limiter.check(u).await.is_ok());
        assert!(limiter.check(u).await.is_ok());
        assert!(matches!(
            limiter.check(u).await,
            Err(RateLimitError::Exceeded(_))
        ));
    }

    #[tokio::test]
    async fn memory_active_cache_distinguishes_states() {
        let cache = MemoryActiveCache::new(60_000);
        let u = Uuid::new_v4();
        assert_eq!(cache.get(u).await, None);
        cache.put(u, true).await;
        assert_eq!(cache.get(u).await, Some(ActiveLookup::Active));
        cache.put(u, false).await;
        assert_eq!(cache.get(u).await, Some(ActiveLookup::Inactive));
        cache.invalidate(u).await;
        assert_eq!(cache.get(u).await, None);
    }
}
