// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "forge-std/interfaces/IERC20.sol";

/**
 * @title PredictionMarket
 * @notice A single prediction market instance where users bet on car count ranges.
 *         Created by MarketFactory. ETH collateral only for Rush MVP.
 *
 *  States: OPEN → LOCKED → RESOLVED
 *          OPEN/LOCKED → CANCELLED
 */
contract PredictionMarket {
    // ─── Types ───────────────────────────────────────────────────────────

    enum MarketState { OPEN, LOCKED, RESOLVED, CANCELLED }

    struct Range {
        uint256 minCars;   // inclusive
        uint256 maxCars;   // inclusive (use type(uint256).max for "16+")
        string  label;     // e.g. "0-5", "6-10", "11-15", "16+"
    }

    struct Bet {
        uint256 rangeIndex;
        uint256 amount;
        bool    claimed;
    }

    // ─── State ───────────────────────────────────────────────────────────

    address public immutable factory;
    address public immutable oracle;         // authorized to resolve/lock/cancel
    address public immutable feeRecipient;

    // USDC support (address(0) = ETH mode)
    IERC20  public immutable bettingToken;
    bool    public immutable isTokenMode;

    string  public streamUrl;
    string  public description;
    uint256 public immutable roundDurationSecs;
    uint256 public immutable minBet;
    uint256 public immutable maxBet;
    uint256 public immutable feeBps; // basis points, e.g. 500 = 5%
    uint256 public immutable disputeWindowSecs; // kept for ABI compatibility, always 0

    uint256 public immutable createdAt;
    uint256 public lockTime;   // when betting closes
    uint256 public resolvedAt;

    MarketState public state;
    uint256 public winningRangeIndex;
    uint256 public actualCarCount;
    bytes32 public attestationHash; // reference to DataAttestation

    Range[] public ranges;

    uint256 public totalPool;
    mapping(uint256 => uint256) public poolByRange;  // rangeIndex => total
    mapping(address => Bet[])   public betsByUser;

    uint256 public totalBettors;
    uint256 public feeCollected;

    address[] public bettorList;                       // all unique bettors
    mapping(address => bool) public hasBet;            // dedup tracker

    // ─── Events ──────────────────────────────────────────────────────────

    event BetPlaced(address indexed user, uint256 rangeIndex, uint256 amount);
    event MarketLocked(uint256 lockTime);
    event MarketResolved(uint256 winningRangeIndex, uint256 actualCarCount);
    event WinningsClaimed(address indexed user, uint256 amount);
    event MarketCancelled();
    event Refunded(address indexed user, uint256 amount);

    // ─── Modifiers ───────────────────────────────────────────────────────

    modifier onlyOracle()   { require(msg.sender == oracle, "NOT_ORACLE"); _; }
    modifier onlyFactory()  { require(msg.sender == factory, "NOT_FACTORY"); _; }
    modifier inState(MarketState s) { require(state == s, "WRONG_STATE"); _; }

    // ─── Constructor Params ─────────────────────────────────────────────

    struct MarketParams {
        address oracle;
        address disputeManager;     // unused in MVP, kept for struct compat
        address feeRecipient;
        address bettingToken;       // address(0) for ETH
        string  streamUrl;
        string  description;
        uint256 roundDurationSecs;
        uint256 minBet;
        uint256 maxBet;
        uint256 feeBps;
        uint256 disputeWindowSecs;  // unused in MVP, always 0
        string[] rangeLabels;
        uint256[] rangeMins;
        uint256[] rangeMaxs;
    }

    // ─── Constructor ─────────────────────────────────────────────────────

    constructor(MarketParams memory p) {
        require(p.rangeLabels.length > 0, "NO_RANGES");
        require(
            p.rangeLabels.length == p.rangeMins.length &&
            p.rangeMins.length == p.rangeMaxs.length,
            "RANGE_MISMATCH"
        );
        require(p.feeBps <= 2000, "FEE_TOO_HIGH"); // max 20%

        factory = msg.sender;
        oracle = p.oracle;
        feeRecipient = p.feeRecipient;

        if (p.bettingToken != address(0)) {
            bettingToken = IERC20(p.bettingToken);
            isTokenMode = true;
        }

        streamUrl = p.streamUrl;
        description = p.description;
        roundDurationSecs = p.roundDurationSecs;
        minBet = p.minBet;
        maxBet = p.maxBet;
        feeBps = p.feeBps;
        disputeWindowSecs = 0; // no dispute window in MVP

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

    // ─── Core Functions ──────────────────────────────────────────────────

    /**
     * @notice Place a bet on a car count range (ETH mode — send ETH with tx)
     * @param rangeIndex Index of the range to bet on
     */
    function placeBet(uint256 rangeIndex) external payable inState(MarketState.OPEN) {
        require(!isTokenMode, "USE_placeBetToken");
        require(block.timestamp < lockTime, "BETTING_CLOSED");
        require(rangeIndex < ranges.length, "INVALID_RANGE");
        require(msg.value >= minBet, "BET_TOO_LOW");
        require(maxBet == 0 || msg.value <= maxBet, "BET_TOO_HIGH");

        _recordBet(msg.sender, rangeIndex, msg.value);
    }

    /**
     * @notice Place a bet on a car count range (USDC/token mode — approve first)
     * @param rangeIndex Index of the range to bet on
     * @param amount     Amount of tokens to bet
     */
    function placeBetToken(uint256 rangeIndex, uint256 amount) external inState(MarketState.OPEN) {
        require(isTokenMode, "USE_placeBet");
        require(block.timestamp < lockTime, "BETTING_CLOSED");
        require(rangeIndex < ranges.length, "INVALID_RANGE");
        require(amount >= minBet, "BET_TOO_LOW");
        require(maxBet == 0 || amount <= maxBet, "BET_TOO_HIGH");

        bool success = bettingToken.transferFrom(msg.sender, address(this), amount);
        require(success, "TRANSFER_FAILED");

        _recordBet(msg.sender, rangeIndex, amount);
    }

    function _recordBet(address user, uint256 rangeIndex, uint256 amount) internal {
        betsByUser[user].push(Bet({
            rangeIndex: rangeIndex,
            amount: amount,
            claimed: false
        }));

        poolByRange[rangeIndex] += amount;
        totalPool += amount;
        totalBettors++;

        if (!hasBet[user]) {
            hasBet[user] = true;
            bettorList.push(user);
        }

        emit BetPlaced(user, rangeIndex, amount);
    }

    /**
     * @notice Lock the market (no more bets). Called by oracle.
     */
    function lockMarket() external onlyOracle inState(MarketState.OPEN) {
        state = MarketState.LOCKED;
        lockTime = block.timestamp;
        emit MarketLocked(lockTime);
    }

    /**
     * @notice Resolve the market with the actual car count (oracle only)
     * @param _actualCarCount The observed car count
     */
    function resolveMarket(uint256 _actualCarCount) external onlyOracle {
        require(
            state == MarketState.OPEN || state == MarketState.LOCKED,
            "WRONG_STATE"
        );

        // Auto-lock if still open
        if (state == MarketState.OPEN) {
            state = MarketState.LOCKED;
            lockTime = block.timestamp;
        }

        actualCarCount = _actualCarCount;

        // Find winning range
        bool found = false;
        for (uint256 i = 0; i < ranges.length; i++) {
            if (_actualCarCount >= ranges[i].minCars && _actualCarCount <= ranges[i].maxCars) {
                winningRangeIndex = i;
                found = true;
                break;
            }
        }
        require(found, "NO_MATCHING_RANGE");

        // Calculate fee
        uint256 fee = (totalPool * feeBps) / 10_000;
        feeCollected = fee;

        // Update state BEFORE external call (reentrancy protection)
        state = MarketState.RESOLVED;
        resolvedAt = block.timestamp;

        // Transfer fee (after state change)
        if (fee > 0 && feeRecipient != address(0)) {
            _transfer(feeRecipient, fee);
        }

        emit MarketResolved(winningRangeIndex, _actualCarCount);
    }

    /**
     * @notice Claim winnings for all winning bets of the caller.
     *         Claims are available immediately after resolution (no dispute window).
     */
    function claimWinnings() external inState(MarketState.RESOLVED) {
        uint256 winPool = poolByRange[winningRangeIndex];
        require(winPool > 0, "NO_WINNERS");

        uint256 distributable = totalPool - feeCollected;
        uint256 totalClaim = 0;

        Bet[] storage userBets = betsByUser[msg.sender];
        for (uint256 i = 0; i < userBets.length; i++) {
            if (userBets[i].rangeIndex == winningRangeIndex && !userBets[i].claimed) {
                userBets[i].claimed = true;
                // Proportional share: (userBet / winPool) * distributable
                totalClaim += (userBets[i].amount * distributable) / winPool;
            }
        }

        require(totalClaim > 0, "NOTHING_TO_CLAIM");

        _transfer(msg.sender, totalClaim);

        emit WinningsClaimed(msg.sender, totalClaim);
    }

    /**
     * @notice Claim winnings on behalf of another user. Anyone can call.
     *         Enables the oracle to auto-distribute after resolution.
     */
    function claimWinningsFor(address user) public inState(MarketState.RESOLVED) {
        uint256 winPool = poolByRange[winningRangeIndex];
        if (winPool == 0) return;

        uint256 distributable = totalPool - feeCollected;
        uint256 totalClaim = 0;

        Bet[] storage userBets = betsByUser[user];
        for (uint256 i = 0; i < userBets.length; i++) {
            if (userBets[i].rangeIndex == winningRangeIndex && !userBets[i].claimed) {
                userBets[i].claimed = true;
                totalClaim += (userBets[i].amount * distributable) / winPool;
            }
        }

        if (totalClaim > 0) {
            bool ok = _safeTransfer(user, totalClaim);
            if (!ok) {
                // Recipient rejected ETH (contract without receive).
                // Send to treasury so funds are never stuck.
                _transfer(feeRecipient, totalClaim);
            }
            emit WinningsClaimed(user, totalClaim);
        }
    }

    /**
     * @notice Distribute winnings to ALL winners in one call.
     *         Oracle calls this right after resolveMarket().
     *         Uses _safeTransfer so one failing recipient doesn't block others.
     */
    function distributeAll() external inState(MarketState.RESOLVED) {
        for (uint256 i = 0; i < bettorList.length; i++) {
            claimWinningsFor(bettorList[i]);
        }
    }

    /**
     * @notice Cancel market and allow refunds (oracle only)
     */
    function cancelMarket() external onlyOracle {
        require(state != MarketState.RESOLVED, "ALREADY_RESOLVED");
        state = MarketState.CANCELLED;
        emit MarketCancelled();
    }

    /**
     * @notice Refund all bets for a user in a cancelled market
     */
    function refund() external inState(MarketState.CANCELLED) {
        Bet[] storage userBets = betsByUser[msg.sender];
        uint256 totalRefund = 0;

        for (uint256 i = 0; i < userBets.length; i++) {
            if (!userBets[i].claimed) {
                userBets[i].claimed = true;
                totalRefund += userBets[i].amount;
            }
        }

        require(totalRefund > 0, "NOTHING_TO_REFUND");

        _transfer(msg.sender, totalRefund);

        emit Refunded(msg.sender, totalRefund);
    }

    // ─── Internal ───────────────────────────────────────────────────────

    function _transfer(address to, uint256 amount) internal {
        if (isTokenMode) {
            bool success = bettingToken.transfer(to, amount);
            require(success, "TOKEN_TRANSFER_FAILED");
        } else {
            (bool sent,) = to.call{value: amount}("");
            require(sent, "TRANSFER_FAILED");
        }
    }

    /// @dev Same as _transfer but does NOT revert on failure.
    ///      Used by distributeAll so one bad recipient can't block everyone.
    function _safeTransfer(address to, uint256 amount) internal returns (bool) {
        if (isTokenMode) {
            try bettingToken.transfer(to, amount) returns (bool success) {
                return success;
            } catch {
                return false;
            }
        } else {
            (bool sent,) = to.call{value: amount}("");
            return sent;
        }
    }

    // ─── View Functions ──────────────────────────────────────────────────

    function getRangeCount() external view returns (uint256) {
        return ranges.length;
    }

    function getRange(uint256 index) external view returns (uint256 minCars, uint256 maxCars, string memory label) {
        require(index < ranges.length, "INVALID_INDEX");
        Range storage r = ranges[index];
        return (r.minCars, r.maxCars, r.label);
    }

    function getAllRanges() external view returns (Range[] memory) {
        return ranges;
    }

    function getUserBets(address user) external view returns (Bet[] memory) {
        return betsByUser[user];
    }

    function getBettorList() external view returns (address[] memory) {
        return bettorList;
    }

    function getUserClaimable(address user) external view returns (uint256) {
        if (state != MarketState.RESOLVED) return 0;

        uint256 winPool = poolByRange[winningRangeIndex];
        if (winPool == 0) return 0;

        uint256 distributable = totalPool - feeCollected;
        uint256 claimable = 0;

        Bet[] storage userBets = betsByUser[user];
        for (uint256 i = 0; i < userBets.length; i++) {
            if (userBets[i].rangeIndex == winningRangeIndex && !userBets[i].claimed) {
                claimable += (userBets[i].amount * distributable) / winPool;
            }
        }
        return claimable;
    }

    function isClaimable() external view returns (bool) {
        return state == MarketState.RESOLVED;
    }

    function getMarketInfo() external view returns (
        string memory _streamUrl,
        string memory _description,
        MarketState _state,
        uint256 _totalPool,
        uint256 _lockTime,
        uint256 _rangeCount
    ) {
        return (
            streamUrl,
            description,
            state,
            totalPool,
            lockTime,
            ranges.length
        );
    }

    function getMarketResult() external view returns (
        uint256 _totalBettors,
        uint256 _winningRangeIndex,
        uint256 _actualCarCount,
        uint256 _resolvedAt,
        uint256 _disputeWindowSecs,
        bool    _isTokenMode
    ) {
        return (
            totalBettors,
            winningRangeIndex,
            actualCarCount,
            resolvedAt,
            disputeWindowSecs,
            isTokenMode
        );
    }
}
