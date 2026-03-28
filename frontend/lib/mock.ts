"use client";

import { useState, useCallback } from "react";
import { FACTORY_ADDRESS } from "./contracts";

// True ONLY when no factory address is configured — fall back to mock data entirely.
// When FACTORY_ADDRESS is set but no active market exists, the app shows a
// "Waiting for next round..." state rather than mock market data.
export const IS_DEMO_MODE = !FACTORY_ADDRESS;

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shortAddress(addr: string) {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

function timeAgo(ts: number) {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

// ─── useLiveMarket hook ───────────────────────────────────────────────────────
// @deprecated — Returns empty/zero state. Real data comes from useMarketContract.

export function useLiveMarket(): LiveMarket {
  return {
    roundId: 0,
    status: "open",
    vehicleCount: 0,
    threshold: 0,
    timeLeft: 0,
    totalDuration: 300,
    overPool: 0,
    underPool: 0,
    totalPool: 0,
    overOdds: 0,
    underOdds: 0,
    overPct: 0,
    underPct: 0,
    bettors: 0,
    recentBets: [],
    roundHistory: [],
  };
}

// ─── useChat hook ─────────────────────────────────────────────────────────────
// @deprecated — Returns empty messages. No fake chat messages.

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [onlineCount] = useState(0);

  const sendMessage = useCallback((text: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: `chat-user-${Date.now()}`,
        username: "you",
        color: "#00ff88",
        text,
        timestamp: Date.now(),
      },
    ].slice(-60));
  }, []);

  return { messages, onlineCount, sendMessage };
}

// ─── useTiles hook ────────────────────────────────────────────────────────────
// @deprecated — Returns empty tile data. Real data comes from useTilesContract.

export function useTiles() {
  const tiles: Tile[] = Array.from({ length: 100 }, (_, i) => ({
    id: i,
    owner: null,
    price: 0.01,
    isActive: false,
    pendingFees: 0,
    isMine: false,
  }));

  return {
    tiles,
    myAddress: "",
    myTileCount: 0,
    totalPendingFees: 0,
    activeTileCount: 0,
    totalDistributed: 0,
    treasuryBalance: 0,
  };
}

// ─── Mock profile data ────────────────────────────────────────────────────────
// @deprecated — Returns empty profile. Real data should come from on-chain events.

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

export function useMockProfile(address: string) {
  return {
    address,
    shortAddress: shortAddress(address),
    totalBets: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    totalPnl: 0,
    tilesOwned: 0,
    bets: [] as ProfileBet[],
  };
}

// ─── Platform stats ───────────────────────────────────────────────────────────
// @deprecated — All zero. Real data should come from contracts / indexer.

export const PLATFORM_STATS = {
  totalVolume: 0,
  marketsResolved: 0,
  uniqueBettors: 0,
  feesDistributed: 0,
  avgPoolSize: 0,
  biggestRound: 0,
  avgBettorsPerRound: 0,
  volume24h: 0,
};

// ─── Utility exports ──────────────────────────────────────────────────────────

export { shortAddress, timeAgo };
export const MY_MOCK_ADDRESS = "";
