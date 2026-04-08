"use client";

import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { motion } from "framer-motion";
import Header from "@/components/Header";
import { useStats } from "@/hooks/useStats";
import {
  FACTORY_ADDRESS,
  RUSH_TILES_ADDRESS,
  RUSH_TILES_V2_ADDRESS,
  RUSH_TOKEN_ADDRESS,
} from "@/lib/contracts";

const BASESCAN = "https://basescan.org";

const CONTRACTS = [
  {
    name: "$RUSH Token",
    address: RUSH_TOKEN_ADDRESS,
    desc: "Deflationary ERC-20 — betting currency",
    highlight: true,
  },
  {
    name: "BurnMarketFactory",
    address: FACTORY_ADDRESS,
    desc: "Creates $RUSH prediction markets (30% burn)",
    tag: "production",
  },
  {
    name: "RushTiles Series 1",
    address: RUSH_TILES_ADDRESS,
    desc: "100 revenue-sharing tiles (Harberger tax)",
  },
  {
    name: "RushTiles Series 2",
    address: RUSH_TILES_V2_ADDRESS,
    desc: "100 tiles — Founder (5 shares) + Normal (1 share)",
  },
  {
    name: "Oracle",
    address: "0x4c385830c2E241EfeEd070Eb92606B6AedeDA277",
    desc: "AI vehicle count settlement",
  },
];

