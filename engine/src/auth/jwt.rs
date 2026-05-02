use crate::auth::claims::Claims;
use crate::config::settings::JwtConfig;
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum JwtError {
    #[error("Failed to create token")]
    TokenCreationError,
    #[error("Invalid token")]
    InvalidToken,
    #[error("Token expired")]
    TokenExpired,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessToken {
    pub access_token: String,
    pub token_type: String,
    pub expires_in: i64,
}

pub struct JwtService {
    encoding_key: EncodingKey,
    decoding_key: DecodingKey,
    access_token_expires: i64,
}

impl JwtService {
    pub fn new(config: &JwtConfig) -> Self {
        Self {
            encoding_key: EncodingKey::from_secret(config.secret.as_bytes()),
            decoding_key: DecodingKey::from_secret(config.secret.as_bytes()),
            access_token_expires: config.access_token_expires_secs,
        }
    }

    pub fn issue(&self, user_id: Uuid, wallet: &str) -> Result<AccessToken, JwtError> {
        let claims = Claims::new(user_id, wallet.to_lowercase(), self.access_token_expires);
        let token = encode(&Header::default(), &claims, &self.encoding_key)
            .map_err(|_| JwtError::TokenCreationError)?;
        Ok(AccessToken {
            access_token: token,
            token_type: "Bearer".to_string(),
            expires_in: self.access_token_expires,
        })
    }

    pub fn validate(&self, token: &str) -> Result<Claims, JwtError> {
        let mut validation = Validation::default();
        validation.validate_exp = false;
        let claims = decode::<Claims>(token, &self.decoding_key, &validation)
            .map(|d| d.claims)
            .map_err(|_| JwtError::InvalidToken)?;
        if claims.is_expired() {
            return Err(JwtError::TokenExpired);
        }
        Ok(claims)
    }

    /// Backwards-compatible alias used elsewhere in the codebase.
    pub fn validate_access_token(&self, token: &str) -> Result<Claims, JwtError> {
        self.validate(token)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn service() -> JwtService {
        JwtService::new(&JwtConfig {
            secret: "test-secret-key-for-testing-minimum-32-chars".to_string(),
            access_token_expires_secs: 900,
            refresh_token_expires_secs: 0,
        })
    }

    #[test]
    fn issue_and_validate_roundtrip() {
        let svc = service();
        let user_id = Uuid::new_v4();
        let issued = svc.issue(user_id, "0xabc").unwrap();
        let claims = svc.validate(&issued.access_token).unwrap();
        assert_eq!(claims.sub, user_id);
        assert_eq!(claims.wallet, "0xabc");
    }
}
