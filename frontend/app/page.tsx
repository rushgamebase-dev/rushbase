"use client";

import { useLiveMarket } from "@/lib/mock";
import { useActiveMarket } from "@/hooks/useActiveMarket";
import { useMarketContract } from "@/hooks/useMarketContract";
import Header from "@/components/Header";
import VideoPlayer from "@/components/VideoPlayer";
import BettingPanel from "@/components/BettingPanel";
import Chat from "@/components/Chat";
import Countdown from "@/components/Countdown";
import RoundHistory from "@/components/RoundHistory";
import StatsBar from "@/components/StatsBar";
import ClaimBanner from "@/components/ClaimBanner";
import Link from "next/link";
import { motion } from "framer-motion";
import { Shield, Zap, Brain, Coins } from "lucide-react";

// ─── Platform stats (mock values) ─────────────────────────────────────────────

const PLATFORM_STAT_CARDS = [
  { label: "Total Volume", value: "127.4 ETH", color: "#00ff88" },
  { label: "Markets Resolved", value: "1,247", color: "#ffd700" },
  { label: "Distributed to Holders", value: "3.24 ETH", color: "#aa88ff" },
  { label: "Unique Bettors", value: "892", color: "#00aaff" },
];

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Connect Wallet",
    desc: "MetaMask or Phantom on Base — one click to get started.",
  },
  {
    step: "02",
    title: "Place Your Prediction",
    desc: "Over or Under on vehicle count at Peace Bridge.",
  },
  {
    step: "03",
    title: "Win ETH",
    desc: "Correct predictions split the pool minus a flat 5% fee. No house edge.",
  },
];

const WHY_RUSH = [
  {
    icon: <Shield size={20} />,
    title: "Fully On-Chain",
    desc: "Every bet verified on Basescan. Zero off-chain custody.",
  },
  {
    icon: <Zap size={20} />,
    title: "No House Edge",
    desc: "Pari-mutuel pool. 5% flat fee only. We never profit from wins or losses.",
  },
  {
    icon: <Brain size={20} />,
    title: "AI-Powered Oracle",
    desc: "YOLOv8 real-time vehicle detection — verifiable on every round.",
  },
  {
    icon: <Coins size={20} />,
    title: "Revenue Sharing",
    desc: "Own a tile, earn from every market. 100 seats, Harberger model.",
  },
];

const BUILT_WITH = [
  { label: "Built on Base" },
  { label: "$RUSH on Uniswap" },
  { label: "Powered by AI" },
];

// ─── Animation helpers ────────────────────────────────────────────────────────

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: (delay = 0) => ({ opacity: 1, y: 0, transition: { duration: 0.4, delay } }),
};

// ─── Home page ────────────────────────────────────────────────────────────────

