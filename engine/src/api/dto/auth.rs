use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Request a SIWE nonce. Client supplies the wallet it intends to sign with
/// so the engine scopes the nonce to that address.
#[derive(Debug, Deserialize)]
pub struct SiweNonceRequest {
    /// 0x-prefixed Ethereum address.
    pub wallet: String,
}

#[derive(Debug, Serialize)]
pub struct SiweNonceResponse {
    pub nonce: String,
    pub expires_at: i64, // unix timestamp
}

#[derive(Debug, Deserialize)]
pub struct SiweVerifyRequest {
    /// Full SIWE message text (EIP-4361).
    pub message: String,
    /// 0x-prefixed 65-byte signature.
    pub signature: String,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub access_token: String,
    pub token_type: String,
    pub expires_in: i64,
    pub user: UserResponse,
}

#[derive(Debug, Serialize)]
pub struct UserResponse {
    pub id: Uuid,
    pub wallet_address: String,
    pub username: Option<String>,
    pub deposited_wei: String,
    pub withdrawn_wei: String,
    pub realized_pnl_wei: String,
    pub locked_margin_wei: String,
    pub free_balance_wei: String,
}

/// Validate a 0x-prefixed 40-hex Ethereum address (case-insensitive).
pub fn is_valid_wallet(s: &str) -> bool {
    if s.len() != 42 || !s.starts_with("0x") {
        return false;
    }
    s[2..].bytes().all(|b| b.is_ascii_hexdigit())
}
