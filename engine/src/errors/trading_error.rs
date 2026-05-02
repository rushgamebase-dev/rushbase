use std::fmt;
use uuid::Uuid;

/// Errors surfaced by the touch-bet engine and resolution loop.
#[derive(Debug)]
pub enum TradingError {
    InsufficientBalance {
        required_wei: String,
        available_wei: String,
    },

    BetNotFound(Uuid),
    BetAlreadyResolved,
    BetNotOwned,
    MaxActiveBetsReached {
        current: i64,
        max: i64,
    },

    InvalidSymbol(String),
    InvalidStakeAmount {
        amount_wei: String,
        min_wei: String,
        max_wei: String,
    },
    InvalidWindow {
        reason: String,
    },
    InvalidBand {
        reason: String,
    },
    QuoteMismatch {
        expected_multiplier_bps: u32,
        actual_multiplier_bps: u32,
    },

    HouseSolvencyViolated {
        required_buffer_wei: String,
        available_buffer_wei: String,
    },
    /// Specific subcase of solvency: the buffer floor would be breached.
    HouseBufferTooLow {
        buffer_wei: String,
        exposure_after_wei: String,
        min_buffer_wei: String,
    },
    PerSymbolExposureLimitExceeded {
        symbol: String,
        current_wei: String,
        limit_wei: String,
    },
    PayoutCapExceeded {
        max_potential_payout_wei: String,
        cap_wei: String,
    },
    /// Per-user potential payout cap exceeded. Sum of net potential
    /// payouts across the user's currently-active bets plus the new
    /// bet's net would breach `max_potential_payout_per_user_wei`.
    UserPayoutCapExceeded {
        user_outstanding_wei: String,
        new_net_wei: String,
        cap_wei: String,
    },
    CircuitBreakerOpen,

    PriceUnavailable(String),
    StalePrice {
        symbol: String,
        age_ms: i64,
    },

    SafeMode,

    LedgerError(String),
    DatabaseError(String),
    /// VRF commit signing failed at place_bet. Treated as a fatal
    /// engine error (refused bet) — never silently fall back to an
    /// unsigned commit.
    SignerError(String),
    /// VRF resolver couldn't reconstruct the path for a bet:
    /// `seed_encrypted` missing, AES tag mismatch, or path config
    /// version drift. Resolver leaves the bet ACTIVE so an operator
    /// can investigate (manual reset of seed, key, or rollback).
    ResolverError(String),
}

impl fmt::Display for TradingError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        use TradingError::*;
        match self {
            InsufficientBalance { required_wei, available_wei } => write!(
                f,
                "Insufficient balance: required {} wei, available {} wei",
                required_wei, available_wei
            ),
            BetNotFound(id) => write!(f, "Bet not found: {}", id),
            BetAlreadyResolved => write!(f, "Bet already resolved"),
            BetNotOwned => write!(f, "Bet does not belong to user"),
            MaxActiveBetsReached { current, max } => {
                write!(f, "Maximum active bets reached: {} of {}", current, max)
            }
            InvalidSymbol(sym) => write!(f, "Invalid symbol: {}", sym),
            InvalidStakeAmount { amount_wei, min_wei, max_wei } => write!(
                f,
                "Invalid stake amount: {} wei (must be {}..{})",
                amount_wei, min_wei, max_wei
            ),
            InvalidWindow { reason } => write!(f, "Invalid window: {}", reason),
            InvalidBand { reason } => write!(f, "Invalid band: {}", reason),
            QuoteMismatch { expected_multiplier_bps, actual_multiplier_bps } => write!(
                f,
                "Multiplier quote mismatch: client expected {} bps, server quotes {} bps",
                expected_multiplier_bps, actual_multiplier_bps
            ),
            HouseSolvencyViolated { required_buffer_wei, available_buffer_wei } => write!(
                f,
                "House solvency: would require {} wei buffer, only {} wei available",
                required_buffer_wei, available_buffer_wei
            ),
            HouseBufferTooLow { buffer_wei, exposure_after_wei, min_buffer_wei } => write!(
                f,
                "House buffer too low: vault holds {} wei, would owe {} wei after this bet (min buffer {} wei)",
                buffer_wei, exposure_after_wei, min_buffer_wei
            ),
            PerSymbolExposureLimitExceeded { symbol, current_wei, limit_wei } => write!(
                f,
                "Per-symbol exposure on {}: {} > {}",
                symbol, current_wei, limit_wei
            ),
            PayoutCapExceeded { max_potential_payout_wei, cap_wei } => write!(
                f,
                "Potential payout {} exceeds cap {}",
                max_potential_payout_wei, cap_wei
            ),
            UserPayoutCapExceeded { user_outstanding_wei, new_net_wei, cap_wei } => write!(
                f,
                "Per-user payout cap: outstanding {} + new {} > {}",
                user_outstanding_wei, new_net_wei, cap_wei
            ),
            CircuitBreakerOpen => write!(f, "Trading is temporarily suspended"),
            PriceUnavailable(sym) => write!(f, "Price unavailable for: {}", sym),
            StalePrice { symbol, age_ms } => {
                write!(f, "Price for {} is stale ({}ms old)", symbol, age_ms)
            }
            SafeMode => write!(f, "Engine is in safe mode"),
            LedgerError(msg) => write!(f, "Ledger error: {}", msg),
            DatabaseError(msg) => write!(f, "Database error: {}", msg),
            SignerError(msg) => write!(f, "Commit signer error: {}", msg),
            ResolverError(msg) => write!(f, "VRF resolver error: {}", msg),
        }
    }
}

impl std::error::Error for TradingError {}

impl From<sqlx::Error> for TradingError {
    fn from(err: sqlx::Error) -> Self {
        TradingError::DatabaseError(err.to_string())
    }
}
