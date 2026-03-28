"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, X, ExternalLink } from "lucide-react";
import Header from "@/components/Header";
import TilesGrid from "@/components/TilesGrid";
import { useTiles, IS_DEMO_MODE } from "@/lib/mock";
import { useTilesContract } from "@/hooks/useTilesContract";
import { useAccount } from "wagmi";
import { formatEther } from "viem";
import { BASE_MAINNET, RUSH_TILES_ADDRESS } from "@/lib/contracts";
import type { Tile } from "@/lib/mock";

export default function TilesPage() {
  const { address: walletAddress } = useAccount();

  // Mock data (always loaded for fallback)
  const mockData = useTiles();

  // Real contract data
  const tilesContract = useTilesContract();

  // Decide which data to use
  const useReal = !IS_DEMO_MODE && !!RUSH_TILES_ADDRESS && tilesContract.tiles.length > 0;

  // Build tiles array from contract data when available
  const tiles: Tile[] = useReal
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
          pendingFees: 0, // per-tile fees not available, use total
          isMine,
        };
      })
    : mockData.tiles;

  const myAddress = useReal ? (walletAddress ?? "") : mockData.myAddress;
  const myTileCount = useReal
    ? (tilesContract.player?.tileCount ?? 0)
    : mockData.myTileCount;
  const totalPendingFees = useReal
    ? parseFloat(tilesContract.pendingFees)
    : mockData.totalPendingFees;
  const activeTileCount = useReal
    ? tilesContract.totalActiveTiles
    : mockData.activeTileCount;
  const totalDistributed = useReal
    ? parseFloat(tilesContract.totalDistributed)
    : mockData.totalDistributed;

  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  const [newPrice, setNewPrice] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const explorerUrl = BASE_MAINNET.blockExplorerUrls[0];

  async function handleAction(action?: string) {
    if (!selectedTile) return;
    setIsLoading(true);

    if (useReal) {
      switch (action) {
        case "claim":
          await tilesContract.claimTile(
            selectedTile.id,
            "0.01",   // MIN_TILE_PRICE
            "0.0105"  // price + 1 week tax deposit
          );
          break;
        case "buyout":
          // Simple buyout at 1.5x current price
          const buyPrice = (selectedTile.price * 1.5).toFixed(6);
          const totalCost = (selectedTile.price * 1.5 * 1.2).toFixed(6); // price + fees + deposit
          await tilesContract.buyoutTile(selectedTile.id, buyPrice, totalCost);
          break;
        case "setprice":
          if (newPrice) {
            await tilesContract.setPrice(selectedTile.id, newPrice);
          }
          break;
        case "abandon":
          await tilesContract.abandonTile(selectedTile.id);
          break;
        case "claimfees":
          await tilesContract.claimFees();
          break;
        default:
          await new Promise((r) => setTimeout(r, 1200));
      }
      tilesContract.refetchAll();
    } else {
      await new Promise((r) => setTimeout(r, 1200));
    }

    setIsLoading(false);
    setSelectedTile(null);
    setNewPrice("");
  }

  async function handleClaimFees() {
    setIsLoading(true);
    if (useReal) {
      await tilesContract.claimFees();
      tilesContract.refetchAll();
    } else {
      await new Promise((r) => setTimeout(r, 1200));
    }
    setIsLoading(false);
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#0a0a0a", color: "#e0e0e0" }}>
      <Header />

      <main className="flex-1 p-4 md:p-6 max-w-6xl mx-auto w-full">

        {/* Back link + title */}
        <div className="flex items-center gap-3 mb-6">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-xs transition-colors"
            style={{ color: "#555", fontFamily: "monospace" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "#00ff88")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "#555")}
          >
            <ArrowLeft size={13} />
            BACK
          </Link>
          <span style={{ color: "#333" }}>/</span>
          <span
            className="text-sm font-bold tracking-widest"
            style={{ color: "#e0e0e0", fontFamily: "monospace" }}
          >
            TILES
          </span>
          {IS_DEMO_MODE && (
            <span
              className="text-xs px-2 py-0.5 rounded"
              style={{ background: "rgba(255,170,0,0.1)", border: "1px solid rgba(255,170,0,0.3)", color: "#ffaa00", fontFamily: "monospace" }}
            >
              DEMO
            </span>
          )}
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: "YOUR TILES", value: myTileCount, color: "#00ff88" },
            { label: "PENDING FEES", value: `${totalPendingFees.toFixed(5)} ETH`, color: "#ffd700" },
            { label: "ACTIVE TILES", value: activeTileCount, color: "#00aaff" },
            { label: "TOTAL DISTRIBUTED", value: `${totalDistributed.toFixed(2)} ETH`, color: "#aaa" },
          ].map((stat) => (
            <div
              key={stat.label}
              className="p-4 rounded"
              style={{ background: "#111", border: "1px solid #1a1a1a" }}
            >
              <div
                className="text-xs font-bold tracking-widest mb-1"
                style={{ color: "#555", fontFamily: "monospace" }}
              >
                {stat.label}
              </div>
              <div
                className="text-lg font-black tabular"
                style={{ color: stat.color, fontFamily: "monospace" }}
              >
                {stat.value}
              </div>
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-4 mb-4 text-xs" style={{ fontFamily: "monospace" }}>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm" style={{ background: "rgba(0,255,136,0.2)", border: "1px solid rgba(0,255,136,0.5)" }} />
            <span style={{ color: "#666" }}>Your tiles</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm" style={{ background: "rgba(0,170,255,0.12)", border: "1px solid rgba(0,170,255,0.3)" }} />
            <span style={{ color: "#666" }}>Owned by others</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm" style={{ background: "#111", border: "1px solid #1a1a1a" }} />
            <span style={{ color: "#666" }}>Empty — claim for 0.01 ETH</span>
          </div>
        </div>

        {/* Claim fees button */}
        {totalPendingFees > 0 && (
          <div
            className="flex items-center justify-between p-3 rounded mb-4 animate-fade-in-up"
            style={{ background: "rgba(255,215,0,0.06)", border: "1px solid rgba(255,215,0,0.2)" }}
          >
            <div>
              <span className="text-xs font-bold" style={{ color: "#ffd700", fontFamily: "monospace" }}>
                CLAIMABLE FEES
              </span>
              <span className="text-sm font-black ml-2" style={{ color: "#ffd700", fontFamily: "monospace" }}>
                {totalPendingFees.toFixed(5)} ETH
              </span>
            </div>
            <button
              onClick={() => handleClaimFees()}
              disabled={isLoading || tilesContract.isLoading}
              className="px-4 py-1.5 rounded text-xs font-bold transition-all"
              style={{
                background: "rgba(255,215,0,0.15)",
                border: "1px solid rgba(255,215,0,0.4)",
                color: "#ffd700",
                fontFamily: "monospace",
              }}
            >
              {isLoading || tilesContract.isLoading ? "CLAIMING..." : "CLAIM ALL FEES"}
            </button>
          </div>
        )}

        {/* Tx success */}
        {tilesContract.txHash && tilesContract.isSuccess && (
          <div
            className="flex items-center justify-between p-3 rounded mb-4 animate-fade-in-up"
            style={{ background: "rgba(0,255,136,0.06)", border: "1px solid rgba(0,255,136,0.2)" }}
          >
            <span className="text-xs font-bold" style={{ color: "#00ff88", fontFamily: "monospace" }}>
              TRANSACTION CONFIRMED
            </span>
            <a
              href={`${explorerUrl}/tx/${tilesContract.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs flex items-center gap-1"
              style={{ color: "#00ff88", fontFamily: "monospace" }}
            >
              View on Basescan <ExternalLink size={10} />
            </a>
          </div>
        )}

        {/* Grid */}
        <div
          className="p-4 rounded"
          style={{ background: "#111", border: "1px solid #1a1a1a" }}
        >
          <TilesGrid tiles={tiles} myAddress={myAddress} onTileClick={setSelectedTile} />
        </div>

        {/* Info */}
        <div className="mt-4 text-xs" style={{ color: "#333", fontFamily: "monospace" }}>
          <span style={{ color: "#00ff88" }}>TIP:</span>{" "}
          Claim a tile to earn a share of every market fee. Tiles can be bought out by others at the effective price + 10% fee. Harberger tax: 5% per week.
        </div>
      </main>

      {/* Tile detail modal */}
      {selectedTile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.7)" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedTile(null);
          }}
          role="dialog"
          aria-modal="true"
          aria-label={`Tile ${selectedTile.id + 1} details`}
        >
          <div
            className="w-full max-w-sm mx-4 rounded-lg p-5 animate-fade-in-up"
            style={{ background: "#111", border: "1px solid #2a2a2a" }}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between mb-4">
              <span
                className="text-sm font-black tracking-widest"
                style={{ color: "#e0e0e0", fontFamily: "monospace" }}
              >
                TILE #{selectedTile.id + 1}
              </span>
              <button
                onClick={() => setSelectedTile(null)}
                style={{ color: "#555", background: "none", border: "none" }}
                aria-label="Close modal"
              >
                <X size={18} />
              </button>
            </div>

            {/* Tile info */}
            <div className="flex flex-col gap-2 mb-4">
              <div className="flex justify-between text-xs">
                <span style={{ color: "#555", fontFamily: "monospace" }}>STATUS</span>
                <span
                  style={{
                    color: selectedTile.isMine ? "#00ff88" : selectedTile.isActive ? "#00aaff" : "#555",
                    fontFamily: "monospace",
                    fontWeight: 700,
                  }}
                >
                  {selectedTile.isMine ? "YOURS" : selectedTile.isActive ? "OWNED" : "EMPTY"}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span style={{ color: "#555", fontFamily: "monospace" }}>PRICE</span>
                <span style={{ color: "#e0e0e0", fontFamily: "monospace" }}>
                  {selectedTile.price.toFixed(4)} ETH
                </span>
              </div>
              {selectedTile.owner && (
                <div className="flex justify-between text-xs">
                  <span style={{ color: "#555", fontFamily: "monospace" }}>OWNER</span>
                  <span style={{ color: "#888", fontFamily: "monospace" }}>
                    {selectedTile.owner.slice(0, 6)}...{selectedTile.owner.slice(-4)}
                  </span>
                </div>
              )}
              {selectedTile.isMine && selectedTile.pendingFees > 0 && (
                <div className="flex justify-between text-xs">
                  <span style={{ color: "#555", fontFamily: "monospace" }}>PENDING FEES</span>
                  <span style={{ color: "#ffd700", fontFamily: "monospace" }}>
                    {selectedTile.pendingFees.toFixed(5)} ETH
                  </span>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2">
              {!selectedTile.isActive && (
                <button
                  onClick={() => handleAction("claim")}
                  disabled={isLoading || tilesContract.isLoading}
                  className="w-full py-2.5 rounded text-sm font-bold transition-all btn-primary"
                  style={{ fontFamily: "monospace" }}
                >
                  {isLoading || tilesContract.isLoading ? "CLAIMING..." : "CLAIM — 0.01 ETH"}
                </button>
              )}

              {selectedTile.isActive && !selectedTile.isMine && (
                <button
                  onClick={() => handleAction("buyout")}
                  disabled={isLoading || tilesContract.isLoading}
                  className="w-full py-2.5 rounded text-sm font-bold transition-all"
                  style={{
                    background: "rgba(0,170,255,0.15)",
                    border: "1px solid rgba(0,170,255,0.4)",
                    color: "#00aaff",
                    fontFamily: "monospace",
                  }}
                >
                  {isLoading || tilesContract.isLoading ? "BUYING OUT..." : `BUYOUT — ${(selectedTile.price * 1.5).toFixed(4)} ETH`}
                </button>
              )}

              {selectedTile.isMine && (
                <>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="New price (ETH)"
                      value={newPrice}
                      onChange={(e) => setNewPrice(e.target.value)}
                      className="flex-1 px-3 py-2 rounded text-xs input-base"
                      style={{ fontFamily: "monospace" }}
                    />
                    <button
                      onClick={() => handleAction("setprice")}
                      disabled={!newPrice || isLoading || tilesContract.isLoading}
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
                    onClick={() => handleAction("abandon")}
                    disabled={isLoading || tilesContract.isLoading}
                    className="w-full py-2.5 rounded text-xs font-bold transition-all"
                    style={{
                      background: "rgba(255,68,68,0.08)",
                      border: "1px solid rgba(255,68,68,0.2)",
                      color: "#ff4444",
                      fontFamily: "monospace",
                    }}
                  >
                    ABANDON TILE
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
