// ─── Evidence Types ──────────────────────────────────────────────────────────

export interface EvidenceData {
  frames: string[];
  finalFrame: string | null;
  frameHashes: string[];
}

// ─── Ledger Types ────────────────────────────────────────────────────────────

export interface BetRecord {
  user: string;
  rangeIndex: number;
  rangeLabel: string;
  amount: string;       // ETH as string
  txHash: string;
  timestamp: number;
  claimed: boolean;
  claimAmount: string | null;
}

export interface MarketRecord {
  address: string;
  createdAt: number;
  resolvedAt: number | null;
  state: "open" | "locked" | "resolved" | "cancelled";
  streamUrl: string;
  description: string;
  cameraName: string;
  threshold: number;
  actualCount: number | null;
  winningRange: string | null;
  winningRangeIndex: number | null;
  totalPool: string;    // ETH
  overPool: string;
  underPool: string;
  totalBettors: number;
  feeCollected: string;
  txHashCreate: string;
  txHashResolve: string | null;
  roundNumber: number;
  bets: BetRecord[];
  evidence: EvidenceData | null;
}

export interface RoundHistoryEntry {
  roundNumber: number;
  marketAddress: string;
  result: "over" | "under";
  actualCount: number;
  threshold: number;
  totalPool: string;
  resolvedAt: number;
}

export interface PlatformStats {
  totalVolume: number;       // ETH
  marketsResolved: number;
  uniqueBettors: number;
  feesDistributed: number;   // ETH
  avgPoolSize: number;       // ETH
  biggestRound: number;      // ETH
  avgBettorsPerRound: number;
  volume24h: number;         // ETH
}

export interface ProfileData {
  address: string;
  shortAddress: string;
  totalBets: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;          // ETH
  tilesOwned: number;
  bets: BetRecord[];
}
