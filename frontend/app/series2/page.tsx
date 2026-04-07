"use client";

import { useState } from "react";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { formatEther, parseEther } from "viem";
import Header from "@/components/Header";
import { RUSH_TILES_V2_ABI, RUSH_TILES_V2_ADDRESS, BASE_MAINNET } from "@/lib/contracts";
import { motion, AnimatePresence } from "framer-motion";
import { X, ExternalLink, Shield, Flame, Crown } from "lucide-react";
const GRID = 100;
const EXPLORER = BASE_MAINNET.blockExplorerUrls[0];
const FOUNDER_IMAGES = 5;
const NORMAL_IMAGES = 10;

function getTileImage(tileId: number, isFounder: boolean): string {
  if (isFounder) {
    return `/tiles-v2/founder/${(tileId % FOUNDER_IMAGES) + 1}.jpg`;
  }
  return `/tiles-v2/normal/${(tileId % NORMAL_IMAGES) + 1}.jpg`;
}

interface TileV2 {
  id: number;
  owner: string | null;
  price: number;
  deposit: number;
  isFounder: boolean;
  isMine: boolean;
  isActive: boolean;
}

function useTilesV2() {
  const { address } = useAccount();
  const addr = RUSH_TILES_V2_ADDRESS || undefined;
  const enabled = !!addr;

  const { data: allTiles, refetch } = useReadContract({
    address: addr, abi: RUSH_TILES_V2_ABI, functionName: "getAllTiles",
    query: { enabled, refetchInterval: 10_000 },
  });
  const { data: totalSharesData } = useReadContract({
    address: addr, abi: RUSH_TILES_V2_ABI, functionName: "totalShares",
    query: { enabled },
  });
  const { data: totalDistData } = useReadContract({
    address: addr, abi: RUSH_TILES_V2_ABI, functionName: "totalDistributed",
    query: { enabled },
  });
  const { data: totalClaimsData } = useReadContract({
    address: addr, abi: RUSH_TILES_V2_ABI, functionName: "totalClaims",
    query: { enabled },
  });

  const tiles: TileV2[] = allTiles
    ? (allTiles as Array<{ owner: string; price: bigint; deposit: bigint; lastTaxTime: number; lastBuyoutTime: number; isFounder: boolean }>).map((t, i) => {
        const isOwned = t.owner !== "0x0000000000000000000000000000000000000000";
        return {
          id: i,
          owner: isOwned ? t.owner : null,
          price: parseFloat(formatEther(t.price)),
          deposit: parseFloat(formatEther(t.deposit)),
          isFounder: t.isFounder,
          isMine: isOwned && address ? t.owner.toLowerCase() === address.toLowerCase() : false,
          isActive: isOwned,
        };
      })
    : Array.from({ length: GRID }, (_, i) => ({
        id: i, owner: null, price: 0, deposit: 0, isFounder: false, isMine: false, isActive: false,
      }));

  const claimed = tiles.filter(t => t.isActive).length;
  const available = GRID - claimed;
  const totalShares = totalSharesData ? Number(totalSharesData) : 0;
  const totalDist = totalDistData ? formatEther(totalDistData as bigint) : "0";
  const totalClaims = totalClaimsData ? Number(totalClaimsData) : 0;

  return { tiles, claimed, available, totalShares, totalDist, totalClaims, refetch };
}

// ── Claim Modal ──────────────────────────────────────────────────────────────

