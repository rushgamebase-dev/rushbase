// ─── Types ────────────────────────────────────────────────────────────────────

export interface Bet {
  id: string;
  wallet: string;
  shortWallet: string;
  side: "over" | "under";
  amount: number;
  txHash: string;
  timestamp: number;
  timeAgo: string;
}

export interface ChatMessage {
  id: string;
  username: string;
  color: string;
  text: string;
  timestamp: number;
}

export interface RoundResult {
  roundId: number;
  result: "over" | "under";
  actualCount: number;
  threshold: number;
  pool: number;
  resolvedAt: number;
}

export interface Tile {
  id: number;
  owner: string | null;
  price: number;
  isActive: boolean;
  pendingFees: number;
  isMine: boolean;
}

export interface LiveMarket {
  roundId: number;
  status: "open" | "locked" | "resolving" | "resolved";
  vehicleCount: number;
  threshold: number;
  timeLeft: number;
  totalDuration: number;
  overPool: number;
  underPool: number;
  totalPool: number;
  overOdds: number;
  underOdds: number;
  overPct: number;
  underPct: number;
  bettors: number;
  recentBets: Bet[];
  roundHistory: RoundResult[];
}

export interface ProfileBet {
  id: string;
  market: string;
  side: "over" | "under";
  amount: number;
  result: "win" | "loss" | "pending";
  pnl: number;
  txHash: string;
  timestamp: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function shortAddress(addr: string) {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

export function timeAgo(ts: number) {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}
