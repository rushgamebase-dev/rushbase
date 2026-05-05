//! `EventHandler` implementation for the vault listener.
//!
//! Each observed event is mirrored idempotently into Postgres:
//!  - `Deposited` → `users.deposited_wei += amount`, ledger DEPOSIT row.
//!  - `Withdrawn` → `users.withdrawn_wei += amount`, ledger WITHDRAWAL row,
//!    matching `withdraw_authorizations` row flipped to SPENT.
//!  - `HouseFunded` → `house_state.house_buffer_wei += amount`, house ledger row.
//!
//! `(chain_tx_hash, chain_log_index)` is unique, so re-delivering the
//! same log is a no-op.

use crate::chain::listener::{
    DepositObserved, EventHandler, HouseFundedObserved, HouseWithdrawnObserved, ListenerError,
    WithdrawObserved,
};
use crate::db::repositories::UserRepository;
use async_trait::async_trait;
use bigdecimal::BigDecimal;
use sqlx::PgPool;
use std::str::FromStr;
use std::sync::Arc;

pub struct VaultEventHandler {
    pool: PgPool,
    user_repo: UserRepository,
    chain_id: i64,
    vault_address: String,
}

impl VaultEventHandler {
    pub fn new(pool: PgPool, chain_id: u64, vault_address: String) -> Self {
        let user_repo = UserRepository::new(pool.clone());
        Self {
            pool,
            user_repo,
            chain_id: chain_id as i64,
            vault_address: vault_address.to_lowercase(),
        }
    }

    pub fn shared(pool: PgPool, chain_id: u64, vault_address: String) -> Arc<Self> {
        Arc::new(Self::new(pool, chain_id, vault_address))
    }

    async fn ensure_chain_state_row(&self) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            INSERT INTO chain_state (chain_id, vault_address, last_processed_block)
            VALUES ($1, $2, 0)
            ON CONFLICT (chain_id, vault_address) DO NOTHING
            "#,
        )
        .bind(self.chain_id)
        .bind(&self.vault_address)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

#[async_trait]
impl EventHandler for VaultEventHandler {
    async fn on_deposit(&self, ev: DepositObserved) -> Result<(), ListenerError> {
        let amount_bd = BigDecimal::from_str(&ev.amount_wei.to_string())
            .map_err(|e| ListenerError::Handler(e.to_string()))?;
        let wallet = format!("0x{:x}", ev.user);
        self.user_repo
            .apply_deposit(
                &wallet,
                &amount_bd,
                &ev.tx_hash,
                ev.log_index as i32,
                ev.block_number as i64,
            )
            .await
            .map_err(|e| ListenerError::Handler(e.to_string()))?;

        tracing::info!(
            user = %wallet,
            amount_wei = %amount_bd,
            tx = %ev.tx_hash,
            "Deposit observed and applied"
        );
        Ok(())
    }

    async fn on_withdraw(&self, ev: WithdrawObserved) -> Result<(), ListenerError> {
        let amount_bd = BigDecimal::from_str(&ev.amount_wei.to_string())
            .map_err(|e| ListenerError::Handler(e.to_string()))?;
        let nonce_i64: i64 = ev
            .nonce
            .try_into()
            .map_err(|_| ListenerError::Handler("nonce overflows i64".into()))?;
        let wallet = format!("0x{:x}", ev.user);
        self.user_repo
            .apply_withdrawal(
                &wallet,
                &amount_bd,
                nonce_i64,
                &ev.tx_hash,
                ev.log_index as i32,
                ev.block_number as i64,
            )
            .await
            .map_err(|e| ListenerError::Handler(e.to_string()))?;

        tracing::info!(
            user = %wallet,
            amount_wei = %amount_bd,
            nonce = nonce_i64,
            tx = %ev.tx_hash,
            "Withdrawal observed and applied"
        );
        Ok(())
    }

    async fn on_house_funded(&self, ev: HouseFundedObserved) -> Result<(), ListenerError> {
        let amount_bd = BigDecimal::from_str(&ev.amount_wei.to_string())
            .map_err(|e| ListenerError::Handler(e.to_string()))?;

        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| ListenerError::Handler(e.to_string()))?;

