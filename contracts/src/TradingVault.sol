// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title TradingVault
 * @notice Custodial ETH vault for the Rush trading engine on Base.
 *
 * Model: off-chain matching, on-chain settlement.
 *  - Users deposit ETH directly. The engine listens for {Deposited} and
 *    credits the user in its off-chain ledger.
 *  - Withdrawals require an EIP-191 signature from the engine signer over
 *    (chainId, vault, user, amount, nonce). The engine signs only when the
 *    user has enough free balance off-chain (deposits + realized PnL -
 *    withdrawn - locked margin).
 *  - The house funds the vault separately via {houseDeposit} so winners can
 *    be paid out of the same balance pool.
 *
 * The contract intentionally does NOT track per-user balances. The off-chain
 * engine is the source of truth; on-chain we only enforce nonce monotonicity,
 * signer authorization, and total liquidity.
 */
contract TradingVault is Ownable, ReentrancyGuard {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ─── Constants ───────────────────────────────────────────────────────

    uint256 public constant SIGNER_TIMELOCK = 1 days;
    uint256 public constant MIN_DEPOSIT = 1e15; // 0.001 ETH

    // ─── State ───────────────────────────────────────────────────────────

    /// @notice Address whose ECDSA signature authorizes withdrawals.
    address public engineSigner;

    /// @notice Pending signer rotation (settled after SIGNER_TIMELOCK).
    address public pendingSigner;
    uint256 public pendingSignerEffectiveAt;

    /// @notice Per-user monotonic nonce. Each successful withdraw must use a
    ///         strictly greater nonce than the last consumed one.
    mapping(address => uint256) public lastNonce;

    /// @notice Balance owned by the house (counterparty buffer + collected
    ///         spread + slashed margins). Tracked separately from user
    ///         deposits so houseWithdraw cannot dip into user funds beyond
    ///         the recorded buffer.
    uint256 public houseBalance;

    /// @notice Cap per single withdrawal. 0 = no cap. Owner-mutable.
    ///         Used as a circuit breaker; off-chain engine enforces real
    ///         per-user balance.
    uint256 public maxSingleWithdraw;

    /// @notice When true, deposits are rejected. Withdrawals stay open so
    ///         users can always exit.
    bool public depositsPaused;

    /// @notice When true, BOTH user and house withdrawals revert. The
    ///         emergency brake — pulled by the owner when the engine
    ///         signer is suspected compromised, when the off-chain
    ///         ledger has diverged, or while ops investigates an
    ///         anomaly. While set, deposits remain unaffected so users
    ///         can keep funding (subject to {depositsPaused}).
    ///         Owner is expected to flip this off once the underlying
    ///         cause clears; there's no auto-reset by design.
    bool public withdrawsPaused;

    // ─── Events ──────────────────────────────────────────────────────────

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount, uint256 nonce);
    event HouseFunded(address indexed from, uint256 amount);
    event HouseWithdrawn(address indexed to, uint256 amount);
    event SignerProposed(address indexed pending, uint256 effectiveAt);
    event SignerRotated(address indexed previous, address indexed current);
    event MaxSingleWithdrawSet(uint256 amount);
    event DepositsPausedSet(bool paused);
    event WithdrawsPausedSet(bool paused);

    // ─── Errors ──────────────────────────────────────────────────────────

    error ZeroAmount();
    error BelowMinDeposit();
    error DepositsArePaused();
    error WithdrawsArePaused();
    error InvalidNonce();
    error InvalidSignature();
    error WithdrawTooLarge();
    error InsufficientHouseBalance();
    error TransferFailed();
    error TimelockNotExpired();
    error NoPendingSigner();
    error ZeroAddress();

    // ─── Constructor ─────────────────────────────────────────────────────

    constructor(address _owner, address _engineSigner) Ownable(_owner) {
        if (_engineSigner == address(0)) revert ZeroAddress();
        engineSigner = _engineSigner;
        emit SignerRotated(address(0), _engineSigner);
    }

    // ─── User: deposit / withdraw ────────────────────────────────────────

    /**
     * @notice Deposit ETH into the vault. Engine credits the user off-chain
     *         after observing the {Deposited} event with N confirmations.
     */
    function deposit() external payable {
        _deposit(msg.sender, msg.value);
    }

    /**
     * @notice Withdraw ETH using an authorization signed by {engineSigner}.
     *         The signature commits to (chainId, vault, user, amount, nonce)
     *         so it cannot be replayed across chains, vaults, or users.
     *
     * @param amount  Wei to withdraw.
     * @param nonce   Strictly greater than {lastNonce[msg.sender]}.
     * @param sig     65-byte ECDSA signature from {engineSigner}.
     */
    function withdraw(uint256 amount, uint256 nonce, bytes calldata sig)
        external
        nonReentrant
    {
        if (withdrawsPaused) revert WithdrawsArePaused();
        if (amount == 0) revert ZeroAmount();
        if (nonce <= lastNonce[msg.sender]) revert InvalidNonce();
        if (maxSingleWithdraw != 0 && amount > maxSingleWithdraw) {
            revert WithdrawTooLarge();
        }

        bytes32 digest = keccak256(
            abi.encode(block.chainid, address(this), msg.sender, amount, nonce)
        ).toEthSignedMessageHash();

        if (digest.recover(sig) != engineSigner) revert InvalidSignature();

        lastNonce[msg.sender] = nonce;

        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Withdrawn(msg.sender, amount, nonce);
    }

    // ─── House: fund / withdraw ──────────────────────────────────────────

    /**
     * @notice Fund the house buffer used to pay winners.
     *         Anyone can fund (e.g. tips), but only owner can withdraw.
     */
    function houseDeposit() external payable {
        if (msg.value == 0) revert ZeroAmount();
        houseBalance += msg.value;
        emit HouseFunded(msg.sender, msg.value);
    }

    /**
     * @notice Owner withdraws accumulated house profits.
     * @dev Capped at {houseBalance}; cannot drain user deposits beyond what
     *      was explicitly booked as house funds.
     */
    function houseWithdraw(address to, uint256 amount)
        external
        onlyOwner
        nonReentrant
    {
        // The same emergency brake stops the owner from sweeping the
        // house balance during an active incident — protects ops from
        // racing themselves while triaging.
        if (withdrawsPaused) revert WithdrawsArePaused();
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > houseBalance) revert InsufficientHouseBalance();

        houseBalance -= amount;

        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit HouseWithdrawn(to, amount);
    }

    // ─── Owner: signer rotation (timelocked) ─────────────────────────────

    function proposeSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert ZeroAddress();
        pendingSigner = newSigner;
        pendingSignerEffectiveAt = block.timestamp + SIGNER_TIMELOCK;
        emit SignerProposed(newSigner, pendingSignerEffectiveAt);
    }

    function activateSigner() external onlyOwner {
        if (pendingSigner == address(0)) revert NoPendingSigner();
        if (block.timestamp < pendingSignerEffectiveAt) revert TimelockNotExpired();

        address previous = engineSigner;
        engineSigner = pendingSigner;
        pendingSigner = address(0);
        pendingSignerEffectiveAt = 0;

        emit SignerRotated(previous, engineSigner);
    }

    /**
     * @notice Cancel a pending signer rotation. Useful if the proposed
     *         signer was leaked before activation.
     */
    function cancelPendingSigner() external onlyOwner {
        pendingSigner = address(0);
        pendingSignerEffectiveAt = 0;
    }

    // ─── Owner: knobs ────────────────────────────────────────────────────

    function setMaxSingleWithdraw(uint256 amount) external onlyOwner {
        maxSingleWithdraw = amount;
        emit MaxSingleWithdrawSet(amount);
    }

    function setDepositsPaused(bool paused) external onlyOwner {
        depositsPaused = paused;
        emit DepositsPausedSet(paused);
    }

    /**
     * @notice Emergency brake for both user and house withdrawals. Set
     *         to `true` to halt every outflow from the vault — used
     *         when the engine signer key is suspected compromised,
     *         when on-chain `houseBalance` has diverged from the
     *         off-chain ledger, or while ops investigates an anomaly.
     *         Auto-reset is intentionally NOT provided — the owner has
     *         to verify the underlying cause cleared before flipping
     *         it back.
     */
    function setWithdrawsPaused(bool paused) external onlyOwner {
        withdrawsPaused = paused;
        emit WithdrawsPausedSet(paused);
    }

    // ─── Internal ────────────────────────────────────────────────────────

    function _deposit(address user, uint256 amount) internal {
        if (depositsPaused) revert DepositsArePaused();
        if (amount < MIN_DEPOSIT) revert BelowMinDeposit();
        emit Deposited(user, amount);
    }

    // ─── Fallback ────────────────────────────────────────────────────────

    /// @notice Plain ETH sends are treated as user deposits.
    receive() external payable {
        _deposit(msg.sender, msg.value);
    }
}
