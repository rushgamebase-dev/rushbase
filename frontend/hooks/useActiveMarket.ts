"use client";

import { useReadContract, useWatchContractEvent } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { FACTORY_ABI, FACTORY_ADDRESS } from "@/lib/contracts";

/**
 * Finds the currently active market from MarketFactory.
 *
 * States:
 *  - No active markets: "waiting" — factory is real but oracle
 *    has not started a round yet. UI should show "Waiting for next round..."
 *  - Active market found: live contract data.
 */
export function useActiveMarket() {
  const enabled = !!FACTORY_ADDRESS;
  const queryClient = useQueryClient();

  // Instant detection of new rounds via MarketCreated event (WebSocket or poll)
  useWatchContractEvent({
    address: FACTORY_ADDRESS || undefined,
    abi: FACTORY_ABI,
    eventName: "MarketCreated",
    enabled,
    onLogs() {
      queryClient.invalidateQueries({ queryKey: ["readContract"] });
    },
  });

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
  const isWaiting = !isLoading && activeMarkets.length === 0;

  const marketCount = marketCountData !== undefined ? Number(marketCountData as bigint) : 0;

  return {
    marketAddress,
    activeMarkets,
    isLoading: enabled ? isLoading : false,
    error,
    refetch,
    isDemoMode: false,
    /** True when the factory is deployed but no round is currently active. */
    isWaiting,
    /** Total number of markets ever created — use as roundId. */
    marketCount,
  };
}
