// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IRushTiles} from "./interfaces/IRushTiles.sol";

/// @title RushTiles - Harberger tile economy for the Rush prediction market on Base
/// @notice 10x10 grid of 100 tiles. Holders earn fees proportional to tile count (1 tile = 1 share).
///         Tax and buyout fees flow to tile holders; appreciation tax flows to the dev wallet.
///         No buildings, no levels, no activity decay — pure tile ownership.
contract RushTiles is IRushTiles, ReentrancyGuard, IERC721Receiver {

    // ── Constants ─────────────────────────────────────────────────────────

    uint256 public constant GRID_SIZE             = 100;
    uint8   public constant MAX_TILES_PER_WALLET  = 5;
    uint8   public constant EMPTY_SLOT            = 0xFF;
    uint80  public constant MIN_TILE_PRICE        = 0.01 ether;
    uint256 public constant MAX_PRICE_INCREASE    = 3;           // 3x max

    // Harberger tax: 5% per week
    uint256 public constant TAX_RATE_BPS          = 500;
    uint256 public constant TAX_PERIOD            = 604_800;     // 1 week in seconds

    // Buyout fees
    uint256 public constant BUYOUT_FEE_BPS        = 1000;        // 10% of effective price → treasury
    uint256 public constant APPRECIATION_TAX_BPS  = 3000;        // 30% of appreciation   → dev

    // Claim fee (2nd+ tile)
    uint256 public constant CLAIM_FEE_BPS         = 1000;        // 10% of declared price → treasury

    // Price decay: 20% per 2-week period
    uint256 public constant PRICE_DECAY_BPS       = 2000;
    uint256 public constant PRICE_DECAY_PERIOD    = 1_209_600;   // 2 weeks in seconds

    // Reward accounting precision
    uint256 public constant REWARD_PRECISION      = 1e18;

    // ── Storage ───────────────────────────────────────────────────────────

    address public immutable authority;
    address public devWallet;
    bool    public paused;

    // Global fee accumulator (globalRewardPerShare pattern from 4FEES)
    uint128 public globalRewardPerShare;
    uint96  public devPending;
    uint96  public treasuryBalance;

    // Tile counts
    uint16  public totalActiveTiles;

    // Lifetime stats (for frontend)
    uint96  public totalDistributed;
    uint96  public totalTaxCollected;
    uint96  public totalBuyoutVolume;
    uint32  public totalBuyouts;
    uint32  public totalClaims;
    uint40  public lastGlobalActivity;

    // Flaunch MemeStream NFT tracking
    address public memeStreamNFT;
    uint256 public memeStreamTokenId;

    uint256 public constant EMERGENCY_TIMELOCK = 90 days;

    // Tile storage: 100 tiles
    TileData[100] internal tiles;

    // Player storage
    mapping(address => PlayerState) internal players;

    // ── Modifiers ─────────────────────────────────────────────────────────

    modifier onlyAuthority() {
        if (msg.sender != authority) revert NotAuthority();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier validTile(uint8 tileIndex) {
        if (tileIndex >= GRID_SIZE) revert InvalidTile();
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────

    constructor(address _devWallet) {
        if (_devWallet == address(0)) revert ZeroAddress();
        authority = msg.sender;
        devWallet = _devWallet;
        lastGlobalActivity = uint40(block.timestamp);
    }

    // ── Tile Actions ──────────────────────────────────────────────────────

    /// @notice Claim an empty tile. First tile is free; subsequent tiles pay a 10% claim fee.
    /// @param tileIndex Tile to claim (0-99)
    /// @param price     Self-assessed price (>= MIN_TILE_PRICE)
    function claimTile(uint8 tileIndex, uint80 price)
        external payable nonReentrant whenNotPaused validTile(tileIndex)
    {
        TileData storage tile = tiles[tileIndex];
        if (tile.owner != address(0)) revert TileAlreadyOwned();
        if (price < MIN_TILE_PRICE) revert ZeroPriceNotAllowed();

        PlayerState storage player = players[msg.sender];
        _initPlayerSlots(player);
        if (player.tileCount >= MAX_TILES_PER_WALLET) revert MaxTilesReached();

        // First tile: no claim fee. Subsequent tiles: 10% of declared price → treasury
        uint96 claimFee = player.tileCount > 0
            ? uint96(_bps(price, CLAIM_FEE_BPS))
            : 0;

        // Minimum deposit: enough to cover 1 week of tax at declared price
        uint96 minDeposit = uint96(_bps(price, TAX_RATE_BPS));
        if (msg.value < uint256(minDeposit) + uint256(claimFee)) revert InsufficientDeposit();

        uint96 depositAmount = uint96(msg.value) - claimFee;

        if (claimFee > 0) {
            treasuryBalance += claimFee;
            emit ClaimFeeCollected(tileIndex, claimFee);
        }

        // Settle fees before changing share count
        _settlePlayerFees(player);

        uint40 now_ = uint40(block.timestamp);
        tile.owner         = msg.sender;
        tile.price         = price;
        tile.deposit       = depositAmount;
        tile.lastTaxTime   = now_;
        tile.lastBuyoutTime = now_;

        _addTileToPlayer(player, tileIndex);

        // Update global share count (1 tile = 1 share)
        totalActiveTiles++;
        unchecked { totalClaims++; }
        lastGlobalActivity = uint40(block.timestamp);

        emit TileClaimed(tileIndex, msg.sender, price, depositAmount);
    }

    /// @notice Buy out a tile from another holder.
    /// @param tileIndex Tile to buy (0-99)
    /// @param newPrice  New self-assessed price (>= MIN_TILE_PRICE)
    function buyoutTile(uint8 tileIndex, uint80 newPrice)
        external payable nonReentrant whenNotPaused validTile(tileIndex)
    {
        TileData storage tile = tiles[tileIndex];
        if (tile.owner == address(0)) revert TileNotOwned();
        if (tile.owner == msg.sender) revert CannotBuyoutSelf();
        if (newPrice < MIN_TILE_PRICE) revert ZeroPriceNotAllowed();

        PlayerState storage buyer = players[msg.sender];
        _initPlayerSlots(buyer);
        if (buyer.tileCount >= MAX_TILES_PER_WALLET) revert MaxTilesReached();

        // Collect pending Harberger tax first
        _applyTax(tileIndex);

        // Tax may have foreclosed the tile
        if (tile.owner == address(0)) revert TileNotOwned();

        uint40 now_ = uint40(block.timestamp);
        uint80 effPrice = _effectivePrice(tile.price, tile.lastBuyoutTime, now_);

        // Price cap: new price cannot exceed 3x effective price
        if (newPrice > uint80(uint256(effPrice) * MAX_PRICE_INCREASE)) {
            revert PriceIncreaseTooLarge();
        }

        // Fee split:
        //   buyoutFee (10% of effPrice)  → treasury (holder rewards)
        //   appTax (30% of appreciation) → dev
        uint256 buyoutFee = _bps(effPrice, BUYOUT_FEE_BPS);
        uint256 appTax = newPrice > effPrice
            ? _bps(uint256(newPrice) - uint256(effPrice), APPRECIATION_TAX_BPS)
            : 0;

        // Minimum deposit for new price: 1 week of tax
        uint96 minDeposit = uint96(_bps(newPrice, TAX_RATE_BPS));

        // Total cost = effective price + buyout fee + appreciation tax + minimum deposit
        uint256 totalCost = uint256(effPrice) + buyoutFee + appTax + uint256(minDeposit);
        if (msg.value < totalCost) revert InsufficientPayment();

        // Buyer deposit = everything above effPrice + fees
        uint96 newDeposit = uint96(msg.value - uint256(effPrice) - buyoutFee - appTax);

        devPending      += uint96(appTax);
        treasuryBalance += uint96(buyoutFee);

        address seller = tile.owner;
        uint96 sellerDeposit = tile.deposit;
        uint256 sellerPayout = uint256(effPrice) + uint256(sellerDeposit);

        // Settle fees for both parties before share counts change
        PlayerState storage sellerState = players[seller];
        _settlePlayerFees(sellerState);
        _settlePlayerFees(buyer);

        _removeTileFromPlayer(sellerState, tileIndex);
        // totalActiveTiles stays the same — one tile transferred, not removed

        tile.owner          = msg.sender;
        tile.price          = newPrice;
        tile.deposit        = newDeposit;
        tile.lastTaxTime    = now_;
        tile.lastBuyoutTime = now_;

        _addTileToPlayer(buyer, tileIndex);

        // Update stats BEFORE external call (reentrancy protection)
        unchecked {
            totalBuyoutVolume += uint96(effPrice);
            totalBuyouts++;
        }
        lastGlobalActivity = uint40(block.timestamp);

        emit TileBuyout(tileIndex, msg.sender, seller, effPrice, newPrice, buyoutFee, appTax);

        // External call LAST (checks-effects-interactions)
        if (sellerPayout > 0) {
            _sendETH(seller, sellerPayout);
        }
    }

    /// @notice Abandon ownership of a tile, recovering the remaining deposit.
    function abandonTile(uint8 tileIndex)
        external nonReentrant whenNotPaused validTile(tileIndex)
    {
        TileData storage tile = tiles[tileIndex];
        if (tile.owner != msg.sender) revert NotTileOwner();

        PlayerState storage player = players[msg.sender];

        _settlePlayerFees(player);
        _applyTax(tileIndex);

        // Tax may have triggered foreclosure
        if (tile.owner == address(0)) return;

        uint96 depositReturn = tile.deposit;

        _removeTileFromPlayer(player, tileIndex);

        tile.owner          = address(0);
        tile.price          = 0;
        tile.deposit        = 0;
        tile.lastTaxTime    = 0;
        tile.lastBuyoutTime = 0;

        totalActiveTiles--;

        if (depositReturn > 0) {
            _sendETH(msg.sender, depositReturn);
        }

        emit TileAbandoned(tileIndex, msg.sender, depositReturn);
    }

    /// @notice Change the self-assessed price of an owned tile.
    ///         If raising price, the appreciation tax (30% of the increase) must be paid.
    /// @param tileIndex Tile to reprice (0-99)
    /// @param newPrice  New self-assessed price (>= MIN_TILE_PRICE)
    function setPrice(uint8 tileIndex, uint80 newPrice)
        external payable whenNotPaused validTile(tileIndex)
    {
        // Settle tax at old price first
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
            devPending += uint96(appTax);
            // Refund any overpayment as deposit top-up
            if (msg.value > appTax) {
                tile.deposit += uint96(msg.value - appTax);
            }
        } else {
            // No tax when lowering price; any ETH sent goes to deposit
            if (msg.value > 0) {
                tile.deposit += uint96(msg.value);
            }
        }

        tile.price = newPrice;

        emit PriceChanged(tileIndex, oldPrice, newPrice, appTax);
    }

    /// @notice Add ETH to a tile's tax deposit.
    function addDeposit(uint8 tileIndex)
        external payable whenNotPaused validTile(tileIndex)
    {
        TileData storage tile = tiles[tileIndex];
        if (tile.owner != msg.sender) revert NotTileOwner();
        if (msg.value == 0) revert ZeroAmount();

        tile.deposit += uint96(msg.value);
        emit DepositAdded(tileIndex, uint96(msg.value));
    }

    /// @notice Withdraw ETH from a tile's tax deposit (tax applied first).
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

    /// @notice Permissionless: trigger Harberger tax collection on any tile.
    function pokeTax(uint8 tileIndex)
        external nonReentrant whenNotPaused validTile(tileIndex)
    {
        _applyTax(tileIndex);
    }

    // ── Fee Operations ────────────────────────────────────────────────────

    /// @notice Distribute the treasury balance to all current tile holders.
    ///         Anyone can call this; it is a permissionless distribution trigger.
    function distributeFees() external nonReentrant whenNotPaused {
        uint96 amount = treasuryBalance;
        if (amount == 0) revert ZeroAmount();

        treasuryBalance = 0;

        if (totalActiveTiles == 0) {
            // No holders yet — park it back
            treasuryBalance = amount;
            return;
        }

        // Increase the per-share accumulator; each tile holds 1 share
        uint256 rewardIncrease = (uint256(amount) * REWARD_PRECISION) / uint256(totalActiveTiles);
        globalRewardPerShare += uint128(rewardIncrease);

        unchecked { totalDistributed += amount; }

        emit FeesDistributed(amount);
    }

    /// @notice Claim accumulated fee rewards.
    function claimFees() external nonReentrant {
        PlayerState storage player = players[msg.sender];
        _settlePlayerFees(player);

        uint96 amount = player.accumulatedFees;
        if (amount == 0) revert NoFeesToClaim();

        player.accumulatedFees = 0;
        _sendETH(msg.sender, amount);

        emit FeesClaimed(msg.sender, amount);
    }

    /// @notice Claim accumulated dev fees. Callable by devWallet or authority.
    function claimDevFees() external nonReentrant {
        if (msg.sender != devWallet && msg.sender != authority) revert NotAuthority();

        uint96 amount = devPending;
        if (amount == 0) revert NoDevFees();

        devPending = 0;
        _sendETH(devWallet, amount);

        emit DevFeesClaimed(devWallet, amount);
    }

    // ── Admin ─────────────────────────────────────────────────────────────

    function setPaused(bool _paused) external onlyAuthority {
        paused = _paused;
    }

    function setDevWallet(address _devWallet) external onlyAuthority {
        if (_devWallet == address(0)) revert ZeroAddress();
        devWallet = _devWallet;
    }

    /// @notice Emergency withdraw — only after 90 days of inactivity
    function emergencyWithdraw(address to, uint256 amount) external onlyAuthority nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (block.timestamp < lastGlobalActivity + EMERGENCY_TIMELOCK) revert EmergencyTimelockNotMet();
        if (amount > address(this).balance) revert ZeroAmount();
        _sendETH(to, amount);
        emit EmergencyWithdraw(to, amount);
    }

    /// @notice Generic authority-only external call. Cannot target this contract.
    function execute(address target, uint256 value, bytes calldata data)
        external onlyAuthority nonReentrant returns (bytes memory)
    {
        if (target == address(this)) revert InvalidTarget();
        (bool ok, bytes memory result) = target.call{value: value}(data);
        if (!ok) revert TransferFailed();
        return result;
    }

    // ── View Functions ────────────────────────────────────────────────────

    function getTile(uint8 tileIndex) external view validTile(tileIndex) returns (TileData memory) {
        return tiles[tileIndex];
    }

    function getAllTiles() external view returns (TileData[100] memory) {
        return tiles;
    }

    function getPlayer(address addr) external view returns (PlayerState memory) {
        PlayerState memory p = players[addr];
        // Return normalized EMPTY_SLOT markers for uninitialized players
        if (p.tileCount == 0
            && p.tilesOwned[0] == 0
            && p.tilesOwned[1] == 0
        ) {
            for (uint8 i = 0; i < 5; i++) {
                p.tilesOwned[i] = EMPTY_SLOT;
            }
        }
        return p;
    }

    /// @notice Returns total pending fees (accumulated + unsettled) for an address.
    function pendingFees(address addr) external view returns (uint96) {
        PlayerState storage player = players[addr];
        uint256 delta = uint256(globalRewardPerShare) - uint256(player.rewardSnapshot);
        uint256 unsettled = (delta * uint256(player.tileCount)) / REWARD_PRECISION;
        return player.accumulatedFees + uint96(unsettled);
    }

    /// @notice Returns the current decay-adjusted price of a tile.
    function effectivePrice(uint8 tileIndex) external view validTile(tileIndex) returns (uint80) {
        TileData storage tile = tiles[tileIndex];
        return _effectivePrice(tile.price, tile.lastBuyoutTime, uint40(block.timestamp));
    }

    // ── Flaunch / ERC721 Integration ──────────────────────────────────────

    /// @notice Receive MemeStream NFT from Flaunch — registers it on first receive
    function onERC721Received(address, address, uint256 tokenId, bytes calldata)
        external override returns (bytes4)
    {
        if (memeStreamNFT == address(0)) {
            memeStreamNFT = msg.sender;
            memeStreamTokenId = tokenId;
            emit MemeStreamReceived(msg.sender, tokenId);
        }
        return IERC721Receiver.onERC721Received.selector;
    }

    /// @notice Claim trading fees from Flaunch FeeEscrow
    function claimFlaunchFees(address feeEscrow) external onlyAuthority nonReentrant {
        if (feeEscrow == address(0)) revert ZeroAddress();
        uint256 balBefore = address(this).balance;
        (bool ok,) = feeEscrow.call(
            abi.encodeWithSignature("withdrawFees(address,bool)", address(this), true)
        );
        if (!ok) revert TransferFailed();
        uint256 received = address(this).balance - balBefore;
        emit FlaunchFeesClaimed(feeEscrow, received);
    }

    /// @notice Transfer an ERC721 NFT out of the contract (authority only)
    function transferERC721(address nft, address to, uint256 tokenId) external onlyAuthority nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        IERC721(nft).safeTransferFrom(address(this), to, tokenId);
    }

    // ── Receive ───────────────────────────────────────────────────────────

    /// @notice Direct ETH sends are distributed immediately to tile holders.
    ///         If there are no holders, ETH is parked in the treasury.
    receive() external payable {
        if (msg.value == 0) return;
        if (totalActiveTiles > 0) {
            uint256 rewardIncrease = (msg.value * REWARD_PRECISION) / uint256(totalActiveTiles);
            globalRewardPerShare += uint128(rewardIncrease);
            unchecked { totalDistributed += uint96(msg.value); }
            emit FeesDistributed(uint96(msg.value));
        } else {
            treasuryBalance += uint96(msg.value);
        }
    }

    // ── Internal: Harberger Tax ───────────────────────────────────────────

    /// @dev Collects accrued Harberger tax from a tile's deposit.
    ///      All tax goes to the treasury (100%). Forecloses on insufficient deposit.
    function _applyTax(uint8 tileIndex) internal {
        TileData storage tile = tiles[tileIndex];
        if (tile.owner == address(0)) return;

        uint40 now_ = uint40(block.timestamp);
        if (now_ <= tile.lastTaxTime) return;

        uint256 elapsed = uint256(now_) - uint256(tile.lastTaxTime);
        uint256 taxOwed = (uint256(tile.price) * elapsed * TAX_RATE_BPS) / (10_000 * TAX_PERIOD);

        // Prevent rounding exploit: always at least 1 wei tax per non-zero elapsed
        if (taxOwed == 0 && elapsed > 0) taxOwed = 1;
        if (taxOwed == 0) {
            tile.lastTaxTime = now_;
            return;
        }

        if (tile.deposit >= uint96(taxOwed)) {
            tile.deposit    -= uint96(taxOwed);
            tile.lastTaxTime = now_;
            treasuryBalance += uint96(taxOwed);
            unchecked { totalTaxCollected += uint96(taxOwed); }
            emit TaxCollected(tileIndex, uint96(taxOwed));
        } else {
            // Insufficient deposit → foreclosure
            uint96 partialTax = tile.deposit;
            if (partialTax > 0) {
                treasuryBalance += partialTax;
                unchecked { totalTaxCollected += partialTax; }
                emit TaxCollected(tileIndex, partialTax);
            }
            _forecloseTile(tileIndex);
        }
    }

    /// @dev Removes ownership of a tile and updates all state. Called on foreclosure.
    function _forecloseTile(uint8 tileIndex) internal {
        TileData storage tile = tiles[tileIndex];
        address formerOwner = tile.owner;

        PlayerState storage player = players[formerOwner];
        _settlePlayerFees(player);
        _removeTileFromPlayer(player, tileIndex);

        tile.owner          = address(0);
        tile.price          = 0;
        tile.deposit        = 0;
        tile.lastTaxTime    = 0;
        tile.lastBuyoutTime = 0;

        totalActiveTiles--;

        emit TileForeclosed(tileIndex, formerOwner);
    }

    // ── Internal: Fee Accounting ──────────────────────────────────────────

    /// @dev Settle pending fees for a player before their share count changes.
    ///      Uses the globalRewardPerShare accumulator pattern (from 4FEES).
    function _settlePlayerFees(PlayerState storage player) internal {
        if (player.tileCount == 0) {
            player.rewardSnapshot = globalRewardPerShare;
            return;
        }
        uint256 delta = uint256(globalRewardPerShare) - uint256(player.rewardSnapshot);
        if (delta > 0) {
            uint256 pending = (delta * uint256(player.tileCount)) / REWARD_PRECISION;
            player.accumulatedFees += uint96(pending);
        }
        player.rewardSnapshot = globalRewardPerShare;
    }

    // ── Internal: Player Tile Tracking ────────────────────────────────────

    /// @dev Initialize tilesOwned slots to EMPTY_SLOT on first use.
    function _initPlayerSlots(PlayerState storage player) internal {
        if (player.tileCount == 0
            && player.tilesOwned[0] == 0
            && player.tilesOwned[1] == 0
            && player.tilesOwned[2] == 0
            && player.tilesOwned[3] == 0
            && player.tilesOwned[4] == 0
        ) {
            for (uint8 j = 0; j < 5; j++) {
                player.tilesOwned[j] = EMPTY_SLOT;
            }
        }
    }

    function _addTileToPlayer(PlayerState storage player, uint8 tileIndex) internal {
        for (uint8 i = 0; i < 5; i++) {
            if (player.tilesOwned[i] == EMPTY_SLOT) {
                player.tilesOwned[i] = tileIndex;
                player.tileCount++;
                return;
            }
        }
        revert MaxTilesReached();
    }

    function _removeTileFromPlayer(PlayerState storage player, uint8 tileIndex) internal {
        for (uint8 i = 0; i < 5; i++) {
            if (player.tilesOwned[i] == tileIndex) {
                player.tilesOwned[i] = EMPTY_SLOT;
                player.tileCount--;
                return;
            }
        }
    }

    // ── Internal: Price Decay ─────────────────────────────────────────────

    /// @dev Returns the decay-adjusted price. 20% decay per 2-week period, floor at 10% of original.
    function _effectivePrice(uint80 price, uint40 lastBuyoutTime, uint40 now_) internal pure returns (uint80) {
        if (price == 0 || lastBuyoutTime == 0 || now_ <= lastBuyoutTime) return price;

        uint256 elapsed     = uint256(now_) - uint256(lastBuyoutTime);
        uint256 fullPeriods = elapsed / PRICE_DECAY_PERIOD;
        uint256 remaining   = elapsed % PRICE_DECAY_PERIOD;

        uint256 result      = uint256(price);
        uint256 decayFactor = 10_000 - PRICE_DECAY_BPS; // 8000

        uint256 maxPeriods = _min(fullPeriods, 20);
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

    // ── Internal: Math Helpers ────────────────────────────────────────────

    function _bps(uint256 amount, uint256 basisPoints) internal pure returns (uint256) {
        return (amount * basisPoints) / 10_000;
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function _sendETH(address to, uint256 amount) internal {
        (bool success,) = to.call{value: amount}("");
        if (!success) revert TransferFailed();
    }
}
