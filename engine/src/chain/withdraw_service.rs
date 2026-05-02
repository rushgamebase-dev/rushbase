//! Service that produces withdraw authorizations: validates free balance,
//! reserves the next nonce, signs `(chainId, vault, user, amount, nonce)`,
//! and persists the result in `withdraw_authorizations`.
//!
//! The user submits the persisted signature directly to
//! `TradingVault.withdraw(amount, nonce, sig)` on Base. When the matching
//! `Withdrawn` event arrives, the listener flips the row to SPENT and
//! credits `users.withdrawn_wei`.

use crate::chain::signer::{WithdrawAuthorization, WithdrawSigner};
use crate::chain::vault_balance::VaultBalanceProvider;
use crate::db::repositories::UserRepository;
use crate::risk::bd_or_zero_u256;
use alloy::primitives::{Address, U256};
use bigdecimal::BigDecimal;
use chrono::{Duration, Utc};
use sqlx::PgPool;
use std::str::FromStr;
use std::sync::Arc;
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum WithdrawServiceError {
    #[error("Insufficient free balance: requested {requested_wei}, available {available_wei}")]
    Insufficient {
        requested_wei: String,
        available_wei: String,
    },
    /// On-chain solvency: vault contract holds less ETH than the user is
    /// asking to withdraw. Engine refuses to sign — otherwise the user
    /// would burn a nonce on a sig the vault can't honor.
    #[error(
        "Insufficient vault liquidity: vault holds {vault_balance_wei} wei, requested {requested_wei} wei"
    )]
    InsufficientVaultLiquidity {
        requested_wei: String,
        vault_balance_wei: String,
    },
    #[error("Vault read failed: {0}")]
    VaultRead(String),
    #[error("Invalid amount: {0}")]
    InvalidAmount(String),
    #[error("Invalid wallet address: {0}")]
    InvalidWallet(String),
    #[error("User not found")]
    UserNotFound,
    #[error("Signing failed: {0}")]
    SignFailed(String),
    #[error("Database error: {0}")]
    Db(String),
}

impl From<sqlx::Error> for WithdrawServiceError {
    fn from(e: sqlx::Error) -> Self {
        WithdrawServiceError::Db(e.to_string())
    }
}

pub struct WithdrawService {
    pool: PgPool,
    #[allow(dead_code)]
    user_repo: UserRepository,
    signer: Arc<WithdrawSigner>,
    vault_balance: Arc<dyn VaultBalanceProvider>,
    auth_ttl_secs: i64,
}

impl WithdrawService {
    pub fn new(
        pool: PgPool,
        signer: Arc<WithdrawSigner>,
        vault_balance: Arc<dyn VaultBalanceProvider>,
        auth_ttl_secs: i64,
    ) -> Self {
        Self {
            user_repo: UserRepository::new(pool.clone()),
            pool,
            signer,
            vault_balance,
            auth_ttl_secs,
        }
    }

