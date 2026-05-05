// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
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
contract TradingVault is Ownable2Step, ReentrancyGuard {
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

    /// @notice Aggregate withdraw cap across a rolling time window. 0
    ///         disables the rate limit. Combined with
    ///         {withdrawWindowSecs}, this caps how fast ETH can leave
    ///         the vault no matter how many valid signatures the
    ///         attacker holds — a defense in depth in case the engine
    ///         signer is compromised and stockpiled authorizations are
    ///         replayed against the contract. Owner can flip the brake
    ///         {setWithdrawsPaused} during the wait, then triage.
    uint256 public maxWindowWithdraw;

    /// @notice Length (seconds) of the rolling window used for
    ///         {maxWindowWithdraw}. The window is *fixed* — when the
    ///         current one expires the next withdraw resets the
    ///         counter. A sliding-window queue would be more accurate
    ///         but linear in storage; the fixed scheme is O(1) and the
    ///         worst case (back-to-back windows) leaks ≤ 2 × cap per
    ///         `2 × windowSecs`, which is acceptable here. 0 = disabled.
    uint256 public withdrawWindowSecs;

    /// @notice Unix timestamp at which the current window started.
    uint256 public currentWindowStart;

    /// @notice Sum of withdrawn `amount` since {currentWindowStart}.
    uint256 public currentWindowVolume;

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
    event WithdrawWindowSet(uint256 maxAmount, uint256 windowSecs);
    event WithdrawWindowReset(uint256 newWindowStart);
    event DepositsPausedSet(bool paused);
    event WithdrawsPausedSet(bool paused);
    /// @notice Fired when {cancelPendingSigner} unwinds an in-flight
    ///         rotation. Carries the address that was cancelled so
    ///         off-chain monitoring can reconcile the abort against
    ///         the original {SignerProposed} log.
    event SignerRotationCancelled(address indexed cancelled);

    // ─── Errors ──────────────────────────────────────────────────────────

    error ZeroAmount();
    error BelowMinDeposit();
    error DepositsArePaused();
    error WithdrawsArePaused();
    error InvalidNonce();
    error InvalidSignature();
    error WithdrawTooLarge();
    /// @dev Carries the blocked amount and how much of the current
    ///      window's allowance is still available, so off-chain ops
    ///      can decode the revert reason directly.
    error WindowVolumeExceeded(uint256 attempted, uint256 windowRemaining);
    error InsufficientHouseBalance();
    error TransferFailed();
    error TimelockNotExpired();
    error NoPendingSigner();
    error ZeroAddress();
    /// @dev Thrown by {setWithdrawWindow} when `maxAmount > 0` is paired
    ///      with a zero-second window (would let unlimited resets fire
    ///      every block). Distinct from {ZeroAmount} so off-chain
    ///      tooling can route the operator to the right setter.
    error ZeroWindowSecs();

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

        // Rolling-window rate limit. Checked AFTER signature validation
        // so a forged sig can't even bump the window counter. The
        // window resets lazily on the first withdraw past its end —
        // gas-efficient and avoids cron-like upkeep.
        if (maxWindowWithdraw != 0) {
            if (block.timestamp >= currentWindowStart + withdrawWindowSecs) {
                currentWindowStart = block.timestamp;
                currentWindowVolume = 0;
                emit WithdrawWindowReset(block.timestamp);
            }
            uint256 newVolume = currentWindowVolume + amount;
            if (newVolume > maxWindowWithdraw) {
                // `currentWindowVolume` may exceed `maxWindowWithdraw`
                // if the owner shrank the cap mid-window (via
                // `setWithdrawWindow`); a naive subtraction would
                // underflow and revert with a Panic instead of our
                // typed error. Saturate at zero so callers always get
                // an actionable `windowRemaining`.
                uint256 windowRemaining = currentWindowVolume >= maxWindowWithdraw
                    ? 0
                    : maxWindowWithdraw - currentWindowVolume;
                revert WindowVolumeExceeded(amount, windowRemaining);
            }
            currentWindowVolume = newVolume;
        }

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
     *         signer was leaked before activation. No-op when nothing
     *         is pending — does not revert, since the calling op is
     *         already in a "make sure rotation is off" state.
     */
    function cancelPendingSigner() external onlyOwner {
        address cancelled = pendingSigner;
        pendingSigner = address(0);
        pendingSignerEffectiveAt = 0;
        if (cancelled != address(0)) {
            emit SignerRotationCancelled(cancelled);
        }
    }

    // ─── Owner: knobs ────────────────────────────────────────────────────

    function setMaxSingleWithdraw(uint256 amount) external onlyOwner {
        maxSingleWithdraw = amount;
        emit MaxSingleWithdrawSet(amount);
    }

    /**
     * @notice Configure the rolling-window withdraw rate limit.
     *         Setting `maxAmount = 0` disables the limit.
     * @param maxAmount  Aggregate cap (wei) within the window.
     * @param windowSecs Length of the window in seconds. Must be >0
     *                   when `maxAmount > 0` (would otherwise mean
     *                   "unlimited withdraws every block").
     * @dev Changing the window does NOT reset the in-flight counter
     *      so an owner can't dodge the brake mid-incident — the next
     *      withdraw that crosses the (possibly re-aligned) window end
     *      starts a fresh accumulator. To clear immediately, use
     *      {setWithdrawsPaused} as a brake first.
     */
    function setWithdrawWindow(uint256 maxAmount, uint256 windowSecs)
        external
        onlyOwner
    {
        if (maxAmount > 0 && windowSecs == 0) revert ZeroWindowSecs();
        maxWindowWithdraw = maxAmount;
        withdrawWindowSecs = windowSecs;
        emit WithdrawWindowSet(maxAmount, windowSecs);
    }

    /**
     * @notice How much wei could still be withdrawn under the current
     *         rolling window without tripping {WindowVolumeExceeded}.
     *         Returns `type(uint256).max` when the rate limit is off.
     *         A value of `0` means the cap is fully consumed; a follow-up
     *         withdraw will revert until {currentWindowStart} +
     *         {withdrawWindowSecs} elapses.
     * @dev Pure read — frontends and the engine call this to render
     *      a live "max you can pull right now" hint to the user.
     */
    function windowRemaining() external view returns (uint256) {
        if (maxWindowWithdraw == 0) return type(uint256).max;
        if (block.timestamp >= currentWindowStart + withdrawWindowSecs) {
            return maxWindowWithdraw;
        }
        return currentWindowVolume >= maxWindowWithdraw
            ? 0
            : maxWindowWithdraw - currentWindowVolume;
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
