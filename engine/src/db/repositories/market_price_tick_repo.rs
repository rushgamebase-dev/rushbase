use crate::utils::wei::bd_to_q8_i64;
use bigdecimal::BigDecimal;
use sqlx::PgPool;

#[derive(Clone)]
pub struct MarketPriceTickRepository {
    pool: PgPool,
}

#[derive(Debug, Clone, sqlx::FromRow)]
struct MarketPriceTickRow {
    timestamp_ms: i64,
    price_q8: BigDecimal,
}

impl MarketPriceTickRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn insert_tick(
        &self,
        symbol: &str,
        timestamp_ms: i64,
        price_q8: i64,
        source: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            INSERT INTO market_price_ticks (symbol, timestamp_ms, price_q8, source)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (symbol, timestamp_ms) DO UPDATE
               SET price_q8 = EXCLUDED.price_q8,
                   source = EXCLUDED.source
            "#,
        )
        .bind(symbol)
        .bind(timestamp_ms)
        .bind(BigDecimal::from(price_q8))
        .bind(source)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn path_window(
        &self,
        symbol: &str,
        start_ms: i64,
        end_ms: i64,
    ) -> Result<Vec<(i64, f64)>, sqlx::Error> {
        let rows = sqlx::query_as::<_, MarketPriceTickRow>(
            r#"
            SELECT timestamp_ms, price_q8 FROM (
                (SELECT timestamp_ms, price_q8
                   FROM market_price_ticks
                  WHERE symbol = $1 AND timestamp_ms < $2
                  ORDER BY timestamp_ms DESC
                  LIMIT 1)
                UNION ALL
                (SELECT timestamp_ms, price_q8
                   FROM market_price_ticks
                  WHERE symbol = $1 AND timestamp_ms >= $2 AND timestamp_ms <= $3
                  ORDER BY timestamp_ms ASC)
                UNION ALL
                (SELECT timestamp_ms, price_q8
                   FROM market_price_ticks
                  WHERE symbol = $1 AND timestamp_ms > $3
                  ORDER BY timestamp_ms ASC
                  LIMIT 1)
            ) ticks
            ORDER BY timestamp_ms ASC
            "#,
        )
        .bind(symbol)
        .bind(start_ms)
        .bind(end_ms)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| {
                let price = bd_to_q8_i64(&row.price_q8) as f64 / 1e8;
                (row.timestamp_ms, price)
            })
            .filter(|(_, price)| price.is_finite() && *price > 0.0)
            .collect())
    }

    pub async fn prune_older_than(&self, cutoff_ms: i64) -> Result<u64, sqlx::Error> {
        let result = sqlx::query("DELETE FROM market_price_ticks WHERE timestamp_ms < $1")
            .bind(cutoff_ms)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected())
    }
}
