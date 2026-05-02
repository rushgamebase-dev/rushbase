//! SIWE (Sign-In with Ethereum, EIP-4361) verification.
//!
//! Flow:
//!  1. Client requests a fresh nonce via `POST /api/v1/auth/siwe/nonce`
//!     and receives `{nonce, expires_at}`. The nonce is persisted in
//!     `siwe_nonces`.
//!  2. Client builds the SIWE message embedding that nonce and the user's
//!     wallet address, signs it with the wallet (`personal_sign`), and
//!     submits `{message, signature}` to `POST /api/v1/auth/siwe/verify`.
//!  3. The engine parses + verifies the message, marks the nonce consumed,
//!     upserts the user row keyed by `wallet_address`, and returns a JWT.
//!
//! This module is transport-agnostic: it only handles message validation.
//! Persistence (nonce store + user upsert) lives in the handler layer.

use alloy::primitives::Address;
use serde::{Deserialize, Serialize};
use siwe::{Message, VerificationOpts};
use std::str::FromStr;
use thiserror::Error;
use time::OffsetDateTime;

#[derive(Debug, Error)]
pub enum SiweError {
    #[error("Failed to parse SIWE message: {0}")]
    Parse(String),
    #[error("Signature verification failed: {0}")]
    Verify(String),
    #[error("Domain mismatch: expected {expected}, got {actual}")]
    DomainMismatch { expected: String, actual: String },
    #[error("Chain mismatch: expected {expected}, got {actual}")]
    ChainMismatch { expected: u64, actual: u64 },
    #[error("Nonce mismatch")]
    NonceMismatch,
    #[error("Invalid signature length: expected 65, got {0}")]
    InvalidSignatureLength(usize),
    #[error("Invalid hex: {0}")]
    InvalidHex(String),
}

pub struct SiweVerifier {
    pub expected_domain: String,
    pub expected_chain_id: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerifiedSiwe {
    /// Lowercased 0x-prefixed wallet address.
    pub wallet: String,
    /// Nonce echoed from the SIWE message — caller must consume it from the
    /// nonce store.
    pub nonce: String,
}

impl SiweVerifier {
    pub fn new(domain: impl Into<String>, chain_id: u64) -> Self {
        Self {
            expected_domain: domain.into(),
            expected_chain_id: chain_id,
        }
    }

    /// Parse and verify a SIWE message + signature. The caller is responsible
    /// for matching the returned nonce against a value previously issued and
    /// not yet consumed.
    pub async fn verify(
        &self,
        message: &str,
        signature_hex: &str,
        expected_nonce: &str,
    ) -> Result<VerifiedSiwe, SiweError> {
        let msg = Message::from_str(message).map_err(|e| SiweError::Parse(e.to_string()))?;

        if msg.domain.to_string() != self.expected_domain {
            return Err(SiweError::DomainMismatch {
                expected: self.expected_domain.clone(),
                actual: msg.domain.to_string(),
            });
        }

        if msg.chain_id != self.expected_chain_id {
            return Err(SiweError::ChainMismatch {
                expected: self.expected_chain_id,
                actual: msg.chain_id,
            });
        }

        if msg.nonce != expected_nonce {
            return Err(SiweError::NonceMismatch);
        }

        let raw = hex::decode(signature_hex.trim_start_matches("0x"))
            .map_err(|e| SiweError::InvalidHex(e.to_string()))?;
        if raw.len() != 65 {
            return Err(SiweError::InvalidSignatureLength(raw.len()));
        }
        let mut sig = [0u8; 65];
        sig.copy_from_slice(&raw);

        let opts = VerificationOpts {
            domain: Some(msg.domain.clone()),
            nonce: Some(msg.nonce.clone()),
            timestamp: Some(OffsetDateTime::now_utc()),
            ..Default::default()
        };

        msg.verify(&sig, &opts)
            .await
            .map_err(|e| SiweError::Verify(e.to_string()))?;

        let address = Address::from(msg.address);
        Ok(VerifiedSiwe {
            wallet: format!("0x{:x}", address),
            nonce: msg.nonce.clone(),
        })
    }
}

/// Generate a 16-byte random nonce, hex-encoded. Suitable as the `nonce`
/// field of a SIWE message. Stored server-side in `siwe_nonces`.
pub fn generate_nonce() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy::signers::local::PrivateKeySigner;
    use alloy::signers::SignerSync;
    use chrono::Utc;
    use siwe::Version;

    const EXPECTED_DOMAIN: &str = "app.rush.trade";
    const EXPECTED_CHAIN_ID: u64 = 8453;
    /// `cast wallet new --json` output, deterministic test only.
    const TEST_KEY_HEX: &str =
        "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

    /// Build a fully-formed SIWE message + signature for a given (domain,
    /// chain_id, nonce). Returns `(message_text, signature_0x_hex,
    /// wallet_lowercase)` ready to feed to `verify`.
    fn sign_siwe(domain: &str, chain_id: u64, nonce: &str) -> (String, String, String) {
        let signer: PrivateKeySigner = TEST_KEY_HEX
            .trim_start_matches("0x")
            .parse()
            .expect("parse test key");
        let wallet_addr = signer.address();
        let wallet = format!("0x{:x}", wallet_addr);

        let msg = Message {
            domain: domain.parse().expect("parse domain"),
            address: wallet_addr.into_array(),
            statement: Some("Sign in to Rush.".into()),
            uri: format!("https://{}", domain).parse().expect("uri"),
            version: Version::V1,
            chain_id,
            nonce: nonce.into(),
            issued_at: Utc::now()
                .to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
                .parse()
                .expect("issued_at parse"),
            expiration_time: None,
            not_before: None,
            request_id: None,
            resources: vec![],
        };
        let text = msg.to_string();
        let sig = signer
            .sign_message_sync(text.as_bytes())
            .expect("sign EIP-191");
        let sig_hex = format!("0x{}", hex::encode(sig.as_bytes()));
        (text, sig_hex, wallet)
    }

