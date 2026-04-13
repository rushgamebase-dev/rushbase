import { parseAbi } from "viem";

// ─── ERC20 ABI ──────────────────────────────────────────────────────────────

export const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

export const RUSH_TOKEN_ADDRESS = "0xB36A127dBa73F3aA7C70B4e00B7395B86A60e73b" as `0x${string}`;

// ─── MarketFactory ABI — matches MarketFactory.sol exactly ──────────────────

export const FACTORY_ABI = parseAbi([
  // State variables
  "function admin() view returns (address)",
  "function oracle() view returns (address)",
  "function feeRecipient() view returns (address)",
  "function feeBps() view returns (uint256)",
  "function markets(uint256) view returns (address)",
  "function isMarket(address) view returns (bool)",

  // Market creation
  "function createMarket(string,string,uint256,uint256,uint256,string[],uint256[],uint256[]) returns (address)",

  // Admin functions
  "function setAdmin(address)",
  "function setOracle(address)",
  "function setFeeRecipient(address)",
  "function setDefaultFee(uint256)",

  // View functions
  "function getMarketCount() view returns (uint256)",
  "function getMarkets() view returns (address[])",
  "function getMarketsByStream(string) view returns (address[])",
  "function getActiveMarkets() view returns (address[])",

  // Events (MarketCreated has 5 params including isTokenMode)
  "event MarketCreated(uint256 indexed marketIndex, address indexed marketAddress, string description, uint256 roundDurationSecs, bool isTokenMode)",
  "event AdminChanged(address indexed oldAdmin, address indexed newAdmin)",
  "event OracleChanged(address indexed oldOracle, address indexed newOracle)",
  "event FeeRecipientChanged(address indexed oldRecipient, address indexed newRecipient)",
  "event DefaultFeeChanged(uint256 oldFee, uint256 newFee)",
]);

// ─── PredictionMarket ABI — matches PredictionMarket.sol exactly ────────────

export const MARKET_ABI = parseAbi([
  // Immutable state
  "function factory() view returns (address)",
  "function oracle() view returns (address)",
  "function feeRecipient() view returns (address)",
  "function bettingToken() view returns (address)",
  "function isTokenMode() view returns (bool)",
  "function roundDurationSecs() view returns (uint256)",
  "function minBet() view returns (uint256)",
  "function maxBet() view returns (uint256)",
  "function feeBps() view returns (uint256)",
  "function disputeWindowSecs() view returns (uint256)",
  "function createdAt() view returns (uint256)",

  // Mutable state
  "function streamUrl() view returns (string)",
  "function description() view returns (string)",
  "function lockTime() view returns (uint256)",
  "function resolvedAt() view returns (uint256)",
  "function state() view returns (uint8)",
  "function winningRangeIndex() view returns (uint256)",
  "function actualCarCount() view returns (uint256)",
  "function attestationHash() view returns (bytes32)",
  "function totalPool() view returns (uint256)",
  "function poolByRange(uint256) view returns (uint256)",
  "function totalBettors() view returns (uint256)",
  "function feeCollected() view returns (uint256)",

  // Core functions
  "function placeBet(uint256) payable",
  "function placeBetToken(uint256, uint256)",
  "function lockMarket()",
  "function resolveMarket(uint256)",
  "function claimWinnings()",
  "function cancelMarket()",
  "function refund()","function refundFor(address) public","function refundAll() external",
  "function claimWinningsFor(address) public",
  "function distributeAll() external",

  // View functions
  "function getRangeCount() view returns (uint256)",
  "function getRange(uint256) view returns (uint256 minCars, uint256 maxCars, string label)",
  "function getAllRanges() view returns ((uint256 minCars, uint256 maxCars, string label)[])",
  "function getUserBets(address) view returns ((uint256 rangeIndex, uint256 amount, bool claimed)[])",
  "function getBettorList() view returns (address[])",
  "function getUserClaimable(address) view returns (uint256)",
  "function isClaimable() view returns (bool)",
  "function getMarketInfo() view returns (string _streamUrl, string _description, uint8 _state, uint256 _totalPool, uint256 _lockTime, uint256 _rangeCount)",
  "function getMarketResult() view returns (uint256 _totalBettors, uint256 _winningRangeIndex, uint256 _actualCarCount, uint256 _resolvedAt, uint256 _disputeWindowSecs, bool _isTokenMode)",

  // Events
  "event BetPlaced(address indexed user, uint256 rangeIndex, uint256 amount)",
  "event MarketLocked(uint256 lockTime)",
  "event MarketResolved(uint256 winningRangeIndex, uint256 actualCarCount)",
  "event WinningsClaimed(address indexed user, uint256 amount)",
  "event MarketCancelled()",
  "event Refunded(address indexed user, uint256 amount)",
]);

