//! Secret VRF seeds: generation, encryption at rest, decryption at
//! reveal.
//!
//! A seed is 32 bytes of cryptographic randomness from the OS RNG.
//! It's generated at `place_bet`, used (transiently, in memory) to
//! compute the commit hash, then immediately encrypted with
//! AES-256-GCM and persisted to `vrf_seeds.seed_encrypted`. The
//! plaintext seed never touches disk and is dropped from memory at the
//! end of the place_bet handler.
//!
//! At resolution (after `window_end_ms`), the engine reads
//! `seed_encrypted`, decrypts in memory, regenerates the path via
//! `vrf::path::generate_vrf_path`, and emits the seed in the
//! `BetResolved` WS event so the client can re-verify.
//!
//! ## Key management
//!
//! The encryption key is loaded once at engine startup from the
//! `APP_VRF__ENCRYPTION_KEY` env var (32 bytes hex, i.e. 64 chars).
//! Without the key, all seeds in the DB become inert and *no* active
//! bet can be resolved. Operators must:
//!
//!  - generate the key once with `openssl rand -hex 32`
//!  - keep it in their secrets manager (KMS, Vault, sealed-secrets…)
//!  - rotate only in maintenance windows when there are zero ACTIVE
//!    bets in flight (the rotation breaks all then-encrypted seeds)
//!
//! Rotation procedure: write a follow-up migration that decrypts every
//! still-active seed with the old key and re-encrypts with the new
//! one, then bumps the env. Out of scope here; documented in
//! `docs/taptrade-vrf.md`.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use rand::rngs::OsRng;
use rand::RngCore;
use thiserror::Error;

/// Length in bytes of the AES-256-GCM key.
pub const KEY_BYTES: usize = 32;
/// Length in bytes of the AES-GCM nonce. 96 bits is the standard.
pub const NONCE_BYTES: usize = 12;
/// Length in bytes of a VRF seed.
pub const SEED_BYTES: usize = 32;

#[derive(Debug, Error)]
pub enum SeedError {
    #[error("encryption key must be {KEY_BYTES} bytes (got {0})")]
    InvalidKeyLength(usize),
    #[error("encryption key must be valid hex")]
    InvalidKeyHex,
    #[error("ciphertext must contain a {NONCE_BYTES}-byte nonce + tag (got {0})")]
    CiphertextTooShort(usize),
    #[error("ciphertext failed authentication — wrong key or tampered data")]
    AuthFailed,
}

/// Wrapper around the engine's AES-256-GCM key. Built once at startup
/// from `APP_VRF__ENCRYPTION_KEY`.
#[derive(Clone)]
pub struct SeedCipher {
    key: [u8; KEY_BYTES],
}

impl SeedCipher {
    /// Build from a 64-char hex string. Anything shorter or longer
    /// fails — operators must `openssl rand -hex 32` and use the
    /// result verbatim.
    pub fn from_hex(hex_key: &str) -> Result<Self, SeedError> {
        let bytes = hex::decode(hex_key.trim().trim_start_matches("0x"))
            .map_err(|_| SeedError::InvalidKeyHex)?;
        if bytes.len() != KEY_BYTES {
            return Err(SeedError::InvalidKeyLength(bytes.len()));
        }
        let mut key = [0_u8; KEY_BYTES];
        key.copy_from_slice(&bytes);
        Ok(Self { key })
    }

    /// Generate a fresh 32-byte seed from the OS RNG. The result is
    /// cryptographic-grade randomness; not derived from time, PIDs,
    /// or any predictable source.
    pub fn generate_secret_seed(&self) -> [u8; SEED_BYTES] {
        let mut seed = [0_u8; SEED_BYTES];
        // OsRng panics only if the OS RNG is unavailable, which on a
        // healthy host doesn't happen — and if it does, the engine
        // can't safely accept bets anyway, so the panic is correct.
        OsRng.fill_bytes(&mut seed);
        seed
    }

    /// Encrypt a seed for at-rest storage. Each call uses a fresh
    /// random 96-bit nonce — the output is `nonce || ciphertext_with_tag`.
    /// Two encryptions of the same seed produce different bytes; never
    /// use this output to compare seeds (compare the keccak256 commit
    /// hash instead).
    pub fn encrypt_seed(&self, seed: &[u8; SEED_BYTES]) -> Vec<u8> {
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&self.key));
        let mut nonce_bytes = [0_u8; NONCE_BYTES];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        // AES-GCM `encrypt` cannot fail on well-formed inputs — the
        // only error path is hardware AES instruction failure, which
        // would be a bigger problem than this bet.
        let ct = cipher
            .encrypt(nonce, seed.as_ref())
            .expect("AES-GCM encrypt of a 32-byte plaintext never fails on healthy hardware");
        let mut out = Vec::with_capacity(NONCE_BYTES + ct.len());
        out.extend_from_slice(&nonce_bytes);
        out.extend_from_slice(&ct);
        out
    }

    /// Decrypt at reveal time. Returns `AuthFailed` if the ciphertext
    /// has been tampered with or the key is wrong; the caller must
    /// treat that as a fatal data-integrity error and refuse to settle
    /// the bet.
    pub fn decrypt_seed(&self, payload: &[u8]) -> Result<[u8; SEED_BYTES], SeedError> {
        if payload.len() < NONCE_BYTES + 16 {
            // 16 bytes is the GCM tag size; without it the ciphertext
            // is too short to be authentic.
            return Err(SeedError::CiphertextTooShort(payload.len()));
        }
        let (nonce_bytes, ct) = payload.split_at(NONCE_BYTES);
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&self.key));
        let nonce = Nonce::from_slice(nonce_bytes);
        let pt = cipher
            .decrypt(nonce, ct)
            .map_err(|_| SeedError::AuthFailed)?;
        if pt.len() != SEED_BYTES {
            // The encryption side always writes 32 bytes; anything
            // else means the row was written by a different version
            // of the engine. Refusing is the safe default.
            return Err(SeedError::AuthFailed);
        }
        let mut seed = [0_u8; SEED_BYTES];
        seed.copy_from_slice(&pt);
        Ok(seed)
    }
}

