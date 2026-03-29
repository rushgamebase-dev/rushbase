"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Bet } from "@/lib/mock";

interface BetToastProps {
  bets: Bet[];
}

export default function BetToast({ bets }: BetToastProps) {
  const [visibleBets, setVisibleBets] = useState<Bet[]>([]);
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const newBets = bets.filter((b) => !seenIds.has(b.id));
    if (newBets.length === 0) return;

    setSeenIds((prev) => {
      const next = new Set(prev);
      newBets.forEach((b) => next.add(b.id));
      return next;
    });

    setVisibleBets((prev) => [...prev, ...newBets]);

    // Auto-remove after 3 seconds
    const timer = setTimeout(() => {
      setVisibleBets((prev) => prev.filter((b) => !newBets.some((n) => n.id === b.id)));
    }, 3000);

    return () => clearTimeout(timer);
  }, [bets, seenIds]);

  return (
    <div className="absolute top-3 right-3 z-20 flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {visibleBets.map((bet) => (
          <motion.div
            key={bet.id}
            initial={{ opacity: 0, x: 40, scale: 0.8 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4 }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
            style={{
              background: bet.side === "over" ? "rgba(0,255,136,0.15)" : "rgba(255,68,68,0.15)",
              border: `1px solid ${bet.side === "over" ? "rgba(0,255,136,0.4)" : "rgba(255,68,68,0.4)"}`,
              backdropFilter: "blur(8px)",
            }}
          >
            <span
              className="text-xs font-black"
              style={{
                color: bet.side === "over" ? "#00ff88" : "#ff4444",
                fontFamily: "monospace",
              }}
            >
              {bet.side === "over" ? "\u25B2" : "\u25BC"}
            </span>
            <span
              className="text-sm font-black tabular-nums"
              style={{
                color: bet.side === "over" ? "#00ff88" : "#ff4444",
                fontFamily: "monospace",
              }}
            >
              +{bet.amount.toFixed(3)} ETH
            </span>
            <span className="text-xs" style={{ color: "#666", fontFamily: "monospace" }}>
              {bet.shortWallet}
            </span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
