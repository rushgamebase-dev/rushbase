import { parseAbi } from "viem";

export const PREDICTION_MARKET_ABI = parseAbi([
  "function getMarketInfo() view returns (string description, string streamUrl, uint8 state, uint256 roundDurationSecs, uint256 minBet, uint256 maxBet, uint256 totalPool, uint256 totalBettors, uint256 createdAt)",
  "function getAllRanges() view returns ((uint256 minCars, uint256 maxCars, string label)[])",
  "function getRangeCount() view returns (uint256)",
  "function poolByRange(uint256 index) view returns (uint256)",
  "function placeBet(uint256 rangeIndex) payable",
  "function getUserBets(address user) view returns ((uint256 rangeIndex, uint256 amount)[])",
  "function getUserClaimable(address user) view returns (uint256)",
  "function claimWinnings()",
  "function state() view returns (uint8)",
  "function totalPool() view returns (uint256)",
  "event BetPlaced(address indexed user, uint256 rangeIndex, uint256 amount)",
  "event MarketResolved(uint256 winningRangeIndex, uint256 actualCount)",
]);

export const MARKET_FACTORY_ABI = parseAbi([
  "function getActiveMarkets() view returns (address[])",
  "function getMarkets() view returns (address[])",
  "function getMarketCount() view returns (uint256)",
  "function isMarket(address) view returns (bool)",
  "event MarketCreated(uint256 indexed marketIndex, address indexed marketAddress, string description, uint256 roundDurationSecs, bool isTokenMode)",
]);

// Placeholder — will be filled after deployment
export const FACTORY_ADDRESS = "" as `0x${string}`;

export const MARKET_STATES = {
  OPEN: 0,
  LOCKED: 1,
  RESOLVED: 2,
  CANCELLED: 3,
} as const;

export const STATE_LABELS: Record<number, string> = {
  0: "OPEN",
  1: "LOCKED",
  2: "RESOLVED",
  3: "CANCELLED",
};

export const STATE_COLORS: Record<number, string> = {
  0: "#00ff88",
  1: "#ffd700",
  2: "#4488ff",
  3: "#ff4444",
};
