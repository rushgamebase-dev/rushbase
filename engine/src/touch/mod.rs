//! Touch-in-window bet engine.
//!
//!  - `pricing`           — multiplier from distance, time and house edge
//!  - `engine`            — open + settle, atomic with Postgres
//!  - `resolution_loop`   — periodic sweep that resolves elapsed windows
//!
//! Resolution is via per-bet VRF path (`vrf::path::first_touch_ms`),
//! not against a real-feed `(min, max)` aggregate — so no separate
//! `resolver` module is needed any more.

pub mod engine;
pub mod pricing;
pub mod quote_token;
pub mod resolution_loop;

pub use engine::{OpenBet, ResolveOutcome, TouchEngine};
pub use pricing::{MultiplierCalculator, MultiplierConfig, MultiplierQuote};
pub use quote_token::{expect_match as quote_token_expect_match, QuoteSigner, QuoteTokenError, QuoteTokenPayload};
pub use resolution_loop::ResolutionLoop;
