"use client";

import { useEffect, useState, useCallback } from "react";
import { usePublicClient, useReadContract } from "wagmi";
import type { PublicClient } from "viem";
import { FACTORY_ABI, FACTORY_ADDRESS, MARKET_ABI } from "@/lib/contracts";

const REFETCH_INTERVAL_MS = 15_000;

// PredictionMarket state enum:
//   0 = Pending (betting open)
//   1 = Locked  (counting)
//   2 = Resolved
//   3 = Cancelled
const INACTIVE_STATES = new Set([2, 3]);

// Walk back at most this many markets if the latest one is already resolved —
// covers the 15s gap between rounds without ever re-entering O(n) territory.
const LOOKBACK_STEPS = 3;

async function fetchLatestActiveMarket(
  client: PublicClient,
): Promise<`0x${string}` | null> {
  const count = (await client.readContract({
    address: FACTORY_ADDRESS,
    abi: FACTORY_ABI,
    functionName: "getMarketCount",
  })) as bigint;

  if (count === BigInt(0)) return null;

  for (let step = 0; step < LOOKBACK_STEPS; step++) {
    const idx = count - BigInt(1 + step);
    if (idx < BigInt(0)) break;

    let mkt: `0x${string}`;
    try {
      mkt = (await client.readContract({
        address: FACTORY_ADDRESS,
        abi: FACTORY_ABI,
        functionName: "markets",
        args: [idx],
      })) as `0x${string}`;
    } catch {
      break;
    }

    try {
      const state = (await client.readContract({
        address: mkt,
        abi: MARKET_ABI,
        functionName: "state",
      })) as number;

      if (!INACTIVE_STATES.has(Number(state))) return mkt;
    } catch {
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

  // NOTE: instant push via useWatchContractEvent is disabled — Chainstack's
  // current plan returns 403 on eth_getLogs (Archive tier required). Ably
  // (useMarketStream) is the real-time channel; 15s poll covers resync.

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
