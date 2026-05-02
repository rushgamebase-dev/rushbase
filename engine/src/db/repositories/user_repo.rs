use crate::models::user::{LeaderboardEntry, User, UserBalance};
use bigdecimal::BigDecimal;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Clone)]
pub struct UserRepository {
    pool: PgPool,
}

impl UserRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Insert a new user keyed by wallet address. If the wallet already
    /// exists, returns the existing row (idempotent for first-time login).
    pub async fn upsert_by_wallet(&self, wallet_address: &str) -> Result<User, sqlx::Error> {
        let wallet = wallet_address.to_lowercase();
        sqlx::query_as::<_, User>(
            r#"
            INSERT INTO users (wallet_address)
            VALUES ($1)
            ON CONFLICT (wallet_address) DO UPDATE
                SET last_login_at = NOW()
            RETURNING *
            "#,
        )
        .bind(&wallet)
        .fetch_one(&self.pool)
        .await
    }

    pub async fn find_by_id(&self, id: Uuid) -> Result<Option<User>, sqlx::Error> {
        sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
    }

    pub async fn find_by_wallet(&self, wallet: &str) -> Result<Option<User>, sqlx::Error> {
        sqlx::query_as::<_, User>("SELECT * FROM users WHERE wallet_address = $1")
            .bind(wallet.to_lowercase())
            .fetch_optional(&self.pool)
            .await
    }

    pub async fn find_by_username(&self, username: &str) -> Result<Option<User>, sqlx::Error> {
        sqlx::query_as::<_, User>("SELECT * FROM users WHERE username = $1")
            .bind(username)
            .fetch_optional(&self.pool)
            .await
    }

    pub async fn get_balance(&self, user_id: Uuid) -> Result<UserBalance, sqlx::Error> {
        let user = self.find_by_id(user_id).await?.ok_or(sqlx::Error::RowNotFound)?;
        Ok(UserBalance::from(&user))
    }

    pub async fn update_last_login(&self, user_id: Uuid) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE users SET last_login_at = NOW() WHERE id = $1")
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Reserve the next withdrawal nonce for `user_id` and return it.
    /// The engine signs `(chainId, vault, user, amount, nonce)` and persists
    /// the authorization in `withdraw_authorizations`.
    pub async fn reserve_next_withdraw_nonce(&self, user_id: Uuid) -> Result<i64, sqlx::Error> {
        let nonce: i64 = sqlx::query_scalar(
            r#"
            UPDATE users
               SET next_withdraw_nonce = next_withdraw_nonce + 1,
                   updated_at = NOW()
             WHERE id = $1
            RETURNING next_withdraw_nonce - 1
            "#,
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(nonce)
    }

    /// Apply an observed on-chain deposit, idempotent on (tx_hash, log_index).
    /// Returns the updated user balance row.
    pub async fn apply_deposit(
        &self,
        wallet: &str,
        amount_wei: &BigDecimal,
        tx_hash: &str,
        log_index: i32,
        block_number: i64,
    ) -> Result<User, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        let wallet = wallet.to_lowercase();

        // Ensure user exists.
        let user = sqlx::query_as::<_, User>(
            r#"
            INSERT INTO users (wallet_address)
            VALUES ($1)
            ON CONFLICT (wallet_address) DO UPDATE SET updated_at = NOW()
            RETURNING *
            "#,
        )
        .bind(&wallet)
        .fetch_one(&mut *tx)
        .await?;

        let before_free = user.free_balance_wei();

        // Idempotent insert into ledger.
        let inserted = sqlx::query(
            r#"
            INSERT INTO ledger (user_id, tx_type, amount_wei, free_balance_before_wei,
                                free_balance_after_wei, reference_type, chain_tx_hash,
                                chain_log_index, chain_block_number, description)
            VALUES ($1, 'DEPOSIT'::transaction_type, $2, $3, $4, 'vault_deposit',
                    $5, $6, $7, 'On-chain deposit observed')
            ON CONFLICT (chain_tx_hash, chain_log_index) DO NOTHING
            RETURNING id
            "#,
        )
        .bind(user.id)
        .bind(amount_wei)
        .bind(&before_free)
        .bind(&before_free + amount_wei)
        .bind(tx_hash)
        .bind(log_index)
        .bind(block_number)
        .execute(&mut *tx)
        .await?;

        if inserted.rows_affected() == 0 {
            // Already processed — return current state without mutating the user row.
            tx.commit().await?;
            return Ok(user);
        }

        let updated = sqlx::query_as::<_, User>(
            r#"
            UPDATE users
               SET deposited_wei = deposited_wei + $2,
                   updated_at = NOW()
             WHERE id = $1
            RETURNING *
            "#,
        )
        .bind(user.id)
        .bind(amount_wei)
        .fetch_one(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(updated)
    }

    /// Apply an observed on-chain withdrawal, idempotent on (tx_hash, log_index).
    /// Marks the matching `withdraw_authorizations` row as SPENT.
    pub async fn apply_withdrawal(
        &self,
        wallet: &str,
        amount_wei: &BigDecimal,
        nonce: i64,
        tx_hash: &str,
        log_index: i32,
        block_number: i64,
    ) -> Result<User, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        let wallet = wallet.to_lowercase();

        let user = sqlx::query_as::<_, User>(
            "SELECT * FROM users WHERE wallet_address = $1 FOR UPDATE",
        )
        .bind(&wallet)
        .fetch_one(&mut *tx)
        .await?;

        let before_free = user.free_balance_wei();

        let inserted = sqlx::query(
            r#"
            INSERT INTO ledger (user_id, tx_type, amount_wei, free_balance_before_wei,
                                free_balance_after_wei, reference_type, chain_tx_hash,
                                chain_log_index, chain_block_number, description)
            VALUES ($1, 'WITHDRAWAL'::transaction_type, -$2, $3, $4, 'vault_withdrawal',
                    $5, $6, $7, 'On-chain withdrawal observed')
            ON CONFLICT (chain_tx_hash, chain_log_index) DO NOTHING
            RETURNING id
            "#,
        )
        .bind(user.id)
        .bind(amount_wei)
        .bind(&before_free)
        .bind(&before_free - amount_wei)
        .bind(tx_hash)
        .bind(log_index)
        .bind(block_number)
        .execute(&mut *tx)
        .await?;

        if inserted.rows_affected() == 0 {
            tx.commit().await?;
            return Ok(user);
        }

        let updated = sqlx::query_as::<_, User>(
            r#"
            UPDATE users
               SET withdrawn_wei = withdrawn_wei + $2,
                   updated_at = NOW()
             WHERE id = $1
            RETURNING *
            "#,
        )
        .bind(user.id)
        .bind(amount_wei)
        .fetch_one(&mut *tx)
        .await?;

        sqlx::query(
            r#"
            UPDATE withdraw_authorizations
               SET status = 'SPENT',
                   spent_tx_hash = $1,
                   spent_at = NOW()
             WHERE user_id = $2 AND nonce = $3 AND status = 'SIGNED'
            "#,
        )
        .bind(tx_hash)
        .bind(user.id)
        .bind(nonce)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(updated)
    }

    pub async fn get_leaderboard(
        &self,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<LeaderboardEntry>, sqlx::Error> {
        sqlx::query_as::<_, LeaderboardEntry>(
            r#"
            SELECT
                ROW_NUMBER() OVER (ORDER BY realized_pnl_wei DESC) as rank,
                id,
                wallet_address,
                username,
                realized_pnl_wei,
                total_trades,
                total_wins,
                CASE
                    WHEN total_trades > 0 THEN (total_wins::FLOAT / total_trades) * 100
                    ELSE 0
                END as win_rate,
                best_win_streak
            FROM users
            WHERE is_active = true AND total_trades > 0
            ORDER BY realized_pnl_wei DESC
            LIMIT $1 OFFSET $2
            "#,
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await
    }
}
