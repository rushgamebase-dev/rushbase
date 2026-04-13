"use client";

import { useState } from "react";
import type { Tile } from "@/lib/mock";

interface TilesGridProps {
  tiles: Tile[];
  myAddress?: string;
  onTileClick: (tile: Tile) => void;
}

/**
 * Tile IDs blocked from purchase via UI.
 * Currently holds tiles that got foreclosed on-chain (owner = 0x0)
 * during the grace period and must not be claimable through the UI.
 * The 46+ healthy tiles remain fully interactive.
 */
export const CLOSED_TILE_IDS = new Set<number>([
  // Original 5 closed during V2 migration
  13, 45, 87, 88, 99,
  // 22 foreclosed on 2026-04-13 for unpaid Harberger tax
  15, 16, 17, 19, 24, 37, 44, 46, 47, 48, 50, 51, 52, 54, 66, 70, 71, 76, 77, 81, 82, 92,
]);

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
        @keyframes dealPulse {
          0%, 100% { box-shadow: 0 0 6px rgba(255,215,0,0.3), inset 0 0 6px rgba(255,215,0,0.05); border-color: rgba(255,215,0,0.4); }
          50% { box-shadow: 0 0 18px rgba(255,215,0,0.6), inset 0 0 10px rgba(255,215,0,0.1); border-color: rgba(255,215,0,0.8); }
        }
        .closed-tile {
          filter: grayscale(0.3) brightness(0.75);
        }
      `}</style>
      <div
        className="grid gap-[3px] rounded-lg p-1"
        style={{ gridTemplateColumns: "repeat(10, 1fr)", background: "#0a0a0a" }}
        role="grid"
        aria-label="Tiles grid 10 by 10"
      >
      {(() => {
        const ownedPrices = tiles.filter(t => t.isActive && !t.isMine && !CLOSED_TILE_IDS.has(t.id)).map(t => t.price);
        const floorPrice = ownedPrices.length > 0 ? Math.min(...ownedPrices) : 0;
        return tiles.map((tile) => {
        const isHovered = hoveredId === tile.id;
        const hasImage = tile.isActive && !!tile.owner;
        const row = Math.floor(tile.id / 10);
        const col = tile.id % 10;
        const sweepDelay = ((row + col) / 18) * 5;
        const isClosed = CLOSED_TILE_IDS.has(tile.id);
        const isCheapest = !isClosed && tile.isActive && !tile.isMine && tile.price === floorPrice && floorPrice > 0;

        let borderColor = "#222";
        let shadow = "none";
        let animStyle = "";

        if (isClosed) {
          borderColor = "rgba(180,40,40,0.55)";
          shadow = "inset 0 0 8px rgba(0,0,0,0.6)";
        } else if (isCheapest) {
          borderColor = "rgba(255,215,0,0.5)";
          shadow = "0 0 10px rgba(255,215,0,0.3)";
          animStyle = "dealPulse 1.8s ease-in-out infinite";
        } else if (tile.isMine) {
          borderColor = "rgba(0,255,136,0.7)";
          shadow = "0 0 8px rgba(0,255,136,0.4)";
          animStyle = "myTilePulse 2s ease-in-out infinite";
        } else if (tile.isActive && tile.owner) {
          const hue = addressHue(tile.owner);
          borderColor = `hsla(${hue}, 60%, 50%, 0.3)`;
        }

        if (isHovered && !isClosed) {
          borderColor = tile.isMine ? "rgba(0,255,136,1)" : "#666";
          shadow = "0 0 12px rgba(255,255,255,0.15)";
        }

        return (
          <button
            key={tile.id}
            className={`relative flex flex-col items-start justify-between rounded-sm overflow-hidden${isClosed ? " closed-tile" : ""}`}
            style={{
              background: isClosed
                ? `url(/tiles/foreclosed.png) center/cover`
                : hasImage
                ? `url(${getTileImage(tile.owner!)}) center/cover`
                : "#141414",
              border: `2px solid ${borderColor}`,
              boxShadow: shadow,
              transition: "transform 0.15s, border-color 0.2s",
              cursor: isClosed ? "not-allowed" : "pointer",
              transform: isHovered && !isClosed ? "scale(1.18)" : "scale(1)",
              zIndex: isHovered ? 10 : 1,
              aspectRatio: "1",
              animation: animStyle,
              opacity: isClosed ? 0.85 : 1,
            }}
            onMouseEnter={() => setHoveredId(tile.id)}
            onMouseLeave={() => setHoveredId(null)}
            onClick={() => { if (!isClosed) onTileClick(tile); }}
            disabled={isClosed}
            aria-label={
              isClosed
                ? `Tile ${tile.id + 1} — not for sale`
                : `Tile ${tile.id + 1} — ${tile.isMine ? "yours" : tile.isActive ? "owned" : "empty"}, ${tile.price.toFixed(4)} ETH`
            }
            role="gridcell"
          >
            {/* Dark overlay for text readability */}
            {hasImage && !isClosed && (
              <div
                className="absolute inset-0"
                style={{
                  background: "linear-gradient(180deg, rgba(0,0,0,0.5) 0%, transparent 40%, transparent 60%, rgba(0,0,0,0.7) 100%)",
                  zIndex: 1,
                }}
              />
            )}

            {/* Closed tile — foreclosed marker */}
            {isClosed && (
              <>
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    background: "linear-gradient(180deg, transparent 40%, rgba(0,0,0,0.6) 100%)",
                    zIndex: 2,
                  }}
                />
                <span
                  className="absolute bottom-0 left-0 right-0 text-center"
                  style={{
                    background: "rgba(120,20,20,0.9)",
                    color: "#ff9090",
                    fontFamily: "monospace",
                    fontSize: 6,
                    fontWeight: 800,
                    letterSpacing: "0.1em",
                    padding: "1px 0",
                    zIndex: 3,
                    borderTop: "1px solid rgba(255,80,80,0.5)",
                  }}
                >
                  FORECLOSED
                </span>
              </>
            )}

            {/* Number top-left */}
            <span
              style={{
                fontSize: 10,
                lineHeight: 1,
                fontFamily: "monospace",
                fontWeight: 800,
                color: isClosed ? "#ff8080" : tile.isMine ? "#00ff88" : tile.isActive ? "#fff" : "#333",
                userSelect: "none",
                textShadow: tile.isActive || isClosed ? "0 1px 4px rgba(0,0,0,1)" : "none",
                position: "relative",
                zIndex: 3,
                padding: "2px",
              }}
            >
              {tile.id + 1}
            </span>

            {/* Price bottom-right — hidden for closed tiles */}
            {!isClosed && (
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
            )}

            {/* Diagonal neon sweep */}
            {!isClosed && (
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background: "linear-gradient(135deg, transparent 20%, rgba(0,255,200,0.28) 48%, rgba(0,180,255,0.18) 52%, transparent 80%)",
                  opacity: 0,
                  animation: `diagonalSweep 5s ${sweepDelay.toFixed(2)}s ease-in-out infinite`,
                  zIndex: 2,
                  borderRadius: "inherit",
                }}
              />
            )}

            {/* Best deal badge */}
            {isCheapest && (
              <span
                className="absolute top-0 left-0 right-0 text-center text-[6px] font-black tracking-widest py-[1px]"
                style={{
                  background: "rgba(255,215,0,0.2)",
                  color: "#ffd700",
                  fontFamily: "monospace",
                  zIndex: 3,
                  textShadow: "0 0 6px rgba(255,215,0,0.8)",
                  borderBottom: "1px solid rgba(255,215,0,0.3)",
                }}
              >
                DEAL
              </span>
            )}

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
                    {isClosed ? (
                      <span style={{ color: "#ff6464" }}>FORECLOSED</span>
                    ) : tile.isMine ? (
                      <span style={{ color: "#00ff88" }}>YOUR TILE</span>
                    ) : tile.isActive ? (
                      <span style={{ color: "#ffd700" }}>{tile.owner ? getRaccoonName(tile.owner) : "OWNED"}</span>
                    ) : (
                      <span style={{ color: "#555" }}>AVAILABLE</span>
                    )}
                    <span style={{ color: "#444" }}> #{tile.id + 1}</span>
                  </div>
                  {isClosed ? (
                    <div style={{ color: "#888", fontSize: 10 }}>unpaid Harberger tax · permanently closed</div>
                  ) : (
                    <>
                      {tile.owner && (
                        <div style={{ color: "#666", fontSize: 10 }}>
                          {tile.owner.slice(0, 6)}...{tile.owner.slice(-4)}
                        </div>
                      )}
                      <div style={{ color: "#00aaff", fontWeight: 700 }}>{tile.price.toFixed(4)} ETH</div>
                    </>
                  )}
                </div>
              </div>
            )}
          </button>
        );
      });
      })()}
      </div>
    </div>
  );
}
