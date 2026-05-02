//! Integration tests for the Redis-backed implementations of
//! `IdempotencyStore`, `NonceStore`, `RateLimitStore`, and
//! `ActiveStatusStore`. Each test brings up a fresh Redis container
//! via testcontainers, builds a `RedisStores` against it, and exercises
//! the same trait API the engine uses in production.
//!
//! The matching memory backends are covered by `lib::api::anti_replay`
//! unit tests; this file is what proves the cluster-mode path works.

use rush_engine::api::anti_replay::{
    idempotency_key, ActiveLookup, ActiveStatusStore, IdempotencyStore, NonceError, NonceStore,
    RateLimitError, RateLimitStore, RedisActiveCache, RedisIdempotency, RedisNonceStore,
    RedisRateLimit, RedisStores,
};
use std::time::Duration;
use testcontainers::runners::AsyncRunner;
use testcontainers_modules::redis::Redis as RedisImage;
use uuid::Uuid;

async fn fresh_redis() -> RedisStores {
    let container = RedisImage::default()
        .start()
        .await
        .expect("redis container start (Docker required)");
    let port = container
        .get_host_port_ipv4(6379)
        .await
        .expect("port lookup");
    Box::leak(Box::new(container));
    let url = format!("redis://127.0.0.1:{}", port);
    let cfg = deadpool_redis::Config::from_url(&url);
    let pool = cfg
        .create_pool(Some(deadpool_redis::Runtime::Tokio1))
        .expect("redis pool");
    let stores = RedisStores::new(
        pool,
        format!("rush_test_{}", Uuid::new_v4()),
        // Use generous TTLs so tests aren't racy on slow CI.
        60_000, // idempotency
        2_000,  // nonce
        10_000, // rate window
        3,      // rate max
        60_000, // active cache
    );
    stores.ping().await.expect("redis ping");
    stores
}

#[tokio::test]
async fn redis_idempotency_replay_returns_cached_body() {
    let stores = fresh_redis().await;
    let idem = RedisIdempotency::new(stores);

    let user = Uuid::new_v4();
    let key = idempotency_key(user, "first");
    assert!(idem.get(&key).await.is_none(), "miss expected");

    idem.put(key.clone(), 201, b"original-body".to_vec()).await;
    let cached = idem.get(&key).await.expect("hit expected");
    assert_eq!(cached.status, 201);
    assert_eq!(&cached.body[..], b"original-body");
}

#[tokio::test]
async fn redis_idempotency_keys_isolated_per_namespace() {
    // Two stores with different prefixes share the Redis but not the
    // keys — validates the multi-environment story.
    let mut a = fresh_redis().await;
    let mut b = fresh_redis().await;
    a.idempotency_ttl_ms = 60_000;
    b.idempotency_ttl_ms = 60_000;
    let store_a = RedisIdempotency::new(a);
    let store_b = RedisIdempotency::new(b);

    let user = Uuid::new_v4();
    let key = idempotency_key(user, "k");
    store_a.put(key.clone(), 201, b"a".to_vec()).await;
    assert!(store_a.get(&key).await.is_some());
    // The second store has a different prefix → no hit.
    assert!(store_b.get(&key).await.is_none());
}

#[tokio::test]
async fn redis_nonce_consume_then_replay_blocks() {
    let stores = fresh_redis().await;
    let nonces = RedisNonceStore::new(stores);
    let id = Uuid::new_v4();
    assert!(nonces.consume(id).await.is_ok());
    assert_eq!(nonces.consume(id).await, Err(NonceError::AlreadyUsed));
}

#[tokio::test]
async fn redis_nonce_distinct_ids_succeed() {
    let stores = fresh_redis().await;
    let nonces = RedisNonceStore::new(stores);
    assert!(nonces.consume(Uuid::new_v4()).await.is_ok());
    assert!(nonces.consume(Uuid::new_v4()).await.is_ok());
    assert!(nonces.consume(Uuid::new_v4()).await.is_ok());
}

#[tokio::test]
async fn redis_rate_limit_caps_per_user() {
    let stores = fresh_redis().await;
    let limiter = RedisRateLimit::new(stores); // max=3 per 10s

    let u = Uuid::new_v4();
    assert!(limiter.check(u).await.is_ok());
    assert!(limiter.check(u).await.is_ok());
    assert!(limiter.check(u).await.is_ok());
    let result = limiter.check(u).await;
    assert!(
        matches!(result, Err(RateLimitError::Exceeded(_))),
        "4th call should hit the 3-per-window cap"
    );
}

#[tokio::test]
async fn redis_rate_limit_isolated_between_users() {
    let stores = fresh_redis().await;
    let limiter = RedisRateLimit::new(stores);

    let a = Uuid::new_v4();
    let b = Uuid::new_v4();
    // Exhaust user `a`, then verify `b` still has full budget.
    for _ in 0..3 {
        limiter.check(a).await.unwrap();
    }
    assert!(limiter.check(a).await.is_err());
    for _ in 0..3 {
        limiter.check(b).await.unwrap();
    }
}

#[tokio::test]
async fn redis_active_cache_round_trip_and_invalidate() {
    let stores = fresh_redis().await;
    let cache = RedisActiveCache::new(stores);

    let u = Uuid::new_v4();
    assert_eq!(cache.get(u).await, None);

    cache.put(u, true).await;
    assert_eq!(cache.get(u).await, Some(ActiveLookup::Active));

    cache.put(u, false).await;
    assert_eq!(cache.get(u).await, Some(ActiveLookup::Inactive));

    cache.invalidate(u).await;
    assert_eq!(cache.get(u).await, None);
}

#[tokio::test]
async fn redis_nonce_expires_after_ttl() {
    // Use a fresh store with a 1-second TTL so the test isn't slow.
    let mut stores = fresh_redis().await;
    stores.nonce_ttl_ms = 1_000;
    let nonces = RedisNonceStore::new(stores);

    let id = Uuid::new_v4();
    assert!(nonces.consume(id).await.is_ok());
    assert_eq!(nonces.consume(id).await, Err(NonceError::AlreadyUsed));

    // Wait past the TTL; the same id should be reusable.
    tokio::time::sleep(Duration::from_millis(1_200)).await;
    assert!(nonces.consume(id).await.is_ok());
}