export default function StatsPage() {
  const { stats: S } = useStats();

  const overview = [
    {
      label: "Markets Resolved",
      value: S.marketsResolved.toLocaleString(),
      sub: "All time",
      color: "#ffd700",
    },
    {
      label: "Unique Wallets",
      value: S.uniqueBettors.toLocaleString(),
      sub: `Avg ${S.avgBettorsPerRound} per round`,
      color: "#00aaff",
    },
    {
      label: "Distributed to Holders",
      value: `${S.feesDistributed.toFixed(2)} ETH`,
      sub: "Series 1 tile rewards",
      color: "#aa88ff",
    },
    {
      label: "Biggest Round",
      value: `${S.biggestRound.toFixed(1)} ETH`,
      sub: "Single pool record",
      color: "#ff8844",
    },
  ];

  const details = [
    { label: "Chain", value: "Base (8453)" },
    { label: "Settlement", value: "AI Oracle" },
    { label: "Round Duration", value: "5 minutes" },
    { label: "Betting Window", value: "2:30" },
    { label: "Burn Rate ($RUSH)", value: "30% per pool" },
    { label: "Protocol Fee ($RUSH)", value: "0%" },
    { label: "Total Tiles", value: "200 (Series 1 + 2)" },
    { label: "Founder Shares", value: "5x per tile" },
  ];

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#0a0a0a", color: "#e0e0e0" }}>
      <Header />

      <main className="flex-1 p-4 md:p-8 max-w-5xl mx-auto w-full">

        {/* Back + title */}
        <div className="flex items-center gap-3 mb-8">
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
          <span className="text-sm font-bold tracking-widest" style={{ color: "#e0e0e0", fontFamily: "monospace" }}>
            PLATFORM STATS
          </span>
        </div>

        {/* Platform Overview */}
        <section aria-label="Platform overview" className="mb-10">
          <div className="text-xs font-bold tracking-widest mb-4" style={{ color: "#555", fontFamily: "monospace" }}>
            OVERVIEW
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {overview.map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: i * 0.07 }}
                className="p-4 rounded-lg"
                style={{ background: "#111", border: "1px solid #1a1a1a" }}
              >
                <div className="text-xs font-bold tracking-wide mb-2" style={{ color: "#555", fontFamily: "monospace" }}>
                  {stat.label}
                </div>
                <div
                  className="text-xl font-black tabular mb-1"
                  style={{ color: stat.color, fontFamily: "monospace", textShadow: `0 0 16px ${stat.color}44` }}
                >
                  {stat.value}
                </div>
                <div className="text-xs" style={{ color: "#444", fontFamily: "monospace" }}>
                  {stat.sub}
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Burn Mechanic Highlight */}
        <section aria-label="Burn mechanics" className="mb-10">
          <div className="text-xs font-bold tracking-widest mb-4" style={{ color: "#555", fontFamily: "monospace" }}>
            $RUSH BURN MODEL
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg p-4 text-center" style={{ background: "#0a150a", border: "1px solid #00ff8822" }}>
              <div className="text-2xl font-black" style={{ color: "#00ff88", fontFamily: "monospace" }}>70%</div>
              <div className="text-xs mt-1" style={{ color: "#555", fontFamily: "monospace" }}>TO WINNERS</div>
            </div>
            <div className="rounded-lg p-4 text-center" style={{ background: "#1a0a0a", border: "1px solid #ff444422" }}>
              <div className="text-2xl font-black" style={{ color: "#ff6666", fontFamily: "monospace" }}>30%</div>
              <div className="text-xs mt-1" style={{ color: "#555", fontFamily: "monospace" }}>BURNED</div>
            </div>
            <div className="rounded-lg p-4 text-center" style={{ background: "#0d0d0d", border: "1px solid #ffd70022" }}>
              <div className="text-2xl font-black" style={{ color: "#ffd700", fontFamily: "monospace" }}>0%</div>
              <div className="text-xs mt-1" style={{ color: "#555", fontFamily: "monospace" }}>FEES</div>
            </div>
          </div>
        </section>

        {/* Smart Contracts */}
        <section aria-label="Smart contracts" className="mb-10">
          <div className="text-xs font-bold tracking-widest mb-4" style={{ color: "#555", fontFamily: "monospace" }}>
            CONTRACTS — VERIFIED ON BASESCAN
          </div>
          <div className="flex flex-col gap-2">
            {CONTRACTS.map((contract, i) => (
              <motion.div
                key={contract.address}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: i * 0.07 }}
                className="flex flex-col md:flex-row md:items-center justify-between gap-2 px-5 py-4 rounded-lg"
                style={{
                  background: "highlight" in contract && contract.highlight ? "#111a00" : "#111",
                  border: `1px solid ${"highlight" in contract && contract.highlight ? "#ffd70033" : "#1a1a1a"}`,
                }}
              >
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span
                      className="text-sm font-bold"
                      style={{
                        color: "highlight" in contract && contract.highlight ? "#ffd700" : "#e0e0e0",
                        fontFamily: "monospace",
                      }}
                    >
                      {contract.name}
                    </span>
                    {"tag" in contract && contract.tag && (
                      <span
                        className="text-xs px-1.5 py-0.5 rounded"
                        style={{ background: "#0a2a0a", color: "#00ff88", border: "1px solid #00ff8833", fontSize: "0.65rem", fontWeight: 700 }}
                      >
                        {contract.tag}
                      </span>
                    )}
                  </div>
                  <span className="text-xs" style={{ color: "#555", fontFamily: "monospace" }}>
                    {contract.desc}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs tabular" style={{ color: "#888", fontFamily: "monospace" }}>
                    {contract.address.slice(0, 10)}...{contract.address.slice(-6)}
                  </span>
                  <a
                    href={`${BASESCAN}/${"highlight" in contract && contract.highlight ? "token" : "address"}/${contract.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-all"
                    style={{
                      background: "rgba(0,170,255,0.1)",
                      border: "1px solid rgba(0,170,255,0.25)",
                      color: "#00aaff",
                      fontFamily: "monospace",
                      textDecoration: "none",
                    }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "rgba(0,170,255,0.18)")}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "rgba(0,170,255,0.1)")}
                  >
                    Basescan <ExternalLink size={10} />
                  </a>
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Protocol Details */}
        <section aria-label="Protocol details" className="mb-10">
          <div className="rounded-lg overflow-hidden" style={{ border: "1px solid #1a1a1a" }}>
            <div className="px-5 py-3" style={{ background: "#0d0d0d", borderBottom: "1px solid #1a1a1a" }}>
              <span className="text-xs font-bold tracking-widest" style={{ color: "#555", fontFamily: "monospace" }}>
                PROTOCOL DETAILS
              </span>
            </div>
            {details.map((row, i) => (
              <div
                key={row.label}
                className="flex items-center justify-between px-5 py-3"
                style={{
                  background: i % 2 === 0 ? "#111" : "#0e0e0e",
                  borderBottom: i < details.length - 1 ? "1px solid #1a1a1a" : "none",
                }}
              >
                <span className="text-xs" style={{ color: "#666", fontFamily: "monospace" }}>{row.label}</span>
                <span className="text-xs font-bold tabular" style={{ color: "#e0e0e0", fontFamily: "monospace" }}>{row.value}</span>
              </div>
            ))}
          </div>
        </section>

        {/* CTAs */}
        <div className="flex gap-4 justify-center flex-wrap">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 rounded font-bold text-sm transition-all"
            style={{
              background: "rgba(0,255,136,0.1)",
              border: "1px solid rgba(0,255,136,0.3)",
              color: "#00ff88",
              fontFamily: "monospace",
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "rgba(0,255,136,0.18)")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "rgba(0,255,136,0.1)")}
          >
            <span className="live-dot" style={{ width: 6, height: 6 }} aria-hidden="true" />
            WATCH LIVE
          </Link>
          <Link
            href="/series2"
            className="inline-flex items-center gap-2 px-6 py-3 rounded font-bold text-sm transition-all"
            style={{
              background: "rgba(255,215,0,0.1)",
              border: "1px solid rgba(255,215,0,0.3)",
              color: "#ffd700",
              fontFamily: "monospace",
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "rgba(255,215,0,0.18)")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "rgba(255,215,0,0.1)")}
          >
            FOUNDER TILES
          </Link>
          <a
            href={`https://flaunch.gg/base/coins/${RUSH_TOKEN_ADDRESS}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 rounded font-bold text-sm transition-all"
            style={{
              background: "rgba(136,170,255,0.1)",
              border: "1px solid rgba(136,170,255,0.3)",
              color: "#88aaff",
              fontFamily: "monospace",
              textDecoration: "none",
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "rgba(136,170,255,0.18)")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "rgba(136,170,255,0.1)")}
          >
            BUY $RUSH
          </a>
        </div>
      </main>
    </div>
  );
}
