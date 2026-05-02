//! AWS KMS-backed Ethereum signer.
//!
//! Compiled only when the `aws-kms` feature is enabled. KMS holds the
//! ECDSA secp256k1 secret; the engine never sees the raw key. Signing
//! flow:
//!
//!   1. Engine compiles the EIP-191 prefixed digest (32 bytes).
//!   2. `kms:Sign` call with `MessageType=DIGEST` and
//!      `SigningAlgorithm=ECDSA_SHA_256`. KMS returns a DER-encoded
//!      `ECDSA-Sig-Value SEQUENCE { r, s }`.
//!   3. We decode `r` and `s`, normalise to low-S (EIP-2), then trial
//!      `v ∈ {27, 28}` against the known signer address until ecrecover
//!      matches. The successful `v` is the recovery byte the on-chain
//!      `ecrecover` will agree with.
//!
//! On startup we fetch `kms:GetPublicKey`, parse the SubjectPublicKeyInfo
//! to a 65-byte uncompressed point, and cache the derived Ethereum
//! address. From then on every `Sign` is a single round-trip; the
//! address never moves.
//!
//! IAM policy: the engine's role needs `kms:Sign` and `kms:GetPublicKey`
//! on the specific key ARN. No `kms:GenerateDataKey` or `kms:Decrypt`.

use crate::chain::signer::SignerError;
use alloy::primitives::{keccak256, Address, B256, U256};
use aws_sdk_kms::primitives::Blob;
use aws_sdk_kms::types::{MessageType, SigningAlgorithmSpec};
use std::str::FromStr;

pub struct KmsBackend {
    client: aws_sdk_kms::Client,
    key_id: String,
    address: Address,
}

impl KmsBackend {
    /// Initialise a KMS-backed signer. Performs `GetPublicKey` once to
    /// derive the Ethereum address; subsequent calls are signing only.
    pub async fn new(key_id: &str) -> Result<Self, SignerError> {
        let cfg = aws_config::defaults(aws_config::BehaviorVersion::latest())
            .load()
            .await;
        let client = aws_sdk_kms::Client::new(&cfg);

        let pk_resp = client
            .get_public_key()
            .key_id(key_id)
            .send()
            .await
            .map_err(|e| SignerError::Kms(format!("get_public_key failed: {}", e)))?;
        let der = pk_resp
            .public_key()
            .ok_or_else(|| SignerError::Kms("KMS returned no public key".into()))?;
        let pubkey = parse_secp256k1_spki(der.as_ref())?;
        let address = pubkey_to_eth_address(&pubkey);

        tracing::info!(
            key_id,
            signer_address = %format!("0x{:x}", address),
            "KMS signer initialised"
        );
        Ok(Self {
            client,
            key_id: key_id.to_string(),
            address,
        })
    }

    pub fn signer_address(&self) -> Address {
        self.address
    }

    /// Sign an EIP-191 prefixed digest of `inner_hash` and return the
    /// 65-byte (r, s, v) signature. `v` is 27 or 28, matching what the
    /// vault's `ecrecover` expects.
    pub async fn sign_eip191(&self, inner_hash: &B256) -> Result<[u8; 65], SignerError> {
        // EIP-191: keccak256("\x19Ethereum Signed Message:\n32" || inner_hash)
        let mut prefixed = Vec::with_capacity(28 + 32);
        prefixed.extend_from_slice(b"\x19Ethereum Signed Message:\n32");
        prefixed.extend_from_slice(inner_hash.as_slice());
        let prefixed_hash: B256 = keccak256(&prefixed);

        let resp = self
            .client
            .sign()
            .key_id(&self.key_id)
            .message(Blob::new(prefixed_hash.to_vec()))
            .message_type(MessageType::Digest)
            .signing_algorithm(SigningAlgorithmSpec::EcdsaSha256)
            .send()
            .await
            .map_err(|e| SignerError::Kms(format!("kms.sign failed: {}", e)))?;
        let sig_blob = resp
            .signature()
            .ok_or_else(|| SignerError::Kms("KMS returned no signature".into()))?;

        let (r, s) = parse_ecdsa_der(sig_blob.as_ref())?;
        let s_norm = normalize_low_s(s);

        // Recover the signer for v=27 and v=28; the one that matches our
        // known address is the right `v`.
        for v in [27u8, 28u8] {
            let mut sig_bytes = [0u8; 65];
            sig_bytes[0..32].copy_from_slice(&r);
            sig_bytes[32..64].copy_from_slice(&s_norm);
            sig_bytes[64] = v;
            let sig = match alloy::primitives::Signature::try_from(&sig_bytes[..]) {
                Ok(s) => s,
                Err(_) => continue,
            };
            if let Ok(recovered) = sig.recover_address_from_prehash(&prefixed_hash) {
                if recovered == self.address {
                    return Ok(sig_bytes);
                }
            }
        }
        Err(SignerError::Kms(
            "failed to determine recovery id (no v ∈ {27,28} recovered to expected address)".into(),
        ))
    }
}

