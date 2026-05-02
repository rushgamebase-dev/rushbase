use crate::config::settings::RedisConfig;
use deadpool_redis::{Config, Pool, Runtime};
use tracing::info;

pub fn create_pool(config: &RedisConfig) -> Result<Pool, deadpool_redis::CreatePoolError> {
    info!("Creating Redis connection pool (size: {})", config.pool_size);

    let cfg = Config::from_url(&config.url);
    let pool = cfg.create_pool(Some(Runtime::Tokio1))?;

    info!("Redis connection pool created successfully");
    Ok(pool)
}

pub type RedisPool = Pool;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pool_creation() {
        let config = RedisConfig {
            url: "redis://localhost:6379".to_string(),
            pool_size: 10,
        };

        // This would require a running Redis instance
        // let pool = create_pool(&config);
    }
}
