"use client";

import { useEffect, useState, useCallback } from "react";
import { usePublicClient, useReadContract, useWatchContractEvent } from "wagmi";
import type { PublicClient } from "viem";
import { FACTORY_ABI, FACTORY_ADDRESS, MARKET_ABI } from "@/lib/contracts";

// How far back to scan for the latest MarketCreated event.
// One round = ~5 min ≈ 150 blocks on Base (2s/block). 500 covers >3 rounds
// which is always enough — the active market is, by definition, the most
// recent MarketCreated that hasn't been Resolved/Cancelled yet.
const BLOCKS_LOOKBACK = BigInt(500);
const ZERO_BLOCK = BigInt(0);
const REFETCH_INTERVAL_MS = 15_000;

// PredictionMarket state enum:
//   0 = Pending (betting open)
//   1 = Locked  (counting)
//   2 = Resolved
//   3 = Cancelled
const INACTIVE_STATES = new Set([2, 3]);

async function fetchLatestActiveMarket(
  client: PublicClient,
): Promise<`0x${string}` | null> {
  const latest = await client.getBlockNumber();
  const fromBlock =
    latest > BLOCKS_LOOKBACK ? latest - BLOCKS_LOOKBACK : ZERO_BLOCK;

  const logs = await client.getContractEvents({
    address: FACTORY_ADDRESS,
    abi: FACTORY_ABI,
    eventName: "MarketCreated",
    fromBlock,
    toBlock: latest,
  });

  if (logs.length === 0) return null;

  // Walk backwards — most recent market first. Return the first one whose
  // on-chain state is still "active" (not Resolved/Cancelled).
  for (let i = logs.length - 1; i >= 0; i--) {
    const log = logs[i] as { args?: { marketAddress?: `0x${string}` } };
    const mkt = log.args?.marketAddress;
    if (!mkt) continue;

    try {
      const state = (await client.readContract({
        address: mkt,
        abi: MARKET_ABI,
        functionName: "state",
      })) as number;

      if (!INACTIVE_STATES.has(Number(state))) return mkt;
    } catch {
      // If the per-market call fails, assume live and return it; the
      // downstream hook can still validate against the WS oracle state.
      return mkt;
    }
  }

  return null;
}

/**
 * Finds the currently active market.
 *
 * Previously used `factory.getActiveMarkets()` which is O(n) over every market
 * ever created — after ~4800 markets the eth_call began exceeding the RPC
 * provider's gas allowance. This version uses `eth_getLogs(MarketCreated)` over
 * a small recent window plus a single `market.state()` read. Cost is constant
 * regardless of factory history.
 *
 * Live updates flow through Ably (useMarketStream); this hook is the
 * authoritative bootstrap + periodic reconciliation.
 */
export function useActiveMarket() {
  const enabled = !!FACTORY_ADDRESS;
  const client = usePublicClient();
  const [marketAddress, setMarketAddress] = useState<`0x${string}` | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | undefined>(undefined);

  const refetch = useCallback(async () => {
    if (!client || !enabled) return;
    try {
      const next = await fetchLatestActiveMarket(client);
      setMarketAddress((prev) => (prev === next ? prev : next));
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setIsLoading(false);
    }
  }, [client, enabled]);

  // Initial + periodic reconciliation
  useEffect(() => {
    if (!client || !enabled) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      await refetch();
    };

    tick();
    const id = setInterval(tick, REFETCH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [client, enabled, refetch]);

  // Instant on-chain push — no wait for next poll
  useWatchContractEvent({
    address: FACTORY_ADDRESS || undefined,
    abi: FACTORY_ABI,
    eventName: "MarketCreated",
    enabled,
    onLogs: (logs) => {
      const last = logs[logs.length - 1] as { args?: { marketAddress?: `0x${string}` } };
      const mkt = last?.args?.marketAddress;
      if (mkt) setMarketAddress(mkt);
    },
  });

  // marketCount still useful for UI ("Round #N"); it's a single SLOAD — cheap.
  const { data: marketCountData } = useReadContract({
    address: FACTORY_ADDRESS || undefined,
    abi: FACTORY_ABI,
    functionName: "getMarketCount",
    query: {
      enabled,
      refetchInterval: 30_000,
    },
  });

  const activeMarkets: `0x${string}`[] = marketAddress ? [marketAddress] : [];
  const isWaiting = !isLoading && !marketAddress;
  const marketCount =
    marketCountData !== undefined ? Number(marketCountData as bigint) : 0;

  return {
    marketAddress,
    activeMarkets,
    isLoading: enabled ? isLoading : false,
    error,
    refetch,
    isDemoMode: false,
    isWaiting,
    marketCount,
  };
}
