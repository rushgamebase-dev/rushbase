"use client";

import { useReadContract } from "wagmi";
import { FACTORY_ABI, FACTORY_ADDRESS } from "@/lib/contracts";
import { IS_DEMO_MODE } from "@/lib/mock";

/**
 * Finds the currently active market from MarketFactory.
 *
 * States:
 *  - IS_DEMO_MODE=true (FACTORY_ADDRESS empty): full mock data, no contract calls.
 *  - IS_DEMO_MODE=false + no active markets: "waiting" — factory is real but oracle
 *    has not started a round yet. UI should show "Waiting for next round..." instead
 *    of mock market data.
 *  - IS_DEMO_MODE=false + active market found: live contract data.
 */
export function useActiveMarket() {
  const enabled = !IS_DEMO_MODE && !!FACTORY_ADDRESS;

  const { data, isLoading, error, refetch } = useReadContract({
    address: FACTORY_ADDRESS || undefined,
    abi: FACTORY_ABI,
    functionName: "getActiveMarkets",
    query: {
      enabled,
      refetchInterval: 5_000,
    },
  });

  const { data: marketCountData } = useReadContract({
    address: FACTORY_ADDRESS || undefined,
    abi: FACTORY_ABI,
    functionName: "getMarketCount",
    query: {
      enabled,
      refetchInterval: 30_000,
    },
  });

  const activeMarkets = (data as `0x${string}`[] | undefined) ?? [];
  const marketAddress = activeMarkets.length > 0 ? activeMarkets[0] : null;

  // "waiting" = factory is real, query has resolved, but no active market yet
  const isWaiting = !IS_DEMO_MODE && !isLoading && activeMarkets.length === 0;

  const marketCount = marketCountData !== undefined ? Number(marketCountData as bigint) : 0;

  return {
    marketAddress,
    activeMarkets,
    isLoading: enabled ? isLoading : false,
    error,
    refetch,
    isDemoMode: IS_DEMO_MODE,
    /** True when the factory is deployed but no round is currently active. */
    isWaiting,
    /** Total number of markets ever created — use as roundId. */
    marketCount,
  };
}
