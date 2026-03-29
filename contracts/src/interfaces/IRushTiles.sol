// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IRushTiles - Interface for the RushTiles prediction market land contract
interface IRushTiles {

    // ── Structs ──────────────────────────────────────────────────────────

    struct TileData {
        address owner;
        uint80  price;
        uint96  deposit;
        uint40  lastTaxTime;
        uint40  lastBuyoutTime;
    }

    struct PlayerState {
        uint128 rewardSnapshot;
        uint96  accumulatedFees;
        uint8   tileCount;
        uint8[5] tilesOwned;
    }

    // ── Events ───────────────────────────────────────────────────────────

    event TileClaimed(
        uint8 indexed tileIndex,
        address indexed owner,
        uint80 price,
        uint96 deposit
    );

    event TileBuyout(
        uint8 indexed tileIndex,
        address indexed newOwner,
        address indexed prevOwner,
        uint80 effectivePrice,
        uint80 newPrice,
        uint256 buyoutFee,
        uint256 appreciationTax
    );

    event TileAbandoned(
        uint8 indexed tileIndex,
        address indexed owner,
        uint96 depositReturned
    );

    event PriceChanged(
        uint8 indexed tileIndex,
        uint80 oldPrice,
        uint80 newPrice,
        uint256 appreciationTax
    );

    event DepositAdded(uint8 indexed tileIndex, uint96 amount);
    event DepositWithdrawn(uint8 indexed tileIndex, uint96 amount);
    event ClaimFeeCollected(uint8 indexed tileIndex, uint96 fee, uint96 devCut);
    event TaxCollected(uint8 indexed tileIndex, uint96 taxAmount, uint96 devCut);
    event TileForeclosed(uint8 indexed tileIndex, address indexed formerOwner);
    event FeesDistributed(uint96 amount);
    event FeesClaimed(address indexed player, uint96 amount);
    event DevFeesClaimed(address indexed devWallet, uint96 amount);

    // ── Errors ───────────────────────────────────────────────────────────

    error NotAuthority();
    error Paused();
    error InvalidTile();
    error TileAlreadyOwned();
    error TileNotOwned();
    error NotTileOwner();
    error CannotBuyoutSelf();
    error MaxTilesReached();
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
    error InvalidTarget();
    error EmergencyTimelockNotMet();

    event EmergencyWithdraw(address indexed to, uint256 amount);
    event MemeStreamReceived(address indexed nft, uint256 tokenId);
    event FlaunchFeesClaimed(address indexed feeEscrow, uint256 amount);
}
