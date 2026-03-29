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
            href="https://basescan.org/token/0xB36A127dBa73F3aA7C70B4e00B7395B86A60e73b"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-bold hover:underline"
            style={{ color: "#ffd700", fontFamily: "monospace" }}
          >
            $RUSH
          </a>
          <a
            href="https://app.uniswap.org/swap?outputCurrency=0xB36A127dBa73F3aA7C70B4e00B7395B86A60e73b&chain=base"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs px-2 py-0.5 rounded hover:opacity-80"
            style={{ background: "#1a2a1a", color: "#00ff88", fontFamily: "monospace", border: "1px solid #00ff8833" }}
          >
            Buy on Uniswap
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

function RightSidebar() {
  return (
    <aside
      className="flex flex-col gap-4 p-4 overflow-y-auto"
      style={{
        width: "25%",
        minWidth: 200,
        borderLeft: "1px solid #1a1a1a",
        background: "#0d0d0d",
      }}
    >
      {/* Floor Price card */}
      <div
        className="p-4 rounded-lg"
        style={{ background: "#111", border: "1px solid #1a1a1a" }}
      >
        <div className="text-xs font-bold tracking-widest mb-2" style={{ color: "#555", fontFamily: "monospace" }}>
          FLOOR PRICE
        </div>
        <div className="text-2xl font-black" style={{ color: "#e0e0e0", fontFamily: "monospace" }}>
          0.01 ETH
        </div>
        <div className="text-xs mt-1" style={{ color: "#555", fontFamily: "monospace" }}>
          base claim price
        </div>
      </div>

      {/* Total Rewards card */}
      <div
        className="p-4 rounded-lg"
        style={{ background: "#111", border: "1px solid rgba(255,215,0,0.15)" }}
      >
        <div className="text-xs font-bold tracking-widest mb-2" style={{ color: "#555", fontFamily: "monospace" }}>
          TOTAL REWARDS
        </div>
        <div className="text-2xl font-black" style={{ color: "#ffd700", fontFamily: "monospace" }}>
          0.00 ETH
        </div>
        <div className="text-xs mt-1" style={{ color: "#555", fontFamily: "monospace" }}>
          distributed all time
        </div>
      </div>

      {/* Top Seat Holders leaderboard */}
      <div>
        <div className="text-xs font-bold tracking-widest mb-2" style={{ color: "#555", fontFamily: "monospace" }}>
          TOP SEAT HOLDERS
        </div>
        <div
          className="px-3 py-4 rounded text-center text-xs"
          style={{ background: "#111", border: "1px solid #1a1a1a", color: "#444", fontFamily: "monospace" }}
        >
          No holders yet
        </div>
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
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.75)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={`Tile ${tile.id + 1} details`}
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.97 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="w-full max-w-sm rounded-xl"
        style={{ background: "#111", border: "1px solid #2a2a2a", boxShadow: "0 24px 48px rgba(0,0,0,0.6)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid #1a1a1a" }}>
          <span className="text-sm font-black tracking-widest" style={{ color: "#e0e0e0", fontFamily: "monospace" }}>
            TILE #{tile.id + 1}
          </span>
          <button onClick={onClose} style={{ color: "#555", background: "none", border: "none", cursor: "pointer" }} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {/* Info rows */}
          <div className="flex flex-col gap-2">
            <div className="flex justify-between text-xs">
              <span style={{ color: "#555", fontFamily: "monospace" }}>STATUS</span>
              <span style={{ color: tile.isMine ? "#00ff88" : tile.isActive ? "#00aaff" : "#555", fontFamily: "monospace", fontWeight: 700 }}>
                {tile.isMine ? "YOURS" : tile.isActive ? "OWNED" : "EMPTY"}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span style={{ color: "#555", fontFamily: "monospace" }}>PRICE</span>
              <span style={{ color: "#e0e0e0", fontFamily: "monospace" }}>{tile.price.toFixed(4)} ETH</span>
            </div>
            {tile.owner && (
              <div className="flex justify-between text-xs">
                <span style={{ color: "#555", fontFamily: "monospace" }}>OWNER</span>
                <span style={{ color: "#888", fontFamily: "monospace" }}>
                  {tile.owner.slice(0, 6)}...{tile.owner.slice(-4)}
                </span>
              </div>
            )}
            {tile.isMine && tile.pendingFees > 0 && (
              <div className="flex justify-between text-xs">
                <span style={{ color: "#555", fontFamily: "monospace" }}>PENDING FEES</span>
                <span style={{ color: "#ffd700", fontFamily: "monospace" }}>{tile.pendingFees.toFixed(5)} ETH</span>
              </div>
            )}
          </div>

          {/* Tx success */}
          {txHash && isSuccess && (
            <a
              href={`${explorerUrl}/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between px-3 py-2 rounded text-xs"
              style={{ background: "rgba(0,255,136,0.06)", border: "1px solid rgba(0,255,136,0.2)", color: "#00ff88", fontFamily: "monospace" }}
            >
              <span>Transaction confirmed</span>
              <ExternalLink size={11} />
            </a>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-2">
            {!tile.isActive && (
              <button
                onClick={() => onAction("claim")}
                disabled={busy}
                className="w-full py-2.5 rounded text-sm font-bold transition-all btn-primary"
                style={{ fontFamily: "monospace" }}
              >
                {busy ? "CLAIMING..." : "CLAIM — 0.01 ETH"}
              </button>
            )}

            {tile.isActive && !tile.isMine && (
              <button
                onClick={() => onAction("buyout")}
                disabled={busy}
                className="w-full py-2.5 rounded text-sm font-bold transition-all"
                style={{ background: "rgba(0,170,255,0.15)", border: "1px solid rgba(0,170,255,0.4)", color: "#00aaff", fontFamily: "monospace" }}
              >
                {busy ? "BUYING OUT..." : `BUYOUT — ${(tile.price * 1.1).toFixed(4)} ETH`}
              </button>
            )}

            {tile.isMine && (
              <>
                <div className="flex gap-2">
                  <input
                    type="number"
                    placeholder="New price (ETH)"
                    value={newPrice}
                    onChange={(e) => setNewPrice(e.target.value)}
                    className="flex-1 px-3 py-2 rounded text-xs input-base"
                    style={{ fontFamily: "monospace" }}
                    min="0.01"
                    step="0.001"
                  />
                  <button
                    onClick={() => onAction("setprice")}
                    disabled={!newPrice || busy}
                    className="px-3 py-2 rounded text-xs font-bold transition-all"
                    style={{
                      background: newPrice ? "rgba(0,255,136,0.15)" : "#0d0d0d",
                      border: `1px solid ${newPrice ? "rgba(0,255,136,0.4)" : "#1a1a1a"}`,
                      color: newPrice ? "#00ff88" : "#444",
                      fontFamily: "monospace",
                    }}
                  >
                    SET
                  </button>
                </div>
                <button
                  onClick={() => onAction("abandon")}
                  disabled={busy}
                  className="w-full py-2.5 rounded text-xs font-bold transition-all"
                  style={{ background: "rgba(255,68,68,0.08)", border: "1px solid rgba(255,68,68,0.2)", color: "#ff4444", fontFamily: "monospace" }}
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
        const buyPrice = (selectedTile.price * 1.1).toFixed(6);
        const totalCost = (selectedTile.price * 1.1 * 1.1).toFixed(6);
        await tilesContract.buyoutTile(selectedTile.id, buyPrice, totalCost);
        break;
      }
      case "setprice":
        if (newPrice) await tilesContract.setPrice(selectedTile.id, newPrice);
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
          <RightSidebar />
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
