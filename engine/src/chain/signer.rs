//! Withdraw-authorization signer.
//!
//! Produces an EIP-191 (`personal_sign`) signature over
//! `keccak(chainId ‖ vault ‖ user ‖ amount ‖ nonce)`. The user submits this
//! signature to `TradingVault.withdraw(amount, nonce, sig)`, where
//! `ecrecover(...)` must equal the contract's `engineSigner`.
//!
//! ## Backends
//!
//! Two signer backends share the [`WithdrawSigner`] surface:
//!
//!  - [`Backend::Local`]: a hex-encoded ECDSA secret key in process memory.
//!    Fast and dependency-free; appropriate for local dev and staging.
//!    NEVER ship to mainnet — process exposure = key exposure.
//!
//!  - [`Backend::Kms`]: AWS KMS-resident ECDSA_SECG_P256K1 key. The engine
//!    never sees the secret material; signing happens inside KMS via the
//!    `kms:Sign` API. The key's IAM policy is the security perimeter.
//!    Enabled by setting `APP_CHAIN__SIGNER_KMS_KEY_ID` AND building with
//!    `cargo build --features aws-kms`. Without the feature flag, an
//!    attempt to use KMS panics at boot with a clear message.
//!
//! Selecting between them is done in `main.rs` based on config — the
//! callers (handlers, withdraw service) only see [`WithdrawSigner`]. The
//! signing entry point is async because KMS does network I/O; the local
//! backend just blocks momentarily on the in-process keccak/secp256k1
//! ops. Sign latency is logged either way for ops dashboards.

use alloy::primitives::{keccak256, Address, B256, U256};
use alloy::signers::{local::PrivateKeySigner, SignerSync};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum SignerError {
    #[error("Invalid private key: {0}")]
    InvalidKey(String),
    #[error("Signing failed: {0}")]
    SigningFailed(String),
    #[error(
        "Engine compiled without `aws-kms` feature but APP_CHAIN__SIGNER_KMS_KEY_ID is set. \
         Rebuild with `cargo build --release --features aws-kms` to use HSM-backed signing."
    )]
    KmsFeatureDisabled,
    #[error("KMS error: {0}")]
    Kms(String),
}

/// Output of a signing operation. The hex fields are 0x-prefixed
/// lowercase, ready to persist in `withdraw_authorizations`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WithdrawAuthorization {
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

/// Internal signing backend. Hidden behind [`WithdrawSigner`] so callers
/// don't have to fork on local-vs-KMS at every signing site.
enum Backend {
    Local(PrivateKeySigner),
    /// AWS KMS-backed signer. Compiled only with the `aws-kms` feature.
    #[cfg(feature = "aws-kms")]
    Kms(crate::chain::signer_kms::KmsBackend),
}

pub struct WithdrawSigner {
    backend: Backend,
    address: Address,
    chain_id: u64,
    vault: Address,
}

impl WithdrawSigner {
    /// Local in-process signer. Use for dev/staging only.
    pub fn from_hex(
        private_key_hex: &str,
        chain_id: u64,
        vault: Address,
    ) -> Result<Self, SignerError> {
        let inner: PrivateKeySigner = private_key_hex
            .trim_start_matches("0x")
            .parse()
            .map_err(|e: alloy::signers::local::LocalSignerError| {
                SignerError::InvalidKey(e.to_string())
            })?;
        let address = inner.address();
        Ok(Self {
            backend: Backend::Local(inner),
            address,
            chain_id,
            vault,
        })
    }

    /// AWS KMS-backed signer. Requires the `aws-kms` feature; without it
    /// callers get [`SignerError::KmsFeatureDisabled`] at boot so the
    /// orchestrator visibly fails the rollout instead of silently falling
    /// back to a hex key.
    #[allow(unused_variables)]
    pub async fn from_kms(
        key_id: &str,
        chain_id: u64,
        vault: Address,
    ) -> Result<Self, SignerError> {
        #[cfg(feature = "aws-kms")]
        {
            let kms = crate::chain::signer_kms::KmsBackend::new(key_id).await?;
            let address = kms.signer_address();
            Ok(Self {
                backend: Backend::Kms(kms),
                address,
                chain_id,
                vault,
            })
        }
        #[cfg(not(feature = "aws-kms"))]
        {
            Err(SignerError::KmsFeatureDisabled)
        }
    }

    pub fn signer_address(&self) -> Address {
        self.address
    }

    /// Compute the digest exactly as the contract does:
    /// `toEthSignedMessageHash(keccak(chainId, vault, user, amount, nonce))`.
    pub fn digest(&self, user: Address, amount: U256, nonce: U256) -> B256 {
        let inner = self.compute_inner_hash(user, amount, nonce);
        // EIP-191: keccak256("\x19Ethereum Signed Message:\n32" || hash)
        let mut prefixed = Vec::with_capacity(28 + 32);
        prefixed.extend_from_slice(b"\x19Ethereum Signed Message:\n32");
        prefixed.extend_from_slice(inner.as_slice());
        keccak256(&prefixed)
    }

