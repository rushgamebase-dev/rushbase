import type { Market, Outcome, MarketDisplay, MarketCategory, MarketStatus } from "@/types/market";

export interface OutcomeRecord {
  id: string;
  label: string;
  pool: string;             // wei as string
  probability: number;      // 0-100
  odds: number;             // multiplier
}

export interface MarketRecord {
  address: string;
  title: string;
  description: string;
  category: MarketCategory;
  icon: string;
  createdAt: number;        // unix ms
  closeDate: number;        // unix ms
  resolutionDate: number;   // unix ms
  resolutionSource: string;
  status: MarketStatus;
  resolvedAt: number | null;
  cancelledAt?: number;
  cancelReason?: string;

  // Outcomes
  outcomes: OutcomeRecord[];
  winningOutcomeId: string | null;

  // Pools
  totalPool: string;        // wei as string
  totalBettors: number;
  feeCollected: string;     // wei as string

  // TX hashes
  txHashCreate: string;
  txHashResolve: string | null;

  // Flags
  isHot: boolean;
}

export interface BetRecord {
  id: string;
  user: string;
  marketAddress: string;
  outcomeId: string;
  outcomeLabel: string;
  amount: string;           // wei as string
  odds: number;
  txHash: string;
  timestamp: number;
  claimed: boolean;
  claimAmount: string | null;
}

export interface OddsSnapshot {
  marketAddress: string;
  outcomes: Array<{
    id: string;
    label: string;
    pool: string;
    probability: number;
    odds: number;
  }>;
  totalPool: string;
  timestamp: number;
  updatedAt: number;
}

export interface PlatformStats {
  totalVolume: number;        // ETH (float)
  totalMarkets: number;
  marketsResolved: number;
  marketsOpen: number;
  uniqueBettors: number;
  feesDistributed: number;    // ETH (float)
  avgPoolSize: number;        // ETH (float)
  biggestMarket: number;      // ETH (float)
  volume24h: number;          // ETH (float)
  bets24h: number;
  // legacy string fields kept for backwards compat
  totalBets?: number;
  totalVolume_wei?: string;
  volume24h_wei?: string;
  uniqueTraders?: number;
  openMarkets?: number;
  resolvedMarkets?: number;
  updatedAt?: number;
}

export interface ProfileData {
  address: string;
  totalBets: number;
  wins: number;
  losses: number;
  winRate: number;            // 0-100
  totalWagered: number;       // ETH (float)
  totalPnl: number;           // ETH (float, can be negative)
  bets: BetRecord[];
  // legacy wei string fields
  totalWagered_wei?: string;
  pnl_wei?: string;
  recentBets?: BetRecord[];
  updatedAt?: number;
}

export interface LeaderboardEntry {
  rank?: number;
  address: string;
  profit: number;             // ETH (float)
  totalBets: number;
  winRate: number;
  // legacy wei string
  profit_wei?: string;
}

export interface AuditEvent {
  id?: string;
  event: string;
  marketAddress?: string;
  actor?: string;
  data: Record<string, unknown>;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Converters: API records -> frontend types
// ---------------------------------------------------------------------------

export function apiToMarket(record: MarketRecord): Market {
  return {
    id: record.address,
    address: record.address,
    title: record.title,
    description: record.description,
    category: (record.category || "other") as MarketCategory,
    outcomes: record.outcomes.map(o => ({
      id: o.id,
      label: o.label,
      probability: o.probability,
      odds: o.odds,
      pool: BigInt(o.pool || "0"),
    })),
    totalPool: BigInt(record.totalPool || "0"),
    poolByOutcome: Object.fromEntries(
      record.outcomes.map(o => [o.label, BigInt(o.pool || "0")])
    ),
    status: record.status as any,
    closeDate: new Date(record.closeDate),
    resolutionDate: new Date(record.resolutionDate),
    resolutionSource: record.resolutionSource,
    createdAt: new Date(record.createdAt),
    icon: record.icon,
    isHot: record.isHot,
  };
}

export function apiToDisplay(record: MarketRecord): MarketDisplay {
  const pool = Number(record.totalPool || "0") / 1e18;
  let liquidity: "High" | "Medium" | "Low" = "Low";
  if (pool >= 5) liquidity = "High";
  else if (pool >= 1) liquidity = "Medium";

  const daysLeft = Math.max(0, Math.ceil((record.closeDate - Date.now()) / 86400000));
  const endDate = daysLeft === 0
    ? "Ended"
    : new Date(record.closeDate).toLocaleDateString("en-US", { day: "numeric", month: "short" });

  return {
    id: record.address,
    title: record.title,
    category: (record.category || "other") as MarketCategory,
    icon: record.icon || "\uD83D\uDCCA",
    volume: pool >= 1000 ? `${(pool / 1000).toFixed(1)}K ETH` : pool >= 1 ? `${pool.toFixed(2)} ETH` : `${pool.toFixed(4)} ETH`,
    outcomes: record.outcomes.map(o => ({ label: o.label, prob: o.probability, odds: o.odds })),
    endDate,
    isHot: record.isHot ?? false,
    liquidity,
    change24h: Math.round((Math.random() * 10 - 3) * 10) / 10,
    status: record.status as any,
    totalBettors: record.totalBettors || Math.floor(pool * 15),
  };
}
