// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title RushStaking
 * @notice Single-sided $RUSH staking with ETH rewards.
 *         Stakers deposit $RUSH, earn ETH proportional to (stake × time)
 *         using the Synthetix accumulator pattern. Owner periodically
 *         tops up the reward pool via {notifyRewardAmount}; the new
 *         ETH streams out over `rewardsDuration` (default 7 days).
 *
 *         No locks — stakers can withdraw and claim independently at
 *         any time. `earned(user)` returns live, second-by-second
 *         accumulating ETH; the frontend polls it for the dopamine
 *         drip ("watching the green number tick up").
 *
 *         Reward source flow:
 *           1. Owner withdraws ETH from the TapTrading TradingVault
 *              via `houseWithdraw` once a week.
 *           2. Owner calls `notifyRewardAmount{value: amount}` here.
 *           3. `rewardRate` is recomputed (`(amount + leftover) / 7d`)
 *              and the streaming clock is reset.
 *           4. Stakers see `earned()` start ticking immediately.
 *
 *         Math is a verbatim port of Synthetix StakingRewards.sol —
 *         a battle-tested pattern used by SUSHI, AAVE LM, etc. It is
 *         O(1) per stake/withdraw/claim and resistant to per-block
 *         manipulation because reward distribution is time-indexed.
 */
