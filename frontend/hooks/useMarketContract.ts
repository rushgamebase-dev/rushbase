"use client";

import { useReadContract, useWatchContractEvent } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { formatEther } from "viem";
import { useState, useEffect } from "react";
import { MARKET_ABI } from "@/lib/contracts";
import { IS_DEMO_MODE } from "@/lib/mock";

export interface MarketRange {
  minCars: bigint;
  maxCars: bigint;
  label: string;
}

export interface MarketData {
  state: number;
  totalPool: string;
  totalPoolWei: bigint;
  lockTime: bigint;
  rangeCount: number;
  ranges: MarketRange[];
  poolByRange: string[];
  poolByRangeWei: bigint[];
  totalBettors: number;
  actualCarCount: number;
  winningRangeIndex: number;
  streamUrl: string;
  description: string;
  isLoading: boolean;
  error: Error | null;
}

// Primary updates come from WebSocket events (BetPlaced, MarketResolved)
// and Ably broadcasts (market_created, market_resolved, market_cancelled).
// Polling is just a safety net — 30s is enough to catch anything missed.
const SAFETY_POLL = 30_000;

/**
 * Reads all data from a specific PredictionMarket contract.
 * Uses WebSocket events for instant bet detection + polling as safety net.
 */
export function useMarketContract(marketAddress: `0x${string}` | null) {
  const enabled = !IS_DEMO_MODE && !!marketAddress;
  const addr = marketAddress || undefined;
  const queryClient = useQueryClient();

  const [realtimeBets, setRealtimeBets] = useState<
    { user: string; rangeIndex: number; amount: bigint; txHash: string; timestamp: number }[]
  >([]);

  // Reset bets when market address changes (new round)
  useEffect(() => { setRealtimeBets([]); }, [marketAddress]);

  // State
  const { data: stateData } = useReadContract({
    address: addr,
    abi: MARKET_ABI,
    functionName: "state",
    query: { enabled, refetchInterval: SAFETY_POLL },
  });

  // Total pool
  const { data: totalPoolData } = useReadContract({
    address: addr,
    abi: MARKET_ABI,
    functionName: "totalPool",
    query: { enabled, refetchInterval: SAFETY_POLL },
  });

  // Lock time
  const { data: lockTimeData } = useReadContract({
    address: addr,
    abi: MARKET_ABI,
    functionName: "lockTime",
    query: { enabled, refetchInterval: 10_000 },
  });

  // Total bettors
  const { data: totalBettorsData } = useReadContract({
    address: addr,
    abi: MARKET_ABI,
    functionName: "totalBettors",
    query: { enabled, refetchInterval: SAFETY_POLL },
  });

  // Actual car count
  const { data: actualCarCountData } = useReadContract({
    address: addr,
    abi: MARKET_ABI,
    functionName: "actualCarCount",
    query: { enabled, refetchInterval: SAFETY_POLL },
  });

  // Winning range index
  const { data: winningRangeIndexData } = useReadContract({
    address: addr,
    abi: MARKET_ABI,
    functionName: "winningRangeIndex",
    query: { enabled, refetchInterval: SAFETY_POLL },
  });

  // All ranges
  const { data: rangesData } = useReadContract({
    address: addr,
    abi: MARKET_ABI,
    functionName: "getAllRanges",
    query: { enabled },
  });

  // Market info (streamUrl, description, etc.)
  const { data: marketInfoData, error: infoError } = useReadContract({
    address: addr,
    abi: MARKET_ABI,
    functionName: "getMarketInfo",
    query: { enabled },
  });

  // Range count for pool queries
  const { data: rangeCountData } = useReadContract({
    address: addr,
    abi: MARKET_ABI,
    functionName: "getRangeCount",
    query: { enabled },
  });

  // Pool by range
  const rangeCount = rangeCountData ? Number(rangeCountData) : 0;
  const { data: pool0 } = useReadContract({
    address: addr,
    abi: MARKET_ABI,
    functionName: "poolByRange",
    args: [BigInt(0)],
    query: { enabled: enabled && rangeCount > 0, refetchInterval: SAFETY_POLL },
  });
  const { data: pool1 } = useReadContract({
    address: addr,
    abi: MARKET_ABI,
    functionName: "poolByRange",
    args: [BigInt(1)],
    query: { enabled: enabled && rangeCount > 1, refetchInterval: SAFETY_POLL },
  });
  const { data: pool2 } = useReadContract({
    address: addr,
    abi: MARKET_ABI,
    functionName: "poolByRange",
    args: [BigInt(2)],
    query: { enabled: enabled && rangeCount > 2, refetchInterval: SAFETY_POLL },
  });
  const { data: pool3 } = useReadContract({
    address: addr,
    abi: MARKET_ABI,
    functionName: "poolByRange",
    args: [BigInt(3)],
    query: { enabled: enabled && rangeCount > 3, refetchInterval: SAFETY_POLL },
  });

  // Watch BetPlaced events — instant detection via WebSocket
  // On event: update realtimeBets AND force-refetch all pool data
  useWatchContractEvent({
    address: addr,
    abi: MARKET_ABI,
    eventName: "BetPlaced",
    enabled,
    onLogs(logs) {
      for (const log of logs) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const args = (log as any).args as { user?: string; rangeIndex?: bigint; amount?: bigint } | undefined;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const txHash = ((log as any).transactionHash as string) ?? "";
        if (args?.user && args.rangeIndex !== undefined && args.amount !== undefined) {
          setRealtimeBets((prev) => {
            // Dedup by txHash to prevent double-counting
            if (txHash && prev.some((b) => b.txHash === txHash)) return prev;
            return [
              {
                user: args.user!,
                rangeIndex: Number(args.rangeIndex),
                amount: args.amount!,
                txHash,
                timestamp: Date.now(),
              },
              ...prev.slice(0, 49),
            ];
          });
        }
      }

      // Force immediate refetch of ALL contract reads (pool, bettors, state)
      // This is the key to real-time odds: event fires → data refetches → odds recalculate
      queryClient.invalidateQueries({ queryKey: ["readContract"] });
    },
  });

  // Also watch MarketResolved for instant resolution detection
  useWatchContractEvent({
    address: addr,
    abi: MARKET_ABI,
    eventName: "MarketResolved",
    enabled,
    onLogs() {
      queryClient.invalidateQueries({ queryKey: ["readContract"] });
    },
  });

  // Watch MarketLocked for instant lock detection
  useWatchContractEvent({
    address: addr,
    abi: MARKET_ABI,
    eventName: "MarketLocked",
    enabled,
    onLogs() {
      queryClient.invalidateQueries({ queryKey: ["readContract"] });
    },
  });

  // Build pools array
  const pools = [pool0, pool1, pool2, pool3]
    .slice(0, rangeCount)
    .map((p) => (p as bigint) ?? BigInt(0));

  // Parse ranges
  const ranges: MarketRange[] = rangesData
    ? (rangesData as Array<{ minCars: bigint; maxCars: bigint; label: string }>).map((r) => ({
        minCars: r.minCars,
        maxCars: r.maxCars,
        label: r.label,
      }))
    : [];

  // Parse market info tuple
  const streamUrl = marketInfoData ? (marketInfoData as unknown as unknown[])[0] as string : "";
  const description = marketInfoData ? (marketInfoData as unknown as unknown[])[1] as string : "";

  const totalPoolWei = (totalPoolData as bigint) ?? BigInt(0);

  return {
    state: stateData !== undefined ? Number(stateData) : 0,
    totalPool: formatEther(totalPoolWei),
    totalPoolWei,
    lockTime: (lockTimeData as bigint) ?? BigInt(0),
    rangeCount,
    ranges,
    poolByRange: pools.map((p) => formatEther(p)),
    poolByRangeWei: pools,
    totalBettors: totalBettorsData ? Number(totalBettorsData) : 0,
    actualCarCount: actualCarCountData ? Number(actualCarCountData) : 0,
    winningRangeIndex: winningRangeIndexData ? Number(winningRangeIndexData) : 0,
    streamUrl,
    description,
    realtimeBets,
    isLoading: false,
    error: infoError ?? null,
  };
}
