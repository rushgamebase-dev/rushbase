//! Read-side service over the `ledger` table. The write paths live inside
//! `TradingEngine` / `UserRepository::apply_*` because every wei mutation
//! must happen inside the same transaction that updates `users`.

use crate::db::repositories::LedgerRepository;
use crate::models::ledger::{LedgerEntry, TransactionType};
use sqlx::PgPool;
use uuid::Uuid;

pub struct LedgerService {
    repo: LedgerRepository,
}

impl LedgerService {
    pub fn new(pool: PgPool) -> Self {
        Self {
            repo: LedgerRepository::new(pool),
        }
    }

    pub async fn get_user_history(
        &self,
        user_id: Uuid,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<LedgerEntry>, sqlx::Error> {
        self.repo.get_user_entries(user_id, limit, offset).await
    }

    pub async fn user_total_by_type_wei(
        &self,
        user_id: Uuid,
        tx_type: TransactionType,
    ) -> Result<bigdecimal::BigDecimal, sqlx::Error> {
        self.repo.get_user_total_by_type_wei(user_id, tx_type).await
    }

    pub fn repo(&self) -> &LedgerRepository {
        &self.repo
    }
}
