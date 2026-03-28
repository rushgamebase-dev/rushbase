"use client";

import { useState } from "react";
import type { Tile } from "@/lib/mock";

interface TilesGridProps {
  tiles: Tile[];
  myAddress: string;
  onTileClick: (tile: Tile) => void;
}

export default function TilesGrid({ tiles, onTileClick }: TilesGridProps) {
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  function getTileStyle(tile: Tile) {
    if (tile.isMine) {
      return {
        background: "rgba(0,255,136,0.2)",
        border: "1px solid rgba(0,255,136,0.5)",
        boxShadow: "0 0 8px rgba(0,255,136,0.2)",
      };
    }
    if (tile.isActive) {
      return {
        background: "rgba(0,170,255,0.12)",
        border: "1px solid rgba(0,170,255,0.3)",
      };
    }
    return {
      background: "#111",
      border: "1px solid #1a1a1a",
    };
  }

  function getTileHoverStyle(tile: Tile) {
    if (tile.isMine) {
      return { background: "rgba(0,255,136,0.3)", border: "1px solid rgba(0,255,136,0.7)" };
    }
    if (tile.isActive) {
      return { background: "rgba(0,170,255,0.22)", border: "1px solid rgba(0,170,255,0.5)" };
    }
    return { background: "#1a1a1a", border: "1px solid #2a2a2a" };
  }

  return (
    <div
      className="grid gap-1"
      style={{
        gridTemplateColumns: "repeat(10, 1fr)",
      }}
      role="grid"
      aria-label="Tiles grid — 10x10"
    >
      {tiles.map((tile) => {
        const isHovered = hoveredId === tile.id;
        const base = getTileStyle(tile);
        const hover = isHovered ? getTileHoverStyle(tile) : {};
        const style = { ...base, ...hover, transition: "all 0.1s", cursor: "pointer" };

        return (
          <button
            key={tile.id}
            className="aspect-square rounded-sm flex items-center justify-center relative"
            style={style}
            onMouseEnter={() => setHoveredId(tile.id)}
            onMouseLeave={() => setHoveredId(null)}
            onClick={() => onTileClick(tile)}
            aria-label={`Tile ${tile.id + 1} — ${tile.isMine ? "yours" : tile.isActive ? "owned" : "empty"}`}
            role="gridcell"
          >
            {/* Tile ID label (small) */}
            <span
              className="text-center"
              style={{
                fontSize: 8,
                color: tile.isMine ? "rgba(0,255,136,0.7)" : tile.isActive ? "rgba(0,170,255,0.5)" : "#222",
                fontFamily: "monospace",
                lineHeight: 1,
              }}
            >
              {tile.id + 1}
            </span>

            {/* My tile indicator */}
            {tile.isMine && (
              <span
                className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full"
                style={{ background: "#00ff88" }}
              />
            )}

            {/* Hover tooltip */}
            {isHovered && (
              <div
                className="absolute z-20 pointer-events-none animate-fade-in-up"
                style={{
                  bottom: "110%",
                  left: "50%",
                  transform: "translateX(-50%)",
                  whiteSpace: "nowrap",
                }}
              >
                <div
                  className="px-2 py-1 rounded text-xs"
                  style={{
                    background: "#1a1a1a",
                    border: "1px solid #2a2a2a",
                    color: "#e0e0e0",
                    fontFamily: "monospace",
                    fontSize: 10,
                  }}
                >
                  {tile.isMine ? (
                    <span style={{ color: "#00ff88" }}>YOURS</span>
                  ) : tile.isActive ? (
                    <span style={{ color: "#00aaff" }}>OWNED</span>
                  ) : (
                    <span style={{ color: "#555" }}>EMPTY</span>
                  )}
                  {" · "}
                  <span style={{ color: "#888" }}>{tile.price.toFixed(4)} ETH</span>
                </div>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
