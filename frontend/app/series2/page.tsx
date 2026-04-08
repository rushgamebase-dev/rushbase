"use client";

import { useState } from "react";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { formatEther, parseEther } from "viem";
import Header from "@/components/Header";
import { RUSH_TILES_V2_ABI, RUSH_TILES_V2_ADDRESS, BASE_MAINNET } from "@/lib/contracts";
import { motion, AnimatePresence } from "framer-motion";
import { X, ExternalLink, Shield, Flame, Crown, CheckCircle } from "lucide-react";

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

function ClaimModal({
  tile,
  onClose,
  refetch,
  defaultFounder,
}: {
  tile: TileV2;
  onClose: () => void;
  refetch: () => void;
  defaultFounder?: boolean;
}) {
  const [founder, setFounder] = useState(defaultFounder ?? false);
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
                  minHeight: 44,
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
                  minHeight: 44,
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
                minHeight: 44,
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

// ── Proof Banner ─────────────────────────────────────────────────────────────

function ProofBanner() {
  return (
    <div
      style={{
        background: "linear-gradient(90deg, rgba(255,215,0,0.12), rgba(0,255,136,0.06))",
        borderBottom: "1px solid rgba(255,215,0,0.15)",
        padding: "8px 16px",
        textAlign: "center",
        fontFamily: "monospace",
        fontSize: 12,
        color: "#ffd700",
        letterSpacing: "0.05em",
      }}
    >
      Series 1 holders earned{" "}
      <span style={{ color: "#ffe84d", fontWeight: 800 }}>11.8+ ETH</span>
      {" "}in 8 days
    </div>
  );
}

// ── Tier Cards ───────────────────────────────────────────────────────────────

function FounderCard({
  founderClaimed,
  onClaim,
}: {
  founderClaimed: number;
  onClaim: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="flex-1 rounded-2xl p-5 flex flex-col gap-4"
      style={{
        background: "linear-gradient(160deg, rgba(255,215,0,0.07) 0%, rgba(255,215,0,0.02) 100%)",
        border: "1px solid rgba(255,215,0,0.35)",
        boxShadow: "0 0 32px rgba(255,215,0,0.05)",
        minWidth: 0,
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <Crown size={14} style={{ color: "#ffd700" }} />
        <span
          className="text-xs font-black tracking-widest"
          style={{ color: "#ffd700", fontFamily: "monospace" }}
        >
          FOUNDER SEAT
        </span>
      </div>

      {/* Price */}
      <div>
        <div
          className="text-4xl font-black"
          style={{ color: "#ffd700", fontFamily: "monospace", lineHeight: 1 }}
        >
          0.5 ETH
        </div>
        <div className="text-[10px] mt-1" style={{ color: "#888", fontFamily: "monospace" }}>
          one-time · permanent seat
        </div>
      </div>

      {/* Benefits */}
      <ul className="flex flex-col gap-2">
        {[
          "5 revenue shares (5x Normal)",
          "Buyout-immune — permanent seat",
          "Founders Circle recognition",
          "Future NFT airdrops",
        ].map((benefit) => (
          <li key={benefit} className="flex items-start gap-2 text-xs" style={{ fontFamily: "monospace" }}>
            <CheckCircle size={12} style={{ color: "#ffd700", marginTop: 1, flexShrink: 0 }} />
            <span style={{ color: "#ccc" }}>{benefit}</span>
          </li>
        ))}
      </ul>

      {/* CTA */}
      <button
        onClick={onClaim}
        className="w-full py-3 rounded-lg font-black tracking-widest text-sm transition-all hover:opacity-90 active:scale-95"
        style={{
          background: "linear-gradient(135deg, #ffd700, #e6a800)",
          color: "#0a0a0a",
          fontFamily: "monospace",
          cursor: "pointer",
          border: "none",
          minHeight: 44,
        }}
      >
        BECOME A FOUNDER — 0.5 ETH
      </button>

      {/* Scarcity */}
      <div
        className="text-center text-[10px]"
        style={{ color: "#888", fontFamily: "monospace" }}
      >
        {founderClaimed} Founder seat{founderClaimed !== 1 ? "s" : ""} claimed
      </div>
    </motion.div>
  );
}

function NormalCard({ onClaim }: { onClaim: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.18 }}
      className="flex-1 rounded-2xl p-5 flex flex-col gap-4"
      style={{
        background: "#0f0f0f",
        border: "1px solid #252525",
        minWidth: 0,
      }}
    >
      {/* Header */}
      <div>
        <span
          className="text-xs font-black tracking-widest"
          style={{ color: "#aaa", fontFamily: "monospace" }}
        >
          NORMAL SEAT
        </span>
      </div>

      {/* Price */}
      <div>
        <div
          className="text-4xl font-black"
          style={{ color: "#e0e0e0", fontFamily: "monospace", lineHeight: 1 }}
        >
          0.1 ETH
        </div>
        <div className="text-[10px] mt-1" style={{ color: "#555", fontFamily: "monospace" }}>
          buyoutable · Harberger tax
        </div>
      </div>

      {/* Benefits */}
      <ul className="flex flex-col gap-2">
        {[
          { text: "1 revenue share", dim: false },
          { text: "Harberger tax 5%/week", dim: true },
          { text: "Can be bought out", dim: true },
        ].map((item) => (
          <li key={item.text} className="flex items-start gap-2 text-xs" style={{ fontFamily: "monospace" }}>
            <CheckCircle size={12} style={{ color: item.dim ? "#444" : "#00ff88", marginTop: 1, flexShrink: 0 }} />
            <span style={{ color: item.dim ? "#555" : "#ccc" }}>{item.text}</span>
          </li>
        ))}
      </ul>

      {/* CTA */}
      <button
        onClick={onClaim}
        className="w-full py-3 rounded-lg font-black tracking-widest text-sm transition-all hover:opacity-90 active:scale-95"
        style={{
          background: "transparent",
          color: "#00ff88",
          fontFamily: "monospace",
          cursor: "pointer",
          border: "1px solid rgba(0,255,136,0.35)",
          minHeight: 44,
        }}
      >
        CLAIM NORMAL — 0.1 ETH
      </button>

      {/* Spacer to align with founder card scarcity */}
      <div style={{ height: 16 }} />
    </motion.div>
  );
}

// ── Founders Circle ──────────────────────────────────────────────────────────

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 4)}..${addr.slice(-4)}`;
}

function FoundersCircle({
  founders,
  onJoin,
}: {
  founders: TileV2[];
  onJoin: () => void;
}) {
  const EMPTY_SLOTS_SHOWN = 3;

  return (
    <section className="py-10">
      {/* Title */}
      <div className="flex items-center gap-4 mb-2">
        <div className="flex-1 h-px" style={{ background: "rgba(255,215,0,0.15)" }} />
        <span
          className="text-xs font-black tracking-[0.25em]"
          style={{ color: "#ffd700", fontFamily: "monospace", whiteSpace: "nowrap" }}
        >
          THE FOUNDERS CIRCLE
        </span>
        <div className="flex-1 h-px" style={{ background: "rgba(255,215,0,0.15)" }} />
      </div>
      <p className="text-center text-xs mb-8" style={{ color: "#555", fontFamily: "monospace" }}>
        Early backers of Rush Protocol
      </p>

      {founders.length === 0 ? (
        <div className="text-center py-8">
          <Crown size={32} style={{ color: "rgba(255,215,0,0.2)", margin: "0 auto 12px" }} />
          <p className="text-sm mb-4" style={{ color: "#555", fontFamily: "monospace" }}>
            Be the first Founder. Your name here.
          </p>
          <button
            onClick={onJoin}
            className="px-6 py-3 rounded-lg font-black tracking-widest text-sm transition-all hover:opacity-90"
            style={{
              background: "linear-gradient(135deg, #ffd700, #e6a800)",
              color: "#0a0a0a",
              fontFamily: "monospace",
              cursor: "pointer",
              border: "none",
              minHeight: 44,
            }}
          >
            JOIN THE CIRCLE →
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-3 justify-center">
            {/* Claimed founder cards */}
            {founders.map((tile) => (
              <motion.div
                key={tile.id}
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                className="rounded-xl overflow-hidden flex flex-col"
                style={{
                  width: 160,
                  border: "1px solid rgba(255,215,0,0.35)",
                  boxShadow: "0 0 20px rgba(255,215,0,0.1)",
                  background: "#0c0c0c",
                }}
              >
                <div
                  className="relative overflow-hidden"
                  style={{ height: 110 }}
                >
                  <img
                    src={getTileImage(tile.id, true)}
                    alt={`Tile ${tile.id + 1}`}
                    className="w-full h-full object-cover"
                    style={{ filter: "brightness(0.7)" }}
                  />
                  <div
                    className="absolute inset-0"
                    style={{ background: "linear-gradient(180deg, transparent 40%, rgba(0,0,0,0.7) 100%)" }}
                  />
                  <div className="absolute top-2 right-2">
                    <Crown size={14} style={{ color: "#ffd700", filter: "drop-shadow(0 0 4px rgba(255,215,0,0.8))" }} />
                  </div>
                </div>
                <div className="p-2.5 flex flex-col gap-0.5">
                  <div className="text-[10px] font-black" style={{ color: "#ffd700", fontFamily: "monospace" }}>
                    Tile #{tile.id + 1}
                  </div>
                  {tile.owner && (
                    <div className="text-[9px]" style={{ color: "#666", fontFamily: "monospace" }}>
                      {truncateAddress(tile.owner)}
                    </div>
                  )}
                </div>
              </motion.div>
            ))}

            {/* Empty slots */}
            {Array.from({ length: Math.min(EMPTY_SLOTS_SHOWN, 100 - founders.length) }).map((_, i) => (
              <button
                key={`empty-${i}`}
                onClick={onJoin}
                className="rounded-xl flex flex-col items-center justify-center transition-all hover:border-yellow-500"
                style={{
                  width: 160,
                  height: 160,
                  border: "1px dashed rgba(255,215,0,0.2)",
                  background: "transparent",
                  cursor: "pointer",
                  gap: 8,
                }}
              >
                <Crown size={20} style={{ color: "rgba(255,215,0,0.25)" }} />
                <span
                  className="text-[10px]"
                  style={{ color: "rgba(255,215,0,0.35)", fontFamily: "monospace" }}
                >
                  Available
                </span>
              </button>
            ))}
          </div>

          {/* Remaining count */}
          <p className="text-center text-xs mt-5" style={{ color: "#555", fontFamily: "monospace" }}>
            + {100 - founders.length - EMPTY_SLOTS_SHOWN > 0 ? 100 - founders.length - EMPTY_SLOTS_SHOWN : 0} more Founder seats available
          </p>

          {/* Final CTA */}
          <div className="text-center mt-5">
            <button
              onClick={onJoin}
              className="px-6 py-3 rounded-lg font-black tracking-widest text-sm transition-all hover:opacity-90 active:scale-95"
              style={{
                background: "linear-gradient(135deg, #ffd700, #e6a800)",
                color: "#0a0a0a",
                fontFamily: "monospace",
                cursor: "pointer",
                border: "none",
                minHeight: 44,
              }}
            >
              Join the Circle →
            </button>
          </div>
        </>
      )}
    </section>
  );
}

// ── Earnings Projection ──────────────────────────────────────────────────────

function EarningsProjection() {
  // Based on S1: 11.8 ETH / 8 days / ~100 shares total
  // Founder = 5 shares, Normal = 1 share
  // Per share per day = 11.8 / 100 / 8 = 0.001475 ETH
  const perSharePerDay = 11.8 / 100 / 8;
  const founderPerDay = perSharePerDay * 5;
  const normalPerDay = perSharePerDay * 1;
  const founderPerMonth = founderPerDay * 30;
  const normalPerMonth = normalPerDay * 30;
  const founderBreakEven = Math.ceil(0.5 / founderPerDay);
  const normalBreakEven = Math.ceil(0.1 / normalPerDay);

  const rows = [
    {
      label: "Founder (5 shares)",
      perDay: founderPerDay,
      perMonth: founderPerMonth,
      breakEven: founderBreakEven,
      color: "#ffd700",
    },
    {
      label: "Normal (1 share)",
      perDay: normalPerDay,
      perMonth: normalPerMonth,
      breakEven: normalBreakEven,
      color: "#00ff88",
    },
  ];

  return (
    <section className="py-10">
      <div className="text-xs font-black tracking-[0.2em] mb-6 text-center" style={{ color: "#e0e0e0", fontFamily: "monospace" }}>
        WHAT TILES EARN
      </div>

      <div className="max-w-xl mx-auto overflow-x-auto">
        <table className="w-full text-xs" style={{ fontFamily: "monospace", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["TIER", "PER DAY", "PER MONTH", "BREAK-EVEN"].map((h) => (
                <th
                  key={h}
                  className="text-left pb-3 pr-4"
                  style={{ color: "#444", fontSize: 10, letterSpacing: "0.1em", fontWeight: 700 }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} style={{ borderTop: "1px solid #1a1a1a" }}>
                <td className="py-3 pr-4" style={{ color: row.color }}>{row.label}</td>
                <td className="py-3 pr-4" style={{ color: "#00ff88" }}>~{row.perDay.toFixed(3)} ETH</td>
                <td className="py-3 pr-4" style={{ color: "#00ff88" }}>~{row.perMonth.toFixed(2)} ETH</td>
                <td className="py-3" style={{ color: "#aaa" }}>~{row.breakEven} days</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-center mt-4 text-[10px]" style={{ color: "#444", fontFamily: "monospace" }}>
        Based on Series 1 actual performance. Future results may vary.
      </p>
    </section>
  );
}

// ── Full Grid ────────────────────────────────────────────────────────────────

function FullGrid({
  tiles,
  onSelect,
}: {
  tiles: TileV2[];
  onSelect: (tile: TileV2) => void;
}) {
  return (
    <section className="py-10">
      <div className="text-xs font-black tracking-[0.2em] mb-6 text-center" style={{ color: "#e0e0e0", fontFamily: "monospace" }}>
        ALL 100 SEATS
      </div>

      <div
        className="grid gap-[2px] sm:gap-[3px] max-w-2xl mx-auto p-1 rounded-lg"
        style={{
          gridTemplateColumns: "repeat(10, 1fr)",
          background: "#0a0a0a",
          border: "1px solid #1a1a1a",
        }}
      >
        {tiles.map((tile) => {
          const isEmpty = !tile.isActive;
          const isMine = tile.isMine;
          const isFounder = tile.isFounder;

          let bg = "transparent";
          let borderColor = "rgba(255,255,255,0.04)";
          let numColor = "#2a2a2a";
          let boxShadow = "none";

          if (isMine) {
            bg = "rgba(0,255,136,0.08)";
            borderColor = "rgba(0,255,136,0.4)";
            numColor = "#00ff88";
            boxShadow = "0 0 6px rgba(0,255,136,0.15)";
          } else if (isFounder) {
            bg = "rgba(255,215,0,0.06)";
            borderColor = "rgba(255,215,0,0.3)";
            numColor = "#ffd700";
            boxShadow = "0 0 8px rgba(255,215,0,0.1)";
          } else if (tile.isActive) {
            bg = "rgba(0,255,136,0.03)";
            borderColor = "rgba(0,255,136,0.18)";
            numColor = "#00ff88";
          }

          return (
            <button
              key={tile.id}
              onClick={() => { if (isEmpty) onSelect(tile); }}
              className="relative aspect-square rounded-sm overflow-hidden flex flex-col items-center justify-center transition-all"
              style={{
                background: tile.isActive ? `url(${getTileImage(tile.id, isFounder)}) center/cover` : bg,
                border: `1px solid ${borderColor}`,
                boxShadow,
                cursor: isEmpty ? "pointer" : "default",
              }}
              onMouseEnter={(e) => {
                if (isEmpty) {
                  e.currentTarget.style.borderColor = "rgba(255,215,0,0.3)";
                  e.currentTarget.style.boxShadow = "0 0 8px rgba(255,215,0,0.08)";
                }
              }}
              onMouseLeave={(e) => {
                if (isEmpty) {
                  e.currentTarget.style.borderColor = borderColor;
                  e.currentTarget.style.boxShadow = boxShadow;
                }
              }}
              aria-label={`Seat ${tile.id + 1}${isEmpty ? " — available" : tile.isMine ? " — yours" : isFounder ? " — founder" : " — claimed"}`}
            >
              {tile.isActive && (
                <div
                  className="absolute inset-0"
                  style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.4) 0%, transparent 40%, transparent 60%, rgba(0,0,0,0.6) 100%)" }}
                />
              )}
              <span
                style={{
                  color: numColor,
                  fontWeight: 800,
                  fontFamily: "monospace",
                  position: "relative",
                  zIndex: 2,
                  fontSize: "clamp(6px, 1.5vw, 9px)",
                  textShadow: tile.isActive ? "0 1px 4px rgba(0,0,0,1)" : "none",
                }}
              >
                {tile.id + 1}
              </span>
              {isFounder && (
                <Crown
                  size={7}
                  style={{ color: "#ffd700", marginTop: 1, position: "relative", zIndex: 2 }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div
        className="flex justify-center gap-3 sm:gap-5 mt-4 flex-wrap"
        style={{ fontFamily: "monospace" }}
      >
        {[
          { bg: "transparent", border: "rgba(255,255,255,0.08)", label: "Open" },
          { bg: "rgba(0,255,136,0.03)", border: "rgba(0,255,136,0.18)", label: "Normal" },
          { bg: "rgba(255,215,0,0.06)", border: "rgba(255,215,0,0.3)", label: "Founder" },
          { bg: "rgba(0,255,136,0.08)", border: "rgba(0,255,136,0.4)", label: "Yours" },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-1.5">
            <div
              className="rounded-sm"
              style={{ width: 10, height: 10, background: item.bg, border: `1px solid ${item.border}` }}
            />
            <span className="text-[9px]" style={{ color: "#555" }}>{item.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── S1 Proof Link ────────────────────────────────────────────────────────────

function S1ProofLink() {
  return (
    <section className="py-8 border-t" style={{ borderColor: "#1a1a1a" }}>
      <div className="text-center max-w-lg mx-auto">
        <div
          className="text-[10px] font-bold tracking-[0.2em] mb-3"
          style={{ color: "#555", fontFamily: "monospace" }}
        >
          SERIES 1 TRACK RECORD
        </div>
        <div className="text-sm mb-2" style={{ color: "#666", fontFamily: "monospace" }}>
          <span style={{ color: "#ffd700", fontWeight: 800 }}>11.8+ ETH</span> distributed to 100 holders in 8 days
        </div>
        <div className="text-xs mb-3 px-4" style={{ color: "#444", fontFamily: "monospace", lineHeight: 1.6 }}>
          Series 2 is a new series — it does not replace Series 1.
          S1 holders keep earning 100% of protocol trading fees and Flaunch $RUSH trading fees.
          Both series are independent revenue streams.
        </div>
        <div className="flex justify-center gap-3 flex-wrap">
          <a
            href={`${EXPLORER}/address/0x6cE3873e31Ab5440fA6AF1860F8E36110504c9C4`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs transition-opacity hover:opacity-80"
            style={{ color: "#00aaff", fontFamily: "monospace" }}
          >
            Verify S1 on Basescan <ExternalLink size={11} />
          </a>
          <a
            href="/tiles"
            className="inline-flex items-center gap-1.5 text-xs transition-opacity hover:opacity-80"
            style={{ color: "#00ff88", fontFamily: "monospace" }}
          >
            View Series 1 Tiles →
          </a>
        </div>
      </div>
    </section>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function Series2Page() {
  useAccount();
  const { tiles, claimed, available, totalDist, refetch } = useTilesV2();
  const [selected, setSelected] = useState<TileV2 | null>(null);
  const [defaultFounder, setDefaultFounder] = useState(false);

  const founderTiles = tiles.filter((t) => t.isActive && t.isFounder);
  const firstAvailable = tiles.find((t) => !t.isActive) ?? null;

  function openClaim(wantFounder: boolean) {
    if (!firstAvailable) return;
    setDefaultFounder(wantFounder);
    setSelected(firstAvailable);
  }

  return (
    <div style={{ background: "#0a0a0a", color: "#ccc", minHeight: "100vh", fontFamily: "monospace" }}>
      <Header />
      <ProofBanner />

      <div className="max-w-4xl mx-auto px-4 sm:px-6">

        {/* ── Hero ── */}
        <section className="pt-12 pb-10 text-center">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <div
              className="text-[11px] font-black tracking-[0.3em] mb-3"
              style={{ color: "#ffd700", fontFamily: "monospace" }}
            >
              SERIES 2
            </div>
            <h1
              className="text-3xl md:text-5xl font-black mb-4"
              style={{ color: "#f5f5f5", fontFamily: "monospace", lineHeight: 1.1 }}
            >
              Founders Circle
            </h1>
            <p className="text-sm max-w-lg mx-auto mb-8" style={{ color: "#999", fontFamily: "monospace", lineHeight: 1.7 }}>
              Revenue-sharing seats in Rush Protocol. Founder holders earned 11.8 ETH in 8 days on Series 1.
            </p>

            {/* Stats row */}
            <div className="flex justify-center gap-6 sm:gap-10 mb-6">
              <div className="text-center">
                <div
                  className="text-2xl sm:text-3xl font-black"
                  style={{ color: available > 0 ? "#00ff88" : "#ff4444", fontFamily: "monospace" }}
                >
                  {available}
                </div>
                <div
                  className="text-[9px] tracking-widest mt-0.5"
                  style={{ color: "#555", fontFamily: "monospace" }}
                >
                  AVAILABLE
                </div>
              </div>
              <div style={{ width: 1, background: "#1a1a1a" }} />
              <div className="text-center">
                <div
                  className="text-2xl sm:text-3xl font-black"
                  style={{ color: "#e0e0e0", fontFamily: "monospace" }}
                >
                  {claimed}
                </div>
                <div
                  className="text-[9px] tracking-widest mt-0.5"
                  style={{ color: "#555", fontFamily: "monospace" }}
                >
                  CLAIMED
                </div>
              </div>
              <div style={{ width: 1, background: "#1a1a1a" }} />
              <div className="text-center">
                <div
                  className="text-2xl sm:text-3xl font-black"
                  style={{ color: "#ffd700", fontFamily: "monospace" }}
                >
                  {parseFloat(totalDist).toFixed(3)}
                </div>
                <div
                  className="text-[9px] tracking-widest mt-0.5"
                  style={{ color: "#555", fontFamily: "monospace" }}
                >
                  ETH DISTRIBUTED
                </div>
              </div>
            </div>

            {/* Progress bar */}
            <div className="max-w-sm mx-auto">
              <div
                className="h-1.5 rounded-full overflow-hidden"
                style={{ background: "#111" }}
              >
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${(claimed / GRID) * 100}%` }}
                  transition={{ duration: 0.8, delay: 0.3 }}
                  className="h-full rounded-full"
                  style={{ background: "linear-gradient(90deg, #00ff88, #ffd700)" }}
                />
              </div>
              <div
                className="text-[10px] mt-2"
                style={{ color: "#444", fontFamily: "monospace" }}
              >
                {claimed}/100 seats claimed
              </div>
            </div>
          </motion.div>
        </section>

        {/* ── Tier Comparison ── */}
        <section className="pb-10">
          <div className="flex flex-col sm:flex-row gap-4">
            <FounderCard
              founderClaimed={founderTiles.length}
              onClaim={() => openClaim(true)}
            />
            <NormalCard onClaim={() => openClaim(false)} />
          </div>
        </section>

        {/* ── Founders Circle ── */}
        <FoundersCircle
          founders={founderTiles}
          onJoin={() => openClaim(true)}
        />

        {/* ── Earnings Projection ── */}
        <EarningsProjection />

        {/* ── Full Grid ── */}
        <FullGrid tiles={tiles} onSelect={(tile) => { setDefaultFounder(false); setSelected(tile); }} />

        {/* ── S1 Proof ── */}
        <S1ProofLink />
      </div>

      {/* Claim modal */}
      <AnimatePresence>
        {selected && !selected.isActive && (
          <ClaimModal
            tile={selected}
            onClose={() => setSelected(null)}
            refetch={refetch}
            defaultFounder={defaultFounder}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
