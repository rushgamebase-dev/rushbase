"use client";

import { useState } from "react";
import Image from "next/image";
import { ExternalLink, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import Header from "@/components/Header";
import TilesGrid from "@/components/TilesGrid";
import { useTilesContract } from "@/hooks/useTilesContract";
import { useAccount } from "wagmi";
import { formatEther } from "viem";
import { BASE_MAINNET } from "@/lib/contracts";
import type { Tile } from "@/lib/mock";

// ─── Constants ────────────────────────────────────────────────────────────────

const CREATOR_ADDRESS = "0x4c385830c2E241EfeEd070Eb92606B6AedeDA277";
const BASESCAN_CREATOR = `https://basescan.org/address/${CREATOR_ADDRESS}`;
const TOTAL_TILES = 100;

// ─── Constants ───────────────────────────────────────────────────────────────

// ─── Left Sidebar ─────────────────────────────────────────────────────────────

function LeftSidebar() {
  return (
    <aside
      className="flex flex-col gap-5 p-4 overflow-y-auto"
      style={{
        width: "25%",
        minWidth: 200,
        borderRight: "1px solid #1a1a1a",
        background: "#0d0d0d",
      }}
    >
      {/* Logo + token */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Image
            src="/logo.png"
            alt="Rush logo"
            width={40}
            height={40}
            style={{ height: 40, width: "auto", objectFit: "contain" }}
          />
          <span
            className="text-xl font-black tracking-widest"
            style={{ color: "#00ff88", fontFamily: "monospace", textShadow: "0 0 10px rgba(0,255,136,0.4)" }}
          >
            RUSH
          </span>
        </div>

        {/* $RUSH token */}
        <div className="flex items-center gap-2 flex-wrap">
          <a
            href="https://flaunch.gg/base/coins/0xB36A127dBa73F3aA7C70B4e00B7395B86A60e73b"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-bold hover:underline"
            style={{ color: "#ffd700", fontFamily: "monospace" }}
          >
            $RUSH
          </a>
          <button
            onClick={() => { navigator.clipboard.writeText("0xB36A127dBa73F3aA7C70B4e00B7395B86A60e73b"); }}
            className="text-[10px] px-2 py-0.5 rounded hover:opacity-80"
            style={{ background: "#1a1a1a", color: "#888", fontFamily: "monospace", border: "1px solid #333", cursor: "pointer" }}
            title="Copy contract address"
          >
            0xB36A...e73b
          </button>
          <a
            href="https://flaunch.gg/base/coins/0xB36A127dBa73F3aA7C70B4e00B7395B86A60e73b"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs px-2 py-0.5 rounded hover:opacity-80"
            style={{ background: "#1a2a1a", color: "#00ff88", fontFamily: "monospace", border: "1px solid #00ff8833" }}
          >
            Buy on Flaunch
          </a>
        </div>

        {/* Creator */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs" style={{ color: "#444", fontFamily: "monospace" }}>
            Created by
          </span>
          <a
            href={BASESCAN_CREATOR}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs transition-colors"
            style={{ color: "#00aaff", fontFamily: "monospace" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "#44ccff")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "#00aaff")}
          >
            0x4c38...A277
            <ExternalLink size={10} />
          </a>
        </div>
      </div>

      {/* Latest Rewards feed */}
      <div>
        <div
          className="text-xs font-bold tracking-widest mb-2"
          style={{ color: "#555", fontFamily: "monospace" }}
        >
          LATEST REWARDS
        </div>
        <div
          className="px-3 py-4 rounded text-center text-xs"
          style={{ background: "#111", border: "1px solid #1a1a1a", color: "#444", fontFamily: "monospace" }}
        >
          No rewards yet
        </div>
      </div>
    </aside>
  );
}

// ─── Right Sidebar ────────────────────────────────────────────────────────────

interface RightSidebarProps {
  tiles: Tile[];
  totalDistributed: string;
  treasuryBalance: string;
  devPending: string;
  activeTileCount: number;
}

function RightSidebar({ tiles, totalDistributed, treasuryBalance, devPending, activeTileCount }: RightSidebarProps) {
  // Calculate floor price (lowest price among owned tiles)
  const ownedTiles = tiles.filter((t) => t.isActive);
  const floorPrice = ownedTiles.length > 0
    ? Math.min(...ownedTiles.map((t) => t.price))
    : 0.01;

  // Build top holders leaderboard
  const holderMap = new Map<string, number>();
  for (const t of ownedTiles) {
    if (t.owner) {
      holderMap.set(t.owner, (holderMap.get(t.owner) || 0) + 1);
    }
  }
  const topHolders: [string, number][] = [];
  holderMap.forEach((count, addr) => topHolders.push([addr, count]));
  topHolders.sort((a, b) => b[1] - a[1]);
  topHolders.splice(5);

  const totalDist = parseFloat(totalDistributed);
  const treasury = parseFloat(treasuryBalance);
  const devPend = parseFloat(devPending);

  return (
    <aside
      className="hidden lg:flex flex-col gap-3 p-3 overflow-y-auto"
      style={{
        width: "22%",
        minWidth: 180,
        maxWidth: 240,
        borderLeft: "1px solid #1a1a1a",
        background: "#0d0d0d",
      }}
    >
      {/* Floor + Distributed — compact row */}
      <div className="grid grid-cols-2 gap-2">
        <div className="p-2.5 rounded-lg" style={{ background: "#111", border: "1px solid #1a1a1a" }}>
          <div className="text-[9px] font-bold tracking-widest" style={{ color: "#555", fontFamily: "monospace" }}>FLOOR</div>
          <div className="text-sm font-black mt-0.5" style={{ color: "#e0e0e0", fontFamily: "monospace" }}>{floorPrice.toFixed(4)}</div>
          <div className="text-[9px]" style={{ color: "#333", fontFamily: "monospace" }}>ETH</div>
        </div>
        <div className="p-2.5 rounded-lg" style={{ background: "#111", border: "1px solid rgba(255,215,0,0.12)" }}>
          <div className="text-[9px] font-bold tracking-widest" style={{ color: "#555", fontFamily: "monospace" }}>PAID OUT</div>
          <div className="text-sm font-black mt-0.5" style={{ color: "#ffd700", fontFamily: "monospace" }}>{totalDist.toFixed(3)}</div>
          <div className="text-[9px]" style={{ color: "#333", fontFamily: "monospace" }}>ETH</div>
        </div>
      </div>

      {/* Pending — compact */}
      <div className="p-2.5 rounded-lg" style={{ background: "#111", border: "1px solid rgba(0,255,136,0.1)" }}>
        <div className="text-[9px] font-bold tracking-widest mb-1.5" style={{ color: "#555", fontFamily: "monospace" }}>PENDING</div>
        <div className="flex justify-between text-[10px] mb-0.5">
          <span style={{ color: "#666", fontFamily: "monospace" }}>Treasury</span>
          <span style={{ color: "#00ff88", fontFamily: "monospace" }}>{treasury.toFixed(4)}</span>
        </div>
        <div className="flex justify-between text-[10px]">
          <span style={{ color: "#666", fontFamily: "monospace" }}>Protocol</span>
          <span style={{ color: "#00aaff", fontFamily: "monospace" }}>{(treasury + devPend).toFixed(4)}</span>
        </div>
        <div className="text-[9px] mt-1.5" style={{ color: "#333", fontFamily: "monospace" }}>{activeTileCount} active tiles</div>
      </div>

      {/* Separator */}
      <div style={{ height: 1, background: "linear-gradient(90deg, transparent, #1a1a1a, transparent)" }} />

      {/* Top Holders — compact */}
      <div>
        <div className="text-[9px] font-bold tracking-widest mb-1.5" style={{ color: "#555", fontFamily: "monospace" }}>
          TOP HOLDERS
        </div>
        {topHolders.length > 0 ? (
          <div className="flex flex-col gap-[3px]">
            {topHolders.map(([addr, count], i) => (
              <div key={addr} className="flex items-center gap-1.5 px-2 py-1.5 rounded"
                style={{ background: "#111", border: "1px solid #151515", fontFamily: "monospace" }}>
                <span className="text-[9px] font-black w-4" style={{
                  color: i === 0 ? "#ffd700" : i === 1 ? "#c0c0c0" : i === 2 ? "#cd7f32" : "#444",
                }}>
                  {i + 1}
                </span>
                <span className="text-[9px] flex-1 truncate" style={{ color: "#777" }}>
                  {addr.slice(2, 6)}...{addr.slice(-3)}
                </span>
                <span className="text-[10px] font-black" style={{ color: "#e0e0e0" }}>
                  {count}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-2 py-3 rounded text-center text-[10px]"
            style={{ background: "#111", border: "1px solid #151515", color: "#333", fontFamily: "monospace" }}>
            No holders yet
          </div>
        )}
      </div>
    </aside>
  );
}

// ─── Tile Modal ───────────────────────────────────────────────────────────────

interface TileModalProps {
  tile: Tile;
  onClose: () => void;
  onAction: (action?: string) => Promise<void>;
  isLoading: boolean;
  newPrice: string;
  setNewPrice: (v: string) => void;
  txHash?: string;
  isSuccess?: boolean;
  explorerUrl: string;
  contractLoading: boolean;
}

function TileModal({
  tile,
  onClose,
  onAction,
  isLoading,
  newPrice,
  setNewPrice,
  txHash,
  isSuccess,
  explorerUrl,
  contractLoading,
}: TileModalProps) {
  const busy = isLoading || contractLoading;

  // Raccoon identity
  const RACCOON_NAMES = [
    "Greedy Bandit", "Purple Velvet", "Skyfall Gangster", "Golden Tail", "Inferno Rusher",
    "Voltage Rusher", "Shadow Drifter", "Frost Phantom", "Neon Prowler", "Magma Fury",
    "Cyber Claw", "Storm Chaser", "Venom Striker", "Crystal Seer", "Clockwork Gear",
    "Plasma Ghost", "Iron Whisker", "Cosmic Dash", "Blaze Runner", "Data Scavenger",
  ];
  const getRaccIdx = (o: string) => { let h = 0; for (let i = 0; i < o.length; i++) h = (h * 31 + o.charCodeAt(i)) | 0; return Math.abs(h) % 20; };
  const raccIdx = tile.owner ? getRaccIdx(tile.owner) : 0;
  const raccName = RACCOON_NAMES[raccIdx];
  const raccImage = `/tiles/${raccIdx + 1}.png`;

  // Rarity based on price
  const rarity = tile.price >= 0.5 ? "LEGENDARY" : tile.price >= 0.1 ? "EPIC" : tile.price >= 0.03 ? "RARE" : "COMMON";
  const rarityColor = rarity === "LEGENDARY" ? "#ffd700" : rarity === "EPIC" ? "#aa44ff" : rarity === "RARE" ? "#00aaff" : "#666";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.85)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={`Tile ${tile.id + 1} details`}
    >
      <style>{`
        @keyframes cardShine {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes feePulse {
          0%, 100% { opacity: 1; text-shadow: 0 0 8px rgba(0,255,136,0.6); }
          50% { opacity: 0.7; text-shadow: 0 0 16px rgba(0,255,136,1); }
        }
        @keyframes priceGlow {
          0%, 100% { text-shadow: 0 0 4px rgba(255,215,0,0.4); }
          50% { text-shadow: 0 0 12px rgba(255,215,0,0.8); }
        }
        @keyframes diagonalSweep {
          0%, 15% { opacity: 0.4; }
          50% { opacity: 1; }
          85%, 100% { opacity: 0.4; }
        }
      `}</style>
      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.9, rotateY: -15 }}
        animate={{ opacity: 1, y: 0, scale: 1, rotateY: 0 }}
        exit={{ opacity: 0, y: 20, scale: 0.95 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="w-full max-w-sm rounded-2xl overflow-hidden"
        style={{
          background: "#0a0a0a",
          border: `2px solid ${rarityColor}44`,
          boxShadow: `0 0 30px ${rarityColor}22, 0 24px 48px rgba(0,0,0,0.8)`,
        }}
      >
        {/* Card top shine bar */}
        <div style={{
          height: 3,
          background: `linear-gradient(90deg, transparent, ${rarityColor}, transparent)`,
          backgroundSize: "200% 100%",
          animation: "cardShine 3s linear infinite",
        }} />

        {/* Raccoon image + close */}
        <div className="relative" style={{ height: 200, overflow: "hidden" }}>
          {tile.isActive && tile.owner ? (
            <img
              src={raccImage}
              alt={raccName}
              className="w-full h-full object-cover"
              style={{ filter: "brightness(0.85)" }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center" style={{ background: "#111" }}>
              <span style={{ color: "#333", fontSize: 48, fontFamily: "monospace" }}>?</span>
            </div>
          )}
          {/* Gradient overlay */}
          <div className="absolute inset-0" style={{
            background: "linear-gradient(180deg, transparent 40%, rgba(10,10,10,0.9) 90%, #0a0a0a 100%)",
          }} />
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.6)", border: "1px solid #333", color: "#888", cursor: "pointer", backdropFilter: "blur(4px)" }}
            aria-label="Close"
          >
            <X size={14} />
          </button>
          {/* Rarity badge */}
          <div className="absolute top-3 left-3 px-2 py-0.5 rounded-full text-[10px] font-black tracking-widest"
            style={{ background: `${rarityColor}22`, border: `1px solid ${rarityColor}55`, color: rarityColor, fontFamily: "monospace" }}>
            {rarity}
          </div>
          {/* Tile number + name overlay */}
          <div className="absolute bottom-3 left-4 right-4">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black" style={{ color: "#fff", fontFamily: "monospace", textShadow: "0 2px 8px rgba(0,0,0,1)" }}>
                #{tile.id + 1}
              </span>
              {tile.owner && (
                <span className="text-sm font-bold" style={{ color: rarityColor, fontFamily: "monospace", textShadow: "0 2px 6px rgba(0,0,0,1)" }}>
                  {raccName}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Lower panel — dark premium surface */}
        <div className="relative px-5 pb-5 pt-3 flex flex-col gap-3" style={{
          background: "linear-gradient(180deg, rgba(15,12,10,0.95) 0%, #080808 100%)",
        }}>
          {/* Subtle inner top highlight */}
          <div className="absolute top-0 left-0 right-0 h-px" style={{ background: `linear-gradient(90deg, transparent 10%, ${rarityColor}22 50%, transparent 90%)` }} />

          {/* Badge row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded text-[9px] font-black tracking-[0.15em]"
                style={{
                  background: `linear-gradient(135deg, ${rarityColor}12, ${rarityColor}06)`,
                  border: `1px solid ${rarityColor}25`,
                  color: rarityColor,
                  fontFamily: "monospace",
                  boxShadow: `inset 0 1px 0 ${rarityColor}08, 0 1px 3px rgba(0,0,0,0.4)`,
                }}>
                {tile.isMine ? "PARTNER" : tile.isActive ? "HELD" : "WILD"}
              </span>
              {tile.owner && (
                <a href={`https://basescan.org/address/${tile.owner}`} target="_blank" rel="noopener noreferrer"
                  className="text-[10px] transition-colors" style={{ color: "#777", fontFamily: "monospace" }}
                  onMouseEnter={(e) => ((e.target as HTMLElement).style.color = "#bbb")}
                  onMouseLeave={(e) => ((e.target as HTMLElement).style.color = "#777")}>
                  {tile.owner.slice(0, 6)}...{tile.owner.slice(-4)}
                </a>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-bold tracking-wider" style={{ color: "#666", fontFamily: "monospace" }}>LVL</span>
              <div className="flex gap-[2px]">
                {[0, 1, 2, 3, 4].map((i) => {
                  const filled = tile.price >= [0.01, 0.03, 0.06, 0.1, 0.2][i];
                  return (
                    <div key={i} className="w-[6px] h-[10px] rounded-[1px]" style={{
                      background: filled ? rarityColor : "#151515",
                      boxShadow: filled ? `0 0 4px ${rarityColor}55` : "inset 0 1px 1px rgba(0,0,0,0.4)",
                      opacity: filled ? 1 : 0.4,
                      animation: filled ? `diagonalSweep 4s ${i * 0.3}s ease-in-out infinite` : "none",
                    }} />
                  );
                })}
              </div>
            </div>
          </div>

          {/* Stats panel — recessed surface */}
          <div className="rounded-lg overflow-hidden" style={{
            background: "linear-gradient(180deg, #0c0c0c, #090909)",
            border: "1px solid #151515",
            boxShadow: "inset 0 2px 4px rgba(0,0,0,0.4), 0 1px 0 rgba(255,255,255,0.02)",
          }}>
            {[
              { label: "VALUE", value: tile.price.toFixed(4), max: 0.5, color: "#ffd700" },
              { label: "TAX/WK", value: (tile.price * 0.05).toFixed(4), max: 0.025, color: "#ff4488" },
              { label: "BUYOUT", value: (tile.price * 1.15).toFixed(4), max: 0.6, color: "#00ccff" },
            ].map((stat, i) => (
              <div key={stat.label} className="flex items-center gap-3 px-3 py-[7px]"
                style={{ borderTop: i > 0 ? "1px solid #111" : "none" }}>
                <span className="text-[9px] w-11 text-right font-bold tracking-wide" style={{ color: "#777", fontFamily: "monospace" }}>{stat.label}</span>
                <div className="flex-1 h-[3px] rounded-sm overflow-hidden" style={{ background: "#0a0a0a", boxShadow: "inset 0 1px 1px rgba(0,0,0,0.5)" }}>
                  <div className="h-full rounded-sm transition-all duration-500" style={{
                    width: `${Math.min(100, (parseFloat(stat.value) / stat.max) * 100)}%`,
                    background: `linear-gradient(90deg, ${stat.color}55, ${stat.color}cc)`,
                    boxShadow: `0 0 8px ${stat.color}22`,
                  }} />
                </div>
                <span className="text-[10px] font-black w-[72px] text-right tabular-nums" style={{ color: stat.color, fontFamily: "monospace", textShadow: `0 0 12px ${stat.color}15` }}>
                  {stat.value}
                </span>
              </div>
            ))}
          </div>

          {/* Pending fees */}
          {tile.isMine && tile.pendingFees > 0 && (
            <div className="flex justify-between items-center px-3 py-2.5 rounded-lg"
              style={{
                background: "linear-gradient(135deg, rgba(0,255,136,0.04), rgba(0,255,136,0.02))",
                border: "1px solid rgba(0,255,136,0.1)",
                boxShadow: "inset 0 1px 0 rgba(0,255,136,0.03), 0 0 20px rgba(0,255,136,0.03)",
              }}>
              <span className="text-[9px] font-bold tracking-[0.15em]" style={{ color: "rgba(0,255,136,0.6)", fontFamily: "monospace" }}>REWARDS</span>
              <span className="text-sm font-black tabular-nums" style={{
                color: "#00ff88",
                fontFamily: "monospace",
                animation: "feePulse 2s ease-in-out infinite",
              }}>
                +{tile.pendingFees.toFixed(5)} ETH
              </span>
            </div>
          )}

          {/* Tx success */}
          {txHash && isSuccess && (
            <a href={`${explorerUrl}/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-between px-3 py-2.5 rounded-lg text-xs transition-all"
              style={{
                background: "linear-gradient(135deg, rgba(0,255,136,0.04), rgba(0,255,136,0.02))",
                border: "1px solid rgba(0,255,136,0.12)",
                color: "#00ff88",
                fontFamily: "monospace",
              }}>
              <span>Transaction confirmed</span>
              <ExternalLink size={11} />
            </a>
          )}

          {/* Divider */}
          <div style={{ height: 1, background: "linear-gradient(90deg, transparent 5%, #1a1a1a 50%, transparent 95%)" }} />

          {/* Actions */}
          <div className="flex flex-col gap-2.5">
            {/* CLAIM — empty tile */}
            {!tile.isActive && (
              <button
                onClick={() => onAction("claim")}
                disabled={busy}
                className="w-full py-3 rounded-lg text-sm font-black tracking-wider transition-all"
                style={{
                  background: "linear-gradient(180deg, rgba(0,255,136,0.12), rgba(0,255,136,0.06))",
                  border: "1px solid rgba(0,255,136,0.25)",
                  color: "#00ff88",
                  fontFamily: "monospace",
                  boxShadow: "0 0 20px rgba(0,255,136,0.06), inset 0 1px 0 rgba(0,255,136,0.08)",
                  letterSpacing: "0.1em",
                }}
              >
                {busy ? "CLAIMING..." : "CLAIM — 0.01 ETH"}
              </button>
            )}

            {/* BUYOUT — someone else's tile */}
            {tile.isActive && !tile.isMine && (() => {
              const effPrice = tile.effectivePrice ?? tile.price;
              const chosenPrice = newPrice ? parseFloat(newPrice) : effPrice;
              const buyoutFee = effPrice * 0.10;
              const appTax = chosenPrice > effPrice ? (chosenPrice - effPrice) * 0.30 : 0;
              const minDeposit = chosenPrice * 0.05;
              const totalCost = effPrice + buyoutFee + appTax + minDeposit;
              return (
                <div className="flex flex-col gap-2.5">
                  {/* Cost breakdown — recessed panel */}
                  <div className="rounded-lg px-3 py-2.5 flex flex-col gap-1" style={{
                    background: "#0a0a0a",
                    border: "1px solid #131313",
                    boxShadow: "inset 0 2px 4px rgba(0,0,0,0.3)",
                  }}>
                    {[
                      { l: "Effective price", v: effPrice, note: effPrice < tile.price ? "decayed" : "" },
                      { l: "Buyout fee (10%)", v: buyoutFee, note: "" },
                      ...(appTax > 0 ? [{ l: "Appreciation (30%)", v: appTax, note: "" }] : []),
                      { l: "Deposit (5%)", v: minDeposit, note: "" },
                    ].map((r) => (
                      <div key={r.l} className="flex justify-between text-[10px]" style={{ fontFamily: "monospace" }}>
                        <span style={{ color: "#888" }}>{r.l} {r.note && <span style={{ color: "#ff448855" }}>{r.note}</span>}</span>
                        <span style={{ color: "#ccc" }}>{r.v.toFixed(4)}</span>
                      </div>
                    ))}
                  </div>

                  {/* Price presets */}
                  <div className="flex gap-1.5 flex-wrap">
                    {[effPrice, effPrice * 1.5, effPrice * 2, effPrice * 3].map((v) => {
                      const sel = newPrice === v.toFixed(4);
                      return (
                        <button key={v} onClick={() => setNewPrice(v.toFixed(4))}
                          className="px-2.5 py-1.5 rounded text-[10px] font-bold transition-all"
                          style={{
                            background: sel ? "linear-gradient(180deg, rgba(0,170,255,0.15), rgba(0,170,255,0.08))" : "#0a0a0a",
                            border: `1px solid ${sel ? "rgba(0,170,255,0.35)" : "#181818"}`,
                            color: sel ? "#00ccff" : "#888",
                            fontFamily: "monospace",
                            cursor: "pointer",
                            boxShadow: sel ? "0 0 10px rgba(0,170,255,0.08), inset 0 1px 0 rgba(0,170,255,0.06)" : "inset 0 1px 2px rgba(0,0,0,0.3)",
                          }}>
                          {v.toFixed(4)}
                        </button>
                      );
                    })}
                  </div>

                  {/* Price input */}
                  <input type="number" placeholder="Custom price (ETH)" value={newPrice}
                    onChange={(e) => setNewPrice(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg text-xs"
                    style={{
                      fontFamily: "monospace",
                      background: "#0a0a0a",
                      border: "1px solid #181818",
                      color: "#ddd",
                      boxShadow: "inset 0 2px 4px rgba(0,0,0,0.3)",
                      outline: "none",
                    }}
                    min={effPrice.toFixed(6)} step="0.001"
                    onFocus={(e) => { e.target.style.borderColor = "rgba(0,170,255,0.3)"; e.target.style.boxShadow = "inset 0 2px 4px rgba(0,0,0,0.3), 0 0 8px rgba(0,170,255,0.06)"; }}
                    onBlur={(e) => { e.target.style.borderColor = "#181818"; e.target.style.boxShadow = "inset 0 2px 4px rgba(0,0,0,0.3)"; }}
                  />

                  {/* Buyout CTA */}
                  <button onClick={() => onAction("buyout")} disabled={busy}
                    className="w-full py-3 rounded-lg text-sm font-black tracking-wider transition-all"
                    style={{
                      background: "linear-gradient(180deg, rgba(0,170,255,0.14), rgba(0,100,200,0.08))",
                      border: "1px solid rgba(0,170,255,0.25)",
                      color: "#00ccff",
                      fontFamily: "monospace",
                      boxShadow: "0 0 24px rgba(0,170,255,0.06), inset 0 1px 0 rgba(0,200,255,0.08)",
                      letterSpacing: "0.1em",
                    }}>
                    {busy ? "ACQUIRING..." : `BUYOUT — ${(totalCost * 1.05).toFixed(4)} ETH`}
                  </button>
                </div>
              );
            })()}

            {/* OWN TILE — set price + abandon */}
            {tile.isMine && (
              <>
                <div className="flex flex-col gap-2.5">
                  {/* Price presets */}
                  <div className="flex gap-1.5 flex-wrap">
                    {[0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1].map((v) => {
                      const sel = newPrice === String(v);
                      return (
                        <button key={v} onClick={() => setNewPrice(String(v))}
                          className="px-2.5 py-1.5 rounded text-[10px] font-bold transition-all"
                          style={{
                            background: sel ? "linear-gradient(180deg, rgba(0,255,136,0.12), rgba(0,255,136,0.06))" : "#0a0a0a",
                            border: `1px solid ${sel ? "rgba(0,255,136,0.3)" : "#181818"}`,
                            color: sel ? "#00ff88" : "#888",
                            fontFamily: "monospace",
                            cursor: "pointer",
                            boxShadow: sel ? "0 0 10px rgba(0,255,136,0.06), inset 0 1px 0 rgba(0,255,136,0.05)" : "inset 0 1px 2px rgba(0,0,0,0.3)",
                          }}>
                          {v} ETH
                        </button>
                      );
                    })}
                  </div>

                  {/* Price input + SET */}
                  <div className="flex gap-2">
                    <input type="number" placeholder="New price (ETH)" value={newPrice}
                      onChange={(e) => setNewPrice(e.target.value)}
                      className="flex-1 px-3 py-2.5 rounded-lg text-xs"
                      style={{
                        fontFamily: "monospace",
                        background: "#0a0a0a",
                        border: "1px solid #181818",
                        color: "#aaa",
                        boxShadow: "inset 0 2px 4px rgba(0,0,0,0.3)",
                        outline: "none",
                      }}
                      min="0.01" step="0.01"
                      onFocus={(e) => { e.target.style.borderColor = "rgba(0,255,136,0.25)"; }}
                      onBlur={(e) => { e.target.style.borderColor = "#181818"; }}
                    />
                    <button onClick={() => onAction("setprice")} disabled={!newPrice || busy}
                      className="px-4 py-2.5 rounded-lg text-xs font-black tracking-wider transition-all"
                      style={{
                        background: newPrice ? "linear-gradient(180deg, rgba(0,255,136,0.12), rgba(0,255,136,0.06))" : "#0a0a0a",
                        border: `1px solid ${newPrice ? "rgba(0,255,136,0.25)" : "#151515"}`,
                        color: newPrice ? "#00ff88" : "#666",
                        fontFamily: "monospace",
                        boxShadow: newPrice ? "0 0 12px rgba(0,255,136,0.04)" : "none",
                      }}>
                      SET
                    </button>
                  </div>
                </div>

                {/* Abandon — dangerous, muted */}
                <button onClick={() => onAction("abandon")} disabled={busy}
                  className="w-full py-2.5 rounded-lg text-[10px] font-bold tracking-wider transition-all"
                  style={{
                    background: "rgba(255,40,40,0.04)",
                    border: "1px solid rgba(255,40,40,0.1)",
                    color: "#884444",
                    fontFamily: "monospace",
                  }}
                  onMouseEnter={(e) => { (e.target as HTMLElement).style.color = "#ff4444"; (e.target as HTMLElement).style.borderColor = "rgba(255,68,68,0.25)"; }}
                  onMouseLeave={(e) => { (e.target as HTMLElement).style.color = "#884444"; (e.target as HTMLElement).style.borderColor = "rgba(255,40,40,0.1)"; }}
                >
                  ABANDON TILE
                </button>
              </>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function TilesPage() {
  const { address: walletAddress } = useAccount();

  const tilesContract = useTilesContract();

  const tiles: Tile[] = tilesContract.tiles.length > 0
    ? tilesContract.tiles.map((t, i) => {
        const isOwned = t.owner !== "0x0000000000000000000000000000000000000000";
        const isMine = isOwned && walletAddress
          ? t.owner.toLowerCase() === walletAddress.toLowerCase()
          : false;
        return {
          id: i,
          owner: isOwned ? t.owner : null,
          price: parseFloat(formatEther(t.price)),
          isActive: isOwned,
          pendingFees: 0,
          isMine,
        };
      })
    : Array.from({ length: 100 }, (_, i) => ({
        id: i,
        owner: null,
        price: 0.01,
        isActive: false,
        pendingFees: 0,
        isMine: false,
      }));

  const myAddress = walletAddress ?? "";
  const activeTileCount = tilesContract.totalActiveTiles;
  const totalPendingFees = parseFloat(tilesContract.pendingFees);

  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  const [newPrice, setNewPrice] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const explorerUrl = BASE_MAINNET.blockExplorerUrls[0];

  async function handleAction(action?: string) {
    if (!selectedTile) return;
    setIsLoading(true);

    switch (action) {
      case "claim":
        await tilesContract.claimTile(selectedTile.id, "0.01", "0.0105");
        break;
      case "buyout": {
        const effPrice = selectedTile.effectivePrice ?? selectedTile.price;
        const buyoutNewPrice = newPrice ? parseFloat(newPrice) : effPrice;
        const buyoutFee = effPrice * 0.10;
        const appTax = buyoutNewPrice > effPrice ? (buyoutNewPrice - effPrice) * 0.30 : 0;
        const minDeposit = buyoutNewPrice * 0.05;
        // 5% buffer for rounding
        const totalCost = (effPrice + buyoutFee + appTax + minDeposit) * 1.05;
        await tilesContract.buyoutTile(selectedTile.id, buyoutNewPrice.toFixed(6), totalCost.toFixed(6));
        break;
      }
      case "setprice":
        if (newPrice) {
          const np = parseFloat(newPrice);
          const current = selectedTile.price;
          // If raising price, pay 30% appreciation tax on the increase (+ 5% buffer for rounding)
          const appTax = np > current
            ? ((np - current) * 0.30 * 1.05).toFixed(6)
            : "0";
          await tilesContract.setPrice(selectedTile.id, newPrice, appTax);
        }
        break;
      case "abandon":
        await tilesContract.abandonTile(selectedTile.id);
        break;
      case "claimfees":
        await tilesContract.claimFees();
        break;
    }
    tilesContract.refetchAll();

    setIsLoading(false);
    setSelectedTile(null);
    setNewPrice("");
  }

  async function handleClaimFees() {
    setIsLoading(true);
    await tilesContract.claimFees();
    tilesContract.refetchAll();
    setIsLoading(false);
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#0a0a0a", color: "#e0e0e0" }}>
      <Header />

      {/* 3-column layout */}
      <div className="flex-1 flex overflow-hidden" style={{ minHeight: 0 }}>

        {/* Left Sidebar (25%) — hidden on mobile */}
        <div className="hidden lg:flex" style={{ width: "25%", minWidth: 220 }}>
          <LeftSidebar />
        </div>

        {/* Center (50%) */}
        <main
          className="flex-1 flex flex-col p-4 md:p-6 overflow-y-auto"
          style={{ maxWidth: "100%" }}
        >
          {/* Header row */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-black tracking-widest" style={{ color: "#ffd700", fontFamily: "monospace" }}>
                {activeTileCount}/{TOTAL_TILES} seats
              </h1>
            </div>
            <span className="text-xs" style={{ color: "#555", fontFamily: "monospace" }}>
              click to select
            </span>
          </div>

          {/* Claimable fees banner */}
          {totalPendingFees > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center justify-between p-3 rounded mb-4"
              style={{ background: "rgba(255,215,0,0.06)", border: "1px solid rgba(255,215,0,0.2)" }}
            >
              <div>
                <span className="text-xs font-bold" style={{ color: "#ffd700", fontFamily: "monospace" }}>CLAIMABLE FEES</span>
                <span className="text-sm font-black ml-2" style={{ color: "#ffd700", fontFamily: "monospace" }}>
                  {totalPendingFees.toFixed(5)} ETH
                </span>
              </div>
              <button
                onClick={handleClaimFees}
                disabled={isLoading || tilesContract.isLoading}
                className="px-4 py-1.5 rounded text-xs font-bold transition-all"
                style={{ background: "rgba(255,215,0,0.15)", border: "1px solid rgba(255,215,0,0.4)", color: "#ffd700", fontFamily: "monospace" }}
              >
                {isLoading || tilesContract.isLoading ? "CLAIMING..." : "CLAIM ALL FEES"}
              </button>
            </motion.div>
          )}

          {/* 10x10 Grid */}
          <div
            className="p-4 rounded-lg"
            style={{ background: "#111", border: "1px solid #1a1a1a" }}
          >
            <TilesGrid tiles={tiles} myAddress={myAddress} onTileClick={setSelectedTile} />
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-4 mt-4 text-xs" style={{ fontFamily: "monospace" }}>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm" style={{ background: "rgba(0,255,136,0.2)", border: "1px solid rgba(0,255,136,0.5)" }} />
              <span style={{ color: "#666" }}>Your tiles</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm" style={{ background: "#1a1a1a", border: "1px solid #333" }} />
              <span style={{ color: "#666" }}>Owned by others</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm" style={{ background: "#0d0d0d", border: "1px solid #1a1a1a" }} />
              <span style={{ color: "#666" }}>Empty — claim for 0.01 ETH</span>
            </div>
          </div>

          {/* Info row */}
          <div className="mt-4 p-3 rounded text-xs" style={{ color: "#555", fontFamily: "monospace", background: "#0d0d0d", border: "1px solid #1a1a1a" }}>
            <span style={{ color: "#ffd700" }}>HOW IT WORKS</span>
            {" — "}
            Claim a seat for 0.01 ETH minimum. Earn a proportional share of every market fee. Anyone can buy out your seat at your listed price + 10%. Harberger tax: 5%/week on self-assessed value.
          </div>
        </main>

        {/* Right Sidebar (25%) — hidden on mobile */}
        <div className="hidden lg:flex" style={{ width: "25%", minWidth: 220 }}>
          <RightSidebar
            tiles={tiles}
            totalDistributed={tilesContract.totalDistributed}
            treasuryBalance={tilesContract.treasuryBalance}
            devPending={tilesContract.devPending}
            activeTileCount={activeTileCount}
          />
        </div>
      </div>

      {/* Tile modal */}
      <AnimatePresence>
        {selectedTile && (
          <TileModal
            tile={selectedTile}
            onClose={() => { setSelectedTile(null); setNewPrice(""); }}
            onAction={handleAction}
            isLoading={isLoading}
            newPrice={newPrice}
            setNewPrice={setNewPrice}
            txHash={tilesContract.txHash ?? undefined}
            isSuccess={tilesContract.isSuccess}
            explorerUrl={explorerUrl}
            contractLoading={tilesContract.isLoading}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
