"use client";

import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { motion } from "framer-motion";
import Header from "@/components/Header";
import { PLATFORM_STATS } from "@/lib/mock";

// ─── Contract addresses ───────────────────────────────────────────────────────

const BASESCAN = "https://basescan.org";

const CONTRACTS = [
  {
    name: "MarketFactory",
    address: "0x7b51C8C92f24Ef705E9C5c6f77ffA819b9733f4c",
    desc: "Creates and tracks prediction markets",
  },
  {
    name: "RushTiles",
    address: "0xaCa403BbDE42836146b681AC7B26CE44E875c651",
    desc: "Harberger-taxed revenue-sharing tile system",
  },
  {
    name: "Oracle",
    address: "0x4c385830c2E241EfeEd070Eb92606B6AedeDA277",
    desc: "AI vehicle count settlement oracle",
  },
  {
    name: "Fee Recipient",
    address: "0xdd12D83786C2BAc7be3D59869834C23E91449A2D",
    desc: "Protocol fee collection address",
  },
];

const FEE_STRUCTURE = [
  { source: "Prediction pool", rate: "5%", recipient: "Protocol" },
  { source: "Harberger tax (5%/week on tiles)", rate: "5%/wk", recipient: "Tile holders" },
  { source: "Buyout fee", rate: "10%", recipient: "Tile holders" },
  { source: "Appreciation tax", rate: "30%", recipient: "Protocol" },
  { source: "Token creator fees", rate: "Variable", recipient: "Tile holders" },
];

// ─── Stats page ───────────────────────────────────────────────────────────────

export default function StatsPage() {
  const overview = [
    {
      label: "Total Volume Wagered",
      value: `${PLATFORM_STATS.totalVolume.toFixed(1)} ETH`,
      sub: "All time",
      color: "#00ff88",
    },
    {
      label: "Markets Created",
      value: PLATFORM_STATS.marketsResolved.toLocaleString(),
      sub: `${PLATFORM_STATS.marketsResolved.toLocaleString()} resolved`,
      color: "#ffd700",
    },
    {
      label: "Unique Wallets",
      value: PLATFORM_STATS.uniqueBettors.toLocaleString(),
      sub: `Avg ${PLATFORM_STATS.avgBettorsPerRound} per round`,
      color: "#00aaff",
    },
    {
      label: "Total Fees Collected",
      value: `${(PLATFORM_STATS.totalVolume * 0.05).toFixed(2)} ETH`,
      sub: "At 5% flat rate",
      color: "#ff8844",
    },
    {
      label: "Distributed to Tile Holders",
      value: `${PLATFORM_STATS.feesDistributed.toFixed(2)} ETH`,
      sub: "All time rewards",
      color: "#aa88ff",
    },
  ];

  const protocolDetails = [
    { label: "24H Volume", value: `${PLATFORM_STATS.volume24h.toFixed(1)} ETH` },
    { label: "Biggest Round Pool", value: `${PLATFORM_STATS.biggestRound.toFixed(1)} ETH` },
    { label: "Avg Pool Size", value: `${PLATFORM_STATS.avgPoolSize.toFixed(2)} ETH` },
    { label: "Avg Bettors / Round", value: PLATFORM_STATS.avgBettorsPerRound },
    { label: "Protocol Fee", value: "5% flat" },
    { label: "Chain", value: "Base (8453)" },
    { label: "Settlement", value: "AI Oracle (YOLOv8)" },
    { label: "Round Duration", value: "5 minutes" },
    { label: "Min Bet", value: "0.005 ETH" },
    { label: "Tile Count", value: "100 seats" },
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
            PLATFORM OVERVIEW
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
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

        {/* Smart Contracts */}
        <section aria-label="Smart contracts" className="mb-10">
          <div className="text-xs font-bold tracking-widest mb-4" style={{ color: "#555", fontFamily: "monospace" }}>
            SMART CONTRACTS — VERIFIED ON BASESCAN
          </div>
          <div className="flex flex-col gap-2">
            {CONTRACTS.map((contract, i) => (
              <motion.div
                key={contract.address}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: i * 0.07 }}
                className="flex flex-col md:flex-row md:items-center justify-between gap-2 px-5 py-4 rounded-lg"
                style={{ background: "#111", border: "1px solid #1a1a1a" }}
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-bold" style={{ color: "#e0e0e0", fontFamily: "monospace" }}>
                    {contract.name}
                  </span>
                  <span className="text-xs" style={{ color: "#555", fontFamily: "monospace" }}>
                    {contract.desc}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="text-xs tabular"
                    style={{ color: "#888", fontFamily: "monospace" }}
                  >
                    {contract.address.slice(0, 10)}...{contract.address.slice(-6)}
                  </span>
                  <a
                    href={`${BASESCAN}/address/${contract.address}`}
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
                    aria-label={`View ${contract.name} on Basescan`}
                  >
                    Basescan
                    <ExternalLink size={10} />
                  </a>
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Fee Structure */}
        <section aria-label="Fee structure" className="mb-10">
          <div className="text-xs font-bold tracking-widest mb-4" style={{ color: "#555", fontFamily: "monospace" }}>
            FEE STRUCTURE
          </div>
          <div className="rounded-lg overflow-hidden" style={{ border: "1px solid #1a1a1a" }}>
            <div className="grid grid-cols-3 px-5 py-2.5" style={{ background: "#0d0d0d", borderBottom: "1px solid #1a1a1a" }}>
              {["SOURCE", "RATE", "RECIPIENT"].map((h) => (
                <span key={h} className="text-xs font-bold" style={{ color: "#444", fontFamily: "monospace" }}>{h}</span>
              ))}
            </div>
            {FEE_STRUCTURE.map((row, i) => (
              <div
                key={row.source}
                className="grid grid-cols-3 items-center px-5 py-3"
                style={{
                  background: i % 2 === 0 ? "#111" : "#0e0e0e",
                  borderBottom: i < FEE_STRUCTURE.length - 1 ? "1px solid #1a1a1a" : "none",
                }}
              >
                <span className="text-xs" style={{ color: "#888", fontFamily: "monospace" }}>{row.source}</span>
                <span className="text-xs font-bold tabular" style={{ color: "#ffd700", fontFamily: "monospace" }}>{row.rate}</span>
                <span className="text-xs" style={{ color: "#00ff88", fontFamily: "monospace" }}>{row.recipient}</span>
              </div>
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
            {protocolDetails.map((row, i) => (
              <div
                key={row.label}
                className="flex items-center justify-between px-5 py-3"
                style={{
                  background: i % 2 === 0 ? "#111" : "#0e0e0e",
                  borderBottom: i < protocolDetails.length - 1 ? "1px solid #1a1a1a" : "none",
                }}
              >
                <span className="text-xs" style={{ color: "#666", fontFamily: "monospace" }}>{row.label}</span>
                <span className="text-xs font-bold tabular" style={{ color: "#e0e0e0", fontFamily: "monospace" }}>{row.value}</span>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
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
            WATCH LIVE MARKET
          </Link>
          <Link
            href="/tiles"
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
            EXPLORE TILES
          </Link>
        </div>
      </main>
    </div>
  );
}
