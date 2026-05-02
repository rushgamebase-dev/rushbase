//! Fuzz the BigDecimal → U256 / I256 conversions used everywhere wei
//! crosses the DB boundary. Postgres NUMERIC can produce surprising
//! exponent forms (`1e+20`, `0.1e21`) under round-trip; the helpers
//! must handle every shape without panicking.

#![no_main]

use bigdecimal::BigDecimal;
use libfuzzer_sys::fuzz_target;
use rush_engine::utils::wei::{bd_to_i256, bd_to_u256};
use std::str::FromStr;

fuzz_target!(|data: &[u8]| {
    if let Ok(s) = std::str::from_utf8(data) {
        if let Ok(bd) = BigDecimal::from_str(s) {
            let _ = bd_to_u256(&bd);
            let _ = bd_to_i256(&bd);
        }
    }
});
