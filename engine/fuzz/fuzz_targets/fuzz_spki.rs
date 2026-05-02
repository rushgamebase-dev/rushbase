//! Fuzz the SubjectPublicKeyInfo parser used to derive the engine's
//! Ethereum address from a KMS public key. Same defence-in-depth
//! reasoning as the DER decoder.

#![no_main]

use libfuzzer_sys::fuzz_target;
use rush_engine::chain::signer_kms::parse_secp256k1_spki;

fuzz_target!(|data: &[u8]| {
    let _ = parse_secp256k1_spki(data);
});
