"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { FACTORY_ADDRESS } from "./contracts";

// True when no contract addresses are set — all hooks fall back to mock data
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

const WALLETS = [
  "0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
  "0xdeadbeef1234567890abcdef1234567890abcdef",
  "0x742d35cc6634c0532925a3b8d4c9b8f1e6d2a7f3",
  "0xabc123def456789012345678901234567890abcd",
  "0x9f8e7d6c5b4a3928374655647382910abcdef01",
  "0x1111222233334444555566667777888899990000",
  "0xface0ff0babe12345678cafebabe9876543210fe",
  "0x0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b",
  "0xc0ffee1234567890abcdef0987654321fedcba98",
  "0xb16b00b5d00db16b00b5cafebabe00c0ffee1234",
  "0x4242424242424242424242424242424242424242",
  "0xf00dbabe1234567890abcdef1234567890f00dba",
];

const TX_HASHES = Array.from({ length: 20 }, () =>
  "0x" + Math.random().toString(16).slice(2).padEnd(64, "0")
);

function shortAddress(addr: string) {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

function timeAgo(ts: number) {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function randomBet(index: number, side?: "over" | "under"): Bet {
  const wallet = WALLETS[index % WALLETS.length];
  const betSide = side ?? (Math.random() > 0.5 ? "over" : "under");
  const amounts = [0.005, 0.01, 0.02, 0.05, 0.1, 0.15, 0.2, 0.25, 0.5];
  const amount = amounts[Math.floor(Math.random() * amounts.length)];
  const ts = Date.now() - Math.floor(Math.random() * 240000);
  return {
    id: `bet-${index}-${ts}`,
    wallet,
    shortWallet: shortAddress(wallet),
    side: betSide,
    amount,
    txHash: TX_HASHES[index % TX_HASHES.length],
    timestamp: ts,
    timeAgo: timeAgo(ts),
  };
}

function computeOdds(overPool: number, underPool: number) {
  const total = overPool + underPool;
  if (total === 0) return { overOdds: 2.0, underOdds: 2.0, overPct: 50, underPct: 50 };
  const FEE = 0.02; // 2% fee
  const net = total * (1 - FEE);
  const overOdds = overPool > 0 ? parseFloat((net / overPool).toFixed(2)) : 99;
  const underOdds = underPool > 0 ? parseFloat((net / underPool).toFixed(2)) : 99;
  const overPct = Math.round((overPool / total) * 100);
  const underPct = 100 - overPct;
  return { overOdds, underOdds, overPct, underPct };
}

// ─── Initial state ────────────────────────────────────────────────────────────

function makeInitialBets(): Bet[] {
  return Array.from({ length: 12 }, (_, i) => randomBet(i));
}

const INITIAL_HISTORY: RoundResult[] = [
  { roundId: 1240, result: "over", actualCount: 58, threshold: 52, pool: 1.2, resolvedAt: Date.now() - 300000 },
  { roundId: 1239, result: "under", actualCount: 44, threshold: 52, pool: 0.85, resolvedAt: Date.now() - 600000 },
  { roundId: 1238, result: "under", actualCount: 47, threshold: 52, pool: 1.1, resolvedAt: Date.now() - 900000 },
  { roundId: 1237, result: "over", actualCount: 61, threshold: 52, pool: 1.45, resolvedAt: Date.now() - 1200000 },
  { roundId: 1236, result: "over", actualCount: 55, threshold: 52, pool: 0.95, resolvedAt: Date.now() - 1500000 },
  { roundId: 1235, result: "under", actualCount: 39, threshold: 52, pool: 2.1, resolvedAt: Date.now() - 1800000 },
  { roundId: 1234, result: "over", actualCount: 67, threshold: 52, pool: 1.3, resolvedAt: Date.now() - 2100000 },
  { roundId: 1233, result: "under", actualCount: 48, threshold: 52, pool: 0.75, resolvedAt: Date.now() - 2400000 },
  { roundId: 1232, result: "over", actualCount: 53, threshold: 52, pool: 1.6, resolvedAt: Date.now() - 2700000 },
  { roundId: 1231, result: "under", actualCount: 41, threshold: 52, pool: 0.9, resolvedAt: Date.now() - 3000000 },
];

// ─── useLiveMarket hook ───────────────────────────────────────────────────────

export function useLiveMarket() {
  const ROUND_DURATION = 5 * 60; // 5 minutes in seconds
  const THRESHOLD = 52;

  const [vehicleCount, setVehicleCount] = useState(23);
  const [timeLeft, setTimeLeft] = useState(187);
  const [roundId, setRoundId] = useState(1241);
  const [status, setStatus] = useState<LiveMarket["status"]>("open");
  const [overPool, setOverPool] = useState(0.42);
  const [underPool, setUnderPool] = useState(0.68);
  const [bettors, setBettors] = useState(14);
  const [recentBets, setRecentBets] = useState<Bet[]>(makeInitialBets);
  const [roundHistory, setRoundHistory] = useState<RoundResult[]>(INITIAL_HISTORY);
  const betIndexRef = useRef(20);

  // Vehicle count grows during round
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (status !== "open") return;
    const interval = setInterval(() => {
      setVehicleCount((c) => {
        const rate = 0.15 + Math.random() * 0.1; // ~9-15 vehicles/min
        const increment = Math.random() < rate ? 1 : 0;
        return c + increment;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [status, timeLeft]); // timeLeft intentional: resets when round changes

  // Countdown
  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          setStatus("locked");
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Auto-resolve when locked
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (status !== "locked") return;
    const timeout = setTimeout(() => {
      setStatus("resolving");
      setTimeout(() => {
        const finalCount = vehicleCount + Math.floor(Math.random() * 5);
        const result: "over" | "under" = finalCount > THRESHOLD ? "over" : "under";

        setRoundHistory((h) => [
          {
            roundId,
            result,
            actualCount: finalCount,
            threshold: THRESHOLD,
            pool: overPool + underPool,
            resolvedAt: Date.now(),
          },
          ...h.slice(0, 9),
        ]);

        // Start new round after 3 seconds
        setTimeout(() => {
          setRoundId((r) => r + 1);
          setVehicleCount(0);
          setTimeLeft(ROUND_DURATION);
          setOverPool(0);
          setUnderPool(0);
          setBettors(0);
          setRecentBets([]);
          setStatus("open");
        }, 3000);
      }, 4000);
    }, 1000);
    return () => clearTimeout(timeout);
  }, [status]);

  // Simulate incoming bets
  useEffect(() => {
    if (status !== "open") return;
    const interval = setInterval(
      () => {
        const side: "over" | "under" = Math.random() > 0.45 ? "under" : "over";
        const newBet = randomBet(betIndexRef.current++, side);

        setRecentBets((prev) => [newBet, ...prev.slice(0, 19)]);
        setBettors((b) => b + 1);

        const amounts = [0.005, 0.01, 0.02, 0.05, 0.1, 0.2];
        const amount = amounts[Math.floor(Math.random() * amounts.length)];

        if (side === "over") {
          setOverPool((p) => parseFloat((p + amount).toFixed(4)));
        } else {
          setUnderPool((p) => parseFloat((p + amount).toFixed(4)));
        }
      },
      4000 + Math.random() * 6000
    );
    return () => clearInterval(interval);
  }, [status]);

  const odds = computeOdds(overPool, underPool);
  const totalPool = overPool + underPool;

  return {
    roundId,
    status,
    vehicleCount,
    threshold: THRESHOLD,
    timeLeft,
    totalDuration: ROUND_DURATION,
    overPool,
    underPool,
    totalPool,
    ...odds,
    bettors,
    recentBets,
    roundHistory,
  } as LiveMarket;
}

// ─── Mock chat messages ───────────────────────────────────────────────────────

const CHAT_USERS = [
  { name: "degenape", color: "#00ff88" },
  { name: "basedchad", color: "#00aaff" },
  { name: "truckwatcher", color: "#ff88aa" },
  { name: "eth_maxi", color: "#ffd700" },
  { name: "onchainonly", color: "#aa88ff" },
  { name: "gm_ser", color: "#ff8844" },
  { name: "ngmi_labs", color: "#44ffcc" },
  { name: "wagmi420", color: "#ff44ff" },
  { name: "peacebridge", color: "#88ff44" },
  { name: "0xshill", color: "#44aaff" },
];

const CHAT_MESSAGES_POOL = [
  "over easy",
  "gg",
  "truck didn't count lol",
  "UNDER gang rise up",
  "easy money fr",
  "camera lagging?",
  "LFG 52+ tonight",
  "bro this is rigged",
  "300% on under no cap",
  "free money under 52",
  "truck count is sus",
  "wen moon",
  "watching from toronto",
  "that semi just clipped the line twice",
  "OVER GANG",
  "these odds are cooked",
  "i see 3 trucks rn",
  "rush rush rush",
  "wagmi boys",
  "ngmi if you go over",
  "late night traffic low = under",
  "big bet incoming",
  "gm from base",
  "truck spotted",
  "loading up on under",
  "ez clap",
  "this oracle is based",
  "let's goo",
  "already up 0.4 eth tonight",
  "under has never failed me",
  "trust the vibes",
  "chart says under",
  "1-1 so far today",
  "who's watching the stream?",
  "count looks off tbh",
  "OVER CONFIRMED",
  "rekt again lmao",
  "gg wp",
  "close one",
  "lol what was that truck",
];

let chatIdCounter = 0;

function makeInitialChat(): ChatMessage[] {
  const msgs: ChatMessage[] = [];
  for (let i = 0; i < 15; i++) {
    const user = CHAT_USERS[i % CHAT_USERS.length];
    msgs.push({
      id: `chat-init-${i}`,
      username: user.name,
      color: user.color,
      text: CHAT_MESSAGES_POOL[Math.floor(Math.random() * CHAT_MESSAGES_POOL.length)],
      timestamp: Date.now() - (15 - i) * 8000 - Math.random() * 5000,
    });
  }
  return msgs;
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>(makeInitialChat);
  const [onlineCount, setOnlineCount] = useState(247);

  // Simulate incoming messages
  useEffect(() => {
    const interval = setInterval(
      () => {
        const user = CHAT_USERS[Math.floor(Math.random() * CHAT_USERS.length)];
        const text = CHAT_MESSAGES_POOL[Math.floor(Math.random() * CHAT_MESSAGES_POOL.length)];
        setMessages((prev) => [
          ...prev,
          {
            id: `chat-${++chatIdCounter}-${Date.now()}`,
            username: user.name,
            color: user.color,
            text,
            timestamp: Date.now(),
          },
        ].slice(-60)); // keep last 60
      },
      5000 + Math.random() * 8000
    );
    return () => clearInterval(interval);
  }, []);

  // Fluctuate online count
  useEffect(() => {
    const interval = setInterval(() => {
      setOnlineCount((c) => Math.max(150, c + Math.floor(Math.random() * 7) - 3));
    }, 12000);
    return () => clearInterval(interval);
  }, []);

  const sendMessage = useCallback((text: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: `chat-user-${++chatIdCounter}`,
        username: "you",
        color: "#00ff88",
        text,
        timestamp: Date.now(),
      },
    ].slice(-60));
  }, []);

  return { messages, onlineCount, sendMessage };
}