/// Hex-encode a 32-byte seed. The path generator takes a `String`
/// because SHA-256 is computed over the hex characters; switching
/// would change every hash and break compatibility with anything
/// that's already stored.
pub fn seed_to_hex(seed: &[u8; SEED_BYTES]) -> String {
    hex::encode(seed)
}

/// Inverse of [`seed_to_hex`]. Used only by the verifier path; the
/// engine itself rarely needs to round-trip.
pub fn seed_from_hex(s: &str) -> Result<[u8; SEED_BYTES], SeedError> {
    let bytes = hex::decode(s.trim().trim_start_matches("0x"))
        .map_err(|_| SeedError::InvalidKeyHex)?;
    if bytes.len() != SEED_BYTES {
        return Err(SeedError::InvalidKeyLength(bytes.len()));
    }
    let mut out = [0_u8; SEED_BYTES];
    out.copy_from_slice(&bytes);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cipher() -> SeedCipher {
        // Deterministic test key — production must use `openssl rand -hex 32`.
        let key = "0".repeat(64);
        SeedCipher::from_hex(&key).unwrap()
    }

    #[test]
    fn rejects_short_key() {
        assert!(matches!(
            SeedCipher::from_hex("00ff"),
            Err(SeedError::InvalidKeyLength(2))
        ));
    }

    #[test]
    fn rejects_non_hex_key() {
        assert!(matches!(
            SeedCipher::from_hex("notvalidhex".repeat(7).as_str()),
            Err(SeedError::InvalidKeyHex)
        ));
    }

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let c = cipher();
        let seed = c.generate_secret_seed();
        let ct = c.encrypt_seed(&seed);
        let pt = c.decrypt_seed(&ct).unwrap();
        assert_eq!(seed, pt);
    }

    #[test]
    fn ciphertext_is_non_deterministic() {
        // Same seed encrypted twice yields different bytes — a fresh
        // nonce on every call. Critical for security: deterministic
        // ciphertexts would let anyone with DB read access link two
        // bets that happened to draw the same seed (vanishingly
        // unlikely, but the protocol shouldn't depend on it).
        let c = cipher();
        let seed = [42_u8; SEED_BYTES];
        let a = c.encrypt_seed(&seed);
        let b = c.encrypt_seed(&seed);
        assert_ne!(a, b);
    }

    #[test]
    fn tampered_ciphertext_rejected() {
        let c = cipher();
        let seed = c.generate_secret_seed();
        let mut ct = c.encrypt_seed(&seed);
        // Flip a bit in the encrypted body — GCM's tag must catch it.
        let tail = ct.len() - 1;
        ct[tail] ^= 0x01;
        assert!(matches!(c.decrypt_seed(&ct), Err(SeedError::AuthFailed)));
    }

    #[test]
    fn wrong_key_rejected() {
        let a = cipher();
        let b = SeedCipher::from_hex(&"f".repeat(64)).unwrap();
        let seed = a.generate_secret_seed();
        let ct = a.encrypt_seed(&seed);
        // A different key produces an authentication failure, not a
        // garbled plaintext — exactly what AES-GCM guarantees.
        assert!(matches!(b.decrypt_seed(&ct), Err(SeedError::AuthFailed)));
    }

    #[test]
    fn short_ciphertext_rejected() {
        let c = cipher();
        // Less than nonce+tag bytes — unambiguously not a valid
        // ciphertext from this scheme.
        assert!(matches!(
            c.decrypt_seed(&[0_u8; 5]),
            Err(SeedError::CiphertextTooShort(_))
        ));
    }

    #[test]
    fn generate_yields_high_entropy() {
        // Smoke check: 4 fresh seeds shouldn't collide, otherwise
        // OsRng is broken or someone replaced it with a stub.
        let c = cipher();
        let seeds: Vec<_> = (0..4).map(|_| c.generate_secret_seed()).collect();
        let unique: std::collections::HashSet<_> = seeds.iter().collect();
        assert_eq!(unique.len(), 4);
        // Also: at least one byte must vary across seeds — guards
        // against a constant-zero RNG.
        let mut byte_varies = false;
        for i in 0..SEED_BYTES {
            let bytes: std::collections::HashSet<u8> = seeds.iter().map(|s| s[i]).collect();
            if bytes.len() > 1 {
                byte_varies = true;
                break;
            }
        }
        assert!(byte_varies);
    }

    #[test]
    fn hex_roundtrip() {
        let seed = [0xab_u8; SEED_BYTES];
        let h = seed_to_hex(&seed);
        assert_eq!(h.len(), SEED_BYTES * 2);
        let back = seed_from_hex(&h).unwrap();
        assert_eq!(seed, back);
    }
}
