"use client";

import { useReadContract, usePublicClient } from "wagmi";
import { formatEther, parseAbiItem } from "viem";
import { useState, useEffect, useRef } from "react";
import { MARKET_ABI } from "@/lib/contracts";

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
// Critical data polled frequently — events are unreliable with HTTP transport.
// State/pools/count MUST update within seconds, not 30s.
const POLL_INTERVAL = 15_000;

/**
 * Reads all data from a specific PredictionMarket contract.
 * Uses WebSocket events for instant bet detection + polling as safety net.
 */
export function useMarketContract(marketAddress: `0x${string}` | null) {
  const enabled = !!marketAddress;
  const addr = marketAddress || undefined;
  // queryClient removed — no more event watchers here

  const [realtimeBets, setRealtimeBets] = useState<
    { user: string; rangeIndex: number; amount: bigint; txHash: string; timestamp: number }[]
  >([]);

  // Reset bets when market address changes (new round)
  useEffect(() => { setRealtimeBets([]); }, [marketAddress]);

  // Poll BetPlaced events every 15s — replaces removed useWatchContractEvent
  const publicClient = usePublicClient();
  const lastBlockRef = useRef<bigint>(BigInt(0));

  useEffect(() => {
    if (!enabled || !addr || !publicClient) return;
    let cancelled = false;

    async function pollBets() {
      try {
        const currentBlock = await publicClient!.getBlockNumber();
        const fromBlock = lastBlockRef.current > BigInt(0) ? lastBlockRef.current + BigInt(1) : currentBlock - BigInt(100);
        if (fromBlock > currentBlock) return;

        const logs = await publicClient!.getLogs({
          address: addr,
          event: parseAbiItem("event BetPlaced(address indexed user, uint256 rangeIndex, uint256 amount)"),
          fromBlock,
          toBlock: currentBlock,
        });

        lastBlockRef.current = currentBlock;

        if (logs.length > 0 && !cancelled) {
          const newBets = logs.map(log => ({
            user: (log.args as { user: string }).user,
            rangeIndex: Number((log.args as { rangeIndex: bigint }).rangeIndex),
            amount: (log.args as { amount: bigint }).amount,
            txHash: log.transactionHash || "",
            timestamp: Date.now(),
          }));
          setRealtimeBets(prev => {
            const existing = new Set(prev.map(b => b.txHash));
            const unique = newBets.filter(b => !existing.has(b.txHash));
            return [...prev, ...unique].slice(-20); // keep last 20
          });
        }
      } catch {
        // Silently fail — safety net, not critical path
      }
    }

    pollBets();
    const interval = setInterval(pollBets, 15_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [enabled, addr, publicClient]);

  // State
  const { data: stateData } = useReadContract({
    address: addr,
    abi: MARKET_ABI,
    functionName: "state",
    query: { enabled, refetchInterval: POLL_INTERVAL },
  });

  // Total pool
  const { data: totalPoolData } = useReadContract({
    address: addr,
    abi: MARKET_ABI,
    functionName: "totalPool",
    query: { enabled, refetchInterval: POLL_INTERVAL },
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
    query: { enabled, refetchInterval: POLL_INTERVAL },
  });

  // Actual car count
  const { data: actualCarCountData } = useReadContract({
    address: addr,
    abi: MARKET_ABI,
    functionName: "actualCarCount",
    query: { enabled, refetchInterval: POLL_INTERVAL },
  });

  // Winning range index
  const { data: winningRangeIndexData } = useReadContract({
    address: addr,
    abi: MARKET_ABI,
    functionName: "winningRangeIndex",
    query: { enabled, refetchInterval: POLL_INTERVAL },
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
    query: { enabled: enabled && rangeCount > 0, refetchInterval: POLL_INTERVAL },
  });
  const { data: pool1 } = useReadContract({
    address: addr,
    abi: MARKET_ABI,
    functionName: "poolByRange",
    args: [BigInt(1)],
    query: { enabled: enabled && rangeCount > 1, refetchInterval: POLL_INTERVAL },
  });
  const { data: pool2 } = useReadContract({
    address: addr,
    abi: MARKET_ABI,
    functionName: "poolByRange",
    args: [BigInt(2)],
    query: { enabled: enabled && rangeCount > 2, refetchInterval: POLL_INTERVAL },
  });
  const { data: pool3 } = useReadContract({
    address: addr,
    abi: MARKET_ABI,
    functionName: "poolByRange",
    args: [BigInt(3)],
    query: { enabled: enabled && rangeCount > 3, refetchInterval: POLL_INTERVAL },
  });

  // Event watchers REMOVED — they caused infinite eth_getLogs polling loops
  // that triggered 429 rate limits on the RPC. Real-time updates now come
  // exclusively from Ably (useMarketStream) which invalidates queries on
  // market_created, market_resolved, and market_cancelled events.

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
