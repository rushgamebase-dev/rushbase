"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import Header from "@/components/Header";
import { PLATFORM_STATS } from "@/lib/mock";

export default function StatsPage() {
  const bigStats = [
    {
      label: "TOTAL VOLUME",
      value: `${PLATFORM_STATS.totalVolume.toFixed(1)} ETH`,
      sub: "All time",
      color: "#00ff88",
    },
    {
      label: "MARKETS RESOLVED",
      value: PLATFORM_STATS.marketsResolved.toLocaleString(),
      sub: `Avg pool ${PLATFORM_STATS.avgPoolSize.toFixed(2)} ETH`,
      color: "#ffd700",
    },
    {
      label: "UNIQUE BETTORS",
      value: PLATFORM_STATS.uniqueBettors.toLocaleString(),
      sub: `Avg ${PLATFORM_STATS.avgBettorsPerRound} per round`,
      color: "#00aaff",
    },
    {
      label: "FEES DISTRIBUTED",
      value: `${PLATFORM_STATS.feesDistributed.toFixed(2)} ETH`,
      sub: "To tile holders",
      color: "#aa88ff",
    },
  ];

  const details = [
    { label: "24H Volume", value: `${PLATFORM_STATS.volume24h.toFixed(1)} ETH` },
    { label: "Biggest Round Pool", value: `${PLATFORM_STATS.biggestRound.toFixed(1)} ETH` },
    { label: "Avg Bettors / Round", value: PLATFORM_STATS.avgBettorsPerRound },
    { label: "Protocol Fee", value: "2%" },
    { label: "Chain", value: "Base (8453)" },
    { label: "Settlement", value: "Oracle-based" },
    { label: "Round Duration", value: "5 minutes" },
    { label: "Min Bet", value: "0.005 ETH" },
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
          <span
            className="text-sm font-bold tracking-widest"
            style={{ color: "#e0e0e0", fontFamily: "monospace" }}
          >
            PLATFORM STATS
          </span>
        </div>

        {/* Big number cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {bigStats.map((stat) => (
            <div
              key={stat.label}
              className="p-5 rounded-lg"
              style={{ background: "#111", border: "1px solid #1a1a1a" }}
            >
              <div
                className="text-xs font-bold tracking-widest mb-2"
                style={{ color: "#555", fontFamily: "monospace" }}
              >
                {stat.label}
              </div>
              <div
                className="text-2xl font-black tabular mb-1"
                style={{
                  color: stat.color,
                  fontFamily: "monospace",
                  textShadow: `0 0 20px ${stat.color}44`,
                }}
              >
                {stat.value}
              </div>
              <div className="text-xs" style={{ color: "#444", fontFamily: "monospace" }}>
                {stat.sub}
              </div>
            </div>
          ))}
        </div>

        {/* Detail table */}
        <div
          className="rounded-lg overflow-hidden"
          style={{ border: "1px solid #1a1a1a" }}
        >
          <div
            className="px-5 py-3"
            style={{ background: "#0d0d0d", borderBottom: "1px solid #1a1a1a" }}
          >
            <span
              className="text-xs font-bold tracking-widest"
              style={{ color: "#555", fontFamily: "monospace" }}
            >
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
              <span className="text-xs" style={{ color: "#666", fontFamily: "monospace" }}>
                {row.label}
              </span>
              <span className="text-xs font-bold tabular" style={{ color: "#e0e0e0", fontFamily: "monospace" }}>
                {row.value}
              </span>
            </div>
          ))}
        </div>

        {/* Live market link */}
        <div className="mt-8 text-center">
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
            <span className="live-dot" style={{ width: 6, height: 6 }} />
            WATCH LIVE MARKET
          </Link>
        </div>
      </main>
    </div>
  );
}