function ClaimModal({ tile, onClose, refetch }: { tile: TileV2; onClose: () => void; refetch: () => void }) {
  const [founder, setFounder] = useState(false);
  const { writeContract, data: txHash, isPending, reset } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const tierPrice = founder ? 0.5 : 0.1;
  const minDeposit = 0.01 * 0.05; // MIN_TILE_PRICE * TAX_RATE
  const totalCost = tierPrice + minDeposit + 0.001; // small buffer

  function handleClaim() {
    reset();
    writeContract({
      address: RUSH_TILES_V2_ADDRESS,
      abi: RUSH_TILES_V2_ABI,
      functionName: "claimTile",
      args: [tile.id, parseEther("0.01"), founder],
      value: parseEther(totalCost.toFixed(6)),
    });
  }

  if (isSuccess) {
    setTimeout(() => { refetch(); onClose(); }, 2000);
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.85)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }}
        className="w-full max-w-sm rounded-2xl overflow-hidden"
        style={{ background: "#0a0a0a", border: "1px solid #222", boxShadow: "0 24px 48px rgba(0,0,0,0.8)" }}
      >
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid #1a1a1a" }}>
          <span className="text-sm font-black tracking-widest" style={{ color: "#e0e0e0", fontFamily: "monospace" }}>
            CLAIM SEAT #{tile.id + 1}
          </span>
          <button onClick={onClose} style={{ color: "#555", background: "none", border: "none", cursor: "pointer" }}>
            <X size={16} />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {/* Tier selection */}
          <div className="flex flex-col gap-2">
            <div className="text-[10px] font-bold tracking-widest" style={{ color: "#555", fontFamily: "monospace" }}>SELECT TIER</div>
            <div className="flex gap-2">
              <button
                onClick={() => setFounder(false)}
                className="flex-1 p-3 rounded-lg text-center transition-all"
                style={{
                  background: !founder ? "linear-gradient(180deg, rgba(0,255,136,0.1), rgba(0,255,136,0.04))" : "#0a0a0a",
                  border: `1px solid ${!founder ? "rgba(0,255,136,0.3)" : "#1a1a1a"}`,
                  cursor: "pointer",
                }}
              >
                <div className="text-xs font-black" style={{ color: !founder ? "#00ff88" : "#444", fontFamily: "monospace" }}>NORMAL</div>
                <div className="text-lg font-black mt-1" style={{ color: !founder ? "#00ff88" : "#333", fontFamily: "monospace" }}>0.1 ETH</div>
                <div className="text-[9px] mt-1" style={{ color: "#555", fontFamily: "monospace" }}>1 share · buyoutable</div>
              </button>
              <button
                onClick={() => setFounder(true)}
                className="flex-1 p-3 rounded-lg text-center transition-all"
                style={{
                  background: founder ? "linear-gradient(180deg, rgba(255,215,0,0.1), rgba(255,215,0,0.04))" : "#0a0a0a",
                  border: `1px solid ${founder ? "rgba(255,215,0,0.3)" : "#1a1a1a"}`,
                  cursor: "pointer",
                }}
              >
                <div className="flex items-center justify-center gap-1">
                  <Crown size={10} style={{ color: founder ? "#ffd700" : "#444" }} />
                  <span className="text-xs font-black" style={{ color: founder ? "#ffd700" : "#444", fontFamily: "monospace" }}>FOUNDER</span>
                </div>
                <div className="text-lg font-black mt-1" style={{ color: founder ? "#ffd700" : "#333", fontFamily: "monospace" }}>0.5 ETH</div>
                <div className="text-[9px] mt-1" style={{ color: "#555", fontFamily: "monospace" }}>5 shares · permanent</div>
              </button>
            </div>
          </div>

          {/* Cost breakdown */}
          <div className="rounded-lg px-3 py-2.5 flex flex-col gap-1" style={{ background: "#0c0c0c", border: "1px solid #151515" }}>
            <div className="flex justify-between text-[10px]" style={{ fontFamily: "monospace" }}>
              <span style={{ color: "#888" }}>Seat price</span>
              <span style={{ color: "#ccc" }}>{tierPrice} ETH</span>
            </div>
            <div className="flex justify-between text-[10px]" style={{ fontFamily: "monospace" }}>
              <span style={{ color: "#888" }}>Tax deposit</span>
              <span style={{ color: "#ccc" }}>{minDeposit.toFixed(4)} ETH</span>
            </div>
            <div style={{ height: 1, background: "#1a1a1a", margin: "4px 0" }} />
            <div className="flex justify-between text-[10px] font-bold" style={{ fontFamily: "monospace" }}>
              <span style={{ color: "#aaa" }}>Total</span>
              <span style={{ color: founder ? "#ffd700" : "#00ff88" }}>~{totalCost.toFixed(4)} ETH</span>
            </div>
          </div>

          {/* Founder benefits */}
          {founder && (
            <div className="flex flex-col gap-1 px-2">
              <div className="flex items-center gap-1.5 text-[10px]" style={{ color: "#ffd700", fontFamily: "monospace" }}>
                <Shield size={10} /> Cannot be bought out
              </div>
              <div className="flex items-center gap-1.5 text-[10px]" style={{ color: "#ffd700", fontFamily: "monospace" }}>
                <Flame size={10} /> 5x revenue share
              </div>
              <div className="flex items-center gap-1.5 text-[10px]" style={{ color: "#ffd700", fontFamily: "monospace" }}>
                <Crown size={10} /> Founder badge on-chain
              </div>
            </div>
          )}

          {/* TX Success */}
          {txHash && isSuccess && (
            <a href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-between px-3 py-2 rounded-lg text-xs"
              style={{ background: "rgba(0,255,136,0.06)", border: "1px solid rgba(0,255,136,0.2)", color: "#00ff88", fontFamily: "monospace" }}>
              <span>Seat claimed!</span>
              <ExternalLink size={11} />
            </a>
          )}

          {/* CTA */}
          {!isSuccess && (
            <button
              onClick={handleClaim}
              disabled={isPending || confirming}
              className="w-full py-3 rounded-lg text-sm font-black tracking-wider transition-all"
              style={{
                background: founder
                  ? "linear-gradient(180deg, rgba(255,215,0,0.15), rgba(255,215,0,0.06))"
                  : "linear-gradient(180deg, rgba(0,255,136,0.15), rgba(0,255,136,0.06))",
                border: `1px solid ${founder ? "rgba(255,215,0,0.3)" : "rgba(0,255,136,0.3)"}`,
                color: founder ? "#ffd700" : "#00ff88",
                fontFamily: "monospace",
                letterSpacing: "0.1em",
                cursor: isPending || confirming ? "wait" : "pointer",
                opacity: isPending || confirming ? 0.5 : 1,
              }}
            >
              {isPending || confirming ? "CLAIMING..." : `CLAIM — ${totalCost.toFixed(3)} ETH`}
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function Series2Page() {
  useAccount();
  const { tiles, claimed, available, totalDist, refetch } = useTilesV2();
  const [selected, setSelected] = useState<TileV2 | null>(null);

  // Featured: first 5 available tiles
  const featured = tiles.filter(t => !t.isActive).slice(0, 5);

  return (
    <div style={{ background: "#0a0a0a", color: "#ccc", minHeight: "100vh", fontFamily: "monospace" }}>
      <Header />

      <div className="max-w-6xl mx-auto px-3 sm:px-4 py-6 sm:py-8">
        {/* Hero */}
        <div className="text-center mb-10">
          <div className="text-[10px] font-bold tracking-[0.3em] mb-2" style={{ color: "#ffd700" }}>
            SERIES 2 — FUNDING ROUND
          </div>
          <h1 className="text-3xl md:text-4xl font-black mb-3" style={{ color: "#e0e0e0" }}>
            100 Revenue Seats
          </h1>
          <p className="text-sm max-w-md mx-auto" style={{ color: "#666" }}>
            Own a seat. Earn from every prediction market. Fund the protocol.
          </p>

          {/* Stats bar */}
          <div className="flex justify-center gap-4 sm:gap-6 mt-6">
            <div className="text-center">
              <div className="text-2xl font-black" style={{ color: available > 0 ? "#00ff88" : "#ff4444" }}>{available}</div>
              <div className="text-[9px] tracking-widest" style={{ color: "#555" }}>AVAILABLE</div>
            </div>
            <div style={{ width: 1, background: "#1a1a1a" }} />
            <div className="text-center">
              <div className="text-2xl font-black" style={{ color: "#e0e0e0" }}>{claimed}</div>
              <div className="text-[9px] tracking-widest" style={{ color: "#555" }}>CLAIMED</div>
            </div>
            <div style={{ width: 1, background: "#1a1a1a" }} />
            <div className="text-center">
              <div className="text-2xl font-black" style={{ color: "#ffd700" }}>{parseFloat(totalDist).toFixed(3)}</div>
              <div className="text-[9px] tracking-widest" style={{ color: "#555" }}>ETH DISTRIBUTED</div>
            </div>
          </div>

          {/* Progress bar */}
          <div className="max-w-sm mx-auto mt-4">
            <div className="h-2 rounded-full overflow-hidden" style={{ background: "#111" }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${(claimed / GRID) * 100}%`,
                  background: "linear-gradient(90deg, #00ff88, #ffd700)",
                }}
              />
            </div>
            <div className="text-[10px] mt-1" style={{ color: "#444" }}>{claimed}/100 seats claimed</div>
          </div>
        </div>

        {/* Featured tiles */}
        {featured.length > 0 && (
          <div className="mb-10">
            <div className="text-xs font-bold tracking-widest mb-4 text-center" style={{ color: "#555" }}>
              AVAILABLE NOW
            </div>
            <div className="flex justify-center gap-3 flex-wrap">
              {featured.map((tile) => (
                <button
                  key={tile.id}
                  onClick={() => setSelected(tile)}
                  className="w-24 h-32 sm:w-32 sm:h-44 rounded-xl overflow-hidden relative transition-all hover:scale-105"
                  style={{
                    border: "1px solid rgba(0,255,136,0.2)",
                    boxShadow: "0 0 20px rgba(0,255,136,0.05)",
                    cursor: "pointer",
                  }}
                >
                  <img
                    src={getTileImage(tile.id, false)}
                    alt={`Seat ${tile.id + 1}`}
                    className="w-full h-full object-cover"
                    style={{ filter: "brightness(0.6)" }}
                  />
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1"
                    style={{ background: "linear-gradient(180deg, transparent 20%, rgba(0,0,0,0.8) 100%)" }}>
                    <div className="text-xl font-black" style={{ color: "#00ff88", textShadow: "0 2px 8px rgba(0,0,0,1)" }}>#{tile.id + 1}</div>
                    <div className="text-[9px] tracking-widest" style={{ color: "#aaa" }}>OPEN</div>
                    <div className="text-[10px] font-bold" style={{ color: "#00ff88" }}>from 0.1 ETH</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Tiers info */}
        <div className="flex justify-center gap-3 sm:gap-4 mb-10 flex-wrap px-2">
          <div className="p-3 sm:p-4 rounded-xl w-full sm:w-56" style={{ background: "#111", border: "1px solid rgba(0,255,136,0.15)" }}>
            <div className="text-xs font-black tracking-widest mb-2" style={{ color: "#00ff88" }}>NORMAL SEAT</div>
            <div className="text-xl font-black" style={{ color: "#e0e0e0" }}>0.1 ETH</div>
            <div className="flex flex-col gap-1 mt-3 text-[10px]" style={{ color: "#666" }}>
              <span>1 revenue share</span>
              <span>Harberger tax 5%/week</span>
              <span>Can be bought out</span>
              <span>Earn from prediction markets</span>
            </div>
          </div>
          <div className="p-3 sm:p-4 rounded-xl w-full sm:w-56" style={{ background: "#111", border: "1px solid rgba(255,215,0,0.2)" }}>
            <div className="flex items-center gap-1 mb-2">
              <Crown size={12} style={{ color: "#ffd700" }} />
              <span className="text-xs font-black tracking-widest" style={{ color: "#ffd700" }}>FOUNDER SEAT</span>
            </div>
            <div className="text-xl font-black" style={{ color: "#e0e0e0" }}>0.5 ETH</div>
            <div className="flex flex-col gap-1 mt-3 text-[10px]" style={{ color: "#666" }}>
              <span style={{ color: "#ffd700" }}>5 revenue shares</span>
              <span>Harberger tax 5%/week</span>
              <span style={{ color: "#ffd700" }}>Cannot be bought out</span>
              <span>Earn from prediction markets</span>
            </div>
          </div>
        </div>

        {/* Full grid */}
        <div className="mb-4 text-center">
          <div className="text-xs font-bold tracking-widest" style={{ color: "#555" }}>ALL 100 SEATS</div>
        </div>
        <div
          className="grid gap-[2px] sm:gap-[3px] max-w-2xl mx-auto p-1 rounded-lg"
          style={{ gridTemplateColumns: "repeat(10, 1fr)", background: "#0a0a0a", border: "1px solid #1a1a1a", fontSize: "clamp(6px, 1.5vw, 9px)" }}
        >
          {tiles.map((tile) => {
            const isEmpty = !tile.isActive;
            const isMine = tile.isMine;
            const isFounder = tile.isFounder;

            let bg = "#141414";
            let borderColor = "#222";
            let numColor = "#333";

            if (isMine) {
              bg = "rgba(0,255,136,0.08)";
              borderColor = "rgba(0,255,136,0.4)";
              numColor = "#00ff88";
            } else if (isFounder) {
              bg = "rgba(255,215,0,0.06)";
              borderColor = "rgba(255,215,0,0.3)";
              numColor = "#ffd700";
            } else if (tile.isActive) {
              bg = "rgba(0,170,255,0.04)";
              borderColor = "rgba(0,170,255,0.15)";
              numColor = "#00aaff";
            }

            return (
              <button
                key={tile.id}
                onClick={() => { if (isEmpty) setSelected(tile); }}
                className="relative aspect-square rounded-sm overflow-hidden flex flex-col items-center justify-center transition-all"
                style={{
                  background: tile.isActive ? `url(${getTileImage(tile.id, isFounder)}) center/cover` : bg,
                  border: `1px solid ${borderColor}`,
                  cursor: isEmpty ? "pointer" : "default",
                  fontSize: 9,
                }}
                onMouseEnter={(e) => { if (isEmpty) (e.currentTarget.style.borderColor = "rgba(0,255,136,0.5)"); }}
                onMouseLeave={(e) => { if (isEmpty) (e.currentTarget.style.borderColor = borderColor); }}
              >
                {tile.isActive && (
                  <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.4) 0%, transparent 40%, transparent 60%, rgba(0,0,0,0.6) 100%)" }} />
                )}
                <span style={{ color: numColor, fontWeight: 800, fontFamily: "monospace", position: "relative", zIndex: 2, textShadow: tile.isActive ? "0 1px 4px rgba(0,0,0,1)" : "none" }}>{tile.id + 1}</span>
                {isFounder && <Crown size={8} style={{ color: "#ffd700", marginTop: 1, position: "relative", zIndex: 2 }} />}
                {isEmpty && <span style={{ color: "#333", fontSize: 7 }}>OPEN</span>}
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex justify-center gap-2 sm:gap-4 mt-3 text-[8px] sm:text-[9px] flex-wrap" style={{ fontFamily: "monospace" }}>
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: "#141414", border: "1px solid #222" }} />
            <span style={{ color: "#555" }}>Open</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: "rgba(0,170,255,0.08)", border: "1px solid rgba(0,170,255,0.2)" }} />
            <span style={{ color: "#555" }}>Normal</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: "rgba(255,215,0,0.08)", border: "1px solid rgba(255,215,0,0.3)" }} />
            <span style={{ color: "#555" }}>Founder</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: "rgba(0,255,136,0.08)", border: "1px solid rgba(0,255,136,0.4)" }} />
            <span style={{ color: "#555" }}>Yours</span>
          </div>
        </div>

        {/* S1 proof */}
        <div className="mt-10 text-center">
          <div className="text-[10px] tracking-widest mb-2" style={{ color: "#333" }}>SERIES 1 TRACK RECORD</div>
          <div className="text-sm" style={{ color: "#555" }}>
            11.8+ ETH ($21,000+) distributed to 100 seat holders in 8 days.{" "}
            <a href={`${EXPLORER}/address/0x6cE3873e31Ab5440fA6AF1860F8E36110504c9C4`}
              target="_blank" rel="noopener noreferrer" style={{ color: "#00aaff" }}>
              Verify on-chain →
            </a>
          </div>
        </div>
      </div>

      {/* Claim modal */}
      <AnimatePresence>
        {selected && !selected.isActive && (
          <ClaimModal tile={selected} onClose={() => setSelected(null)} refetch={refetch} />
        )}
      </AnimatePresence>
    </div>
  );
}
