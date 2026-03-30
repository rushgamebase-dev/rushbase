"use client";

import { useState } from "react";
import type { RoundResult } from "@/lib/mock";

interface RoundHistoryProps {
  history: RoundResult[];
}

export default function RoundHistory({ history }: RoundHistoryProps) {
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span
          className="text-xs font-bold tracking-widest"
          style={{ color: "#666", fontFamily: "monospace" }}
        >
          {history.length > 0 ? `LAST ${history.length} ROUNDS` : "ROUND HISTORY"}
        </span>
        <span className="text-xs" style={{ color: "#444", fontFamily: "monospace" }}>
          GREEN = OVER / RED = UNDER
        </span>
      </div>

      {history.length === 0 && (
        <div
          className="text-xs py-3 text-center"
          style={{ color: "#444", fontFamily: "monospace" }}
        >
          No rounds yet
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {history.map((round) => {
          const isOver = round.result === "over";
          const isCancelled = !round.result || (round.result !== "over" && round.result !== "under");
          const isHovered = hoveredId === round.roundId;

          const color = isCancelled ? "#666" : isOver ? "#00ff88" : "#ff4444";
          const bg = isCancelled ? "rgba(100,100,100,0.1)" : isOver ? "rgba(0,255,136,0.15)" : "rgba(255,68,68,0.15)";
          const borderColor = isCancelled ? "rgba(100,100,100,0.25)" : isOver ? "rgba(0,255,136,0.35)" : "rgba(255,68,68,0.35)";
          const icon = isCancelled ? "—" : isOver ? "▲" : "▼";
          const label = isCancelled ? "CANCELLED" : isOver ? "OVER" : "UNDER";

          return (
            <div
              key={round.roundId}
              className="relative"
              onMouseEnter={() => setHoveredId(round.roundId)}
              onMouseLeave={() => setHoveredId(null)}
              onTouchStart={() => setHoveredId(isHovered ? null : round.roundId)}
            >
              <div
                className="w-7 h-7 rounded flex items-center justify-center text-xs font-bold cursor-default transition-all"
                style={{
                  background: bg,
                  border: `1px solid ${borderColor}`,
                  color,
                  transform: isHovered ? "scale(1.15)" : "scale(1)",
                  fontFamily: "monospace",
                }}
                aria-label={`Round ${round.roundId}: ${label} — ${round.actualCount} vehicles`}
              >
                {icon}
              </div>

              {/* Tooltip */}
              {isHovered && (
                <div
                  className="absolute bottom-full left-1/2 mb-2 z-50 whitespace-nowrap pointer-events-none"
                  style={{ transform: "translateX(-50%)" }}
                >
                  <div
                    className="px-2 py-1.5 rounded text-xs"
                    style={{
                      background: "#1a1a1a",
                      border: "1px solid #2a2a2a",
                      color: "#e0e0e0",
                      fontFamily: "monospace",
                    }}
                  >
                    <div className="font-bold" style={{ color }}>
                      #{round.roundId} {label}
                    </div>
                    <div style={{ color: "#aaa" }}>Count: {round.actualCount}</div>
                    {!isCancelled && <div style={{ color: "#aaa" }}>Pool: {round.pool.toFixed(2)} ETH</div>}
                  </div>
                  <div
                    className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0"
                    style={{
                      borderLeft: "5px solid transparent",
                      borderRight: "5px solid transparent",
                      borderTop: "5px solid #2a2a2a",
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
