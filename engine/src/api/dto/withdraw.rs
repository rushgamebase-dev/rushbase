use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct SignWithdrawRequest {
    /// Amount to withdraw, in wei (decimal string).
    pub amount_wei: String,
}

#[derive(Debug, Serialize)]
pub struct SignWithdrawResponse {
    pub authorization_id: Uuid,
    pub user_id: Uuid,
    pub wallet: String,
    pub amount_wei: String,
    pub nonce: u64,
    pub signature: String,
    pub signer_address: String,
    pub chain_id: u64,
    pub vault_address: String,
}

impl From<crate::chain::WithdrawAuthorization> for SignWithdrawResponse {
    fn from(a: crate::chain::WithdrawAuthorization) -> Self {
        Self {
            authorization_id: a.authorization_id,
            user_id: a.user_id,
            wallet: a.wallet,
            amount_wei: a.amount_wei,
            nonce: a.nonce,
            signature: a.signature,
            signer_address: a.signer_address,
            chain_id: a.chain_id,
            vault_address: a.vault_address,
        }
    }
}
