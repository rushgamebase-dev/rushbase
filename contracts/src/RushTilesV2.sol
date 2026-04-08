// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title RushTiles V2 — Series 2 tile economy for Rush
/// @notice 100 tiles. Two tiers: Normal (0.1 ETH, 1 share) and Founder (0.5 ETH, 5 shares).
///         Harberger tax model. Founder tiles cannot be bought out but still pay tax.
///         Appreciation tax, buyout fee, claim fee → 100% dev.
///         Harberger tax → 70% dev / 30% holders.
///         External ETH via receive() → 100% holders.
contract RushTilesV2 is ReentrancyGuard {

    // ── Constants ─────────────────────────────────────────────────────────
    uint256 public constant GRID_SIZE             = 100;
    uint80  public constant NORMAL_PRICE          = 0.1 ether;
    uint80  public constant FOUNDER_PRICE         = 0.5 ether;
    uint80  public constant MIN_TILE_PRICE        = 0.01 ether;
    uint256 public constant MAX_PRICE_INCREASE    = 3;
    uint8   public constant FOUNDER_SHARES        = 5;
    uint8   public constant NORMAL_SHARES         = 1;

    // Harberger tax
    uint256 public constant TAX_RATE_BPS          = 500;         // 5% per week
    uint256 public constant TAX_PERIOD            = 604_800;     // 1 week
    uint256 public constant DEV_TAX_SHARE_BPS     = 7000;        // 70% of tax → dev

    // Buyout / appreciation / claim fees → 100% dev
    uint256 public constant BUYOUT_FEE_BPS        = 1000;        // 10% of effective price
    uint256 public constant APPRECIATION_TAX_BPS  = 3000;        // 30% of price increase
    uint256 public constant CLAIM_FEE_BPS         = 1000;        // 10% of declared price (2nd+)

    // Price decay
    uint256 public constant PRICE_DECAY_BPS       = 2000;        // 20% per 2 weeks
    uint256 public constant PRICE_DECAY_PERIOD    = 1_209_600;

    // Reward precision
    uint256 public constant REWARD_PRECISION      = 1e18;

    // Emergency
    uint256 public constant EMERGENCY_TIMELOCK    = 30 days;

    // ── Structs ───────────────────────────────────────────────────────────
    struct TileData {
        address owner;
        uint80  price;
        uint96  deposit;
        uint40  lastTaxTime;
        uint40  lastBuyoutTime;
        bool    isFounder;
    }

    struct PlayerState {
        uint128 rewardSnapshot;
        uint96  accumulatedFees;
        uint32  shareCount;
        uint8   tileCount;
    }

    // ── Storage ───────────────────────────────────────────────────────────
    address public immutable authority;
    address public devWallet;
    bool    public paused;

    uint128 public globalRewardPerShare;
    uint96  public devPending;
    uint96  public treasuryBalance;
    uint128 public totalShares;

    uint96  public totalDistributed;
    uint96  public totalTaxCollected;
    uint96  public totalBuyoutVolume;
    uint32  public totalBuyouts;
    uint32  public totalClaims;
    uint40  public lastGlobalActivity;

    TileData[100] internal tiles;
    mapping(address => PlayerState) internal players;
    mapping(address => uint8[]) internal playerTiles;

    // ── Events ────────────────────────────────────────────────────────────
    event TileClaimed(uint8 indexed tileIndex, address indexed owner, uint80 price, bool isFounder, uint96 deposit);
    event TileBuyout(uint8 indexed tileIndex, address indexed newOwner, address indexed prevOwner, uint80 effectivePrice, uint80 newPrice, uint256 buyoutFee, uint256 appreciationTax);
    event TileAbandoned(uint8 indexed tileIndex, address indexed owner, uint96 depositReturned);
    event PriceChanged(uint8 indexed tileIndex, uint80 oldPrice, uint80 newPrice, uint256 appreciationTax);
    event DepositAdded(uint8 indexed tileIndex, uint96 amount);
    event DepositWithdrawn(uint8 indexed tileIndex, uint96 amount);
    event TaxCollected(uint8 indexed tileIndex, uint96 taxAmount, uint96 devCut);
    event TileForeclosed(uint8 indexed tileIndex, address indexed formerOwner);
    event FeesDistributed(uint96 amount);
    event FeesClaimed(address indexed player, uint96 amount);
    event DevFeesClaimed(address indexed devWallet, uint96 amount);
    event EmergencyWithdraw(address indexed to, uint256 amount);

    // ── Errors ────────────────────────────────────────────────────────────
    error NotAuthority();
    error Paused();
    error InvalidTile();
    error TileAlreadyOwned();
    error TileNotOwned();
    error NotTileOwner();
    error CannotBuyoutFounder();
    error CannotBuyoutSelf();
    error InsufficientDeposit();
    error InsufficientPayment();
    error PriceIncreaseTooLarge();
    error ZeroPriceNotAllowed();
    error WithdrawExceedsAvailable();
    error ZeroAmount();
    error ZeroAddress();
    error NoFeesToClaim();
    error NoDevFees();
    error TransferFailed();
    error EmergencyTimelockNotMet();

    // ── Modifiers ─────────────────────────────────────────────────────────
    modifier onlyAuthority() { if (msg.sender != authority) revert NotAuthority(); _; }
    modifier whenNotPaused() { if (paused) revert Paused(); _; }
    modifier validTile(uint8 tileIndex) { if (tileIndex >= GRID_SIZE) revert InvalidTile(); _; }

    // ── Constructor ───────────────────────────────────────────────────────
    constructor(address _devWallet) {
        if (_devWallet == address(0)) revert ZeroAddress();
        authority = msg.sender;
        devWallet = _devWallet;
        lastGlobalActivity = uint40(block.timestamp);
    }

    // ── Tile Actions ──────────────────────────────────────────────────────

    /// @notice Claim a tile. 0.1 ETH = Normal (1 share), 0.5 ETH = Founder (5 shares).
    function claimTile(uint8 tileIndex, uint80 price, bool founder)
        external payable nonReentrant whenNotPaused validTile(tileIndex)
    {
        TileData storage tile = tiles[tileIndex];
        if (tile.owner != address(0)) revert TileAlreadyOwned();
        if (price < MIN_TILE_PRICE) revert ZeroPriceNotAllowed();

        PlayerState storage player = players[msg.sender];

        uint96 tierPrice = founder ? uint96(FOUNDER_PRICE) : uint96(NORMAL_PRICE);

        // Claim fee: 10% of declared price on 2nd+ tile → 100% dev
        uint96 claimFee = player.tileCount > 0
            ? uint96(_bps(price, CLAIM_FEE_BPS))
            : 0;

        // Minimum deposit: 1 week of tax
        uint96 minDeposit = uint96(_bps(price, TAX_RATE_BPS));

        if (msg.value < uint256(tierPrice) + uint256(claimFee) + uint256(minDeposit)) revert InsufficientDeposit();

        uint96 depositAmount = uint96(msg.value) - tierPrice - claimFee;

        // Tier price + claim fee → 100% dev
        devPending += tierPrice + claimFee;

        // Settle before share change
        _settlePlayerFees(player);

        uint40 now_ = uint40(block.timestamp);
        tile.owner = msg.sender;
        tile.price = price;
        tile.deposit = depositAmount;
        tile.lastTaxTime = now_;
        tile.lastBuyoutTime = now_;
        tile.isFounder = founder;

        uint8 shares = founder ? FOUNDER_SHARES : NORMAL_SHARES;
        player.shareCount += shares;
        player.tileCount++;
        playerTiles[msg.sender].push(tileIndex);
        totalShares += shares;

        unchecked { totalClaims++; }
        lastGlobalActivity = now_;

        emit TileClaimed(tileIndex, msg.sender, price, founder, depositAmount);
    }

    /// @notice Buyout a normal tile. Founder tiles cannot be bought out.
    function buyoutTile(uint8 tileIndex, uint80 newPrice)
        external payable nonReentrant whenNotPaused validTile(tileIndex)
    {
        TileData storage tile = tiles[tileIndex];
        if (tile.owner == address(0)) revert TileNotOwned();
        if (tile.owner == msg.sender) revert CannotBuyoutSelf();
        if (tile.isFounder) revert CannotBuyoutFounder();
        if (newPrice < MIN_TILE_PRICE) revert ZeroPriceNotAllowed();

        _applyTax(tileIndex);
        if (tile.owner == address(0)) revert TileNotOwned();

        uint40 now_ = uint40(block.timestamp);
        uint80 effPrice = _effectivePrice(tile.price, tile.lastBuyoutTime, now_);

        if (newPrice > uint80(uint256(effPrice) * MAX_PRICE_INCREASE)) {
            revert PriceIncreaseTooLarge();
        }

        // All fees → 100% dev
        uint256 buyoutFee = _bps(effPrice, BUYOUT_FEE_BPS);
        uint256 appTax = newPrice > effPrice
            ? _bps(uint256(newPrice) - uint256(effPrice), APPRECIATION_TAX_BPS)
            : 0;

        uint96 minDeposit = uint96(_bps(newPrice, TAX_RATE_BPS));
        uint256 totalCost = uint256(effPrice) + buyoutFee + appTax + uint256(minDeposit);
        if (msg.value < totalCost) revert InsufficientPayment();

        uint96 newDeposit = uint96(msg.value - uint256(effPrice) - buyoutFee - appTax);

        // 100% buyout + appreciation → dev
        devPending += uint96(buyoutFee + appTax);

        address seller = tile.owner;
        uint96 sellerDeposit = tile.deposit;
        uint256 sellerPayout = uint256(effPrice) + uint256(sellerDeposit);

        // Settle both
        PlayerState storage sellerState = players[seller];
        PlayerState storage buyerState = players[msg.sender];
        _settlePlayerFees(sellerState);
        _settlePlayerFees(buyerState);

        // Remove from seller (normal tile = 1 share)
        _removeTileFromPlayer(seller, tileIndex);
        sellerState.shareCount -= NORMAL_SHARES;
        sellerState.tileCount--;
        totalShares -= NORMAL_SHARES;

        // Buyer gets normal tile (cannot buyout into founder)
        tile.owner = msg.sender;
        tile.price = newPrice;
        tile.deposit = newDeposit;
        tile.lastTaxTime = now_;
        tile.lastBuyoutTime = now_;
        // isFounder stays false

        buyerState.shareCount += NORMAL_SHARES;
        buyerState.tileCount++;
        playerTiles[msg.sender].push(tileIndex);
        totalShares += NORMAL_SHARES;

        unchecked {
            totalBuyoutVolume += uint96(effPrice);
            totalBuyouts++;
        }
        lastGlobalActivity = now_;

        emit TileBuyout(tileIndex, msg.sender, seller, effPrice, newPrice, buyoutFee, appTax);

        if (sellerPayout > 0) {
            _sendETH(seller, sellerPayout);
        }
    }

    /// @notice Abandon a tile.
    function abandonTile(uint8 tileIndex)
        external nonReentrant whenNotPaused validTile(tileIndex)
    {
        TileData storage tile = tiles[tileIndex];
        if (tile.owner != msg.sender) revert NotTileOwner();

        PlayerState storage player = players[msg.sender];
        _settlePlayerFees(player);
        _applyTax(tileIndex);

        if (tile.owner == address(0)) return; // foreclosed during tax

        uint96 depositReturn = tile.deposit;
        uint8 shares = tile.isFounder ? FOUNDER_SHARES : NORMAL_SHARES;

        _removeTileFromPlayer(msg.sender, tileIndex);
        player.shareCount -= shares;
        player.tileCount--;
        totalShares -= shares;

        tile.owner = address(0);
        tile.price = 0;
        tile.deposit = 0;
        tile.lastTaxTime = 0;
        tile.lastBuyoutTime = 0;
        tile.isFounder = false;

        if (depositReturn > 0) {
            _sendETH(msg.sender, depositReturn);
        }

        emit TileAbandoned(tileIndex, msg.sender, depositReturn);
    }

    /// @notice Change self-assessed price. Appreciation tax (30%) → 100% dev.
    function setPrice(uint8 tileIndex, uint80 newPrice)
        external payable whenNotPaused validTile(tileIndex)
    {
        _applyTax(tileIndex);

        TileData storage tile = tiles[tileIndex];
        if (tile.owner == address(0)) revert TileNotOwned();
        if (tile.owner != msg.sender) revert NotTileOwner();
        if (newPrice < MIN_TILE_PRICE) revert ZeroPriceNotAllowed();
        if (newPrice > uint80(uint256(tile.price) * MAX_PRICE_INCREASE)) {
            revert PriceIncreaseTooLarge();
        }

        uint80 oldPrice = tile.price;
        uint256 appTax = 0;

        if (newPrice > oldPrice) {
            appTax = _bps(uint256(newPrice) - uint256(oldPrice), APPRECIATION_TAX_BPS);
            if (msg.value < appTax) revert InsufficientPayment();
            // 100% appreciation → dev
            devPending += uint96(appTax);
            if (msg.value > appTax) {
                tile.deposit += uint96(msg.value - appTax);
            }
        } else {
            if (msg.value > 0) {
                tile.deposit += uint96(msg.value);
            }
        }

        tile.price = newPrice;
        emit PriceChanged(tileIndex, oldPrice, newPrice, appTax);
    }

    /// @notice Add deposit.
    function addDeposit(uint8 tileIndex)
        external payable whenNotPaused validTile(tileIndex)
    {
        TileData storage tile = tiles[tileIndex];
        if (tile.owner != msg.sender) revert NotTileOwner();
        if (msg.value == 0) revert ZeroAmount();
        tile.deposit += uint96(msg.value);
        emit DepositAdded(tileIndex, uint96(msg.value));
    }

    /// @notice Withdraw deposit.
    function withdrawDeposit(uint8 tileIndex, uint96 amount)
        external nonReentrant whenNotPaused validTile(tileIndex)
    {
        _applyTax(tileIndex);
        TileData storage tile = tiles[tileIndex];
        if (tile.owner == address(0)) revert TileNotOwned();
        if (tile.owner != msg.sender) revert NotTileOwner();
        if (amount == 0) revert ZeroAmount();
        if (amount > tile.deposit) revert WithdrawExceedsAvailable();
        tile.deposit -= amount;
        _sendETH(msg.sender, amount);
        emit DepositWithdrawn(tileIndex, amount);
    }

    /// @notice Trigger tax on any tile.
    function pokeTax(uint8 tileIndex)
        external nonReentrant whenNotPaused validTile(tileIndex)
    {
        _applyTax(tileIndex);
    }

    // ── Fee Operations ────────────────────────────────────────────────────

    /// @notice Distribute treasury (30% of tax) to holders.
    function distributeFees() external nonReentrant whenNotPaused {
        uint96 amount = treasuryBalance;
        if (amount == 0) revert ZeroAmount();
        treasuryBalance = 0;
        if (totalShares == 0) {
            treasuryBalance = amount;
            return;
        }
        uint256 rewardIncrease = (uint256(amount) * REWARD_PRECISION) / uint256(totalShares);
        globalRewardPerShare += uint128(rewardIncrease);
        unchecked { totalDistributed += amount; }
        emit FeesDistributed(amount);
    }

    /// @notice Claim accumulated fees.
    function claimFees() external nonReentrant {
        PlayerState storage player = players[msg.sender];
        _settlePlayerFees(player);
        uint96 amount = player.accumulatedFees;
        if (amount == 0) revert NoFeesToClaim();
        player.accumulatedFees = 0;
        _sendETH(msg.sender, amount);
        emit FeesClaimed(msg.sender, amount);
    }

    /// @notice Claim dev fees.
    function claimDevFees() external nonReentrant {
        if (msg.sender != devWallet && msg.sender != authority) revert NotAuthority();
        uint96 amount = devPending;
        if (amount == 0) revert NoDevFees();
        devPending = 0;
        _sendETH(devWallet, amount);
        emit DevFeesClaimed(devWallet, amount);
    }

    // ── Admin ─────────────────────────────────────────────────────────────

    function setPaused(bool _paused) external onlyAuthority { paused = _paused; }

    function setDevWallet(address _devWallet) external onlyAuthority {
        if (_devWallet == address(0)) revert ZeroAddress();
        devWallet = _devWallet;
    }

    function emergencyWithdraw(address to, uint256 amount) external onlyAuthority nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (block.timestamp < lastGlobalActivity + EMERGENCY_TIMELOCK) revert EmergencyTimelockNotMet();
        if (amount > address(this).balance) revert ZeroAmount();
        _sendETH(to, amount);
        emit EmergencyWithdraw(to, amount);
    }

    // ── Receive ───────────────────────────────────────────────────────────

    /// @notice Direct ETH → distributed to holders. If no holders, park in treasury.
    receive() external payable {
        if (msg.value == 0) return;
        if (totalShares > 0) {
            uint256 rewardIncrease = (msg.value * REWARD_PRECISION) / uint256(totalShares);
            globalRewardPerShare += uint128(rewardIncrease);
            unchecked { totalDistributed += uint96(msg.value); }
            emit FeesDistributed(uint96(msg.value));
        } else {
            treasuryBalance += uint96(msg.value);
        }
    }

    // ── Views ─────────────────────────────────────────────────────────────

    function getTile(uint8 tileIndex) external view validTile(tileIndex) returns (TileData memory) {
        return tiles[tileIndex];
    }

    function getAllTiles() external view returns (TileData[100] memory) {
        return tiles;
    }

    function getPlayer(address addr) external view returns (PlayerState memory) {
        return players[addr];
    }

    function getPlayerTiles(address addr) external view returns (uint8[] memory) {
        return playerTiles[addr];
    }

    function pendingFees(address addr) external view returns (uint96) {
        PlayerState storage player = players[addr];
        if (player.shareCount == 0) return player.accumulatedFees;
        uint256 delta = uint256(globalRewardPerShare) - uint256(player.rewardSnapshot);
        uint256 unsettled = (delta * uint256(player.shareCount)) / REWARD_PRECISION;
        return player.accumulatedFees + uint96(unsettled);
    }

    function effectivePrice(uint8 tileIndex) external view validTile(tileIndex) returns (uint80) {
        TileData storage tile = tiles[tileIndex];
        return _effectivePrice(tile.price, tile.lastBuyoutTime, uint40(block.timestamp));
    }

    // ── Internal: Tax ─────────────────────────────────────────────────────

    function _applyTax(uint8 tileIndex) internal {
        TileData storage tile = tiles[tileIndex];
        if (tile.owner == address(0)) return;

        uint40 now_ = uint40(block.timestamp);
        if (now_ <= tile.lastTaxTime) return;

        uint256 elapsed = uint256(now_) - uint256(tile.lastTaxTime);
        uint256 taxOwed = (uint256(tile.price) * elapsed * TAX_RATE_BPS) / (10_000 * TAX_PERIOD);

        if (taxOwed == 0 && elapsed > 0) taxOwed = 1;
        if (taxOwed == 0) { tile.lastTaxTime = now_; return; }

        if (tile.deposit >= uint96(taxOwed)) {
            tile.deposit -= uint96(taxOwed);
            tile.lastTaxTime = now_;
            // 70% dev, 30% treasury (holders)
            uint96 devCut = uint96(_bps(taxOwed, DEV_TAX_SHARE_BPS));
            devPending += devCut;
            treasuryBalance += uint96(taxOwed) - devCut;
            unchecked { totalTaxCollected += uint96(taxOwed); }
            emit TaxCollected(tileIndex, uint96(taxOwed), devCut);
        } else {
            uint96 partialTax = tile.deposit;
            if (partialTax > 0) {
                uint96 devCut = uint96(_bps(partialTax, DEV_TAX_SHARE_BPS));
                devPending += devCut;
                treasuryBalance += partialTax - devCut;
                unchecked { totalTaxCollected += partialTax; }
                emit TaxCollected(tileIndex, partialTax, devCut);
            }
            _forecloseTile(tileIndex);
        }
    }

    function _forecloseTile(uint8 tileIndex) internal {
        TileData storage tile = tiles[tileIndex];
        address formerOwner = tile.owner;
        uint8 shares = tile.isFounder ? FOUNDER_SHARES : NORMAL_SHARES;

        PlayerState storage player = players[formerOwner];
        _settlePlayerFees(player);
        _removeTileFromPlayer(formerOwner, tileIndex);
        player.shareCount -= shares;
        player.tileCount--;
        totalShares -= shares;

        tile.owner = address(0);
        tile.price = 0;
        tile.deposit = 0;
        tile.lastTaxTime = 0;
        tile.lastBuyoutTime = 0;
        tile.isFounder = false;

        emit TileForeclosed(tileIndex, formerOwner);
    }

    // ── Internal: Fee Accounting ──────────────────────────────────────────

    function _settlePlayerFees(PlayerState storage player) internal {
        if (player.shareCount == 0) {
            player.rewardSnapshot = globalRewardPerShare;
            return;
        }
        uint256 delta = uint256(globalRewardPerShare) - uint256(player.rewardSnapshot);
        if (delta > 0) {
            uint256 pending = (delta * uint256(player.shareCount)) / REWARD_PRECISION;
            player.accumulatedFees += uint96(pending);
        }
        player.rewardSnapshot = globalRewardPerShare;
    }

    // ── Internal: Player Tracking ─────────────────────────────────────────

    function _removeTileFromPlayer(address owner, uint8 tileIndex) internal {
        uint8[] storage pts = playerTiles[owner];
        for (uint256 i = 0; i < pts.length; i++) {
            if (pts[i] == tileIndex) {
                pts[i] = pts[pts.length - 1];
                pts.pop();
                return;
            }
        }
    }

    // ── Internal: Price Decay ─────────────────────────────────────────────

    function _effectivePrice(uint80 price, uint40 lastBuyoutTime, uint40 now_) internal pure returns (uint80) {
        if (price == 0 || lastBuyoutTime == 0 || now_ <= lastBuyoutTime) return price;

        uint256 elapsed = uint256(now_) - uint256(lastBuyoutTime);
        uint256 fullPeriods = elapsed / PRICE_DECAY_PERIOD;
        uint256 remaining = elapsed % PRICE_DECAY_PERIOD;

        uint256 result = uint256(price);
        uint256 decayFactor = 10_000 - PRICE_DECAY_BPS;

        uint256 maxPeriods = fullPeriods < 20 ? fullPeriods : 20;
        for (uint256 i = 0; i < maxPeriods; i++) {
            result = (result * decayFactor) / 10_000;
        }

        if (remaining > 0) {
            uint256 partialDecay = (result * PRICE_DECAY_BPS * remaining) / (10_000 * PRICE_DECAY_PERIOD);
            result = result > partialDecay ? result - partialDecay : 0;
        }

        uint256 floor = uint256(price) / 10;
        if (result < floor) result = floor;

        return uint80(result);
    }

    // ── Internal: Helpers ─────────────────────────────────────────────────

    function _bps(uint256 amount, uint256 basisPoints) internal pure returns (uint256) {
        return (amount * basisPoints) / 10_000;
    }

    function _sendETH(address to, uint256 amount) internal {
        (bool success,) = to.call{value: amount}("");
        if (!success) revert TransferFailed();
    }
}
