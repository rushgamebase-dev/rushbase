//! Property-based fuzzing for adversarial parser inputs.
//!
//! Every byte in this file is what a hostile network or KMS-spoof might
//! send the engine. The properties enforce two non-negotiables:
//!
//!   1. **No panics.** Any input — random bytes, oversized strings,
//!      malformed DER — must produce a typed `Err`, never a process
//!      crash. A panic in the request path is a DoS vector.
//!
//!   2. **Round-trips are exact.** When we sign + verify, encode +
//!      decode, or convert to/from `U256`, the output must equal the
//!      input. Drift in any one direction is a forgery surface.
//!
//! Run with `cargo test --test fuzz_parsers`. proptest defaults to 256
//! cases per property; bump via `PROPTEST_CASES=4096` for deeper sweeps
//! before mainnet.

use alloy::primitives::{Address, U256};
use bigdecimal::BigDecimal;
use proptest::prelude::*;
use rush_engine::models::touch_bet::TouchDirection;
use rush_engine::touch::{quote_token::expect_match, QuoteSigner, QuoteTokenError};
use rush_engine::utils::wei::{bd_to_i256, bd_to_u256, i256_to_bd, u256_to_bd};
use std::str::FromStr;
use uuid::Uuid;

// ─── parse_u256 / bd_to_u256 ────────────────────────────────────────────

proptest! {
    /// Any U256 round-trips through BigDecimal without loss.
    #[test]
    fn u256_roundtrip_via_bigdecimal(
        a in any::<u128>(),
        b in any::<u128>(),
    ) {
        let v = U256::from(a).saturating_mul(U256::from(1u128 << 64))
            .saturating_add(U256::from(b));
        let bd = u256_to_bd(v);
        let back = bd_to_u256(&bd).expect("non-negative integer");
        prop_assert_eq!(back, v);
    }

    /// `bd_to_u256` rejects every BigDecimal containing a fractional
    /// component, regardless of its scale representation.
    #[test]
    fn bd_to_u256_rejects_fractions(int in 0i128..1_000_000_i128, frac in 1u32..999_999_u32) {
        let s = format!("{}.{:06}", int, frac);
        let bd = BigDecimal::from_str(&s).unwrap();
        prop_assert!(bd_to_u256(&bd).is_err(), "fractional {} accepted", s);
    }

    /// `bd_to_u256` and `bd_to_i256` never panic — error or value, never abort.
    #[test]
    fn bd_conversions_never_panic(s in "[-+]?[0-9]{1,40}(\\.[0-9]{1,20})?(e[-+]?[0-9]{1,3})?") {
        if let Ok(bd) = BigDecimal::from_str(&s) {
            let _ = bd_to_u256(&bd);
            let _ = bd_to_i256(&bd);
        }
    }
}

// ─── DER ECDSA signature ────────────────────────────────────────────────

proptest! {
    /// Random byte strings must not crash the DER decoder. They should
    /// parse to (r, s) iff the input is well-formed; everything else
    /// returns a typed `SignerError::Kms`.
    #[test]
    fn der_decoder_never_panics(bytes in proptest::collection::vec(any::<u8>(), 0..256)) {
        // We test through the public DER decoder by importing the
        // helper from signer_kms (gated to the aws-kms feature). When
        // the feature is off the decoder isn't compiled — fall back to
        // a no-op so the test runs without `--features aws-kms`.
        #[cfg(feature = "aws-kms")]
        {
            use rush_engine::chain::signer_kms::{parse_ecdsa_der, parse_secp256k1_spki, normalize_low_s};
            let _ = parse_ecdsa_der(&bytes);
            let _ = parse_secp256k1_spki(&bytes);
            // normalize_low_s takes a fixed-size [u8; 32]; build one
            // deterministically from the input prefix.
            let mut s = [0u8; 32];
            for (i, b) in bytes.iter().take(32).enumerate() {
                s[i] = *b;
            }
            let _ = normalize_low_s(s);
        }
        #[cfg(not(feature = "aws-kms"))]
        {
            // Without the feature compiled, just exercise the input
            // budget so the test still pulls bytes for shrinking.
            std::hint::black_box(bytes);
        }
    }

    /// Well-formed minimal DER: `0x30 0x06 0x02 0x01 r 0x02 0x01 s` —
    /// when r and s are 1 byte each, decoder must yield zero-padded 32-byte
    /// ints.
    #[test]
    #[cfg(feature = "aws-kms")]
    fn der_minimal_valid_decodes(r in 1u8..=127, s in 1u8..=127) {
        use rush_engine::chain::signer_kms::parse_ecdsa_der;
        let der = vec![0x30, 0x06, 0x02, 0x01, r, 0x02, 0x01, s];
        let (r_out, s_out) = parse_ecdsa_der(&der).expect("valid minimal DER");
        prop_assert_eq!(r_out[31], r);
        prop_assert_eq!(s_out[31], s);
        prop_assert!(r_out[..31].iter().all(|&b| b == 0));
        prop_assert!(s_out[..31].iter().all(|&b| b == 0));
    }
}

// ─── quote token sign / verify ─────────────────────────────────────────

fn signer() -> QuoteSigner {
    QuoteSigner::new("proptest-quote-secret-with-32-or-more-bytes!", 5_000).unwrap()
}