export default function Home() {
  const market = useLiveMarket();
  const { marketAddress, isDemoMode } = useActiveMarket();
  const contractData = useMarketContract(marketAddress);

  const lockTime = contractData.lockTime ? Number(contractData.lockTime) : 0;
  const contractState = contractData.state;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#0a0a0a", color: "#e0e0e0" }}>
      <Header viewerCount={247} />
      <StatsBar />

      {/* Main 3-column layout */}
      <div className="flex-1 flex min-h-0 flex-col lg:flex-row">

        {/* Left: Video + content (55%) */}
        <div
          className="flex flex-col p-3 gap-3 overflow-y-auto lg:overflow-visible"
          style={{
            flex: "0 0 55%",
            maxWidth: "100%",
            borderRight: "1px solid #1a1a1a",
          }}
        >
          {/* Claim winnings banner */}
          <ClaimBanner
            marketAddress={marketAddress}
            marketState={contractState}
          />

          {/* Hero tagline */}
          <motion.div
            initial="hidden"
            animate="show"
            variants={fadeUp}
            custom={0}
            className="px-1"
          >
            <h1
              className="text-2xl md:text-3xl font-black tracking-tight leading-tight"
              style={{
                color: "#00ff88",
                fontFamily: "ui-monospace, SFMono-Regular, monospace",
                textShadow: "0 0 24px rgba(0,255,136,0.3)",
              }}
            >
              Predict. Win. Verify.
            </h1>
            <p className="text-sm mt-1" style={{ color: "#666" }}>
              The first fully transparent on-chain prediction market on Base
            </p>
          </motion.div>

          <VideoPlayer
            vehicleCount={market.vehicleCount}
            isLive={market.status === "open" || market.status === "locked"}
          />

          {/* Countdown + count row */}
          <div
            className="grid grid-cols-2 gap-4 p-4 rounded"
            style={{ background: "#111", border: "1px solid #1a1a1a" }}
          >
            <Countdown
              lockTime={lockTime > 0 ? lockTime : undefined}
              timeLeft={market.timeLeft}
              totalDuration={market.totalDuration}
              status={market.status}
              roundNumber={market.roundId}
            />
            <div className="flex flex-col justify-center gap-1">
              <div
                className="text-xs font-bold tracking-widest"
                style={{ color: "#555", fontFamily: "monospace" }}
              >
                CURRENT COUNT
              </div>
              <div
                className="text-3xl font-black tabular"
                style={{
                  color: "#00ff88",
                  fontFamily: "monospace",
                  textShadow: "0 0 16px rgba(0,255,136,0.4)",
                }}
              >
                {String(market.vehicleCount).padStart(3, "0")}
              </div>
              <div className="text-xs" style={{ color: "#555", fontFamily: "monospace" }}>
                threshold:{" "}
                <span style={{ color: "#ffd700" }}>{market.threshold}</span>
                {" · "}
                <span
                  style={{
                    color: market.vehicleCount > market.threshold ? "#00ff88" : "#ff4444",
                    fontWeight: 700,
                  }}
                >
                  {market.vehicleCount > market.threshold
                    ? `+${market.vehicleCount - market.threshold} over`
                    : `${market.threshold - market.vehicleCount} to go`}
                </span>
              </div>
            </div>
          </div>

          {/* Pool bars */}
          <div
            className="p-4 rounded"
            style={{ background: "#111", border: "1px solid #1a1a1a" }}
          >
            <div
              className="text-xs font-bold tracking-widest mb-3"
              style={{ color: "#555", fontFamily: "monospace" }}
            >
              POOL DISTRIBUTION
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold w-16 shrink-0" style={{ color: "#00ff88", fontFamily: "monospace" }}>
                  &#9650; OVER
                </span>
                <div className="flex-1 h-4 rounded overflow-hidden" style={{ background: "#0d0d0d" }}>
                  <div
                    className="h-full rounded transition-all duration-700"
                    style={{ width: `${market.overPct}%`, background: "rgba(0,255,136,0.7)" }}
                  />
                </div>
                <span className="text-xs font-bold tabular w-24 text-right shrink-0" style={{ color: "#00ff88", fontFamily: "monospace" }}>
                  {market.overPool.toFixed(3)} ETH
                </span>
                <span className="text-xs tabular w-8 text-right shrink-0" style={{ color: "#444", fontFamily: "monospace" }}>
                  {market.overPct}%
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold w-16 shrink-0" style={{ color: "#ff4444", fontFamily: "monospace" }}>
                  &#9660; UNDER
                </span>
                <div className="flex-1 h-4 rounded overflow-hidden" style={{ background: "#0d0d0d" }}>
                  <div
                    className="h-full rounded transition-all duration-700"
                    style={{ width: `${market.underPct}%`, background: "rgba(255,68,68,0.7)" }}
                  />
                </div>
                <span className="text-xs font-bold tabular w-24 text-right shrink-0" style={{ color: "#ff4444", fontFamily: "monospace" }}>
                  {market.underPool.toFixed(3)} ETH
                </span>
                <span className="text-xs tabular w-8 text-right shrink-0" style={{ color: "#444", fontFamily: "monospace" }}>
                  {market.underPct}%
                </span>
              </div>
            </div>
          </div>

          {/* Round history */}
          <div
            className="p-4 rounded"
            style={{ background: "#111", border: "1px solid #1a1a1a" }}
          >
            <RoundHistory history={market.roundHistory} />
          </div>

          {/* Platform Stats */}
          <PlatformStats />

          {/* How It Works */}
          <HowItWorks />

          {/* Why Rush */}
          <WhyRush />

          {/* Tiles preview */}
          <TilesPreview />

          {/* Built With */}
          <BuiltWith />

          {/* Footer links */}
          <div className="flex gap-4 text-xs pb-2" style={{ color: "#333", fontFamily: "monospace" }}>
            <a href="/tiles" className="hover:text-[#00ff88] transition-colors">Tiles</a>
            <a href="/stats" className="hover:text-[#00ff88] transition-colors">Stats</a>
            <a href="https://basescan.org" target="_blank" rel="noopener noreferrer" className="hover:text-[#00ff88] transition-colors">
              Basescan
            </a>
            {isDemoMode && (
              <span style={{ color: "#ffaa00" }}>DEMO MODE</span>
            )}
          </div>
        </div>

        {/* Center: Betting panel (25%) */}
        <div
          className="flex flex-col"
          style={{ flex: "0 0 25%", maxWidth: "100%", minWidth: 0 }}
        >
          <BettingPanel market={market} marketAddress={marketAddress} />
        </div>

        {/* Right: Chat (20%) */}
        <div
          className="hidden lg:flex flex-col"
          style={{
            flex: "0 0 20%",
            maxWidth: "20%",
            borderLeft: "1px solid #1a1a1a",
          }}
        >
          <Chat />
        </div>
      </div>
    </div>
  );
}

