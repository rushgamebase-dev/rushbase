"use client";

import { useEffect, useRef, useCallback } from "react";
import * as Ably from "ably";
import { useQueryClient } from "@tanstack/react-query";

const CHANNEL_NAME = "rush:market";

export interface MarketEvent {
  type: "market_created" | "market_resolved" | "market_cancelled";
  marketAddress?: string;
  txHash?: string;
  threshold?: number;
  lockTime?: number;
  actualCount?: number;
  winningRangeIndex?: number;
  ts?: number;
}

/**
 * Subscribes to the Ably rush:market channel for instant oracle broadcasts.
 *
 * Events:
 *  - market_created:   Oracle created a new market → refetch active markets
 *  - market_resolved:  Oracle resolved a market → refetch all contract data
 *  - market_cancelled: Oracle cancelled a market → refetch active markets
 *
 * This replaces polling as the primary detection method for market lifecycle events.
 * wagmi event watchers (BetPlaced, MarketResolved) handle bet-level events.
 */
export function useMarketStream(onEvent?: (event: MarketEvent) => void, currentMarketAddress?: string | null) {
  const queryClient = useQueryClient();
  const ablyRef = useRef<Ably.Realtime | null>(null);
  const channelRef = useRef<Ably.RealtimeChannel | null>(null);
  const mountedRef = useRef(true);
  const currentMarketRef = useRef(currentMarketAddress);

  // Keep ref in sync without recreating handleEvent
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { currentMarketRef.current = currentMarketAddress; }, [currentMarketAddress]);

  const handleEvent = useCallback(
    (msg: Ably.Message) => {
      if (!mountedRef.current) return;

      let data: Record<string, unknown> = {};
      try {
        data = typeof msg.data === "string" ? JSON.parse(msg.data) : msg.data ?? {};
      } catch {
        return;
      }

      const event: MarketEvent = {
        type: msg.name as MarketEvent["type"],
        marketAddress: data.marketAddress as string | undefined,
        txHash: data.txHash as string | undefined,
        threshold: data.threshold as number | undefined,
        lockTime: data.lockTime as number | undefined,
        actualCount: data.actualCount as number | undefined,
        winningRangeIndex: data.winningRangeIndex as number | undefined,
        ts: data.ts as number | undefined,
      };

      // market_created always processed (signals new round)
      // market_resolved / market_cancelled: only invalidate if for current market
      if (event.type !== "market_created" && event.marketAddress && currentMarketRef.current) {
        if (event.marketAddress.toLowerCase() !== currentMarketRef.current.toLowerCase()) {
          return; // stale event from different market — discard
        }
      }

      // Invalidate contract reads → forces immediate refetch
      queryClient.invalidateQueries({ queryKey: ["readContract"] });

      onEvent?.(event);
    },
    [queryClient, onEvent],
  );

  useEffect(() => {
    mountedRef.current = true;

    async function init() {
      try {
        const ably = new Ably.Realtime({
          authUrl: "/api/ably-token",
          autoConnect: true,
        });
        ablyRef.current = ably;

        const channel = ably.channels.get(CHANNEL_NAME);
        channelRef.current = channel;

        channel.subscribe("market_created", handleEvent);
        channel.subscribe("market_resolved", handleEvent);
        channel.subscribe("market_cancelled", handleEvent);
      } catch (err) {
        console.error("Market stream init error:", err);
      }
    }

    init();

    return () => {
      mountedRef.current = false;
      try { channelRef.current?.unsubscribe(); } catch {}
      // close() returns a Promise at runtime despite void TS type — catch the rejection
      if (ablyRef.current) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Promise.resolve((ablyRef.current as any).close()).catch(() => {});
      }
      ablyRef.current = null;
      channelRef.current = null;
    };
  }, [handleEvent]);
}
