//! Fuzz the DER ECDSA signature decoder used on KMS responses. KMS
//! itself is trusted, but defence-in-depth: a man-in-the-middle on the
//! AWS endpoint or a bug in our HTTP client could surface adversarial
//! bytes here. The decoder MUST never panic.

#![no_main]

use libfuzzer_sys::fuzz_target;
use rush_engine::chain::signer_kms::{normalize_low_s, parse_ecdsa_der};

fuzz_target!(|data: &[u8]| {
    let _ = parse_ecdsa_der(data);
    let mut s = [0u8; 32];
    for (i, b) in data.iter().take(32).enumerate() {
        s[i] = *b;
    }
    let _ = normalize_low_s(s);
});
