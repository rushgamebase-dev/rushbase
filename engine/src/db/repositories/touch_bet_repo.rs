use crate::models::touch_bet::{TouchBet, TouchDirection};
use bigdecimal::BigDecimal;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Clone)]
pub struct TouchBetRepository {
    pool: PgPool,
}

impl TouchBetRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn create(
        &self,
        user_id: Uuid,
        symbol: &str,
        direction: TouchDirection,
        stake_wei: &BigDecimal,
        multiplier_bps: i32,
        potential_payout_wei: &BigDecimal,
        house_edge_wei: &BigDecimal,
        entry_price_q8: &BigDecimal,
        target_row_min_q8: &BigDecimal,
        target_row_max_q8: &BigDecimal,
        window_start_ms: i64,
        window_end_ms: i64,
    ) -> Result<TouchBet, sqlx::Error> {
        sqlx::query_as::<_, TouchBet>(
            r#"
            INSERT INTO touch_bets (
                user_id, symbol, direction, status,
                stake_wei, multiplier_bps, potential_payout_wei, house_edge_wei,
                entry_price_q8, target_row_min_q8, target_row_max_q8,
                window_start_ms, window_end_ms
            )
            VALUES ($1, $2, $3::touch_direction, 'ACTIVE',
                    $4, $5, $6, $7,
                    $8, $9, $10,
                    $11, $12)
            RETURNING *
            "#,
        )
        .bind(user_id)
        .bind(symbol)
        .bind(direction.as_str())
        .bind(stake_wei)
        .bind(multiplier_bps)
        .bind(potential_payout_wei)
        .bind(house_edge_wei)
        .bind(entry_price_q8)
        .bind(target_row_min_q8)
        .bind(target_row_max_q8)
        .bind(window_start_ms)
        .bind(window_end_ms)
        .fetch_one(&self.pool)
        .await
    }

    pub async fn find_by_id(&self, id: Uuid) -> Result<Option<TouchBet>, sqlx::Error> {
        sqlx::query_as::<_, TouchBet>("SELECT * FROM touch_bets WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
    }

    pub async fn get_user_active(&self, user_id: Uuid) -> Result<Vec<TouchBet>, sqlx::Error> {
        sqlx::query_as::<_, TouchBet>(
            "SELECT * FROM touch_bets WHERE user_id = $1 AND status = 'ACTIVE' ORDER BY placed_at DESC",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await
    }

    /// All ACTIVE bets whose window has elapsed (i.e. ready to resolve).
    pub async fn get_resolvable(&self, now_ms: i64) -> Result<Vec<TouchBet>, sqlx::Error> {
        sqlx::query_as::<_, TouchBet>(
            "SELECT * FROM touch_bets WHERE status = 'ACTIVE' AND window_end_ms <= $1 ORDER BY window_end_ms ASC",
        )
        .bind(now_ms)
        .fetch_all(&self.pool)
        .await
    }

    pub async fn get_user_history(
        &self,
        user_id: Uuid,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<TouchBet>, sqlx::Error> {
        sqlx::query_as::<_, TouchBet>(
            r#"
            SELECT * FROM touch_bets
             WHERE user_id = $1 AND status != 'ACTIVE'
             ORDER BY resolved_at DESC NULLS LAST, placed_at DESC
             LIMIT $2 OFFSET $3
            "#,
        )
        .bind(user_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await
    }

    pub async fn count_user_active(&self, user_id: Uuid) -> Result<i64, sqlx::Error> {
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM touch_bets WHERE user_id = $1 AND status = 'ACTIVE'",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await
    }

    /// Total locked stake across all the user's ACTIVE bets — used as a
    /// double-check against `users.locked_margin_wei`.
    pub async fn user_active_stake_total_wei(
        &self,
        user_id: Uuid,
    ) -> Result<BigDecimal, sqlx::Error> {
        sqlx::query_scalar::<_, BigDecimal>(
            "SELECT COALESCE(SUM(stake_wei), 0) FROM touch_bets WHERE user_id = $1 AND status = 'ACTIVE'",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await
    }

    /// Total potential payout the house owes if every ACTIVE bet wins.
    /// Used by exposure / solvency checks.
    pub async fn total_active_potential_payout_wei(&self) -> Result<BigDecimal, sqlx::Error> {
        sqlx::query_scalar::<_, BigDecimal>(
            "SELECT COALESCE(SUM(potential_payout_wei - stake_wei), 0) FROM touch_bets WHERE status = 'ACTIVE'",
        )
        .fetch_one(&self.pool)
        .await
    }

    pub async fn get_pool(&self) -> &PgPool {
        &self.pool
    }
}
