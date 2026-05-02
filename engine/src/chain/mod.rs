//! On-chain integration for the TradingVault.

pub mod event_handler;
pub mod listener;
pub mod sanity;
pub mod signer;
pub mod solvency_monitor;
pub mod types;
pub mod vault_balance;
pub mod withdraw_service;

pub use event_handler::VaultEventHandler;
pub use listener::{
    DepositObserved, EventHandler, HouseFundedObserved, HouseWithdrawnObserved, ListenerError,
    VaultListener, WithdrawObserved,
};
pub use sanity::{OracleSanity, SanityVerdict, SymbolSanityConfig};
pub use signer::{WithdrawAuthorization, WithdrawSigner};
pub use solvency_monitor::{SolvencyMonitor, SolvencyMonitorConfig};
pub use vault_balance::{
    AlloyVaultBalanceProvider, VaultBalanceError, VaultBalanceProvider,
};
pub use withdraw_service::{WithdrawService, WithdrawServiceError};

#[cfg(any(test, feature = "test-helpers"))]
pub use vault_balance::MockVaultBalanceProvider;

#[cfg(feature = "aws-kms")]
pub mod signer_kms;
#[cfg(feature = "aws-kms")]
pub use signer_kms::KmsBackend;
