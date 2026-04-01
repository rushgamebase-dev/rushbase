"use client";

import { useState, useRef, useEffect } from "react";
import type { RoundResult } from "@/lib/mock";

interface RoundHistoryProps {
  history: RoundResult[];
}

export default function RoundHistory({ history }: RoundHistoryProps) {
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close tooltip on click outside or scroll
  useEffect(() => {
    function close() { setHoveredId(null); }
    window.addEventListener("scroll", close, true);
    window.addEventListener("click", close, true);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("click", close, true);
    };
  }, []);

  return (
    <div className="flex flex-col gap-2" ref={containerRef}>
      <div className="flex items-center justify-between">
        <span
          className="text-xs font-bold tracking-widest"
          style={{ color: "#666", fontFamily: "monospace" }}
        >
          {history.length > 0 ? `LAST ${history.length} ROUNDS` : "ROUND HISTORY"}
        </span>
        <span className="text-xs" style={{ color: "#444", fontFamily: "monospace" }}>
          <span style={{ color: "#00ff88" }}>▲</span> OVER
          {" / "}
          <span style={{ color: "#ff4444" }}>▼</span> UNDER
          {" / "}
          <span style={{ color: "#666" }}>—</span> NO BETS
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

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {history.map((round) => {
          const isOver = round.result === "over";
          const isCancelled = round.pool <= 0;
          const isHovered = hoveredId === round.roundId;

          const color = isCancelled ? "#555" : isOver ? "#00ff88" : "#ff4444";
          const bg = isCancelled ? "rgba(60,60,60,0.15)" : isOver ? "rgba(0,255,136,0.15)" : "rgba(255,68,68,0.15)";
          const borderColor = isCancelled ? "rgba(60,60,60,0.3)" : isOver ? "rgba(0,255,136,0.35)" : "rgba(255,68,68,0.35)";
          const icon = isCancelled ? "—" : isOver ? "▲" : "▼";
          const label = isCancelled ? "NO BETS" : isOver ? "OVER" : "UNDER";

          return (
            <div
              key={round.roundId}
              className="relative"
              onMouseEnter={() => setHoveredId(round.roundId)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={(e) => {
                e.stopPropagation();
                setHoveredId(isHovered ? null : round.roundId);
              }}
            >
              <div
                className="w-7 h-7 rounded flex items-center justify-center text-xs font-bold cursor-pointer transition-all select-none"
                style={{
                  background: bg,
                  border: `1px solid ${borderColor}`,
                  color,
                  transform: isHovered ? "scale(1.2)" : "scale(1)",
                  fontFamily: "monospace",
                  opacity: isCancelled ? 0.5 : 1,
                }}
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
                    className="px-3 py-2 rounded text-xs"
                    style={{
                      background: "#1a1a1a",
                      border: `1px solid ${borderColor}`,
                      color: "#e0e0e0",
                      fontFamily: "monospace",
                      boxShadow: `0 0 10px ${color}22`,
                    }}
                  >
                    <div className="font-bold" style={{ color }}>
                      #{round.roundId} {label}
                    </div>
                    <div style={{ color: "#aaa" }}>
                      Vehicles: {round.actualCount}
                      {round.threshold > 0 && ` / threshold: ${round.threshold}`}
                    </div>
                    {!isCancelled && (
                      <div style={{ color: "#aaa" }}>Pool: {round.pool.toFixed(3)} ETH</div>
                    )}
                  </div>
                  <div
                    className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0"
                    style={{
                      borderLeft: "5px solid transparent",
                      borderRight: "5px solid transparent",
                      borderTop: `5px solid ${borderColor}`,
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
