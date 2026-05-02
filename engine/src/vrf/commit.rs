//! Commit/reveal protocol primitives.
//!
//! At place_bet:
//!  ```text
//!  commit_hash = keccak256(
//!      "rush.vrf.commit.v1" ||
//!      seed (32 bytes) ||
//!      bet_id (16 bytes, UUID) ||
//!      user_wallet (20 bytes) ||
//!      p_min_q8 (32 bytes, U256 BE) ||
//!      p_max_q8 (32 bytes, U256 BE) ||
//!      window_start_ms (i64 BE) ||
//!      window_end_ms (i64 BE)
//!  )
//!  signature = engineSigner.sign(EIP191(commit_hash))
//!  ```
//!
//! The domain tag (`"rush.vrf.commit.v1"`) prevents anyone from
//! reusing a withdraw signature here or vice-versa: the same EOA
//! signs both, but the digests sit in different namespaces. The
//! version suffix lets us bump the protocol without grandfathering
//! old commits — the resolver simply refuses to verify a v2 commit
//! with a v1 signer.
//!
//! At reveal time the client is given the full preimage (`seed`,
//! `bet_id`, `user_wallet`, band, window) plus the signature. It
//! recomputes the keccak, recovers the signer from the signature, and
//! confirms the address matches the `engineSigner` it reads from the
//! vault contract on-chain. No off-line trust.
//!
//! Because the seed is the only secret in the preimage and is 256-bit
//! cryptographic randomness, an attacker who sees only the commit
//! can't infer the seed (and therefore can't predict the path) any
//! better than brute-forcing 2^256.

use crate::chain::signer::{SignerError, WithdrawSigner};
use crate::vrf::seed::SEED_BYTES;
use alloy::primitives::{keccak256, Address, B256, U256};
use thiserror::Error;
use uuid::Uuid;

/// Domain separator. **Bump on any change to the digest layout.**
/// Old commits remain verifiable against the prior version of this
/// constant, but new ones must not collide.
pub const COMMIT_DOMAIN_TAG: &[u8] = b"rush.vrf.commit.v1";

#[derive(Debug, Error)]
pub enum CommitError {
    #[error("signing failed: {0}")]
    Signing(#[from] SignerError),
    #[error("invalid signature: bad recovery byte")]
    BadRecovery,
    #[error("invalid signature length (expected 65, got {0})")]
    BadSignatureLength(usize),
    #[error("commit signature does not match expected signer")]
    SignerMismatch,
}

/// All public inputs to the commit. The seed is intentionally NOT
/// part of this struct — it lives only in the place_bet handler's
/// stack and is passed to [`compute_commit_hash`] separately. This
/// makes it harder to accidentally log or serialize the seed.
#[derive(Debug, Clone)]
pub struct CommitPreimage<'a> {
    pub bet_id: Uuid,
    pub user_wallet: Address,
    pub p_min_q8: U256,
    pub p_max_q8: U256,
    pub window_start_ms: i64,
    pub window_end_ms: i64,
    /// Set to `b"rush.vrf.commit.v1"` for v1 commits. Carved out so
    /// future protocol revs can override without forking this struct.
    pub domain_tag: &'a [u8],
}

/// Compute `keccak256(domain_tag || seed || bet_id || user_wallet ||
/// p_min || p_max || window_start || window_end)`. The byte layout is
/// fixed and must match the client's reference implementation
/// exactly — any reorder breaks all stored commits.
pub fn compute_commit_hash(seed: &[u8; SEED_BYTES], preimage: &CommitPreimage<'_>) -> B256 {
    // Pre-allocated for clarity. Total: 18 (max domain tag we use) +
    // 32 + 16 + 20 + 32 + 32 + 8 + 8 = 166 bytes worst case for v1.
    let mut buf = Vec::with_capacity(preimage.domain_tag.len() + 32 + 16 + 20 + 32 + 32 + 8 + 8);
    buf.extend_from_slice(preimage.domain_tag);
    buf.extend_from_slice(seed);
    buf.extend_from_slice(preimage.bet_id.as_bytes());
    buf.extend_from_slice(preimage.user_wallet.as_slice());
    buf.extend_from_slice(&preimage.p_min_q8.to_be_bytes::<32>());
    buf.extend_from_slice(&preimage.p_max_q8.to_be_bytes::<32>());
    buf.extend_from_slice(&preimage.window_start_ms.to_be_bytes());
    buf.extend_from_slice(&preimage.window_end_ms.to_be_bytes());
    keccak256(&buf)
}