    /// Sign a withdrawal authorization for `user_id` of `amount_wei`.
    /// Returns the persisted authorization (incl. signature) ready to be
    /// surfaced to the client and submitted to the vault contract.
    ///
    /// Checks, in order:
    ///   1. amount > 0
    ///   2. vault on-chain ETH balance ≥ amount (refuse to burn a nonce
    ///      on a sig the vault can't honor)
    ///   3. user free balance ≥ amount
    ///   4. reserve nonce, sign, persist authorization
    pub async fn authorize(
        &self,
        user_id: Uuid,
        amount_wei: U256,
    ) -> Result<WithdrawAuthorization, WithdrawServiceError> {
        if amount_wei.is_zero() {
            return Err(WithdrawServiceError::InvalidAmount(
                "amount must be > 0".into(),
            ));
        }

        // On-chain liquidity gate — read the vault's ETH balance live so a
        // user is never given a sig the vault can't pay (the nonce would
        // be consumed off-chain and the on-chain submit would revert).
        check_vault_liquidity(&*self.vault_balance, amount_wei).await?;

        // Lock user row to compute free balance and reserve nonce atomically.
        let mut tx = self.pool.begin().await?;

        let user = sqlx::query_as::<_, crate::models::user::User>(
            "SELECT * FROM users WHERE id = $1 FOR UPDATE",
        )
        .bind(user_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(WithdrawServiceError::UserNotFound)?;

        let free = user.free_balance_wei();
        let free_u = bd_or_zero_u256(&free);
        if free_u < amount_wei {
            return Err(WithdrawServiceError::Insufficient {
                requested_wei: amount_wei.to_string(),
                available_wei: free.to_string(),
            });
        }

        // Reserve nonce (increment users.next_withdraw_nonce, return the consumed value).
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
        .fetch_one(&mut *tx)
        .await?;

        let wallet = Address::from_str(&user.wallet_address)
            .map_err(|e| WithdrawServiceError::InvalidWallet(e.to_string()))?;

        let auth_id = Uuid::new_v4();
        let auth = self
            .signer
            .sign_withdraw(auth_id, user_id, wallet, amount_wei, nonce as u64)
            .await
            .map_err(|e| WithdrawServiceError::SignFailed(e.to_string()))?;

        let amount_bd = BigDecimal::from_str(&amount_wei.to_string())
            .map_err(|e| WithdrawServiceError::InvalidAmount(e.to_string()))?;
        let expires_at = Utc::now() + Duration::seconds(self.auth_ttl_secs);

        sqlx::query(
            r#"
            INSERT INTO withdraw_authorizations (
                id, user_id, amount_wei, nonce, signature, signer_address,
                free_balance_at_sign_wei, expires_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            "#,
        )
        .bind(auth.authorization_id)
        .bind(user_id)
        .bind(&amount_bd)
        .bind(nonce)
        .bind(&auth.signature)
        .bind(&auth.signer_address)
        .bind(&free)
        .bind(expires_at)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;

        tracing::info!(
            user_id = %user_id,
            wallet = %user.wallet_address,
            amount_wei = %amount_bd,
            nonce,
            "Withdraw authorization signed"
        );

        Ok(auth)
    }

    /// Mark expired SIGNED authorizations (best-effort housekeeping).
    pub async fn expire_stale(&self) -> Result<u64, sqlx::Error> {
        let res = sqlx::query(
            r#"
            UPDATE withdraw_authorizations
               SET status = 'EXPIRED'
             WHERE status = 'SIGNED' AND expires_at < NOW()
            "#,
        )
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected())
    }
}

/// Read the vault's ETH balance and reject if it can't honor `amount_wei`.
/// Extracted so it can be unit-tested without a Postgres pool.
pub async fn check_vault_liquidity(
    provider: &dyn VaultBalanceProvider,
    amount_wei: U256,
) -> Result<(), WithdrawServiceError> {
    let vault_eth = provider
        .vault_eth_balance()
        .await
        .map_err(|e| WithdrawServiceError::VaultRead(e.to_string()))?;
    if vault_eth < amount_wei {
        return Err(WithdrawServiceError::InsufficientVaultLiquidity {
            requested_wei: amount_wei.to_string(),
            vault_balance_wei: vault_eth.to_string(),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chain::vault_balance::MockVaultBalanceProvider;

    #[tokio::test]
    async fn liquidity_check_rejects_when_vault_short() {
        let mock = MockVaultBalanceProvider::new(U256::from(50_000u64), U256::from(20_000u64));
        let res = check_vault_liquidity(&mock, U256::from(75_000u64)).await;
        match res {
            Err(WithdrawServiceError::InsufficientVaultLiquidity {
                requested_wei,
                vault_balance_wei,
            }) => {
                assert_eq!(requested_wei, "75000");
                assert_eq!(vault_balance_wei, "50000");
            }
            other => panic!("expected InsufficientVaultLiquidity, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn liquidity_check_passes_when_vault_holds_enough() {
        let mock = MockVaultBalanceProvider::new(U256::from(100_000u64), U256::from(50_000u64));
        let res = check_vault_liquidity(&mock, U256::from(75_000u64)).await;
        assert!(res.is_ok());
    }

    #[tokio::test]
    async fn liquidity_check_passes_at_exact_balance() {
        let mock = MockVaultBalanceProvider::new(U256::from(75_000u64), U256::from(0u64));
        let res = check_vault_liquidity(&mock, U256::from(75_000u64)).await;
        assert!(res.is_ok());
    }
}
