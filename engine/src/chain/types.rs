//! Solidity-compatible bindings for TradingVault. Generated via `alloy::sol!`.
//! Keep the event signatures in sync with `contracts/src/TradingVault.sol`.

use alloy::sol;

sol! {
    #[sol(rpc)]
    contract TradingVault {
        // ── Read ────────────────────────────────────────────────────────
        function engineSigner() external view returns (address);
        function pendingSigner() external view returns (address);
        function pendingSignerEffectiveAt() external view returns (uint256);
        function lastNonce(address user) external view returns (uint256);
        function houseBalance() external view returns (uint256);
        function maxSingleWithdraw() external view returns (uint256);
        function depositsPaused() external view returns (bool);
        function withdrawsPaused() external view returns (bool);

        // ── Write ───────────────────────────────────────────────────────
        function deposit() external payable;
        function withdraw(uint256 amount, uint256 nonce, bytes calldata sig) external;
        function houseDeposit() external payable;
        function houseWithdraw(address to, uint256 amount) external;
        function proposeSigner(address newSigner) external;
        function activateSigner() external;
        function cancelPendingSigner() external;
        function setMaxSingleWithdraw(uint256 amount) external;
        function setDepositsPaused(bool paused) external;
        function setWithdrawsPaused(bool paused) external;

        // ── Events ──────────────────────────────────────────────────────
        event Deposited(address indexed user, uint256 amount);
        event Withdrawn(address indexed user, uint256 amount, uint256 nonce);
        event HouseFunded(address indexed from, uint256 amount);
        event HouseWithdrawn(address indexed to, uint256 amount);
        event SignerProposed(address indexed pending, uint256 effectiveAt);
        event SignerRotated(address indexed previous, address indexed current);
        event MaxSingleWithdrawSet(uint256 amount);
        event DepositsPausedSet(bool paused);
        event WithdrawsPausedSet(bool paused);
    }
}
