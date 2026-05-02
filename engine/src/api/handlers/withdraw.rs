use crate::api::dto::{SignWithdrawRequest, SignWithdrawResponse};
use crate::api::middleware::AuthenticatedUser;
use crate::api::state::AppState;
use crate::chain::WithdrawServiceError;
use crate::errors::ApiError;
use actix_web::{web, HttpResponse};
use alloy::primitives::U256;
use std::str::FromStr;

/// `POST /api/v1/trade/withdraw/sign` — engine signs a withdrawal authorization
/// the user can submit on-chain to `TradingVault.withdraw(...)`.
pub async fn sign_withdraw(
    app_state: web::Data<AppState>,
    user: AuthenticatedUser,
    body: web::Json<SignWithdrawRequest>,
) -> Result<HttpResponse, ApiError> {
    let amount = U256::from_str(&body.amount_wei)
        .map_err(|_| ApiError::validation_error("amount_wei must be a uint256 decimal string"))?;
    if amount.is_zero() {
        return Err(ApiError::validation_error("amount_wei must be > 0"));
    }

    let auth = app_state
        .withdraw_service
        .authorize(user.user_id, amount)
        .await
        .map_err(|e| match e {
            WithdrawServiceError::Insufficient { requested_wei, available_wei } => {
                ApiError::bad_request(format!(
                    "Insufficient balance: requested {} wei, available {} wei",
                    requested_wei, available_wei
                ))
            }
            WithdrawServiceError::InsufficientVaultLiquidity {
                requested_wei,
                vault_balance_wei,
            } => ApiError::service_unavailable(format!(
                "Vault liquidity too low: requested {} wei, vault holds {} wei",
                requested_wei, vault_balance_wei
            )),
            WithdrawServiceError::VaultRead(m) => {
                ApiError::service_unavailable(format!("Vault read failed: {}", m))
            }
            WithdrawServiceError::InvalidAmount(m) => ApiError::validation_error(m),
            WithdrawServiceError::InvalidWallet(m) => ApiError::internal(m),
            WithdrawServiceError::UserNotFound => ApiError::not_found("User not found"),
            WithdrawServiceError::SignFailed(m) => ApiError::internal(m),
            WithdrawServiceError::Db(m) => ApiError::internal(m),
        })?;

    Ok(HttpResponse::Ok().json(SignWithdrawResponse::from(auth)))
}
