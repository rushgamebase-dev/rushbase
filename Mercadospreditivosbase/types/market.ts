export type MarketCategory = "base-chain" | "crypto" | "social" | "community" | "other";

export type MarketStatus = "open" | "locked" | "resolved" | "cancelled";

export type MarketSort = "newest" | "ending-soon" | "most-volume" | "most-bets";

export interface Outcome {
  id: string;
  label: string;
  probability: number;
  odds: number;
  pool: bigint;
}

export interface Market {
  id: string;
  address: string;
  title: string;
  description: string;
  category: MarketCategory;
  outcomes: Outcome[];
  totalPool: bigint;
  poolByOutcome: Record<string, bigint>;
  status: MarketStatus;
  closeDate: Date;
  resolutionDate: Date;
  resolutionSource: string;
  createdAt: Date;
  icon?: string;
  isHot?: boolean;
}

export interface MarketBet {
  id: string;
  user: string;
  outcomeId: string;
  outcomeLabel: string;
  amount: number;
  amountWei: bigint;
  txHash: string;
  timestamp: number;
}

export interface PricePoint {
  timestamp: number;
  probability: number;
  volume: number;
}

export interface ActivityItem {
  id: string;
  type: "bet" | "resolution" | "creation";
  marketId: string;
  user?: string;
  outcomeLabel?: string;
  amount?: number;
  txHash?: string;
  timestamp: number;
}

export interface MarketDisplay {
  id: string;
  title: string;
  category: MarketCategory;
  icon: string;
  volume: string;
  outcomes: { label: string; prob: number; odds: number }[];
  endDate: string;
  isHot: boolean;
  liquidity: "High" | "Medium" | "Low";
  change24h: number;
  status: MarketStatus;
  totalBettors: number;
}