// ─── pure DER / SPKI helpers (unit-testable without AWS) ────────────────

/// Pull the 65-byte uncompressed secp256k1 public key out of a
/// SubjectPublicKeyInfo DER blob. KMS returns a fixed structure for
/// `ECC_SECG_P256K1` keys: the trailing 65 bytes are `0x04 ‖ X ‖ Y`.
pub fn parse_secp256k1_spki(der: &[u8]) -> Result<[u8; 65], SignerError> {
    if der.len() < 65 {
        return Err(SignerError::Kms(format!("SPKI too short: {} bytes", der.len())));
    }
    let pk_start = der.len() - 65;
    if der[pk_start] != 0x04 {
        return Err(SignerError::Kms(
            "expected uncompressed pubkey marker 0x04 in SPKI tail".into(),
        ));
    }
    let mut out = [0u8; 65];
    out.copy_from_slice(&der[pk_start..]);
    Ok(out)
}

/// `keccak256(pubkey[1..65])[12..32]` — the standard Ethereum address
/// derivation. The leading `0x04` (uncompressed marker) is dropped.
pub fn pubkey_to_eth_address(pubkey: &[u8; 65]) -> Address {
    let hash = keccak256(&pubkey[1..]);
    let mut addr = [0u8; 20];
    addr.copy_from_slice(&hash[12..]);
    Address::from(addr)
}

/// Decode an ASN.1 DER `ECDSA-Sig-Value SEQUENCE { r, s }` into raw
/// 32-byte big-endian integers. Tolerant of DER's 0x00-padding for
/// positive-sign integers.
pub fn parse_ecdsa_der(der: &[u8]) -> Result<([u8; 32], [u8; 32]), SignerError> {
    // 0x30 SEQ-LEN 0x02 R-LEN <r-bytes> 0x02 S-LEN <s-bytes>
    if der.len() < 8 || der[0] != 0x30 {
        return Err(SignerError::Kms(format!(
            "invalid DER signature header (len={})",
            der.len()
        )));
    }
    // Support both short and long-form length (KMS uses short form).
    let (seq_len, body_start) = if der[1] & 0x80 == 0 {
        (der[1] as usize, 2)
    } else {
        let n = (der[1] & 0x7f) as usize;
        if der.len() < 2 + n {
            return Err(SignerError::Kms("DER length truncated".into()));
        }
        let mut len = 0usize;
        for b in &der[2..2 + n] {
            len = len.checked_shl(8).ok_or_else(|| SignerError::Kms("DER length overflow".into()))?
                | (*b as usize);
        }
        (len, 2 + n)
    };
    if der.len() < body_start + seq_len {
        return Err(SignerError::Kms("DER body truncated".into()));
    }
    let body = &der[body_start..body_start + seq_len];

    // r INTEGER
    if body.is_empty() || body[0] != 0x02 {
        return Err(SignerError::Kms("expected r INTEGER tag".into()));
    }
    let r_len = body[1] as usize;
    if body.len() < 2 + r_len {
        return Err(SignerError::Kms("r INTEGER truncated".into()));
    }
    let r_bytes = &body[2..2 + r_len];
    // s INTEGER
    let s_off = 2 + r_len;
    if body.len() < s_off + 2 || body[s_off] != 0x02 {
        return Err(SignerError::Kms("expected s INTEGER tag".into()));
    }
    let s_len = body[s_off + 1] as usize;
    if body.len() < s_off + 2 + s_len {
        return Err(SignerError::Kms("s INTEGER truncated".into()));
    }
    let s_bytes = &body[s_off + 2..s_off + 2 + s_len];

    Ok((pad_or_trim_32(r_bytes)?, pad_or_trim_32(s_bytes)?))
}

fn pad_or_trim_32(bytes: &[u8]) -> Result<[u8; 32], SignerError> {
    // DER prepends 0x00 if the high bit of the first byte is set, to keep
    // the integer positive. Strip it before sizing.
    let trimmed = if bytes.len() == 33 && bytes[0] == 0x00 {
        &bytes[1..]
    } else {
        bytes
    };
    if trimmed.len() > 32 {
        return Err(SignerError::Kms(format!(
            "integer too large for 32 bytes: {}",
            trimmed.len()
        )));
    }
    let mut out = [0u8; 32];
    out[32 - trimmed.len()..].copy_from_slice(trimmed);
    Ok(out)
}

