//! Fuzz the signed-quote token verifier. Hostile clients send an
//! arbitrary string in the `quote_token` field of `/trade/bets`; the
//! parser MUST always return a typed error and never panic.
//!
//! Run from the repo root with a nightly toolchain installed:
//!   rustup install nightly
//!   cargo install cargo-fuzz
//!   cargo +nightly fuzz run fuzz_quote_token -- -max_total_time=300

#![no_main]

use libfuzzer_sys::fuzz_target;
use rush_engine::touch::QuoteSigner;

fuzz_target!(|data: &[u8]| {
    // The only contract we care about: never panic on adversarial input.
    let signer = match QuoteSigner::new("fuzz-secret-with-32-or-more-bytes-please!", 5_000) {
        Ok(s) => s,
        Err(_) => return,
    };
    if let Ok(s) = std::str::from_utf8(data) {
        let _ = signer.verify(s, chrono::Utc::now().timestamp_millis());
    }
});
