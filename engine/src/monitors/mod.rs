//! Background monitors that escalate to the circuit breaker.
//!
//! These are idempotent watchdogs — they only TRIP the breaker, they
//! never reset it. Operations resets the breaker once the underlying
//! cause has cleared.
//!
//! In the VRF arena there are no Binance / oracle feeds to watch.
//! The remaining monitor revalidates open WebSocket sessions when a
//! user is banned mid-flight.

pub mod ws_revalidate;
pub use ws_revalidate::{spawn_ws_revalidator, WsRevalidateConfig};
