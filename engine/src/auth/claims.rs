use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Access-token claims. Identity = wallet address (lowercased).
/// No refresh tokens — clients re-auth via SIWE when access token expires.
///
/// `jti` is the per-token unique id. Its main purpose is to give us a
/// stable handle for surgical revocation (logout, admin force-revoke).
/// `iat` (issued-at) doubles as the watermark for per-user mass
/// invalidation: setting `users.tokens_invalidated_before_ms = now`
/// kills every token issued before that instant in one write.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: Uuid,                // User ID
    pub wallet: String,           // 0x-lowercase
    pub exp: i64,                 // Expiration timestamp (UNIX seconds)
    pub iat: i64,                 // Issued-at (UNIX seconds)
    /// Unique per-token identifier. Older tokens issued before the jti
    /// field existed will deserialize with `Uuid::nil()` via the default,
    /// so a single "rotate signing key" + "force re-login" cycle covers
    /// the upgrade.
    #[serde(default)]
    pub jti: Uuid,
}

impl Claims {
    pub fn new(user_id: Uuid, wallet: String, expires_in_secs: i64) -> Self {
        let now = chrono::Utc::now().timestamp();
        Self {
            sub: user_id,
            wallet,
            exp: now + expires_in_secs,
            iat: now,
            jti: Uuid::new_v4(),
        }
    }

    pub fn is_expired(&self) -> bool {
        chrono::Utc::now().timestamp() > self.exp
    }
}