// ─── RushTiles V2 ABI ────────────────────────────────────────────────────────

export const RUSH_TILES_V2_ABI = parseAbi([
  "function claimTile(uint8 tileIndex, uint80 price, bool founder) payable",
  "function buyoutTile(uint8 tileIndex, uint80 newPrice) payable",
  "function abandonTile(uint8 tileIndex)",
  "function setPrice(uint8 tileIndex, uint80 newPrice) payable",
  "function addDeposit(uint8 tileIndex) payable",
  "function withdrawDeposit(uint8 tileIndex, uint96 amount)",
  "function pokeTax(uint8 tileIndex)",
  "function distributeFees()",
  "function claimFees()",
  "function claimDevFees()",
  "function getTile(uint8) view returns ((address owner, uint80 price, uint96 deposit, uint40 lastTaxTime, uint40 lastBuyoutTime, bool isFounder))",
  "function getAllTiles() view returns ((address owner, uint80 price, uint96 deposit, uint40 lastTaxTime, uint40 lastBuyoutTime, bool isFounder)[100])",
  "function getPlayer(address) view returns ((uint128 rewardSnapshot, uint96 accumulatedFees, uint32 shareCount, uint8 tileCount))",
  "function getPlayerTiles(address) view returns (uint8[])",
  "function pendingFees(address) view returns (uint96)",
  "function effectivePrice(uint8) view returns (uint80)",
  "function totalShares() view returns (uint128)",
  "function totalDistributed() view returns (uint96)",
  "function treasuryBalance() view returns (uint96)",
  "function devPending() view returns (uint96)",
  "function totalBuyouts() view returns (uint32)",
  "function totalClaims() view returns (uint32)",
  "function paused() view returns (bool)",
  "function NORMAL_PRICE() view returns (uint80)",
  "function FOUNDER_PRICE() view returns (uint80)",
  "function GRID_SIZE() view returns (uint256)",
]);

// ─── RushTiles ABI — matches RushTiles.sol + IRushTiles.sol exactly ─────────