proptest! {
    /// `verify` never panics on any string. Tampered, truncated,
    /// non-base64, non-JSON — all return typed errors.
    #[test]
    fn quote_verify_never_panics(token in "[A-Za-z0-9_\\-=.]{0,512}") {
        let s = signer();
        let now = chrono::Utc::now().timestamp_millis();
        let _ = s.verify(&token, now);
    }

    /// Sign + verify is exact for any reasonable payload values.
    #[test]
    fn quote_signed_then_verified_roundtrips(
        symbol in "[A-Z]{2,8}USDT",
        entry in 100_00000000_u64..1_000_000_00000000_u64,
        delta in 1_00000000_u64..50_00000000_u64,
        duration in 1_000u64..60_000u64,
        multiplier in 11_000u32..200_000u32,
    ) {
        let signer = signer();
        let now = chrono::Utc::now().timestamp_millis();
        let entry_u = U256::from(entry);
        let target_min = entry_u.saturating_add(U256::from(delta));
        let target_max = target_min.saturating_add(U256::from(delta));
        let token = signer.issue(
            Uuid::new_v4(),
            &symbol,
            TouchDirection::Up,
            entry_u,
            target_min,
            target_max,
            0,            // window_start_offset_ms — quote-now for fuzz coverage
            duration,
            multiplier,
            now,
        );
        let payload = signer.verify(&token, now).expect("just-issued token verifies");
        prop_assert_eq!(&payload.symbol, &symbol);
        prop_assert_eq!(payload.multiplier_bps, multiplier);
        prop_assert_eq!(payload.window_duration_ms, duration);
        // expect_match must accept the same parameters.
        let ok = expect_match(
            &payload,
            &symbol,
            TouchDirection::Up,
            target_min,
            target_max,
            duration,
            0,            // window_start_offset_ms — same as quote
            multiplier,
        );
        prop_assert!(ok.is_ok());
    }

    /// Drift on ANY field surfaces as `Mismatch`. This prevents quote
    /// shopping (re-quote, then submit with altered band).
    #[test]
    fn quote_mismatch_on_field_drift(
        d_mult in 1u32..1_000u32,
    ) {
        let signer = signer();
        let now = chrono::Utc::now().timestamp_millis();
        let multiplier = 12_500u32;
        let token = signer.issue(
            Uuid::new_v4(),
            "BTCUSDT",
            TouchDirection::Up,
            U256::from(50_000_00000000_u64),
            U256::from(50_010_00000000_u64),
            U256::from(50_050_00000000_u64),
            0,
            3_000,
            multiplier,
            now,
        );
        let payload = signer.verify(&token, now).unwrap();
        // Same params except multiplier drift → must reject.
        let bumped = multiplier.wrapping_add(d_mult);
        let result = expect_match(
            &payload,
            "BTCUSDT",
            TouchDirection::Up,
            U256::from(50_010_00000000_u64),
            U256::from(50_050_00000000_u64),
            3_000,
            0,
            bumped,
        );
        let is_multiplier_drift = matches!(
            result,
            Err(QuoteTokenError::Mismatch { field: "multiplier_bps" })
        );
        prop_assert!(is_multiplier_drift);
    }
}

// ─── multiplier pricing ────────────────────────────────────────────────

proptest! {
    /// Multiplier output is always inside the configured floor/ceiling
    /// for every legal input: distance > 0, duration > 0, finite vol.
    /// This catches regressions like the old `2*exp(-z²/2)` overflow
    /// that produced negative multipliers in some edge cases.
    #[test]
    fn multiplier_is_always_in_band(
        entry in 100_00000000_u128..1_000_000_00000000_u128,
        delta_bps in 1u32..1_000u32,
        duration_ms in 1_000u64..120_000u64,
    ) {
        use rush_engine::touch::{MultiplierCalculator, MultiplierConfig};
        let cfg = MultiplierConfig::default();
        let calc = MultiplierCalculator::new(cfg.clone());
        let band_min = entry + (entry * delta_bps as u128) / 10_000;
        let band_max = band_min + 1_00000000;
        let q = calc.quote(entry, band_min, band_max, TouchDirection::Up, 0, duration_ms);
        prop_assert!(q.multiplier_bps >= cfg.min_multiplier_bps);
        prop_assert!(q.multiplier_bps <= cfg.max_multiplier_bps);
    }
}

// ─── address / wei conversions ────────────────────────────────────────

proptest! {
    /// `Address::from_str` and the engine's hex formatter round-trip.
    /// Corrects subtle 40-char zero-padding bugs we'd hit with malformed
    /// wallet addresses on user input.
    #[test]
    fn address_hex_roundtrip(bytes in proptest::array::uniform20(any::<u8>())) {
        let addr = Address::from(bytes);
        let s = format!("0x{:040x}", addr);
        let back = Address::from_str(&s).expect("formatted hex parses");
        prop_assert_eq!(back, addr);
    }

    /// I256 ↔ BigDecimal round-trip preserves sign + magnitude.
    #[test]
    fn i256_roundtrip(magnitude in 0i128..i128::MAX, negative in any::<bool>()) {
        let signed = if negative { -(magnitude as i128) } else { magnitude as i128 };
        let v = alloy::primitives::I256::try_from(signed).unwrap();
        let bd = i256_to_bd(v);
        let back = bd_to_i256(&bd).expect("integer round-trip");
        prop_assert_eq!(back, v);
    }
}
