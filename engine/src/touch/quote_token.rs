//! Server-signed quote tokens.
//!
//! When a client calls `/trade/quote`, the engine returns a `QuoteToken`
//! along with the multiplier. To open a bet, the client must echo the
//! same token back. The engine then:
//!
//!   1. Verifies the HMAC signature (token wasn't tampered with).
//!   2. Verifies the token isn't expired (TTL ~1–2 s).
//!   3. Verifies the token's parameters match the open-bet request body
//!      (so a quote for one band/duration can't be reused for another).
//!
//! This closes the "quote shopping" hole where a client repeatedly hits
//! `/trade/quote` until it gets a favourable multiplier and then submits
//! the most-favourable one. With signed quotes, every bet must reference
//! a quote ≤ TTL old, and the engine's recompute happens against the
//! token's `entry_price_q8` (so quotes don't drift mid-flight).
//!
//! The token format is `base64url(payload).base64url(hmac)`. Compact, no
//! Redis dependency, fully stateless. Idempotency (one bet per quote)
//! still requires server-side tracking; we keep that out of scope here
//! and rely on TTL + bet-side replay protection (`expected_multiplier_bps`
//! must match what the engine computes at open time using the same entry
//! price).

use alloy::primitives::U256;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::str::FromStr;
use thiserror::Error;
use uuid::Uuid;

use crate::models::touch_bet::TouchDirection;

type HmacSha256 = Hmac<Sha256>;

