use crate::config::settings::DatabaseConfig;
use sqlx::postgres::{PgPool, PgPoolOptions};
use std::time::Duration;
use tracing::info;

pub async fn create_pool(config: &DatabaseConfig) -> Result<PgPool, sqlx::Error> {
    info!(
        "Creating PostgreSQL connection pool (max: {}, min: {})",
        config.max_connections, config.min_connections
    );

    let pool = PgPoolOptions::new()
        .max_connections(config.max_connections)
        .min_connections(config.min_connections)
        .acquire_timeout(Duration::from_secs(config.connect_timeout_secs))
        .idle_timeout(Duration::from_secs(config.idle_timeout_secs))
        // Validate every connection with a cheap `SELECT 1` before
        // the pool hands it out. Without this, sqlx will happily
        // surface a TCP-reset connection to the caller and the next
        // query fails with `Connection reset by peer (os error 104)`.
        // Cost is one round-trip (~0.1 ms over loopback) per acquire,
        // negligible compared to the average resolution-loop query.
        .test_before_acquire(true)
        // Cap connection lifetime well under any kernel/Postgres
        // idle-kill window. 10 min keeps the pool healthy without
        // forcing reconnects mid-traffic.
        .max_lifetime(Some(Duration::from_secs(600)))
        .connect(&config.url)
        .await?;

    info!("PostgreSQL connection pool created successfully");
    Ok(pool)
}

pub async fn run_migrations(pool: &PgPool) -> Result<(), sqlx::migrate::MigrateError> {
    info!("Running database migrations...");
    sqlx::migrate!("./migrations").run(pool).await?;
    info!("Database migrations completed successfully");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_pool_creation() {
        // This test requires a running PostgreSQL instance
        // Skip in CI if database is not available
    }
}