// ─── Platform Stats section ───────────────────────────────────────────────────

function PlatformStats() {
  return (
    <section aria-label="Platform statistics">
      <div
        className="text-xs font-bold tracking-widest mb-3"
        style={{ color: "#555", fontFamily: "monospace" }}
      >
        PLATFORM STATS
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {PLATFORM_STAT_CARDS.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.35, delay: i * 0.07 }}
            className="p-4 rounded-lg"
            style={{ background: "#111", border: "1px solid #1a1a1a" }}
          >
            <div className="text-xs mb-1" style={{ color: "#555", fontFamily: "monospace" }}>
              {stat.label}
            </div>
            <div
              className="text-xl font-black tabular"
              style={{ color: stat.color, fontFamily: "monospace" }}
            >
              {stat.value}
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

// ─── How It Works section ─────────────────────────────────────────────────────

function HowItWorks() {
  return (
    <section aria-label="How it works">
      <div
        className="text-xs font-bold tracking-widest mb-3"
        style={{ color: "#555", fontFamily: "monospace" }}
      >
        HOW IT WORKS
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {HOW_IT_WORKS.map((step, i) => (
          <motion.div
            key={step.step}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.35, delay: i * 0.1 }}
            className="p-4 rounded-lg flex flex-col gap-2"
            style={{ background: "#111", border: "1px solid #1a1a1a" }}
          >
            <span
              className="text-xs font-black"
              style={{ color: "#00ff88", fontFamily: "monospace" }}
            >
              {step.step}
            </span>
            <div className="text-sm font-bold" style={{ color: "#e0e0e0", fontFamily: "monospace" }}>
              {step.title}
            </div>
            <p className="text-xs" style={{ color: "#666" }}>
              {step.desc}
            </p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

// ─── Why Rush section ─────────────────────────────────────────────────────────

function WhyRush() {
  return (
    <section aria-label="Why Rush">
      <div
        className="text-xs font-bold tracking-widest mb-3"
        style={{ color: "#555", fontFamily: "monospace" }}
      >
        WHY RUSH?
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {WHY_RUSH.map((item, i) => (
          <motion.div
            key={item.title}
            initial={{ opacity: 0, x: -8 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.35, delay: i * 0.07 }}
            className="flex items-start gap-3 p-4 rounded-lg"
            style={{ background: "#111", border: "1px solid #1a1a1a" }}
          >
            <span style={{ color: "#00ff88", marginTop: 1, flexShrink: 0 }} aria-hidden="true">
              {item.icon}
            </span>
            <div>
              <div className="text-sm font-bold mb-0.5" style={{ color: "#e0e0e0", fontFamily: "monospace" }}>
                {item.title}
              </div>
              <p className="text-xs" style={{ color: "#666" }}>
                {item.desc}
              </p>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

// ─── Tiles preview section ────────────────────────────────────────────────────

function TilesPreview() {
  const TOTAL_TILES = 100;
  const OWNED = 34;
  const DISTRIBUTED = 2.47;

  const miniTiles = Array.from({ length: 25 }, (_, i) => ({
    id: i,
    owned: i < 8,
    mine: i === 2 || i === 7,
  }));

  return (
    <section
      className="p-4 rounded animate-fade-in-up"
      aria-label="Tiles revenue sharing preview"
      style={{
        background: "#0f0f0f",
        border: "1px solid rgba(255,215,0,0.2)",
        boxShadow: "0 0 24px rgba(255,215,0,0.04)",
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-xs font-black tracking-widest" style={{ color: "#ffd700", fontFamily: "monospace" }}>
            REVENUE SHARES
          </div>
          <div className="text-xs mt-0.5" style={{ color: "#555" }}>
            Own a tile, earn from every market
          </div>
        </div>
        <Link
          href="/tiles"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold transition-all"
          style={{
            background: "rgba(255,215,0,0.1)",
            border: "1px solid rgba(255,215,0,0.3)",
            color: "#ffd700",
            fontFamily: "monospace",
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "rgba(255,215,0,0.18)")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "rgba(255,215,0,0.1)")}
        >
          Claim your tile
          <span style={{ fontSize: 14, lineHeight: 1 }} aria-hidden="true">→</span>
        </Link>
      </div>

      <div className="flex gap-4 mb-3">
        {[
          { label: "TOTAL TILES", value: String(TOTAL_TILES) },
          { label: "OWNED", value: String(OWNED) },
          { label: "DISTRIBUTED", value: `${DISTRIBUTED} ETH` },
        ].map((s) => (
          <div key={s.label}>
            <div className="text-xs" style={{ color: "#444", fontFamily: "monospace" }}>{s.label}</div>
            <div className="text-sm font-black tabular" style={{ color: "#ffd700", fontFamily: "monospace" }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div
        className="grid gap-0.5"
        style={{ gridTemplateColumns: "repeat(25, 1fr)" }}
        aria-hidden="true"
      >
        {miniTiles.map((t) => (
          <div
            key={t.id}
            className="aspect-square rounded-sm"
            style={{
              background: t.mine ? "rgba(0,255,136,0.5)" : t.owned ? "rgba(255,215,0,0.25)" : "#1a1a1a",
              border: t.mine ? "1px solid rgba(0,255,136,0.7)" : t.owned ? "1px solid rgba(255,215,0,0.3)" : "1px solid #222",
            }}
          />
        ))}
      </div>

      <div className="flex gap-3 mt-2 text-xs" style={{ fontFamily: "monospace" }}>
        <div className="flex items-center gap-1">
          <div className="w-2.5 h-2.5 rounded-sm" style={{ background: "rgba(0,255,136,0.5)", border: "1px solid rgba(0,255,136,0.7)" }} />
          <span style={{ color: "#555" }}>Yours</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2.5 h-2.5 rounded-sm" style={{ background: "rgba(255,215,0,0.25)", border: "1px solid rgba(255,215,0,0.3)" }} />
          <span style={{ color: "#555" }}>Owned</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2.5 h-2.5 rounded-sm" style={{ background: "#1a1a1a", border: "1px solid #222" }} />
          <span style={{ color: "#555" }}>Available</span>
        </div>
      </div>

      <div className="mt-2 text-xs" style={{ color: "#444", fontFamily: "monospace" }}>
        Harberger tax model · 5%/week · buyout anytime
      </div>
    </section>
  );
}

// ─── Built With section ───────────────────────────────────────────────────────

function BuiltWith() {
  return (
    <section aria-label="Built with" className="flex flex-wrap gap-2">
      {BUILT_WITH.map((item) => (
        <span
          key={item.label}
          className="px-3 py-1.5 rounded text-xs font-bold"
          style={{
            background: "#111",
            border: "1px solid #2a2a2a",
            color: "#555",
            fontFamily: "monospace",
            letterSpacing: "0.04em",
          }}
        >
          {item.label}
        </span>
      ))}
    </section>
  );
}
