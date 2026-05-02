use crate::models::ledger::{LedgerEntry, TransactionType};
use bigdecimal::BigDecimal;
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

#[derive(Clone)]
pub struct LedgerRepository {
    pool: PgPool,
}

impl LedgerRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Insert a ledger entry. `free_balance_before_wei` is the user's free
    /// balance immediately before the entry is applied; the engine
    /// computes it from the current row state inside the same transaction
    /// that updates `users` to keep the audit chain consistent.
    pub async fn create_in_tx(
        tx: &mut PgConnection,
        user_id: Uuid,
        tx_type: TransactionType,
        amount_wei: &BigDecimal,
        free_balance_before_wei: &BigDecimal,
        reference_id: Option<Uuid>,
        reference_type: Option<&str>,
        description: Option<&str>,
    ) -> Result<LedgerEntry, sqlx::Error> {
        let after = free_balance_before_wei + amount_wei;
        sqlx::query_as::<_, LedgerEntry>(
            r#"
            INSERT INTO ledger (
                user_id, tx_type, amount_wei,
                free_balance_before_wei, free_balance_after_wei,
                reference_id, reference_type, description
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
            "#,
        )
        .bind(user_id)
        .bind(tx_type)
        .bind(amount_wei)
        .bind(free_balance_before_wei)
        .bind(&after)
        .bind(reference_id)
        .bind(reference_type)
        .bind(description)
        .fetch_one(&mut *tx)
        .await
    }

    pub async fn get_user_entries(
        &self,
        user_id: Uuid,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<LedgerEntry>, sqlx::Error> {
        sqlx::query_as::<_, LedgerEntry>(
            r#"
            SELECT * FROM ledger
             WHERE user_id = $1
             ORDER BY created_at DESC
             LIMIT $2 OFFSET $3
            "#,
        )
        .bind(user_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await
    }

    pub async fn get_by_reference(
        &self,
        reference_id: Uuid,
    ) -> Result<Vec<LedgerEntry>, sqlx::Error> {
        sqlx::query_as::<_, LedgerEntry>(
            "SELECT * FROM ledger WHERE reference_id = $1 ORDER BY created_at ASC",
        )
        .bind(reference_id)
        .fetch_all(&self.pool)
        .await
    }

    pub async fn get_user_total_by_type_wei(
        &self,
        user_id: Uuid,
        tx_type: TransactionType,
    ) -> Result<BigDecimal, sqlx::Error> {
        sqlx::query_scalar::<_, BigDecimal>(
            "SELECT COALESCE(SUM(amount_wei), 0) FROM ledger WHERE user_id = $1 AND tx_type = $2",
        )
        .bind(user_id)
        .bind(tx_type)
        .fetch_one(&self.pool)
        .await
    }

    /// Append a row to `house_ledger`. Uses the in-memory `house_buffer_wei`
    /// snapshot from `house_state` for the audit chain.
    #[allow(clippy::too_many_arguments)]
    pub async fn create_house_entry_in_tx(
        tx: &mut PgConnection,
        tx_type: &str,
        amount_wei: &BigDecimal,
        buffer_before_wei: &BigDecimal,
        position_id: Option<Uuid>,
        user_id: Option<Uuid>,
        description: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        let buffer_after = buffer_before_wei + amount_wei;
        sqlx::query(
            r#"
            INSERT INTO house_ledger (
                tx_type, amount_wei, buffer_before_wei, buffer_after_wei,
                position_id, user_id, description
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            "#,
        )
        .bind(tx_type)
        .bind(amount_wei)
        .bind(buffer_before_wei)
        .bind(&buffer_after)
        .bind(position_id)
        .bind(user_id)
        .bind(description)
        .execute(&mut *tx)
        .await?;
        Ok(())
    }
}
