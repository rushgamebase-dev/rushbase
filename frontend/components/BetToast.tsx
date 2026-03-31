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
      // Prune old IDs to prevent memory leak
      if (next.size > 200) {
        const arr = Array.from(next);
        return new Set(arr.slice(arr.length - 100));
      }
      return next;
    });

    setVisibleBets((prev) => {
      const merged = [...prev, ...newBets];
      // Keep only the 5 most recent
      return merged.slice(-5);
    });

    const timer = setTimeout(() => {
      setVisibleBets((prev) => prev.filter((b) => !newBets.some((n) => n.id === b.id)));
    }, 4000);

    return () => clearTimeout(timer);
  }, [bets, seenIds]);

  return (
    <div className="absolute bottom-3 right-3 z-20 flex flex-col-reverse gap-2 pointer-events-none">
      <AnimatePresence initial={false}>
        {visibleBets.map((bet) => {
          const isOver = bet.side === "over";
          const color = isOver ? "#00ff88" : "#ff4444";
          const bg = isOver ? "rgba(0,255,136,0.15)" : "rgba(255,68,68,0.15)";
          const border = isOver ? "rgba(0,255,136,0.4)" : "rgba(255,68,68,0.4)";

          return (
            <motion.div
              layout
              key={bet.id}
              initial={{ opacity: 0, y: 40, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.8 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
              className="flex items-center gap-2 px-3 py-2 rounded-xl"
              style={{
                background: bg,
                border: `1px solid ${border}`,
                backdropFilter: "blur(12px)",
                boxShadow: `0 0 20px ${isOver ? "rgba(0,255,136,0.2)" : "rgba(255,68,68,0.2)"}`,
              }}
            >
              {/* Mascot mini */}
              <img
                src="/mascot/bet-placed.gif"
                alt=""
                style={{ width: 32, height: 32, borderRadius: "50%" }}
              />
              <div className="flex flex-col">
                <span
                  className="text-sm font-black tabular-nums"
                  style={{ color, fontFamily: "monospace" }}
                >
                  {isOver ? "\u25B2 OVER" : "\u25BC UNDER"} +{bet.amount.toFixed(3)} ETH
                </span>
                <span className="text-xs" style={{ color: "#888", fontFamily: "monospace" }}>
                  {bet.shortWallet}
                </span>
              </div>

              {/* Glow pulse */}
              <motion.div
                animate={{ scale: [1, 1.5, 1], opacity: [0.6, 0, 0.6] }}
                transition={{ duration: 1.5, repeat: Infinity }}
                style={{
                  position: "absolute",
                  right: -4,
                  top: -4,
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  background: color,
                }}
              />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