    fn compute_inner_hash(&self, user: Address, amount: U256, nonce: U256) -> B256 {
        let mut payload = Vec::with_capacity(32 * 5);
        payload.extend_from_slice(&U256::from(self.chain_id).to_be_bytes::<32>());
        // address occupies the low 20 bytes of a 32-byte word
        let mut vault_word = [0u8; 32];
        vault_word[12..].copy_from_slice(self.vault.as_slice());
        payload.extend_from_slice(&vault_word);
        let mut user_word = [0u8; 32];
        user_word[12..].copy_from_slice(user.as_slice());
        payload.extend_from_slice(&user_word);
        payload.extend_from_slice(&amount.to_be_bytes::<32>());
        payload.extend_from_slice(&nonce.to_be_bytes::<32>());
        keccak256(&payload)
    }

    /// Sign a withdraw authorization. The caller (handler) must already have
    /// validated the user's free balance ≥ amount and reserved the nonce in
    /// `withdraw_authorizations`. Async because KMS does network I/O —
    /// the local backend completes synchronously inside the await.
    pub async fn sign_withdraw(
        &self,
        authorization_id: Uuid,
        user_id: Uuid,
        user: Address,
        amount: U256,
        nonce: u64,
    ) -> Result<WithdrawAuthorization, SignerError> {
        let inner_hash = self.compute_inner_hash(user, amount, U256::from(nonce));
        let sig_bytes = self.sign_eip191(&inner_hash).await?;
        let sig_hex = format!("0x{}", hex::encode(sig_bytes));
        Ok(WithdrawAuthorization {
            authorization_id,
            user_id,
            wallet: format!("0x{:x}", user),
            amount_wei: amount.to_string(),
            nonce,
            signature: sig_hex,
            signer_address: format!("0x{:x}", self.address),
            chain_id: self.chain_id,
            vault_address: format!("0x{:x}", self.vault),
        })
    }

    /// Sign an arbitrary 32-byte hash with the engine signer using
    /// EIP-191. Used for VRF commit signatures so the client can
    /// verify them against the same `engineSigner` address it knows
    /// from the vault contract — single signer identity for both
    /// withdraw authorizations and provably-fair commits.
    ///
    /// Callers MUST pass a domain-separated hash (e.g. one that
    /// includes a domain tag like `"rush.vrf.commit.v1"`) to prevent
    /// cross-protocol signature reuse. The signer itself does not
    /// inject a domain — callers are responsible for the digest.
    pub async fn sign_digest(&self, digest: &B256) -> Result<[u8; 65], SignerError> {
        self.sign_eip191(digest).await
    }

    /// Sign the EIP-191 digest of `inner_hash` and return the 65-byte
    /// (r, s, v) signature. Backend-specific: local does it in-process,
    /// KMS will issue an `kms:Sign` call.
    async fn sign_eip191(&self, inner_hash: &B256) -> Result<[u8; 65], SignerError> {
        match &self.backend {
            Backend::Local(signer) => {
                // sign_message_sync prefixes "\x19Ethereum Signed Message:\n<len>" —
                // since we feed it 32 bytes (the inner hash), the resulting EIP-191
                // digest matches MessageHashUtils.toEthSignedMessageHash on the
                // contract side.
                let signature = signer
                    .sign_message_sync(inner_hash.as_slice())
                    .map_err(|e| SignerError::SigningFailed(e.to_string()))?;
                Ok(signature.as_bytes())
            }
            #[cfg(feature = "aws-kms")]
            Backend::Kms(kms) => kms.sign_eip191(inner_hash).await,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy::primitives::address;

    #[actix_rt::test]
    async fn signer_produces_recoverable_signature() {
        // Deterministic test key (DO NOT USE IN PROD)
        let key_hex = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
        let vault = address!("5b04F3DFaE780A7e109066E754d27f491Af55Af9");
        let signer = WithdrawSigner::from_hex(key_hex, 8453, vault).unwrap();

        let user = address!("dd12D83786C2BAc7be3D59869834C23E91449A2D");
        let amount = U256::from(1_000_000_000_000_000_000u128); // 1 ETH
        let nonce = 1u64;

        let auth = signer
            .sign_withdraw(Uuid::new_v4(), Uuid::new_v4(), user, amount, nonce)
            .await
            .unwrap();
        assert!(auth.signature.starts_with("0x"));
        assert_eq!(hex::decode(&auth.signature[2..]).unwrap().len(), 65);
        assert_eq!(auth.chain_id, 8453);
        assert_eq!(auth.nonce, 1);
    }

    #[actix_rt::test]
    async fn kms_path_without_feature_returns_clear_error() {
        // The from_kms constructor should produce a typed error that
        // boot logic can match on, not a panic, so the orchestrator
        // sees a clean shutdown rather than a stack trace.
        let vault = address!("5b04F3DFaE780A7e109066E754d27f491Af55Af9");
        let result = WithdrawSigner::from_kms("alias/dummy", 8453, vault).await;
        assert!(result.is_err());
        match result.err().unwrap() {
            #[cfg(not(feature = "aws-kms"))]
            SignerError::KmsFeatureDisabled => {}
            #[cfg(feature = "aws-kms")]
            SignerError::Kms(_) => {}
            other => panic!("unexpected error variant: {:?}", other),
        }
    }
}