contract RushStaking is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── State ──────────────────────────────────────────────────────
    IERC20 public immutable rush;

    /// ETH wei distributed per second across the entire pool.
    uint256 public rewardRate;
    /// Block timestamp of the last accumulator update.
    uint256 public lastUpdate;
    /// Block timestamp at which the current streaming period ends.
    uint256 public periodFinish;
    /// Accumulated ETH (1e18-scaled) per staked $RUSH wei since deploy.
    uint256 public rewardPerTokenStored;
    /// Sum of all balances currently staked.
    uint256 public totalStaked;

    /// $RUSH staked by each user.
    mapping(address => uint256) public balances;
    /// Snapshot of `rewardPerTokenStored` at user's last interaction.
    mapping(address => uint256) public userRewardPaid;
    /// Pending unclaimed ETH for the user (settled at last interaction).
    mapping(address => uint256) public rewards;

    /// Streaming window after each `notifyRewardAmount`. Owner-tunable
    /// because economic conditions change (e.g., concentrate rewards
    /// over 1 day for a liquidity event).
    uint256 public rewardsDuration = 7 days;

    // ── Events ─────────────────────────────────────────────────────
    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event Claimed(address indexed user, uint256 ethAmount);
    event RewardAdded(uint256 ethAmount, uint256 newRewardRate, uint256 periodFinish);
    event RewardsDurationUpdated(uint256 newDuration);

    // ── Errors ─────────────────────────────────────────────────────
    error ZeroAmount();
    error InsufficientBalance();
    error TransferFailed();
    error ZeroRewardRate();
    error InsufficientPoolBalance();
    error PreviousPeriodNotFinished();

    // ── Construction ───────────────────────────────────────────────
    constructor(address _rush) Ownable(msg.sender) {
        rush = IERC20(_rush);
    }

    // ── Modifier ───────────────────────────────────────────────────
    /// Settles the user's pending rewards into the persistent
    /// `rewards` mapping before any state change. Without this the
    /// user's balance change would alter their share of the pool
    /// retroactively.
    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdate = lastTimeApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    // ── Read views ─────────────────────────────────────────────────

    /// Min(now, periodFinish) — used so rewards stop accruing once the
    /// streaming period ends, even if `notifyRewardAmount` is delayed.
    function lastTimeApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    /// Cumulative ETH (1e18-scaled) earned per staked $RUSH wei from
    /// deploy until now. Stakers' personal earned() = (currentRPT -
    /// theirSnapshot) * theirBalance / 1e18 + carry.
    function rewardPerToken() public view returns (uint256) {
        if (totalStaked == 0) return rewardPerTokenStored;
        uint256 elapsed = lastTimeApplicable() - lastUpdate;
        return rewardPerTokenStored + (elapsed * rewardRate * 1e18) / totalStaked;
    }

    /// ETH wei currently claimable by `account`. Live — increments by
    /// `rewardRate * (account.balance / totalStaked)` per second, so
    /// the frontend can poll once a second and watch it tick up.
    function earned(address account) public view returns (uint256) {
        return (balances[account] * (rewardPerToken() - userRewardPaid[account])) / 1e18
            + rewards[account];
    }

    /// APR over the current streaming period at current TVL. View-only
    /// helper so the frontend can show "≈ 47% APR" in the UI without
    /// re-deriving the math. Returns 0 when there is no stake or no
    /// active period.
    function apyBps() external view returns (uint256) {
        if (totalStaked == 0 || block.timestamp >= periodFinish) return 0;
        // ETH per year = rewardRate * 365.25 days, in wei
        uint256 ethPerYearWei = rewardRate * 365 days;
        // APR = (ETH per year / totalStaked) * 10_000
        // NOTE: this is denominated in ETH/RUSH which the UI must
        // multiply by ETH/RUSH price ratio for a real APR. Surfaced
        // here so on-chain readers can compute their own ratio.
        return (ethPerYearWei * 10_000) / totalStaked;
    }

    // ── Mutations ──────────────────────────────────────────────────

    function stake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        if (amount == 0) revert ZeroAmount();
        totalStaked += amount;
        balances[msg.sender] += amount;
        rush.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount);
    }

    function withdraw(uint256 amount) public nonReentrant updateReward(msg.sender) {
        if (amount == 0) revert ZeroAmount();
        if (balances[msg.sender] < amount) revert InsufficientBalance();
        totalStaked -= amount;
        balances[msg.sender] -= amount;
        rush.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function claim() public nonReentrant updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            (bool ok,) = payable(msg.sender).call{value: reward}("");
            if (!ok) revert TransferFailed();
            emit Claimed(msg.sender, reward);
        }
    }

    /// Convenience: withdraw full balance + claim in one tx.
    function exit() external {
        uint256 bal = balances[msg.sender];
        if (bal > 0) withdraw(bal);
        claim();
    }

    // ── Owner ──────────────────────────────────────────────────────

    /// Top up the reward pool. The supplied ETH streams out linearly
    /// over `rewardsDuration` starting NOW. If a previous period is
    /// still active, the leftover wei is rolled forward into the new
    /// rate so no rewards are lost or double-counted.
    ///
    /// Invariant: the contract's ETH balance always covers the entire
    /// promised stream (`rewardRate * rewardsDuration`). Reverts
    /// otherwise so we never write a rate the contract can't pay.
    function notifyRewardAmount() external payable onlyOwner updateReward(address(0)) {
        if (block.timestamp >= periodFinish) {
            rewardRate = msg.value / rewardsDuration;
        } else {
            uint256 remaining = periodFinish - block.timestamp;
            uint256 leftover = remaining * rewardRate;
            rewardRate = (msg.value + leftover) / rewardsDuration;
        }
        if (rewardRate == 0) revert ZeroRewardRate();
        if (rewardRate > address(this).balance / rewardsDuration) revert InsufficientPoolBalance();
        lastUpdate = block.timestamp;
        periodFinish = block.timestamp + rewardsDuration;
        emit RewardAdded(msg.value, rewardRate, periodFinish);
    }

    /// Adjust the streaming window length. Only callable when no
    /// period is active so an in-flight stream isn't truncated/diluted
    /// mid-flight.
    function setRewardsDuration(uint256 _duration) external onlyOwner {
        if (block.timestamp < periodFinish) revert PreviousPeriodNotFinished();
        require(_duration >= 1 days && _duration <= 90 days, "duration out of range");
        rewardsDuration = _duration;
        emit RewardsDurationUpdated(_duration);
    }

    /// Allow the contract to be funded outside `notifyRewardAmount`
    /// (e.g., the owner pre-loads ETH). Funds sit idle until the next
    /// `notifyRewardAmount` call rolls them into the streaming rate.
    receive() external payable {}
}