        // Idempotent house ledger insert. The unique index on
        // (chain_tx_hash, chain_log_index) is partial; ON CONFLICT
        // can't bind to it, so use a NOT EXISTS pre-check instead.
        let inserted = sqlx::query(
            r#"
            INSERT INTO house_ledger (
                tx_type, amount_wei, buffer_before_wei, buffer_after_wei,
                user_id, chain_tx_hash, chain_log_index, description
            )
            SELECT 'HOUSE_FUNDED',
                   $1,
                   COALESCE((SELECT house_buffer_wei FROM house_state LIMIT 1), 0),
                   COALESCE((SELECT house_buffer_wei FROM house_state LIMIT 1), 0) + $1,
                   NULL,
                   $2,
                   $3,
                   'On-chain HouseFunded'
             WHERE NOT EXISTS (
                 SELECT 1 FROM house_ledger
                  WHERE chain_tx_hash = $2 AND chain_log_index = $3
             )
            RETURNING id
            "#,
        )
        .bind(&amount_bd)
        .bind(&ev.tx_hash)
        .bind(ev.log_index as i32)
        .execute(&mut *tx)
        .await
        .map_err(|e| ListenerError::Handler(e.to_string()))?;

        if inserted.rows_affected() > 0 {
            sqlx::query(
                "UPDATE house_state SET house_buffer_wei = house_buffer_wei + $1, updated_at = NOW()",
            )
            .bind(&amount_bd)
            .execute(&mut *tx)
            .await
            .map_err(|e| ListenerError::Handler(e.to_string()))?;
        }

        tx.commit()
            .await
            .map_err(|e| ListenerError::Handler(e.to_string()))?;

        tracing::info!(
            from = %format!("0x{:x}", ev.from),
            amount_wei = %amount_bd,
            "House funding observed"
        );
        Ok(())
    }

    async fn on_house_withdrawn(
        &self,
        ev: HouseWithdrawnObserved,
    ) -> Result<(), ListenerError> {
        let amount_bd = BigDecimal::from_str(&ev.amount_wei.to_string())
            .map_err(|e| ListenerError::Handler(e.to_string()))?;

        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| ListenerError::Handler(e.to_string()))?;

        let inserted = sqlx::query(
            r#"
            INSERT INTO house_ledger (
                tx_type, amount_wei, buffer_before_wei, buffer_after_wei,
                user_id, chain_tx_hash, chain_log_index, description
            )
            SELECT 'HOUSE_WITHDRAWN',
                   -$1,
                   COALESCE((SELECT house_buffer_wei FROM house_state LIMIT 1), 0),
                   COALESCE((SELECT house_buffer_wei FROM house_state LIMIT 1), 0) - $1,
                   NULL,
                   $2,
                   $3,
                   'On-chain HouseWithdrawn'
             WHERE NOT EXISTS (
                 SELECT 1 FROM house_ledger
                  WHERE chain_tx_hash = $2 AND chain_log_index = $3
             )
            RETURNING id
            "#,
        )
        .bind(&amount_bd)
        .bind(&ev.tx_hash)
        .bind(ev.log_index as i32)
        .execute(&mut *tx)
        .await
        .map_err(|e| ListenerError::Handler(e.to_string()))?;

        if inserted.rows_affected() > 0 {
            sqlx::query(
                "UPDATE house_state SET house_buffer_wei = house_buffer_wei - $1, updated_at = NOW()",
            )
            .bind(&amount_bd)
            .execute(&mut *tx)
            .await
            .map_err(|e| ListenerError::Handler(e.to_string()))?;
        }

        tx.commit()
            .await
            .map_err(|e| ListenerError::Handler(e.to_string()))?;

        tracing::info!(
            to = %format!("0x{:x}", ev.to),
            amount_wei = %amount_bd,
            "House withdrawal observed"
        );
        Ok(())
    }

    async fn cursor(&self) -> Result<u64, ListenerError> {
        self.ensure_chain_state_row()
            .await
            .map_err(|e| ListenerError::Handler(e.to_string()))?;
        let last: i64 = sqlx::query_scalar(
            "SELECT last_processed_block FROM chain_state WHERE chain_id = $1 AND vault_address = $2",
        )
        .bind(self.chain_id)
        .bind(&self.vault_address)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| ListenerError::Handler(e.to_string()))?;
        Ok(last as u64)
    }

    async fn advance_cursor(&self, block: u64) -> Result<(), ListenerError> {
        sqlx::query(
            r#"
            UPDATE chain_state
               SET last_processed_block = GREATEST(last_processed_block, $1::BIGINT),
                   last_processed_at = NOW(),
                   updated_at = NOW()
             WHERE chain_id = $2 AND vault_address = $3
            "#,
        )
        .bind(block as i64)
        .bind(self.chain_id)
        .bind(&self.vault_address)
        .execute(&self.pool)
        .await
        .map_err(|e| ListenerError::Handler(e.to_string()))?;
        Ok(())
    }
}