export const RUSH_TILES_ABI = parseAbi([
  // Tile actions
  "function claimTile(uint8, uint80) payable",
  "function buyoutTile(uint8, uint80) payable",
  "function abandonTile(uint8)",
  "function setPrice(uint8, uint80) payable",
  "function addDeposit(uint8) payable",
  "function withdrawDeposit(uint8, uint96)",
  "function pokeTax(uint8)",

  // Fee operations
  "function distributeFees()",
  "function claimFees()",
  "function claimDevFees()",

  // Admin
  "function setPaused(bool)",
  "function setDevWallet(address)",
  "function emergencyWithdraw(address, uint256)",
  "function claimFlaunchFees(address)",
  "function transferERC721(address, address, uint256)",
  "function execute(address, uint256, bytes) returns (bytes)",

  // View functions
  "function getTile(uint8) view returns ((address owner, uint80 price, uint96 deposit, uint40 lastTaxTime, uint40 lastBuyoutTime))",
  "function getAllTiles() view returns ((address owner, uint80 price, uint96 deposit, uint40 lastTaxTime, uint40 lastBuyoutTime)[100])",
  "function getPlayer(address) view returns ((uint128 rewardSnapshot, uint96 accumulatedFees, uint8 tileCount, uint8[5] tilesOwned))",
  "function pendingFees(address) view returns (uint96)",
  "function effectivePrice(uint8) view returns (uint80)",

  // Constants
  "function GRID_SIZE() view returns (uint256)",
  "function MAX_TILES_PER_WALLET() view returns (uint8)",
  "function EMPTY_SLOT() view returns (uint8)",
  "function MIN_TILE_PRICE() view returns (uint80)",
  "function MAX_PRICE_INCREASE() view returns (uint256)",
  "function TAX_RATE_BPS() view returns (uint256)",
  "function TAX_PERIOD() view returns (uint256)",
  "function BUYOUT_FEE_BPS() view returns (uint256)",
  "function APPRECIATION_TAX_BPS() view returns (uint256)",
  "function CLAIM_FEE_BPS() view returns (uint256)",
  "function PRICE_DECAY_BPS() view returns (uint256)",
  "function PRICE_DECAY_PERIOD() view returns (uint256)",
  "function REWARD_PRECISION() view returns (uint256)",
  "function EMERGENCY_TIMELOCK() view returns (uint256)",

  // Public state
  "function authority() view returns (address)",
  "function devWallet() view returns (address)",
  "function paused() view returns (bool)",
  "function globalRewardPerShare() view returns (uint128)",
  "function devPending() view returns (uint96)",
  "function treasuryBalance() view returns (uint96)",
  "function totalActiveTiles() view returns (uint16)",
  "function totalDistributed() view returns (uint96)",
  "function totalTaxCollected() view returns (uint96)",
  "function totalBuyoutVolume() view returns (uint96)",
  "function totalBuyouts() view returns (uint32)",
  "function totalClaims() view returns (uint32)",
  "function lastGlobalActivity() view returns (uint40)",
  "function memeStreamNFT() view returns (address)",
  "function memeStreamTokenId() view returns (uint256)",

  // ERC721 receiver
  "function onERC721Received(address, address, uint256, bytes) returns (bytes4)",

  // Events from IRushTiles
  "event TileClaimed(uint8 indexed tileIndex, address indexed owner, uint80 price, uint96 deposit)",
  "event TileBuyout(uint8 indexed tileIndex, address indexed newOwner, address indexed prevOwner, uint80 effectivePrice, uint80 newPrice, uint256 buyoutFee, uint256 appreciationTax)",
  "event TileAbandoned(uint8 indexed tileIndex, address indexed owner, uint96 depositReturned)",
  "event PriceChanged(uint8 indexed tileIndex, uint80 oldPrice, uint80 newPrice, uint256 appreciationTax)",
  "event DepositAdded(uint8 indexed tileIndex, uint96 amount)",
  "event DepositWithdrawn(uint8 indexed tileIndex, uint96 amount)",
  "event ClaimFeeCollected(uint8 indexed tileIndex, uint96 fee, uint96 devCut)",
  "event TaxCollected(uint8 indexed tileIndex, uint96 taxAmount, uint96 devCut)",
  "event TileForeclosed(uint8 indexed tileIndex, address indexed formerOwner)",
  "event FeesDistributed(uint96 amount)",
  "event FeesClaimed(address indexed player, uint96 amount)",
  "event DevFeesClaimed(address indexed devWallet, uint96 amount)",
  "event EmergencyWithdraw(address indexed to, uint256 amount)",
  "event MemeStreamReceived(address indexed nft, uint256 tokenId)",
  "event FlaunchFeesClaimed(address indexed feeEscrow, uint256 amount)",
]);

// ─── Market state enum ──────────────────────────────────────────────────────

export const MARKET_STATES: Record<number, string> = {
  0: "OPEN",
  1: "LOCKED",
  2: "RESOLVED",
  3: "CANCELLED",
};

export const STATE_COLORS: Record<string, string> = {
  OPEN: "#00ff88",
  LOCKED: "#ffaa00",
  RESOLVED: "#00aaff",
  CANCELLED: "#ff4444",
};

// ─── Contract addresses — fill in after deploy ─────────────────────────────

// BurnMarket (RUSH) factory archived: 0xf3edae04f632bc4cfde9a08e06f36a17bfaee83f
export const FACTORY_ADDRESS = "0x5b04F3DFaE780A7e109066E754d27f491Af55Af9" as `0x${string}`;
export const RUSH_TILES_ADDRESS = "0x6cE3873e31Ab5440fA6AF1860F8E36110504c9C4" as `0x${string}`;
export const RUSH_TILES_V2_ADDRESS = "0x5b7b2a6AC4f3A017fb943C9F550d609174532fFF" as `0x${string}`;

// USDC on Base mainnet (for future token mode)
export const USDC_ADDRESS_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// ─── Chain configs ──────────────────────────────────────────────────────────

export const BASE_MAINNET = {
  chainId: "0x2105", // 8453
  chainIdDecimal: 8453,
  chainName: "Base",
  rpcUrls: ["https://mainnet.base.org"],
  blockExplorerUrls: ["https://basescan.org"],
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
};

export const BASE_SEPOLIA = {
  chainId: "0x14a34", // 84532
  chainIdDecimal: 84532,
  chainName: "Base Sepolia",
  rpcUrls: ["https://sepolia.base.org"],
  blockExplorerUrls: ["https://sepolia.basescan.org"],
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
};

export const LOCAL_ANVIL = {
  chainId: "0x7a69", // 31337
  chainIdDecimal: 31337,
  chainName: "Anvil Local",
  rpcUrls: ["http://127.0.0.1:8545"],
  blockExplorerUrls: [],
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
};
