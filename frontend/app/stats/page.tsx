"use client";

import Link from "next/link";
import { ArrowLeft, BarChart3, ExternalLink } from "lucide-react";
import { motion } from "framer-motion";
import Header from "@/components/Header";
import { useStats } from "@/hooks/useStats";
import {
  FACTORY_ADDRESS,
  RUSH_TILES_ADDRESS,
  RUSH_TILES_V2_ADDRESS,
  RUSH_TOKEN_ADDRESS,
} from "@/lib/contracts";
import { RUSH_ARENAS_CONTRACTS } from "@/lib/contracts/rushArenas";

const BASESCAN = "https://basescan.org";

const CONTRACTS = [
  {
    name: "Prediction MarketFactory",
    address: FACTORY_ADDRESS,
    desc: "Creates ETH prediction markets",
  },
  {
    name: "$RUSH Token",
    address: RUSH_TOKEN_ADDRESS,
    desc: "ERC-20 on Flaunch — trading fee revenue",
    tag: "token",
    highlight: true,
  },
  {
    name: "Royale Agent Registry",
    address: RUSH_ARENAS_CONTRACTS.agentRegistry,
    desc: "Rush Royale fighter identities",
    tag: "royale",
  },
  {
    name: "Royale Arena Manager",
    address: RUSH_ARENAS_CONTRACTS.arenaManager,
    desc: "Rush Royale arenas and player entry",
    tag: "royale",
  },
  {
    name: "Royale Battle Engine",
    address: RUSH_ARENAS_CONTRACTS.battleEngine,
    desc: "VRF request, deterministic battle result and payouts",
    tag: "royale",
  },
  {
    name: "Oracle",
    address: "0x4c385830c2E241EfeEd070Eb92606B6AedeDA277",
    desc: "AI vehicle count settlement",
  },
  {
    name: "RushTiles Series 1",
    address: RUSH_TILES_ADDRESS,
    desc: "Legacy holder rewards and claims",
    tag: "legacy",
  },
  {
    name: "RushTiles Series 2",
    address: RUSH_TILES_V2_ADDRESS,
    desc: "Legacy holder management and claims",
    tag: "legacy",
  },
];

export default function StatsPage() {
  const { stats: S } = useStats();

  const overview = [
    {
      label: "Predict Markets",
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
      label: "Legacy Distributions",
      value: `${S.feesDistributed.toFixed(2)} ETH`,
      sub: "Holder rewards",
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
    { label: "Royale", value: "VRF battle arenas" },
    { label: "Tap Trading", value: "Price-touch arena" },
    { label: "Prediction", value: "AI Oracle markets" },
    { label: "Currency", value: "ETH on Base" },
    { label: "Ledger", value: "On-chain proof" },
    { label: "Legacy Claims", value: "Available from Ledger" },
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
            STATS
          </span>
        </div>

        <section className="mb-10 overflow-hidden rounded-lg border border-[#1a1a1a] bg-[#0d0d0d] p-5 md:p-6">
          <div className="mb-3 inline-flex items-center gap-2 rounded border border-[#00ff88]/25 bg-[#00ff88]/10 px-3 py-1 font-mono text-[10px] font-black uppercase tracking-[0.2em] text-[#00ff88]">
            <BarChart3 size={13} />
            Ecosystem
          </div>
          <h1 className="text-3xl font-black uppercase tracking-tight text-white md:text-5xl">Rush Stats</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#8a8a8a]">
            Live protocol counters, verified contracts and legacy accounting in one place.
          </p>
        </section>

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

        {/* Payout Model */}
        <section aria-label="Payout model" className="mb-10">
          <div className="text-xs font-bold tracking-widest mb-4" style={{ color: "#555", fontFamily: "monospace" }}>
            ECOSYSTEM MODEL
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg p-4 text-center" style={{ background: "#0a150a", border: "1px solid #00ff8822" }}>
              <div className="text-2xl font-black" style={{ color: "#00ff88", fontFamily: "monospace" }}>LIVE</div>
              <div className="text-xs mt-1" style={{ color: "#555", fontFamily: "monospace" }}>ROYALE + TAP TRADING</div>
            </div>
            <div className="rounded-lg p-4 text-center" style={{ background: "#0d0d0d", border: "1px solid #ffd70022" }}>
              <div className="text-2xl font-black" style={{ color: "#ffd700", fontFamily: "monospace" }}>BASE</div>
              <div className="text-xs mt-1" style={{ color: "#555", fontFamily: "monospace" }}>ON-CHAIN PROOF</div>
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
                        style={contractTagStyle(contract.tag)}
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
            href="/arenas"
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
            OPEN ROYALE
          </Link>
          <Link
            href="/trade"
            className="inline-flex items-center gap-2 px-6 py-3 rounded font-bold text-sm transition-all"
            style={{
              background: "rgba(0,255,102,0.1)",
              border: "1px solid rgba(0,255,102,0.3)",
              color: "#00ff66",
              fontFamily: "monospace",
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "rgba(0,255,102,0.18)")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "rgba(0,255,102,0.1)")}
          >
            TAP TRADING
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

function contractTagStyle(tag: string) {
  if (tag === "legacy") {
    return {
      background: "#2a1a00",
      color: "#ffaa00",
      border: "1px solid #ffaa0033",
      fontSize: "0.65rem",
      fontWeight: 700,
    };
  }

  if (tag === "token") {
    return {
      background: "#1a1600",
      color: "#ffd700",
      border: "1px solid #ffd70033",
      fontSize: "0.65rem",
      fontWeight: 700,
    };
  }

  return {
    background: "#061827",
    color: "#00ddff",
    border: "1px solid #00ddff33",
    fontSize: "0.65rem",
    fontWeight: 700,
  };
}
