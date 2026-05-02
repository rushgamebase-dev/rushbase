//! Wei / U256 / BigDecimal conversion helpers.
//!
//! Database side stores wei as `NUMERIC(78,0)` and sqlx maps it to
//! `BigDecimal`. Math side uses `alloy::primitives::{U256, I256}`. This
//! module centralizes the conversions so the rest of the engine never
//! reaches for `to_string` / `from_str` directly.

use alloy::primitives::{I256, U256};
use bigdecimal::{BigDecimal, Zero};
use std::str::FromStr;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum WeiError {
    #[error("Negative value cannot be represented as U256: {0}")]
    Negative(BigDecimal),
    #[error("Value is not an integer: {0}")]
    NotInteger(BigDecimal),
    #[error("Failed to parse U256: {0}")]
    ParseU256(String),
    #[error("Failed to parse I256: {0}")]
    ParseI256(String),
    #[error("Value out of range")]
    OutOfRange,
}

/// Reduce a `BigDecimal` to its integer big-int representation. Returns
/// `Err(NotInteger)` if there's a fractional part; otherwise yields the
/// exact integer value (handles both `(mantissa, 0)` and `(mantissa,
/// negative_scale)` forms — sqlx round-trips through both depending on
/// how Postgres NUMERIC values are normalized).
fn bd_to_bigint(value: &BigDecimal) -> Result<bigdecimal::num_bigint::BigInt, WeiError> {
    use bigdecimal::num_bigint::BigInt;
    let (int_value, scale) = value.as_bigint_and_exponent();
    if scale == 0 {
        return Ok(int_value);
    }
    if scale < 0 {
        // value = int_value * 10^(-scale). Always integer.
        let factor = BigInt::from(10u32).pow((-scale) as u32);
        return Ok(int_value * factor);
    }
    // scale > 0 → value = int_value / 10^scale. Integer iff divisible.
    let divisor = BigInt::from(10u32).pow(scale as u32);
    let (q, r) = (&int_value / &divisor, &int_value % &divisor);
    if !r.is_zero() {
        return Err(WeiError::NotInteger(value.clone()));
    }
    let _ = q.clone(); // explicit move guard
    Ok(q)
}

/// Convert a non-negative integer `BigDecimal` to `U256`. Errors if the
/// value is negative or has a fractional part. Tolerant of sqlx round-tripped
/// values that come back with non-zero internal scale.
pub fn bd_to_u256(value: &BigDecimal) -> Result<U256, WeiError> {
    if value.sign() == bigdecimal::num_bigint::Sign::Minus {
        return Err(WeiError::Negative(value.clone()));
    }
    let int_value = bd_to_bigint(value)?;
    let s = int_value.to_string();
    U256::from_str(&s).map_err(|e| WeiError::ParseU256(e.to_string()))
}

/// Convert any integer `BigDecimal` (positive or negative) to `I256`.
pub fn bd_to_i256(value: &BigDecimal) -> Result<I256, WeiError> {
    let int_value = bd_to_bigint(value)?;
    let s = int_value.to_string();
    I256::from_dec_str(&s).map_err(|e| WeiError::ParseI256(e.to_string()))
}

pub fn u256_to_bd(value: U256) -> BigDecimal {
    BigDecimal::from_str(&value.to_string()).expect("U256 always parses to BigDecimal")
}

pub fn i256_to_bd(value: I256) -> BigDecimal {
    BigDecimal::from_str(&value.to_string()).expect("I256 always parses to BigDecimal")
}

/// Saturating absolute value of an `I256`, returned as `U256`.
pub fn i256_abs_u256(value: I256) -> U256 {
    if value.is_negative() {
        // Two's-complement overflow guard: I256::MIN.abs() doesn't fit in
        // U256 by exactly the sign bit; saturate to MAX instead.
        match value.checked_neg() {
            Some(v) => U256::from_str(&v.to_string()).unwrap_or(U256::MAX),
            None => U256::MAX,
        }
    } else {
        U256::from_str(&value.to_string()).unwrap_or(U256::ZERO)
    }
}

/// Parse a 1e8-scaled price (q8) integer from a `BigDecimal` (DB column).
/// Returns 0 on overflow rather than failing — callers should treat 0 as
/// "no price available" anyway.
pub fn bd_to_q8_i64(value: &BigDecimal) -> i64 {
    bd_to_bigint(value)
        .ok()
        .and_then(|n| n.to_string().parse::<i64>().ok())
        .unwrap_or(0)
}

/// Convert a price encoded as q8 (price × 1e8) to `U256`. Used in PnL math.
pub fn q8_to_u256(price_q8: i64) -> U256 {
    if price_q8 < 0 {
        U256::ZERO
    } else {
        U256::from(price_q8 as u64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_u256() {
        let v = U256::from(1_234_567_890_000_000_000u128);
        let bd = u256_to_bd(v);
        let back = bd_to_u256(&bd).unwrap();
        assert_eq!(back, v);
    }

    #[test]
    fn roundtrip_i256_negative() {
        let v = I256::try_from(-1_234_567_890i64).unwrap();
        let bd = i256_to_bd(v);
        let back = bd_to_i256(&bd).unwrap();
        assert_eq!(back, v);
    }

    #[test]
    fn negative_to_u256_fails() {
        let bd = BigDecimal::from(-1);
        assert!(bd_to_u256(&bd).is_err());
    }

    #[test]
    fn fractional_rejected() {
        let bd = BigDecimal::from_str("1.5").unwrap();
        assert!(bd_to_u256(&bd).is_err());
    }

    #[test]
    fn q8_parse() {
        let bd = BigDecimal::from(50_000_12345678i64); // 500_001.2345678 * 1e8
        assert_eq!(bd_to_q8_i64(&bd), 50_000_12345678i64);
    }

    #[test]
    fn handles_non_zero_scale_integer_form() {
        // `1e+20` round-trips as (1, -20) in bigdecimal, which the old
        // `bd_to_u256` rejected as "not integer". The conversion must
        // accept it as long as the resulting value is exact.
        let bd = BigDecimal::from_str("1e+20").unwrap();
        let v = bd_to_u256(&bd).unwrap();
        assert_eq!(v.to_string(), "100000000000000000000");
    }

    #[test]
    fn rejects_truly_fractional_with_positive_scale() {
        // (123, 2) → 1.23 — not integer.
        let bd = BigDecimal::from_str("1.23").unwrap();
        assert!(bd_to_u256(&bd).is_err());
    }

    #[test]
    fn accepts_integer_with_positive_scale() {
        // (12300, 2) = 123.00 — integer 123.
        let bd = BigDecimal::from_str("123.00").unwrap();
        assert_eq!(bd_to_u256(&bd).unwrap().to_string(), "123");
    }
}