// ─── Mock tiles data ──────────────────────────────────────────────────────────

const MY_ADDRESS = "0xface0ff0babe12345678cafebabe9876543210fe";

export function useTiles() {
  const tiles: Tile[] = Array.from({ length: 100 }, (_, i) => {
    const isOwned = [3, 7, 12, 15, 22, 33, 44, 47, 56, 61, 72, 88, 91].includes(i);
    const isMine = [7, 22, 47, 72].includes(i);
    const owner = isMine
      ? MY_ADDRESS
      : isOwned
      ? WALLETS[i % WALLETS.length]
      : null;

    return {
      id: i,
      owner,
      price: isOwned ? parseFloat((0.005 + Math.random() * 0.05).toFixed(4)) : 0.005,
      isActive: isOwned,
      pendingFees: isMine ? parseFloat((Math.random() * 0.02).toFixed(5)) : 0,
      isMine,
    };
  });

  const myTiles = tiles.filter((t) => t.isMine);
  const totalPendingFees = myTiles.reduce((acc, t) => acc + t.pendingFees, 0);
  const activeTileCount = tiles.filter((t) => t.isActive).length;

  return {
    tiles,
    myAddress: MY_ADDRESS,
    myTileCount: myTiles.length,
    totalPendingFees: parseFloat(totalPendingFees.toFixed(5)),
    activeTileCount,
    totalDistributed: 3.24,
    treasuryBalance: 0.41,
  };
}

