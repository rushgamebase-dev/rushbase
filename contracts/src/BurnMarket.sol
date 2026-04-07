// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title BurnMarket
 * @notice Prediction market with 70/30 burn split. All bets in $RUSH token.
 *         70% of pool → winners (proportional)
 *         30% of pool → burned (sent to 0x000...dEaD)
 *         No fees. Pure deflation.
 */
contract BurnMarket {
    enum MarketState { OPEN, LOCKED, RESOLVED, CANCELLED }

    struct Range {
        uint256 minCars;
        uint256 maxCars;
        string  label;
    }

    struct Bet {
        uint256 rangeIndex;
        uint256 amount;
        bool    claimed;
    }

    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant BURN_BPS = 3000; // 30%

    address public immutable factory;
    address public immutable oracle;
    IERC20  public immutable bettingToken;
    bool    public constant isTokenMode = true;

    string  public streamUrl;
    string  public description;
    uint256 public immutable roundDurationSecs;
    uint256 public immutable minBet;
    uint256 public immutable maxBet;
    uint256 public immutable feeBps;

    uint256 public immutable createdAt;
    uint256 public lockTime;
    uint256 public resolvedAt;

    MarketState public state;
    uint256 public winningRangeIndex;
    uint256 public actualCarCount;

    Range[] public ranges;

    uint256 public totalPool;
    mapping(uint256 => uint256) public poolByRange;
    mapping(address => Bet[])   public betsByUser;
    address[] public bettorList;
    mapping(address => bool) internal hasBet;

    uint256 public totalBettors;
    uint256 public totalBurned;
    uint256 public feeCollected; // always 0, kept for interface compat

    event BetPlaced(address indexed user, uint256 rangeIndex, uint256 amount);
    event MarketLocked(uint256 lockTime);
    event MarketResolved(uint256 winningRangeIndex, uint256 actualCarCount);
    event TokensBurned(uint256 amount);
    event WinningsClaimed(address indexed user, uint256 amount);
    event MarketCancelled();
    event Refunded(address indexed user, uint256 amount);

    modifier onlyOracle() { require(msg.sender == oracle, "NOT_ORACLE"); _; }
    modifier inState(MarketState s) { require(state == s, "WRONG_STATE"); _; }

    struct MarketParams {
        address oracle;
        address bettingToken;
        string  streamUrl;
        string  description;
        uint256 roundDurationSecs;
        uint256 minBet;
        uint256 maxBet;
        uint256 feeBps;
        string[] rangeLabels;
        uint256[] rangeMins;
        uint256[] rangeMaxs;
    }

    constructor(MarketParams memory p) {
        require(p.rangeLabels.length > 0, "NO_RANGES");
        require(
            p.rangeLabels.length == p.rangeMins.length &&
            p.rangeMins.length == p.rangeMaxs.length,
            "RANGE_MISMATCH"
        );
        require(p.bettingToken != address(0), "ZERO_TOKEN");

        factory = msg.sender;
        oracle = p.oracle;
        bettingToken = IERC20(p.bettingToken);
        feeBps = p.feeBps; // stored but unused (burn replaces fee)

        streamUrl = p.streamUrl;
        description = p.description;
        roundDurationSecs = p.roundDurationSecs;
        minBet = p.minBet;
        maxBet = p.maxBet;

        createdAt = block.timestamp;
        lockTime = block.timestamp + p.roundDurationSecs;
        state = MarketState.OPEN;

        for (uint256 i = 0; i < p.rangeLabels.length; i++) {
            ranges.push(Range({
                minCars: p.rangeMins[i],
                maxCars: p.rangeMaxs[i],
                label: p.rangeLabels[i]
            }));
        }
    }

    // ── Betting ───────────────────────────────────────────────────────────

    /// @notice Place a bet with $RUSH tokens. Must approve first.
    function placeBetToken(uint256 rangeIndex, uint256 amount) external inState(MarketState.OPEN) {
        require(block.timestamp < lockTime, "BETTING_CLOSED");
        require(rangeIndex < ranges.length, "INVALID_RANGE");
        require(amount >= minBet, "BET_TOO_LOW");
        require(maxBet == 0 || amount <= maxBet, "BET_TOO_HIGH");

        require(bettingToken.transferFrom(msg.sender, address(this), amount), "TRANSFER_FAILED");

        betsByUser[msg.sender].push(Bet({
            rangeIndex: rangeIndex,
            amount: amount,
            claimed: false
        }));

        if (!hasBet[msg.sender]) {
            hasBet[msg.sender] = true;
            bettorList.push(msg.sender);
        }

        poolByRange[rangeIndex] += amount;
        totalPool += amount;
        totalBettors++;

        emit BetPlaced(msg.sender, rangeIndex, amount);
    }

    // ── Market Lifecycle ──────────────────────────────────────────────────

    function lockMarket() external onlyOracle inState(MarketState.OPEN) {
        state = MarketState.LOCKED;
        lockTime = block.timestamp;
        emit MarketLocked(lockTime);
    }

    function resolveMarket(uint256 _actualCarCount) external onlyOracle {
        require(state == MarketState.OPEN || state == MarketState.LOCKED, "WRONG_STATE");

        if (state == MarketState.OPEN) {
            state = MarketState.LOCKED;
            lockTime = block.timestamp;
        }

        actualCarCount = _actualCarCount;

        bool found = false;
        for (uint256 i = 0; i < ranges.length; i++) {
            if (_actualCarCount >= ranges[i].minCars && _actualCarCount <= ranges[i].maxCars) {
                winningRangeIndex = i;
                found = true;
                break;
            }
        }
        require(found, "NO_MATCHING_RANGE");

        // 30% burn
        uint256 burnAmount = (totalPool * BURN_BPS) / 10_000;
        totalBurned = burnAmount;

        state = MarketState.RESOLVED;
        resolvedAt = block.timestamp;

        if (burnAmount > 0) {
            require(bettingToken.transfer(BURN_ADDRESS, burnAmount), "BURN_FAILED");
            emit TokensBurned(burnAmount);
        }

        emit MarketResolved(winningRangeIndex, _actualCarCount);
    }

    function cancelMarket() external onlyOracle {
        require(state != MarketState.RESOLVED, "ALREADY_RESOLVED");
        state = MarketState.CANCELLED;
        emit MarketCancelled();
    }

    // ── Claims & Refunds ──────────────────────────────────────────────────

    function claimWinnings() external inState(MarketState.RESOLVED) {
        _claimFor(msg.sender);
    }

    function claimWinningsFor(address user) public inState(MarketState.RESOLVED) {
        _claimFor(user);
    }

    function _claimFor(address user) internal {
        uint256 winPool = poolByRange[winningRangeIndex];
        if (winPool == 0) return;

        uint256 distributable = totalPool - totalBurned;
        uint256 totalClaim = 0;

        Bet[] storage userBets = betsByUser[user];
        for (uint256 i = 0; i < userBets.length; i++) {
            if (userBets[i].rangeIndex == winningRangeIndex && !userBets[i].claimed) {
                userBets[i].claimed = true;
                totalClaim += (userBets[i].amount * distributable) / winPool;
            }
        }

        if (totalClaim > 0) {
            // Try to send to user, fallback silently if fails
            try bettingToken.transfer(user, totalClaim) returns (bool success) {
                if (success) {
                    emit WinningsClaimed(user, totalClaim);
                }
            } catch {}
        }
    }

    /// @notice Auto-distribute to all winners. Called by oracle post-resolution.
    function distributeAll() external inState(MarketState.RESOLVED) {
        for (uint256 i = 0; i < bettorList.length; i++) {
            _claimFor(bettorList[i]);
        }
    }

    function refund() external inState(MarketState.CANCELLED) {
        _refundFor(msg.sender);
    }

    function refundFor(address user) public inState(MarketState.CANCELLED) {
        _refundFor(user);
    }

    function _refundFor(address user) internal {
        Bet[] storage userBets = betsByUser[user];
        uint256 totalRefund = 0;

        for (uint256 i = 0; i < userBets.length; i++) {
            if (!userBets[i].claimed) {
                userBets[i].claimed = true;
                totalRefund += userBets[i].amount;
            }
        }

        if (totalRefund > 0) {
            try bettingToken.transfer(user, totalRefund) returns (bool success) {
                if (success) {
                    emit Refunded(user, totalRefund);
                }
            } catch {}
        }
    }

    /// @notice Auto-refund all bettors. Called by oracle after cancel.
    function refundAll() external inState(MarketState.CANCELLED) {
        for (uint256 i = 0; i < bettorList.length; i++) {
            _refundFor(bettorList[i]);
        }
    }

    // ── Views ─────────────────────────────────────────────────────────────

    function getRangeCount() external view returns (uint256) { return ranges.length; }

    function getRange(uint256 index) external view returns (uint256 minCars, uint256 maxCars, string memory label) {
        require(index < ranges.length, "INVALID_INDEX");
        Range storage r = ranges[index];
        return (r.minCars, r.maxCars, r.label);
    }

    function getAllRanges() external view returns (Range[] memory) { return ranges; }
    function getUserBets(address user) external view returns (Bet[] memory) { return betsByUser[user]; }
    function getBettorList() external view returns (address[] memory) { return bettorList; }
    function isClaimable() external view returns (bool) { return state == MarketState.RESOLVED; }

    function getUserClaimable(address user) external view returns (uint256) {
        if (state != MarketState.RESOLVED) return 0;
        uint256 winPool = poolByRange[winningRangeIndex];
        if (winPool == 0) return 0;
        uint256 distributable = totalPool - totalBurned;
        uint256 claimable = 0;
        Bet[] storage userBets = betsByUser[user];
        for (uint256 i = 0; i < userBets.length; i++) {
            if (userBets[i].rangeIndex == winningRangeIndex && !userBets[i].claimed) {
                claimable += (userBets[i].amount * distributable) / winPool;
            }
        }
        return claimable;
    }

    function getMarketInfo() external view returns (
        string memory _streamUrl,
        string memory _description,
        MarketState _state,
        uint256 _totalPool,
        uint256 _lockTime,
        uint256 _rangeCount
    ) {
        return (streamUrl, description, state, totalPool, lockTime, ranges.length);
    }

    function getMarketResult() external view returns (
        uint256 _totalBettors,
        uint256 _winningRangeIndex,
        uint256 _actualCarCount,
        uint256 _resolvedAt,
        uint256 _disputeWindowSecs,
        bool    _isTokenMode
    ) {
        return (totalBettors, winningRangeIndex, actualCarCount, resolvedAt, 0, true);
    }
}
