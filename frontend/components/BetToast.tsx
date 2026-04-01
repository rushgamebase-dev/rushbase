"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Bet } from "@/lib/mock";

interface BetToastProps {
  bets: Bet[];
}

export default function BetToast({ bets }: BetToastProps) {
  const [visibleBets, setVisibleBets] = useState<Bet[]>([]);
  const seenIdsRef = useRef(new Set<string>());

  // Clear seen IDs when bets array resets (new round)
  useEffect(() => {
    if (bets.length === 0) {
      seenIdsRef.current.clear();
      setVisibleBets([]);
    }
  }, [bets.length === 0]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const newBets = bets.filter((b) => !seenIdsRef.current.has(b.id));
    if (newBets.length === 0) return;

    newBets.forEach((b) => seenIdsRef.current.add(b.id));

    // Add expiry timestamp to each bet
    const now = Date.now();
    const withExpiry = newBets.map((b) => ({ ...b, _expiry: now + 5000 }));
    setVisibleBets((prev) => [...prev, ...withExpiry].slice(-5));
  }, [bets]);

  // Auto-remove expired toasts every second
  useEffect(() => {
    const interval = setInterval(() => {
      setVisibleBets((prev) => {
        const now = Date.now();
        const filtered = prev.filter((b: Bet & { _expiry?: number }) => !b._expiry || b._expiry > now);
        return filtered.length === prev.length ? prev : filtered;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="absolute top-3 right-3 z-20 flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {visibleBets.map((bet) => {
          const isOver = bet.side === "over";
          const color = isOver ? "#00ff88" : "#ff4444";
          const bg = isOver ? "rgba(0,255,136,0.15)" : "rgba(255,68,68,0.15)";
          const border = isOver ? "rgba(0,255,136,0.4)" : "rgba(255,68,68,0.4)";

          return (
            <motion.div
              key={bet.id}
              initial={{ opacity: 0, x: 60, scale: 0.7 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 60, scale: 0.7 }}
              transition={{ type: "spring", stiffness: 300, damping: 20 }}
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
                style={{ width: 24, height: 24, borderRadius: "50%" }}
              />
              <div className="flex flex-col">
                <span
                  className="text-xs font-black tabular-nums"
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
