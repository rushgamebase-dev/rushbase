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

    /// Active bets across ALL users — feeds the public "Active Bets"
    /// social-proof panel. Joins `users` so the panel can show a
    /// player handle (`username` if set, else short wallet).
    /// Privacy: returns no PII, just public bet data + a display
    /// handle. Capped by `limit` to keep round-trip small.
    pub async fn list_public_active(
        &self,
        limit: i64,
    ) -> Result<Vec<PublicBetRow>, sqlx::Error> {
        sqlx::query_as::<_, PublicBetRow>(
            r#"
            SELECT
                tb.id,
                tb.symbol,
                tb.stake_wei,
                tb.multiplier_bps,
                tb.potential_payout_wei,
                tb.placed_at,
                tb.window_end_ms,
                tb.resolved_at,
                COALESCE(u.username, '') AS username,
                u.wallet_address
            FROM touch_bets tb
            JOIN users u ON u.id = tb.user_id
            WHERE tb.status = 'ACTIVE'
            ORDER BY tb.placed_at DESC
            LIMIT $1
            "#,
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await
    }

    /// Most recent WON bets across ALL users — feeds the public
    /// "Recent Wins" panel. Same privacy/limits as `list_public_active`.
    pub async fn list_public_recent_wins(
        &self,
        limit: i64,
    ) -> Result<Vec<PublicBetRow>, sqlx::Error> {
        sqlx::query_as::<_, PublicBetRow>(
            r#"
            SELECT
                tb.id,
                tb.symbol,
                tb.stake_wei,
                tb.multiplier_bps,
                tb.potential_payout_wei,
                tb.placed_at,
                tb.window_end_ms,
                tb.resolved_at,
                COALESCE(u.username, '') AS username,
                u.wallet_address
            FROM touch_bets tb
            JOIN users u ON u.id = tb.user_id
            WHERE tb.status = 'WON'
            ORDER BY tb.resolved_at DESC NULLS LAST
            LIMIT $1
            "#,
        )
        .bind(limit)
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

    /// Aggregate ACTIVE bets per (band × window) cell, plus a count of
    /// distinct players with at least one ACTIVE bet. Powers the
    /// canvas heatmap + the "X online" pill — single round-trip so
    /// the canvas can poll cheaply (every 2 s) without crushing the DB.
    pub async fn list_active_heatmap(
        &self,
    ) -> Result<(i64, Vec<HeatmapCellRow>), sqlx::Error> {
        let online: i64 = sqlx::query_scalar(
            // "Online" is just "has at least one ACTIVE bet OR placed
            // a bet in the last 5 minutes". A player who finished the
            // last bet 30s ago is still in the room watching the
            // snake. Cheap proxy that doesn't need WS-session
            // tracking infrastructure.
            r#"
            SELECT COUNT(DISTINCT user_id) FROM touch_bets
             WHERE status = 'ACTIVE'
                OR placed_at > NOW() - INTERVAL '5 minutes'
            "#,
        )
        .fetch_one(&self.pool)
        .await?;

        let cells = sqlx::query_as::<_, HeatmapCellRow>(
            r#"
            SELECT
                target_row_min_q8,
                target_row_max_q8,
                window_start_ms,
                window_end_ms,
                COUNT(*)::bigint AS n_bets,
                SUM(stake_wei) AS total_stake_wei
            FROM touch_bets
            WHERE status = 'ACTIVE'
            GROUP BY target_row_min_q8, target_row_max_q8, window_start_ms, window_end_ms
            ORDER BY n_bets DESC
            LIMIT 200
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok((online, cells))
    }
}

/// One aggregated bucket of ACTIVE bets that share the same band
/// (`target_row_*_q8`) and the same window (`window_*_ms`). The
/// canvas matches this against its locally-built cell ids by
/// comparing the four bytes — same band + window = same cell.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct HeatmapCellRow {
    pub target_row_min_q8: BigDecimal,
    pub target_row_max_q8: BigDecimal,
    pub window_start_ms: i64,
    pub window_end_ms: i64,
    pub n_bets: i64,
    pub total_stake_wei: BigDecimal,
}

/// Public-facing bet row for social-proof panels (Active Bets, Recent
/// Wins). Carries no per-user IDs, only a display handle and the same
/// public bet data that lives on-chain via events.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct PublicBetRow {
    pub id: Uuid,
    pub symbol: String,
    pub stake_wei: BigDecimal,
    pub multiplier_bps: i32,
    pub potential_payout_wei: BigDecimal,
    pub placed_at: chrono::DateTime<chrono::Utc>,
    pub window_end_ms: i64,
    pub resolved_at: Option<chrono::DateTime<chrono::Utc>>,
    pub username: String,
    pub wallet_address: String,
}
