"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Ably from "ably";

export interface LiveBet {
  id: string;
  user: string;
  shortWallet: string;
  side: "over" | "under";
  amount: number;
  txHash: string;
  timestamp: number;
}

const MAX_BETS = 20;
const PRUNE_AGE = 600_000; // 10 minutes

/**
 * Real-time bet stream via Ably.
 * - publishBet(): broadcast a new bet to all clients
 * - bets: list of recent bets (auto-pruned after 10min)
 */
export function useBetStream() {
  const [bets, setBets] = useState<LiveBet[]>([]);
  const clientRef = useRef<Ably.Realtime | null>(null);
  const channelRef = useRef<Ably.RealtimeChannel | null>(null);

  useEffect(() => {
    let mounted = true;

    async function connect() {
      try {
        const rnd = Math.random().toString(36).slice(2);
        const res = await fetch(`/api/ably-token?rnd=${rnd}`);
        if (!res.ok) return;
        const tokenRequest = await res.json();

        const client = new Ably.Realtime({ authCallback: (_, cb) => cb(null, tokenRequest) });
        clientRef.current = client;

        const channel = client.channels.get("rush:bets");
        channelRef.current = channel;

        channel.subscribe("bet_placed", (msg) => {
          if (!mounted) return;
          const data = msg.data as LiveBet;
          setBets(prev => {
            const now = Date.now();
            const exists = prev.some(b => b.id === data.id);
            if (exists) return prev;
            return [...prev, data]
              .filter(b => now - b.timestamp < PRUNE_AGE)
              .slice(-MAX_BETS);
          });
        });
      } catch {
        // Ably unavailable
      }
    }

    connect();

    // Periodic prune
    const pruneInterval = setInterval(() => {
      setBets(prev => prev.filter(b => Date.now() - b.timestamp < PRUNE_AGE));
    }, 30_000);

    return () => {
      mounted = false;
      clearInterval(pruneInterval);
      if (channelRef.current) {
        try { channelRef.current.unsubscribe(); } catch {}
      }
      if (clientRef.current) {
        try { clientRef.current.close(); } catch {}
      }
    };
  }, []);

  const publishBet = useCallback((bet: Omit<LiveBet, "id" | "timestamp" | "shortWallet">) => {
    const liveBet: LiveBet = {
      ...bet,
      id: `${bet.txHash}-${Date.now()}`,
      shortWallet: `${bet.user.slice(0, 6)}...${bet.user.slice(-4)}`,
      timestamp: Date.now(),
    };

    // Add locally immediately (instant feedback)
    setBets(prev => [...prev, liveBet].slice(-MAX_BETS));

    // Publish to Ably for all clients
    if (channelRef.current) {
      try {
        channelRef.current.publish("bet_placed", liveBet);
      } catch {
        // Ably unavailable — local-only
      }
    }
  }, []);

  return { bets, publishBet };
}