/// Anything sent over the wire and HMAC'd. Field order matters for the
/// signed payload — keep stable across versions or bump `v`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuoteTokenPayload {
    /// Schema version. Increment on breaking changes.
    pub v: u8,
    pub quote_id: Uuid,
    pub symbol: String,
    pub direction: String, // "UP" / "DOWN"
    pub entry_price_q8: String,
    pub target_row_min_q8: String,
    pub target_row_max_q8: String,
    pub window_duration_ms: u64,
    /// Offset between server's `now` (at quote time) and the start of the
    /// window. Signed because first-passage pricing is offset-specific:
    /// otherwise a player could quote at offset=0 (cheap mult) and try to
    /// place at offset=9000 (different real probability).
    #[serde(default)]
    pub window_start_offset_ms: u64,
    pub multiplier_bps: u32,
    pub issued_at_ms: i64,
    pub expires_at_ms: i64,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum QuoteTokenError {
    #[error("token format invalid")]
    BadFormat,
    #[error("base64 decode failed")]
    BadEncoding,
    #[error("payload deserialization failed")]
    BadPayload,
    #[error("signature verification failed")]
    BadSignature,
    #[error("token expired")]
    Expired,
    #[error("token mismatch: {field}")]
    Mismatch { field: &'static str },
    #[error("signing key invalid")]
    BadKey,
}

/// Wraps an HMAC key + ttl, derived from config at startup.
#[derive(Clone)]
pub struct QuoteSigner {
    key: Vec<u8>,
    ttl_ms: i64,
}

impl QuoteSigner {
    /// `secret` must have at least 32 bytes of entropy. Operators should
    /// rotate this on schedule; old tokens simply fail verification.
    pub fn new(secret: &str, ttl_ms: i64) -> Result<Self, QuoteTokenError> {
        if secret.len() < 32 {
            return Err(QuoteTokenError::BadKey);
        }
        Ok(Self {
            key: secret.as_bytes().to_vec(),
            ttl_ms: ttl_ms.max(100),
        })
    }

    pub fn ttl_ms(&self) -> i64 {
        self.ttl_ms
    }

    /// Build, sign and serialize a token for a fresh quote.
    #[allow(clippy::too_many_arguments)]
    pub fn issue(
        &self,
        quote_id: Uuid,
        symbol: &str,
        direction: TouchDirection,
        entry_price_q8: U256,
        target_row_min_q8: U256,
        target_row_max_q8: U256,
        window_start_offset_ms: u64,
        window_duration_ms: u64,
        multiplier_bps: u32,
        now_ms: i64,
    ) -> String {
        let payload = QuoteTokenPayload {
            v: 1,
            quote_id,
            symbol: symbol.to_uppercase(),
            direction: direction.as_str().to_string(),
            entry_price_q8: entry_price_q8.to_string(),
            target_row_min_q8: target_row_min_q8.to_string(),
            target_row_max_q8: target_row_max_q8.to_string(),
            window_duration_ms,
            window_start_offset_ms,
            multiplier_bps,
            issued_at_ms: now_ms,
            expires_at_ms: now_ms + self.ttl_ms,
        };
        self.encode(&payload)
    }

    fn encode(&self, payload: &QuoteTokenPayload) -> String {
        let body = serde_json::to_vec(payload).expect("payload serializes");
        let body_b64 = URL_SAFE_NO_PAD.encode(&body);
        let sig = self.sign_bytes(body_b64.as_bytes());
        let sig_b64 = URL_SAFE_NO_PAD.encode(sig);
        format!("{}.{}", body_b64, sig_b64)
    }

    fn sign_bytes(&self, data: &[u8]) -> Vec<u8> {
        let mut mac = HmacSha256::new_from_slice(&self.key).expect("any key length is valid");
        mac.update(data);
        mac.finalize().into_bytes().to_vec()
    }

    /// Verify HMAC + freshness. Caller still has to compare the payload
    /// fields against the request (use [`expect_match`] for ergonomics).
    pub fn verify(&self, token: &str, now_ms: i64) -> Result<QuoteTokenPayload, QuoteTokenError> {
        let (body_b64, sig_b64) = token
            .split_once('.')
            .ok_or(QuoteTokenError::BadFormat)?;
        let expected_sig = self.sign_bytes(body_b64.as_bytes());
        let provided_sig = URL_SAFE_NO_PAD
            .decode(sig_b64)
            .map_err(|_| QuoteTokenError::BadEncoding)?;
        // Constant-time compare via HMAC verify (same key; mac.verify_slice
        // would also work, but we already have the bytes).
        if !constant_time_eq(&expected_sig, &provided_sig) {
            return Err(QuoteTokenError::BadSignature);
        }
        let body = URL_SAFE_NO_PAD
            .decode(body_b64)
            .map_err(|_| QuoteTokenError::BadEncoding)?;
        let payload: QuoteTokenPayload =
            serde_json::from_slice(&body).map_err(|_| QuoteTokenError::BadPayload)?;
        if now_ms > payload.expires_at_ms {
            return Err(QuoteTokenError::Expired);
        }
        Ok(payload)
    }
}

/// Validate a verified payload against the parameters of an open-bet
/// request. Returns the parsed band as `U256` for the engine to consume.
#[allow(clippy::too_many_arguments)]
pub fn expect_match(
    payload: &QuoteTokenPayload,
    symbol: &str,
    direction: TouchDirection,
    target_row_min_q8: U256,
    target_row_max_q8: U256,
    window_duration_ms: u64,
    window_start_offset_ms: u64,
    expected_multiplier_bps: u32,
) -> Result<(), QuoteTokenError> {
    if payload.symbol != symbol.to_uppercase() {
        return Err(QuoteTokenError::Mismatch { field: "symbol" });
    }
    if payload.direction != direction.as_str() {
        return Err(QuoteTokenError::Mismatch { field: "direction" });
    }
    let token_min =
        U256::from_str(&payload.target_row_min_q8).map_err(|_| QuoteTokenError::BadPayload)?;
    if token_min != target_row_min_q8 {
        return Err(QuoteTokenError::Mismatch {
            field: "target_row_min_q8",
        });
    }
    let token_max =
        U256::from_str(&payload.target_row_max_q8).map_err(|_| QuoteTokenError::BadPayload)?;
    if token_max != target_row_max_q8 {
        return Err(QuoteTokenError::Mismatch {
            field: "target_row_max_q8",
        });
    }
    if payload.window_duration_ms != window_duration_ms {
        return Err(QuoteTokenError::Mismatch {
            field: "window_duration_ms",
        });
    }
    // Tolerate up to ±2s of clock drift between the quote and the bet so
    // a slow click doesn't 400 — the multiplier match check above already
    // catches any meaningful repricing.
    let drift = (payload.window_start_offset_ms as i64 - window_start_offset_ms as i64).abs();
    if drift > 2_000 {
        return Err(QuoteTokenError::Mismatch {
            field: "window_start_offset_ms",
        });
    }
    if payload.multiplier_bps != expected_multiplier_bps {
        return Err(QuoteTokenError::Mismatch {
            field: "multiplier_bps",
        });
    }
    Ok(())
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn signer() -> QuoteSigner {
        QuoteSigner::new("a-test-secret-with-at-least-32-bytes!!", 2_000).unwrap()
    }

    fn issue_token(s: &QuoteSigner, now_ms: i64) -> (String, QuoteTokenPayload) {
        let token = s.issue(
            Uuid::new_v4(),
            "BTCUSDT",
            TouchDirection::Up,
            U256::from(50_000_00000000_u64),
            U256::from(50_010_00000000_u64),
            U256::from(50_050_00000000_u64),
            0, // window_start_offset_ms
            3_000,
            12_500,
            now_ms,
        );
        let payload = s.verify(&token, now_ms).unwrap();
        (token, payload)
    }

    #[test]
    fn signer_rejects_short_secrets() {
        assert!(matches!(
            QuoteSigner::new("too-short", 1_000),
            Err(QuoteTokenError::BadKey)
        ));
    }

    #[test]
    fn issue_then_verify_roundtrips() {
        let s = signer();
        let now = 1_700_000_000_000_i64;
        let (_token, p) = issue_token(&s, now);
        assert_eq!(p.symbol, "BTCUSDT");
        assert_eq!(p.multiplier_bps, 12_500);
        assert_eq!(p.expires_at_ms, now + 2_000);
    }

    #[test]
    fn expired_token_rejected() {
        let s = signer();
        let now = 1_700_000_000_000_i64;
        let token = s.issue(
            Uuid::new_v4(),
            "BTCUSDT",
            TouchDirection::Up,
            U256::from(50_000_00000000_u64),
            U256::from(50_010_00000000_u64),
            U256::from(50_050_00000000_u64),
            0,
            3_000,
            12_500,
            now,
        );
        assert!(matches!(
            s.verify(&token, now + 2_001),
            Err(QuoteTokenError::Expired)
        ));
    }

    #[test]
    fn tampered_payload_rejected() {
        let s = signer();
        let now = 1_700_000_000_000_i64;
        let (token, _) = issue_token(&s, now);
        let (_, sig_b64) = token.split_once('.').unwrap();
        // Forge a payload claiming a 99× multiplier; reuse the original sig.
        let mut payload: QuoteTokenPayload =
            serde_json::from_slice(&URL_SAFE_NO_PAD.decode(token.split_once('.').unwrap().0).unwrap()).unwrap();
        payload.multiplier_bps = 990_000;
        let evil_body = serde_json::to_vec(&payload).unwrap();
        let evil = format!("{}.{}", URL_SAFE_NO_PAD.encode(&evil_body), sig_b64);
        assert!(matches!(
            s.verify(&evil, now),
            Err(QuoteTokenError::BadSignature)
        ));
    }

    #[test]
    fn different_secret_rejects_token() {
        let a = signer();
        let b = QuoteSigner::new("another-secret-with-32-or-more-bytes!!", 2_000).unwrap();
        let now = 1_700_000_000_000_i64;
        let (token, _) = issue_token(&a, now);
        assert!(matches!(
            b.verify(&token, now),
            Err(QuoteTokenError::BadSignature)
        ));
    }

    #[test]
    fn expect_match_catches_param_drift() {
        let s = signer();
        let now = 1_700_000_000_000_i64;
        let (_, p) = issue_token(&s, now);
        // Match-correct case.
        assert!(expect_match(
            &p,
            "BTCUSDT",
            TouchDirection::Up,
            U256::from(50_010_00000000_u64),
            U256::from(50_050_00000000_u64),
            3_000,
            0,
            12_500,
        )
        .is_ok());

        // Symbol drift.
        assert!(matches!(
            expect_match(
                &p,
                "ETHUSDT",
                TouchDirection::Up,
                U256::from(50_010_00000000_u64),
                U256::from(50_050_00000000_u64),
                3_000,
                0,
                12_500,
            ),
            Err(QuoteTokenError::Mismatch { field: "symbol" })
        ));

        // Multiplier drift.
        assert!(matches!(
            expect_match(
                &p,
                "BTCUSDT",
                TouchDirection::Up,
                U256::from(50_010_00000000_u64),
                U256::from(50_050_00000000_u64),
                3_000,
                0,
                12_499,
            ),
            Err(QuoteTokenError::Mismatch { field: "multiplier_bps" })
        ));

        // Window-start offset drift past tolerance.
        assert!(matches!(
            expect_match(
                &p,
                "BTCUSDT",
                TouchDirection::Up,
                U256::from(50_010_00000000_u64),
                U256::from(50_050_00000000_u64),
                3_000,
                9_000, // token has 0; 9s drift is way past tolerance
                12_500,
            ),
            Err(QuoteTokenError::Mismatch { field: "window_start_offset_ms" })
        ));
    }
}