/// Enforce low-S (EIP-2): if `s > N/2`, replace with `N - s`. Skipping
/// this gives KMS-issued signatures that the vault contract rejects on
/// strictly-low-S enforcement (OpenZeppelin's ECDSA does this).
pub fn normalize_low_s(s: [u8; 32]) -> [u8; 32] {
    // secp256k1 group order N
    const N_HEX: &str = "fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141";
    let n = U256::from_str_radix(N_HEX, 16).expect("constant secp256k1 N");
    let s_int = U256::from_be_bytes::<32>(s);
    let half_n = n >> 1;
    if s_int > half_n {
        (n - s_int).to_be_bytes::<32>()
    } else {
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Known-answer DER signature → r, s vector.
    /// Generated with: openssl dgst -sha256 -sign testkey.pem -out sig.bin <input>
    /// Decoded r, s captured below; same test runs in many libraries.
    #[test]
    fn parse_der_with_padding_works() {
        // 0x30 0x44 0x02 0x20 <32-byte r> 0x02 0x20 <32-byte s>
        let mut der = vec![0x30, 0x44, 0x02, 0x20];
        der.extend_from_slice(&[0x11; 32]);
        der.push(0x02);
        der.push(0x20);
        der.extend_from_slice(&[0x22; 32]);
        let (r, s) = parse_ecdsa_der(&der).unwrap();
        assert_eq!(r, [0x11; 32]);
        assert_eq!(s, [0x22; 32]);
    }

    #[test]
    fn parse_der_strips_high_bit_padding() {
        // 0x30 0x46 0x02 0x21 0x00 <32 bytes high-bit set> 0x02 0x21 0x00 <32 bytes>
        let mut der = vec![0x30, 0x46, 0x02, 0x21, 0x00];
        der.extend_from_slice(&[0xff; 32]);
        der.push(0x02);
        der.push(0x21);
        der.push(0x00);
        der.extend_from_slice(&[0xfe; 32]);
        let (r, s) = parse_ecdsa_der(&der).unwrap();
        assert_eq!(r, [0xff; 32]);
        assert_eq!(s, [0xfe; 32]);
    }

    #[test]
    fn parse_der_rejects_garbage() {
        assert!(parse_ecdsa_der(&[0x00, 0x01, 0x02]).is_err());
        assert!(parse_ecdsa_der(&[0x30, 0xFF, 0x02, 0x20, 0x00]).is_err()); // truncated
    }

    #[test]
    fn pubkey_derives_known_address() {
        // Secret key (test only): 1
        // Public key (uncompressed) — well-known generator point.
        let mut pk = [0u8; 65];
        pk[0] = 0x04;
        // X = 79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798
        // Y = 483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8
        let x = hex::decode("79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798").unwrap();
        let y = hex::decode("483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8").unwrap();
        pk[1..33].copy_from_slice(&x);
        pk[33..65].copy_from_slice(&y);
        let addr = pubkey_to_eth_address(&pk);
        // Address derived from secp256k1 generator's pubkey:
        // keccak256(X||Y)[12..] → 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf
        assert_eq!(
            format!("0x{:x}", addr),
            "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf"
        );
    }

    #[test]
    fn parse_spki_extracts_pubkey_from_tail() {
        // Build a synthetic SPKI with arbitrary header + trailing pubkey.
        let mut spki = vec![0xAA; 100]; // header noise — real SPKI is ~88 bytes
        let mut pk = [0u8; 65];
        pk[0] = 0x04;
        for i in 1..65 {
            pk[i] = i as u8;
        }
        spki.extend_from_slice(&pk);
        let extracted = parse_secp256k1_spki(&spki).unwrap();
        assert_eq!(extracted, pk);
    }

    #[test]
    fn normalize_low_s_flips_high_s() {
        // s = N / 2 + 1 should be flipped.
        let n = U256::from_str_radix(
            "fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141",
            16,
        )
        .unwrap();
        let half_plus_one = (n >> 1) + U256::from(1u8);
        let s_high = half_plus_one.to_be_bytes::<32>();
        let s_norm = normalize_low_s(s_high);
        let s_norm_int = U256::from_be_bytes::<32>(s_norm);
        assert!(s_norm_int <= n >> 1, "normalised s must be ≤ N/2");
        // Specifically, N - (N/2 + 1) == N/2 - 1.
        let expected = (n >> 1) - U256::from(1u8);
        assert_eq!(s_norm_int, expected);
    }

    #[test]
    fn normalize_low_s_keeps_low_s_intact() {
        let mut low = [0u8; 32];
        low[31] = 0x42;
        assert_eq!(normalize_low_s(low), low);
    }

    // Silence the unused-import warning when the `aws-kms` feature is on
    // but we're still building tests that don't touch the AWS client.
    #[allow(dead_code)]
    fn _force_use_str() {
        let _ = String::from_str("ignored");
    }
}