// ─── Mock profile data ────────────────────────────────────────────────────────

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
  const bets: ProfileBet[] = [
    { id: "1", market: "Peace Bridge #1241", side: "over", amount: 0.05, result: "win", pnl: 0.065, txHash: TX_HASHES[0], timestamp: Date.now() - 300000 },
    { id: "2", market: "Peace Bridge #1240", side: "under", amount: 0.1, result: "loss", pnl: -0.1, txHash: TX_HASHES[1], timestamp: Date.now() - 600000 },
    { id: "3", market: "Peace Bridge #1239", side: "under", amount: 0.05, result: "win", pnl: 0.047, txHash: TX_HASHES[2], timestamp: Date.now() - 900000 },
    { id: "4", market: "Peace Bridge #1238", side: "under", amount: 0.02, result: "win", pnl: 0.018, txHash: TX_HASHES[3], timestamp: Date.now() - 1200000 },
    { id: "5", market: "Peace Bridge #1237", side: "over", amount: 0.1, result: "win", pnl: 0.072, txHash: TX_HASHES[4], timestamp: Date.now() - 1500000 },
    { id: "6", market: "Peace Bridge #1236", side: "over", amount: 0.05, result: "win", pnl: 0.038, txHash: TX_HASHES[5], timestamp: Date.now() - 1800000 },
    { id: "7", market: "Peace Bridge #1235", side: "under", amount: 0.2, result: "loss", pnl: -0.2, txHash: TX_HASHES[6], timestamp: Date.now() - 2100000 },
    { id: "8", market: "Peace Bridge #1234", side: "over", amount: 0.05, result: "win", pnl: 0.031, txHash: TX_HASHES[7], timestamp: Date.now() - 2400000 },
  ];

  const wins = bets.filter((b) => b.result === "win").length;
  const losses = bets.filter((b) => b.result === "loss").length;
  const totalBets = bets.length;
  const winRate = totalBets > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;
  const totalPnl = bets.reduce((acc, b) => acc + b.pnl, 0);

  return {
    address,
    shortAddress: shortAddress(address),
    totalBets,
    wins,
    losses,
    winRate,
    totalPnl: parseFloat(totalPnl.toFixed(4)),
    tilesOwned: 4,
    bets,
  };
}

// ─── Platform stats ───────────────────────────────────────────────────────────

export const PLATFORM_STATS = {
  totalVolume: 127.4,
  marketsResolved: 1247,
  uniqueBettors: 892,
  feesDistributed: 3.24,
  avgPoolSize: 1.02,
  biggestRound: 8.4,
  avgBettorsPerRound: 18,
  volume24h: 12.5,
};

// ─── Utility exports ──────────────────────────────────────────────────────────

export { shortAddress, timeAgo };
export const MY_MOCK_ADDRESS = MY_ADDRESS;
