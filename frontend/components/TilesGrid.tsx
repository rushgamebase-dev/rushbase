"use client";

import { useState } from "react";
import type { Tile } from "@/lib/mock";

interface TilesGridProps {
  tiles: Tile[];
  myAddress?: string;
  onTileClick: (tile: Tile) => void;
}

/** 5 raccoon tile images */
const TILE_IMAGES = [
  "/tiles/1.png", // Greedy Raccoon (green)
  "/tiles/2.png", // Purple Velvet
  "/tiles/3.png", // Skyfall Gangster (blue)
  "/tiles/4.png", // Golden Tail
  "/tiles/5.png", // Inferno Rusher (red)
];

function getTileImage(tileId: number): string {
  return TILE_IMAGES[tileId % TILE_IMAGES.length];
}

/** Deterministic color from an address string */
function addressToColor(addr: string): string {
  let hash = 0;
  for (let i = 0; i < addr.length; i++) {
    hash = (hash * 31 + addr.charCodeAt(i)) | 0;
  }
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 65%, 38%)`;
}

export default function TilesGrid({ tiles, onTileClick }: TilesGridProps) {
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  return (
    <div
      className="relative p-[3px] rounded-lg"
      style={{
        background: "linear-gradient(90deg, #00ff88, #00aaff, #aa44ff, #ff4488, #ffd700, #00ff88)",
        backgroundSize: "300% 100%",
        animation: "borderGlow 6s linear infinite",
        boxShadow: "0 0 15px rgba(0,255,136,0.15), 0 0 30px rgba(0,170,255,0.1)",
      }}
    >
      <style>{`
        @keyframes borderGlow {
          0% { background-position: 0% 50%; }
          100% { background-position: 300% 50%; }
        }
      `}</style>
      <div
        className="grid gap-1 rounded-lg p-1"
        style={{ gridTemplateColumns: "repeat(10, 1fr)", background: "#111" }}
        role="grid"
        aria-label="Tiles grid 10 by 10"
      >
      {tiles.map((tile) => {
        const isHovered = hoveredId === tile.id;

        // Background color logic
        let bg = "#1a1a1a"; // empty
        let borderColor = "#222";
        let shadow = "none";

        if (tile.isMine) {
          bg = "rgba(0,255,136,0.18)";
          borderColor = "rgba(0,255,136,0.55)";
          shadow = "0 0 6px rgba(0,255,136,0.25)";
        } else if (tile.isActive && tile.owner) {
          bg = addressToColor(tile.owner);
          borderColor = "rgba(255,255,255,0.08)";
        }

        if (isHovered) {
          borderColor = tile.isMine ? "rgba(0,255,136,0.9)" : "#444";
          shadow = tile.isMine ? "0 0 10px rgba(0,255,136,0.4)" : "0 0 6px rgba(255,255,255,0.1)";
        }

        const hasImage = tile.isActive;

        return (
          <button
            key={tile.id}
            className="relative flex flex-col items-start justify-between rounded overflow-hidden"
            style={{
              background: hasImage ? `url(${getTileImage(tile.id)}) center/cover` : bg,
              border: `1px solid ${borderColor}`,
              boxShadow: shadow,
              transition: "all 0.15s",
              cursor: "pointer",
              transform: isHovered ? "scale(1.15)" : "scale(1)",
              zIndex: isHovered ? 10 : 1,
              padding: "3px 3px 2px",
              aspectRatio: "1",
            }}
            onMouseEnter={() => setHoveredId(tile.id)}
            onMouseLeave={() => setHoveredId(null)}
            onClick={() => onTileClick(tile)}
            aria-label={`Tile ${tile.id + 1} — ${tile.isMine ? "yours" : tile.isActive ? "owned" : "empty"}, ${tile.price.toFixed(4)} ETH`}
            role="gridcell"
          >
            {/* Number top-left */}
            <span
              style={{
                fontSize: 8,
                lineHeight: 1,
                fontFamily: "monospace",
                fontWeight: 700,
                color: tile.isMine ? "#00ff88" : tile.isActive ? "#fff" : "#2a2a2a",
                userSelect: "none",
                textShadow: tile.isActive ? "0 1px 3px rgba(0,0,0,0.9)" : "none",
                position: "relative",
                zIndex: 2,
              }}
            >
              {tile.id + 1}
            </span>

            {/* Price bottom */}
            <span
              style={{
                fontSize: 7,
                lineHeight: 1,
                fontFamily: "monospace",
                color: tile.isMine ? "#00ff88" : tile.isActive ? "rgba(255,255,255,0.85)" : "#2a2a2a",
                userSelect: "none",
                alignSelf: "flex-end",
                textShadow: tile.isActive ? "0 1px 3px rgba(0,0,0,0.9)" : "none",
                position: "relative",
                zIndex: 2,
              }}
            >
              {tile.price.toFixed(3)}
            </span>

            {/* My tile indicator dot */}
            {tile.isMine && (
              <span
                className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full"
                style={{ background: "#00ff88", boxShadow: "0 0 4px rgba(0,255,136,0.8)" }}
                aria-hidden="true"
              />
            )}

            {/* Hover tooltip */}
            {isHovered && (
              <div
                className="absolute z-20 pointer-events-none"
                style={{
                  bottom: "115%",
                  left: "50%",
                  transform: "translateX(-50%)",
                  whiteSpace: "nowrap",
                  animation: "fadeInUp 0.12s ease-out forwards",
                }}
              >
                <div
                  className="px-2.5 py-1.5 rounded text-xs"
                  style={{
                    background: "#1a1a1a",
                    border: "1px solid #333",
                    color: "#e0e0e0",
                    fontFamily: "monospace",
                    fontSize: 10,
                    boxShadow: "0 4px 12px rgba(0,0,0,0.7)",
                  }}
                >
                  <div className="font-bold mb-0.5">
                    {tile.isMine ? (
                      <span style={{ color: "#00ff88" }}>YOURS</span>
                    ) : tile.isActive ? (
                      <span style={{ color: "#aaa" }}>OWNED</span>
                    ) : (
                      <span style={{ color: "#555" }}>EMPTY</span>
                    )}
                    <span style={{ color: "#444" }}> #{tile.id + 1}</span>
                  </div>
                  {tile.owner && (
                    <div style={{ color: "#666" }}>
                      {tile.owner.slice(0, 6)}...{tile.owner.slice(-4)}
                    </div>
                  )}
                  <div style={{ color: "#888" }}>{tile.price.toFixed(4)} ETH</div>
                </div>
              </div>
            )}
          </button>
        );
      })}
      </div>
    </div>
  );
}
