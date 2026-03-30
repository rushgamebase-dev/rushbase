"use client";

import { useState } from "react";
import type { Tile } from "@/lib/mock";

interface TilesGridProps {
  tiles: Tile[];
  myAddress?: string;
  onTileClick: (tile: Tile) => void;
}

/** 20 raccoon tile images */
const TILE_IMAGE_COUNT = 20;

/** Raccoon names for the card */
const RACCOON_NAMES = [
  "Greedy Bandit", "Purple Velvet", "Skyfall Gangster", "Golden Tail", "Inferno Rusher",
  "Voltage Rusher", "Shadow Drifter", "Frost Phantom", "Neon Prowler", "Magma Fury",
  "Cyber Claw", "Storm Chaser", "Venom Striker", "Crystal Seer", "Clockwork Gear",
  "Plasma Ghost", "Iron Whisker", "Cosmic Dash", "Blaze Runner", "Data Scavenger",
];

/** Deterministic raccoon index from owner address */
function getRaccoonIndex(owner: string): number {
  let hash = 0;
  for (let i = 0; i < owner.length; i++) {
    hash = (hash * 31 + owner.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % TILE_IMAGE_COUNT;
}

function getTileImage(owner: string): string {
  return `/tiles/${getRaccoonIndex(owner) + 1}.png`;
}

function getRaccoonName(owner: string): string {
  return RACCOON_NAMES[getRaccoonIndex(owner)];
}

/** Deterministic hue from address */
function addressHue(addr: string): number {
  let hash = 0;
  for (let i = 0; i < addr.length; i++) {
    hash = (hash * 31 + addr.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
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
        @keyframes myTilePulse {
          0%, 100% { box-shadow: 0 0 6px rgba(0,255,136,0.4), inset 0 0 8px rgba(0,255,136,0.1); }
          50% { box-shadow: 0 0 14px rgba(0,255,136,0.7), inset 0 0 12px rgba(0,255,136,0.2); }
        }
        @keyframes diagonalSweep {
          0%, 15% { opacity: 0; }
          50% { opacity: 1; }
          85%, 100% { opacity: 0; }
        }
      `}</style>
      <div
        className="grid gap-[3px] rounded-lg p-1"
        style={{ gridTemplateColumns: "repeat(10, 1fr)", background: "#0a0a0a" }}
        role="grid"
        aria-label="Tiles grid 10 by 10"
      >
      {tiles.map((tile) => {
        const isHovered = hoveredId === tile.id;
        const hasImage = tile.isActive && !!tile.owner;
        const row = Math.floor(tile.id / 10);
        const col = tile.id % 10;
        const sweepDelay = ((row + col) / 18) * 5; // 0-5s spread across diagonal

        let borderColor = "#222";
        let shadow = "none";
        let animStyle = "";

        if (tile.isMine) {
          borderColor = "rgba(0,255,136,0.7)";
          shadow = "0 0 8px rgba(0,255,136,0.4)";
          animStyle = "myTilePulse 2s ease-in-out infinite";
        } else if (tile.isActive && tile.owner) {
          const hue = addressHue(tile.owner);
          borderColor = `hsla(${hue}, 60%, 50%, 0.3)`;
        }

        if (isHovered) {
          borderColor = tile.isMine ? "rgba(0,255,136,1)" : "#666";
          shadow = "0 0 12px rgba(255,255,255,0.15)";
        }

        return (
          <button
            key={tile.id}
            className="relative flex flex-col items-start justify-between rounded-sm overflow-hidden"
            style={{
              background: hasImage ? `url(${getTileImage(tile.owner!)}) center/cover` : "#141414",
              border: `2px solid ${borderColor}`,
              boxShadow: shadow,
              transition: "transform 0.15s, border-color 0.2s",
              cursor: "pointer",
              transform: isHovered ? "scale(1.18)" : "scale(1)",
              zIndex: isHovered ? 10 : 1,
              aspectRatio: "1",
              animation: animStyle,
            }}
            onMouseEnter={() => setHoveredId(tile.id)}
            onMouseLeave={() => setHoveredId(null)}
            onClick={() => onTileClick(tile)}
            aria-label={`Tile ${tile.id + 1} — ${tile.isMine ? "yours" : tile.isActive ? "owned" : "empty"}, ${tile.price.toFixed(4)} ETH`}
            role="gridcell"
          >
            {/* Dark overlay for text readability */}
            {hasImage && (
              <div
                className="absolute inset-0"
                style={{
                  background: "linear-gradient(180deg, rgba(0,0,0,0.5) 0%, transparent 40%, transparent 60%, rgba(0,0,0,0.7) 100%)",
                  zIndex: 1,
                }}
              />
            )}

            {/* Number top-left */}
            <span
              style={{
                fontSize: 10,
                lineHeight: 1,
                fontFamily: "monospace",
                fontWeight: 800,
                color: tile.isMine ? "#00ff88" : tile.isActive ? "#fff" : "#333",
                userSelect: "none",
                textShadow: tile.isActive ? "0 1px 4px rgba(0,0,0,1)" : "none",
                position: "relative",
                zIndex: 2,
                padding: "2px",
              }}
            >
              {tile.id + 1}
            </span>

            {/* Price bottom-right */}
            <span
              style={{
                fontSize: 9,
                lineHeight: 1,
                fontFamily: "monospace",
                fontWeight: 700,
                color: tile.isMine ? "#00ff88" : tile.isActive ? "#fff" : "#333",
                userSelect: "none",
                alignSelf: "flex-end",
                textShadow: tile.isActive ? "0 1px 4px rgba(0,0,0,1)" : "none",
                position: "relative",
                zIndex: 2,
                padding: "2px",
              }}
            >
              {tile.price.toFixed(3)}
            </span>

            {/* Diagonal neon sweep */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: "linear-gradient(135deg, transparent 30%, rgba(0,255,200,0.12) 50%, transparent 70%)",
                opacity: 0,
                animation: `diagonalSweep 5s ${sweepDelay.toFixed(2)}s ease-in-out infinite`,
                zIndex: 2,
                borderRadius: "inherit",
              }}
            />

            {/* My tile pulsing dot */}
            {tile.isMine && (
              <span
                className="absolute top-1 right-1 w-2 h-2 rounded-full"
                style={{
                  background: "#00ff88",
                  boxShadow: "0 0 6px rgba(0,255,136,0.9)",
                  zIndex: 3,
                  animation: "myTilePulse 2s ease-in-out infinite",
                }}
                aria-hidden="true"
              />
            )}

            {/* Hover tooltip */}
            {isHovered && (
              <div
                className="absolute z-20 pointer-events-none"
                style={{
                  bottom: "120%",
                  left: "50%",
                  transform: "translateX(-50%)",
                  whiteSpace: "nowrap",
                }}
              >
                <div
                  className="px-3 py-2 rounded-lg"
                  style={{
                    background: "#111",
                    border: "1px solid #333",
                    color: "#e0e0e0",
                    fontFamily: "monospace",
                    fontSize: 11,
                    boxShadow: "0 4px 16px rgba(0,0,0,0.8)",
                  }}
                >
                  <div className="font-bold mb-0.5">
                    {tile.isMine ? (
                      <span style={{ color: "#00ff88" }}>YOUR TILE</span>
                    ) : tile.isActive ? (
                      <span style={{ color: "#ffd700" }}>{tile.owner ? getRaccoonName(tile.owner) : "OWNED"}</span>
                    ) : (
                      <span style={{ color: "#555" }}>AVAILABLE</span>
                    )}
                    <span style={{ color: "#444" }}> #{tile.id + 1}</span>
                  </div>
                  {tile.owner && (
                    <div style={{ color: "#666", fontSize: 10 }}>
                      {tile.owner.slice(0, 6)}...{tile.owner.slice(-4)}
                    </div>
                  )}
                  <div style={{ color: "#00aaff", fontWeight: 700 }}>{tile.price.toFixed(4)} ETH</div>
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