    #[actix_rt::test]
    async fn happy_path_verifies() {
        let nonce = generate_nonce();
        let (msg, sig, wallet) = sign_siwe(EXPECTED_DOMAIN, EXPECTED_CHAIN_ID, &nonce);
        let v = SiweVerifier::new(EXPECTED_DOMAIN, EXPECTED_CHAIN_ID);
        let result = v.verify(&msg, &sig, &nonce).await.expect("happy path");
        assert_eq!(result.wallet, wallet);
        assert_eq!(result.nonce, nonce);
    }

    #[actix_rt::test]
    async fn rejects_wrong_domain() {
        let nonce = generate_nonce();
        // Adversarial sign-in: message names a phishing domain.
        let (msg, sig, _) = sign_siwe("attacker.example", EXPECTED_CHAIN_ID, &nonce);
        let v = SiweVerifier::new(EXPECTED_DOMAIN, EXPECTED_CHAIN_ID);
        let err = v.verify(&msg, &sig, &nonce).await.expect_err("must reject");
        match err {
            SiweError::DomainMismatch { expected, actual } => {
                assert_eq!(expected, EXPECTED_DOMAIN);
                assert_eq!(actual, "attacker.example");
            }
            other => panic!("expected DomainMismatch, got {:?}", other),
        }
    }

    #[actix_rt::test]
    async fn rejects_wrong_chain_id() {
        let nonce = generate_nonce();
        // Cross-chain replay: signed for chain 1 (Ethereum), engine on Base (8453).
        let (msg, sig, _) = sign_siwe(EXPECTED_DOMAIN, 1, &nonce);
        let v = SiweVerifier::new(EXPECTED_DOMAIN, EXPECTED_CHAIN_ID);
        let err = v.verify(&msg, &sig, &nonce).await.expect_err("must reject");
        match err {
            SiweError::ChainMismatch { expected, actual } => {
                assert_eq!(expected, EXPECTED_CHAIN_ID);
                assert_eq!(actual, 1);
            }
            other => panic!("expected ChainMismatch, got {:?}", other),
        }
    }

    #[actix_rt::test]
    async fn rejects_nonce_drift() {
        let signed_nonce = generate_nonce();
        let server_nonce = generate_nonce();
        assert_ne!(signed_nonce, server_nonce);
        let (msg, sig, _) = sign_siwe(EXPECTED_DOMAIN, EXPECTED_CHAIN_ID, &signed_nonce);
        let v = SiweVerifier::new(EXPECTED_DOMAIN, EXPECTED_CHAIN_ID);
        // Server expected a different nonce (e.g. attacker tries to
        // reuse a nonce intended for a different login).
        let err = v
            .verify(&msg, &sig, &server_nonce)
            .await
            .expect_err("must reject");
        assert!(matches!(err, SiweError::NonceMismatch));
    }

    #[actix_rt::test]
    async fn rejects_tampered_signature() {
        let nonce = generate_nonce();
        let (msg, sig, _) = sign_siwe(EXPECTED_DOMAIN, EXPECTED_CHAIN_ID, &nonce);
        // Flip a single byte in the signature — keeps length 65 + valid hex
        // so we hit the verify step rather than length/hex guards.
        let mut tampered: Vec<u8> = hex::decode(sig.trim_start_matches("0x")).unwrap();
        tampered[10] ^= 0x01;
        let tampered_hex = format!("0x{}", hex::encode(&tampered));
        let v = SiweVerifier::new(EXPECTED_DOMAIN, EXPECTED_CHAIN_ID);
        let err = v
            .verify(&msg, &tampered_hex, &nonce)
            .await
            .expect_err("must reject");
        // Either Verify (recovered different address) or
        // InvalidSignature — both signal the sig is no good.
        assert!(
            matches!(err, SiweError::Verify(_)),
            "expected Verify, got {:?}",
            err
        );
    }

    #[actix_rt::test]
    async fn rejects_bad_signature_hex() {
        let nonce = generate_nonce();
        let (msg, _, _) = sign_siwe(EXPECTED_DOMAIN, EXPECTED_CHAIN_ID, &nonce);
        let v = SiweVerifier::new(EXPECTED_DOMAIN, EXPECTED_CHAIN_ID);
        // Non-hex characters anywhere → InvalidHex.
        let err = v
            .verify(&msg, "0xZZZ", &nonce)
            .await
            .expect_err("must reject");
        assert!(matches!(err, SiweError::InvalidHex(_)));
    }

    #[actix_rt::test]
    async fn rejects_signature_wrong_length() {
        let nonce = generate_nonce();
        let (msg, _, _) = sign_siwe(EXPECTED_DOMAIN, EXPECTED_CHAIN_ID, &nonce);
        let v = SiweVerifier::new(EXPECTED_DOMAIN, EXPECTED_CHAIN_ID);
        // Valid hex, length 64 instead of 65 → InvalidSignatureLength.
        let short_sig = format!("0x{}", "ab".repeat(64));
        let err = v
            .verify(&msg, &short_sig, &nonce)
            .await
            .expect_err("must reject");
        assert!(matches!(err, SiweError::InvalidSignatureLength(64)));
    }

    #[actix_rt::test]
    async fn rejects_unparseable_message() {
        let v = SiweVerifier::new(EXPECTED_DOMAIN, EXPECTED_CHAIN_ID);
        let err = v
            .verify("not a SIWE message", "0x00", "ignored")
            .await
            .expect_err("must reject");
        assert!(matches!(err, SiweError::Parse(_)));
    }
}