/// EIP-191 envelope around the commit hash. Mirrors what the client
/// (and the on-chain `ecrecover` if anyone ever wants to verify
/// commits in Solidity) will hash to recover the signer.
pub fn eip191_envelope(commit_hash: &B256) -> B256 {
    let mut prefixed = Vec::with_capacity(28 + 32);
    prefixed.extend_from_slice(b"\x19Ethereum Signed Message:\n32");
    prefixed.extend_from_slice(commit_hash.as_slice());
    keccak256(&prefixed)
}

/// Sign a commit with the engine signer. The returned 65-byte (r, s, v)
/// signature is the value persisted alongside the bet.
///
/// Internally [`WithdrawSigner::sign_digest`] applies the EIP-191
/// envelope (`"\x19Ethereum Signed Message:\n32" || hash`) before
/// signing, so we pass the raw `commit_hash` here — wrapping it with
/// [`eip191_envelope`] would cause a double-prefix and a signature
/// that no client can verify.
pub async fn sign_commit(
    signer: &WithdrawSigner,
    commit_hash: &B256,
) -> Result<[u8; 65], CommitError> {
    Ok(signer.sign_digest(commit_hash).await?)
}

/// Verify a commit signature came from the expected signer. Used by
/// integration tests and by clients that re-implement the protocol
/// (e.g. a reference verifier we ship for auditors).
pub fn verify_commit(
    commit_hash: &B256,
    signature: &[u8],
    expected_signer: Address,
) -> Result<(), CommitError> {
    if signature.len() != 65 {
        return Err(CommitError::BadSignatureLength(signature.len()));
    }
    let envelope = eip191_envelope(commit_hash);
    let sig = alloy::primitives::PrimitiveSignature::try_from(signature)
        .map_err(|_| CommitError::BadRecovery)?;
    let recovered = sig
        .recover_address_from_prehash(&envelope)
        .map_err(|_| CommitError::BadRecovery)?;
    if recovered != expected_signer {
        return Err(CommitError::SignerMismatch);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy::primitives::address;

    fn preimage<'a>(bet_id: Uuid) -> CommitPreimage<'a> {
        CommitPreimage {
            bet_id,
            user_wallet: address!("dd12D83786C2BAc7be3D59869834C23E91449A2D"),
            p_min_q8: U256::from(50_000_00000000_u64),
            p_max_q8: U256::from(50_010_00000000_u64),
            window_start_ms: 1_700_000_000_000,
            window_end_ms: 1_700_000_003_000,
            domain_tag: COMMIT_DOMAIN_TAG,
        }
    }

    #[test]
    fn same_inputs_same_commit() {
        let seed = [0xab_u8; SEED_BYTES];
        let id = Uuid::new_v4();
        let p = preimage(id);
        let h1 = compute_commit_hash(&seed, &p);
        let h2 = compute_commit_hash(&seed, &p);
        assert_eq!(h1, h2);
    }

    #[test]
    fn different_seed_different_commit() {
        let id = Uuid::new_v4();
        let p = preimage(id);
        let a = compute_commit_hash(&[0xab_u8; SEED_BYTES], &p);
        let b = compute_commit_hash(&[0xac_u8; SEED_BYTES], &p);
        assert_ne!(a, b);
    }

    #[test]
    fn different_bet_id_different_commit() {
        // Same seed but different bet_id MUST yield a different commit
        // — otherwise an attacker could reuse a recorded commit on a
        // future bet to fix the outcome.
        let seed = [0xab_u8; SEED_BYTES];
        let a = compute_commit_hash(&seed, &preimage(Uuid::new_v4()));
        let b = compute_commit_hash(&seed, &preimage(Uuid::new_v4()));
        assert_ne!(a, b);
    }

    #[test]
    fn different_user_different_commit() {
        // Same seed + same band, different user wallet → different
        // commit. Stops a multi-account attacker from precomputing
        // outcomes for one wallet and replaying on another.
        let seed = [0xab_u8; SEED_BYTES];
        let id = Uuid::new_v4();
        let mut p = preimage(id);
        let h1 = compute_commit_hash(&seed, &p);
        p.user_wallet = address!("bb12D83786C2BAc7be3D59869834C23E91449A2D");
        let h2 = compute_commit_hash(&seed, &p);
        assert_ne!(h1, h2);
    }

    #[test]
    fn different_band_different_commit() {
        let seed = [0xab_u8; SEED_BYTES];
        let id = Uuid::new_v4();
        let mut p = preimage(id);
        let h1 = compute_commit_hash(&seed, &p);
        p.p_min_q8 = U256::from(50_005_00000000_u64);
        let h2 = compute_commit_hash(&seed, &p);
        assert_ne!(h1, h2);
    }

    #[test]
    fn different_window_different_commit() {
        let seed = [0xab_u8; SEED_BYTES];
        let id = Uuid::new_v4();
        let mut p = preimage(id);
        let h1 = compute_commit_hash(&seed, &p);
        p.window_end_ms += 1;
        let h2 = compute_commit_hash(&seed, &p);
        assert_ne!(h1, h2);
    }

    #[test]
    fn different_domain_tag_different_commit() {
        // Bumping the domain tag invalidates v1 commits — exactly the
        // protection we want when the protocol changes.
        let seed = [0xab_u8; SEED_BYTES];
        let id = Uuid::new_v4();
        let mut p = preimage(id);
        let h1 = compute_commit_hash(&seed, &p);
        p.domain_tag = b"rush.vrf.commit.v2";
        let h2 = compute_commit_hash(&seed, &p);
        assert_ne!(h1, h2);
    }

    #[actix_rt::test]
    async fn sign_and_verify_roundtrip() {
        let key_hex = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
        let vault = address!("5b04F3DFaE780A7e109066E754d27f491Af55Af9");
        let signer = WithdrawSigner::from_hex(key_hex, 8453, vault).unwrap();
        let signer_addr = signer.signer_address();

        let seed = [0x77_u8; SEED_BYTES];
        let id = Uuid::new_v4();
        let p = preimage(id);
        let commit = compute_commit_hash(&seed, &p);
        let sig = sign_commit(&signer, &commit).await.unwrap();
        assert_eq!(sig.len(), 65);

        // Honest verify path.
        verify_commit(&commit, &sig, signer_addr).expect("commit verifies under correct signer");

        // Wrong expected signer → mismatch.
        let other = address!("dd12D83786C2BAc7be3D59869834C23E91449A2D");
        assert!(matches!(
            verify_commit(&commit, &sig, other),
            Err(CommitError::SignerMismatch)
        ));

        // Tampered commit → recover yields a different address →
        // mismatch (the signature itself is still well-formed).
        let mut tampered = [0_u8; 32];
        tampered.copy_from_slice(commit.as_slice());
        tampered[0] ^= 0x01;
        let tampered_b256 = B256::from(tampered);
        assert!(matches!(
            verify_commit(&tampered_b256, &sig, signer_addr),
            Err(CommitError::SignerMismatch)
        ));
    }

    #[test]
    fn rejects_short_signature() {
        let id = Uuid::new_v4();
        let p = preimage(id);
        let h = compute_commit_hash(&[0_u8; SEED_BYTES], &p);
        assert!(matches!(
            verify_commit(&h, &[0_u8; 64], address!("0000000000000000000000000000000000000000")),
            Err(CommitError::BadSignatureLength(64))
        ));
    }
}
