"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ExternalLink } from "lucide-react";
import { shortAddress, timeAgo } from "@/lib/mock-data";
import { useActivity } from "@/hooks/useActivity";

// Maps outcome index → CSS color token (inline style values)
const OUTCOME_COLORS = [
  "#00ff88", // primary — first outcome (yes / winner)
  "#ff4444", // danger  — second outcome (no / loser)
  "#ffd700", // gold    — third outcome
  "#4488ff", // blue    — fourth outcome
  "#cc44ff", // purple  — fifth+
];

function outcomeColor(index: number): string {
  return OUTCOME_COLORS[index] ?? OUTCOME_COLORS[OUTCOME_COLORS.length - 1];
}

const WHALE_THRESHOLD = 0.05; // ETH

interface LiveActivityFeedProps {
  marketId: string;
}

// Tick timestamp every second so timeAgo() stays current without re-renders
// triggered by item mutations.
function useNow(intervalMs = 5000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export default function LiveActivityFeed({ marketId: _marketId }: LiveActivityFeedProps) {
  const { activity, isLoading } = useActivity(15);
  // Track outcome-label→index mapping for color assignment
  const labelIndexRef = useRef<Record<string, number>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  // Force re-render for timeAgo refresh
  useNow(10000);

  // Stable outcome-index lookup
  const getOutcomeIndex = useCallback((label: string): number => {
    if (!(label in labelIndexRef.current)) {
      labelIndexRef.current[label] = Object.keys(labelIndexRef.current).length;
    }
    return labelIndexRef.current[label];
  }, []);

  return (
    <section
      className="card"
      aria-label="Real-time activity feed"
      aria-live="polite"
      aria-atomic="false"
      aria-relevant="additions"
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-2">
          <h3
            className="text-xs font-bold tracking-widest"
            style={{ color: "var(--text)", fontFamily: "monospace" }}
          >
            ACTIVITY
          </h3>
          {!isLoading && (
            <span
              className="text-xs font-bold tabular px-1.5 py-0.5 rounded"
              style={{
                background: "rgba(0,255,136,0.1)",
                color: "var(--primary)",
                fontFamily: "monospace",
              }}
              aria-label={`${activity.length} recent bets`}
            >
              {activity.length}
            </span>
          )}
        </div>

        {/* ON-CHAIN badge */}
        <div
          className="flex items-center gap-1.5"
          aria-label="Real-time on-chain data"
        >
          <span className="live-dot-green" aria-hidden="true" />
          <span
            className="text-xs font-bold tracking-widest"
            style={{ color: "var(--primary)", fontFamily: "monospace" }}
          >
            ON-CHAIN
          </span>
        </div>
      </div>

      {/* Scrollable list */}
      <div
        ref={scrollRef}
        className="overflow-y-auto"
        style={{ maxHeight: 360 }}
        role="log"
        aria-label="Recent bets list"
      >
        {/* Loading skeleton */}
        {isLoading && (
          <div className="flex flex-col gap-1 p-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-2 px-1">
                <div className="skeleton w-2 h-2 rounded-full flex-shrink-0" />
                <div className="skeleton h-3 w-16 rounded" />
                <div className="skeleton h-3 flex-1 rounded" />
                <div className="skeleton h-3 w-14 rounded" />
              </div>
            ))}
          </div>
        )}

        {!isLoading && (
          <AnimatePresence initial={false}>
            {activity.map((item) => {
              const idx = item.outcomeLabel
                ? getOutcomeIndex(item.outcomeLabel)
                : 0;
              const color = outcomeColor(idx);
              const amountEth = parseFloat(item.amount) / 1e18;
              const isWhale = amountEth > WHALE_THRESHOLD;

              return (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.22, ease: "easeOut" }}
                  className="flex items-center gap-3 py-2 px-3 rounded-md hover:bg-surface/50 bet-flash"
                  style={{ fontFamily: "monospace" }}
                  role="listitem"
                >
                  {/* Outcome color dot */}
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: color, boxShadow: `0 0 6px ${color}66` }}
                    aria-hidden="true"
                  />

                  {/* Wallet address */}
                  <span
                    className="text-xs flex-shrink-0"
                    style={{ color: "var(--muted)" }}
                    title={item.user}
                  >
                    {item.user ? shortAddress(item.user) : "—"}
                  </span>

                  {/* Outcome label */}
                  <span
                    className="text-xs font-semibold truncate min-w-0"
                    style={{ color: "var(--text)" }}
                  >
                    {item.outcomeLabel ?? "—"}
                  </span>

                  {/* Whale badge */}
                  {isWhale && (
                    <span
                      className="text-xs font-bold px-1 py-0.5 rounded flex-shrink-0"
                      style={{
                        background: "rgba(255,215,0,0.12)",
                        border: "1px solid rgba(255,215,0,0.3)",
                        color: "#ffd700",
                        fontSize: "0.6rem",
                        letterSpacing: "0.05em",
                      }}
                      aria-label="Whale — large bet"
                    >
                      WHALE
                    </span>
                  )}

                  {/* Amount */}
                  <span
                    className="text-xs tabular ml-auto flex-shrink-0"
                    style={{ color: "var(--primary)" }}
                    aria-label={`${amountEth.toFixed(4)} ETH bet`}
                  >
                    {amountEth.toFixed(4)} ETH
                  </span>

                  {/* Time ago */}
                  <span
                    className="text-xs flex-shrink-0"
                    style={{ color: "var(--muted)" }}
                    aria-label={`${timeAgo(item.timestamp)} ago`}
                  >
                    {timeAgo(item.timestamp)}
                  </span>

                  {/* Basescan link */}
                  {item.txHash && (
                    <a
                      href={`https://basescan.org/tx/${item.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-shrink-0 transition-colors"
                      style={{ color: "var(--muted)" }}
                      aria-label="View transaction on Basescan"
                      onMouseEnter={(e) =>
                        ((e.currentTarget as HTMLElement).style.color =
                          "var(--primary)")
                      }
                      onMouseLeave={(e) =>
                        ((e.currentTarget as HTMLElement).style.color =
                          "var(--muted)")
                      }
                    >
                      <ExternalLink size={12} aria-hidden="true" />
                    </a>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}

        {!isLoading && activity.length === 0 && (
          <p
            className="text-xs text-center py-8"
            style={{ color: "var(--muted)", fontFamily: "monospace" }}
          >
            Waiting for bets...
          </p>
        )}
      </div>
    </section>
  );
}
