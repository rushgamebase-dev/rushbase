"use client";

import { useState, useRef, useEffect } from "react";
import { useAccount } from "wagmi";
import { formatEther } from "viem";
import { useActiveMarket } from "@/hooks/useActiveMarket";
import { useMarketContract } from "@/hooks/useMarketContract";
import { useStats } from "@/hooks/useStats";
import { useTilesContract } from "@/hooks/useTilesContract";
import { useRoundHistory } from "@/hooks/useRoundHistory";
import Header from "@/components/Header";
import VideoPlayer from "@/components/VideoPlayer";
import BettingPanel from "@/components/BettingPanel";
import Chat from "@/components/Chat";
import Countdown from "@/components/Countdown";
import RoundHistory from "@/components/RoundHistory";
import StatsBar from "@/components/StatsBar";
// ClaimBanner removed — distributeAll auto-pays winners, no manual claim needed
import WelcomeOverlay from "@/components/WelcomeOverlay";
import Link from "next/link";
import { motion } from "framer-motion";
import { Shield, Zap, Brain, Coins } from "lucide-react";
import { timeAgo, type LiveMarket } from "@/lib/mock";
import { useMarketStream } from "@/hooks/useMarketStream";
import BetToast from "@/components/BetToast";
import MascotOverlay from "@/components/MascotOverlay";

// ─── Platform stats (real values from contracts or zero) ─────────────────────

function usePlatformStatCards(stats: { totalVolume: number; marketsResolved: number; feesDistributed: number; uniqueBettors: number }, distributed?: number) {
  const dist = distributed && distributed > 0 ? distributed : stats.feesDistributed;
  return [
    { label: "Total Volume", value: `${stats.totalVolume.toFixed(2)} ETH`, color: "#00ff88" },
    { label: "Markets Resolved", value: String(stats.marketsResolved), color: "#ffd700" },
    { label: "Distributed to Holders", value: `${dist.toFixed(2)} ETH`, color: "#aa88ff" },
    { label: "Unique Bettors", value: String(stats.uniqueBettors), color: "#00aaff" },
  ];
}

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Connect Wallet",
    desc: "MetaMask or Phantom on Base — one click to get started.",
  },
  {
    step: "02",
    title: "Place Your Prediction",
    desc: "Over or Under on vehicle count. New camera each round.",
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
  { label: "Powered by AI" },
];

// ─── Animation helpers ────────────────────────────────────────────────────────

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: (delay = 0) => ({ opacity: 1, y: 0, transition: { duration: 0.4, delay } }),
};

// ─── Build LiveMarket from contract data ──────────────────────────────────────

function buildMarketFromContract(contractData: ReturnType<typeof useMarketContract>, isWaiting: boolean, marketCount: number): LiveMarket {
  const totalPoolNum = parseFloat(contractData.totalPool) || 0;
  const overPool = contractData.poolByRange[1] ? parseFloat(contractData.poolByRange[1]) : 0;
  const underPool = contractData.poolByRange[0] ? parseFloat(contractData.poolByRange[0]) : 0;
  const total = overPool + underPool;
  const overPct = total > 0 ? Math.round((overPool / total) * 100) : 0;
  const underPct = total > 0 ? 100 - overPct : 0;
  const net = total > 0 ? total * 0.95 : 0;
  const overOdds = overPool > 0 ? parseFloat((net / overPool).toFixed(2)) : 0;
  const underOdds = underPool > 0 ? parseFloat((net / underPool).toFixed(2)) : 0;

  const stateMap: Record<number, LiveMarket["status"]> = { 0: "open", 1: "locked", 2: "resolved", 3: "cancelled" };
  const status = stateMap[contractData.state] ?? "open";

  return {
    roundId: marketCount,
    status,
    vehicleCount: contractData.actualCarCount,
    threshold: contractData.ranges[0] ? Number(contractData.ranges[0].maxCars) : 0,
    timeLeft: 0,
    totalDuration: 300,
    overPool,
    underPool,
    totalPool: totalPoolNum,
    overOdds,
    underOdds,
    overPct,
    underPct,
    bettors: contractData.totalBettors,
    recentBets: contractData.realtimeBets.map((b) => ({
      id: b.txHash || `${b.user}-${b.timestamp}`,
      wallet: b.user,
      shortWallet: `${b.user.slice(0, 6)}...${b.user.slice(-4)}`,
      side: (b.rangeIndex === 1 ? "over" : "under") as "over" | "under",
      amount: parseFloat(formatEther(b.amount)),
      txHash: b.txHash,
      timestamp: b.timestamp,
      timeAgo: timeAgo(b.timestamp),
    })),
    roundHistory: [],
  };
}

// ─── Home page ────────────────────────────────────────────────────────────────

// Mount exactly ONE Chat instance based on viewport (avoids duplicate Ably connections)
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    setIsDesktop(mq.matches);
    const h = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);
  return isDesktop;
}

export default function Home() {
  const isDesktop = useIsDesktop();

  const { marketAddress: activeMarketAddress, isWaiting, marketCount } = useActiveMarket();

  // Keep the last known market address so we can show RESOLVED state
  // even after getActiveMarkets() returns []. Only update when a NEW market appears.
  const [lastMarketAddress, setLastMarketAddress] = useState<`0x${string}` | null>(null);
  useEffect(() => {
    if (activeMarketAddress) {
      setLastMarketAddress(activeMarketAddress);
    }
  }, [activeMarketAddress]);

  // Use active market if available, otherwise keep showing the last one
  const marketAddress = activeMarketAddress || lastMarketAddress;
  const contractData = useMarketContract(marketAddress);
  const [liveCount, setLiveCount] = useState(0);
  const { stats } = useStats();
  const { history: roundHistory } = useRoundHistory();
  const { isConnected } = useAccount();
  const tilesData = useTilesContract();
  const onChainDistributed = parseFloat(tilesData.totalDistributed || "0");

  // Subscribe to Ably market events for instant oracle broadcasts
  useMarketStream();

  // Reset live count when market changes (new round starts)
  useEffect(() => { setLiveCount(0); }, [activeMarketAddress]);

  const market = buildMarketFromContract(contractData, isWaiting && !lastMarketAddress, marketCount);

  // Use live oracle count if available; fallback to contract data but never jump backwards
  const displayCount = liveCount > 0 ? liveCount : (market.vehicleCount ?? 0);

  const lockTime = contractData.lockTime ? Number(contractData.lockTime) : 0;
  // contractState removed — was only used by ClaimBanner (now removed)
  const winningRangeIndex = contractData.winningRangeIndex;

  // Dynamic camera name from contract description (e.g. "Peace Bridge — USA/Canada Border — How many vehicles in 5 min?")
  const marketDescription = contractData.description || "";
  const cameraName = marketDescription.split(" — ")[0] || "Live Camera";

  // Market is "active" if we have a real address — either currently active or
  // the last known one (for showing RESOLVED/CANCELLED state between rounds)
  const hasActiveMarket = !!marketAddress;

  // Ref to scroll to BettingPanel from mobile sticky bar
  const bettingPanelRef = useRef<HTMLDivElement>(null);
  // Separate ref for the mobile betting panel (rendered after video)
  const mobileBettingPanelRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex flex-col" style={{ background: "#0a0a0a", color: "#e0e0e0", minHeight: "100vh" }}>
      <WelcomeOverlay />
      <Header />
      <StatsBar
        volume24h={stats.volume24h}
        totalDistributed={onChainDistributed > 0 ? onChainDistributed : stats.feesDistributed}
        activeBettors={stats.uniqueBettors}
        marketsResolved={stats.marketsResolved}
      />

      {/* Main 3-column layout */}
      <div className="flex flex-col lg:flex-row" style={{ flex: "1 1 auto" }}>

        {/* Left: Video + content (55%) */}
        <div
          className="flex flex-col p-3 gap-3"
          style={{
            flex: "0 0 55%",
            maxWidth: "100%",
            borderRight: "1px solid #1a1a1a",
          }}
        >
          {/* Hero tagline */}
          <motion.div
            initial="hidden"
            animate="show"
            variants={fadeUp}
            custom={0}
            className="px-1"
          >
            <div className="flex items-center justify-between">
              <div>
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
              </div>

              {/* Mascot — always visible, loop */}
              <img
                src="/mascot/bet-placed.gif"
                alt="Rush Mascot"
                className="hidden md:block"
                style={{
                  width: 72,
                  height: 72,
                  filter: "drop-shadow(0 0 10px rgba(0,255,136,0.3))",
                }}
              />

              {/* Vehicle count — live counter (hidden on mobile; countdown overlay shows it) */}
              <div
                className="hidden md:flex flex-col items-end"
                style={{
                  background: "rgba(0,0,0,0.5)",
                  border: `1px solid ${hasActiveMarket ? "rgba(0,255,136,0.2)" : "#1a1a1a"}`,
                  borderRadius: 8,
                  padding: "8px 16px",
                }}
              >
                <span
                  className="tabular-nums"
                  style={{
                    color: hasActiveMarket ? "#00ff88" : "#333",
                    fontFamily: "ui-monospace, SFMono-Regular, monospace",
                    fontSize: 36,
                    fontWeight: 900,
                    lineHeight: 1,
                    textShadow: hasActiveMarket ? "0 0 16px rgba(0,255,136,0.4)" : "none",
                  }}
                >
                  {hasActiveMarket ? String(displayCount).padStart(3, "0") : "---"}
                </span>
                <span
                  style={{
                    color: hasActiveMarket ? "rgba(0,255,136,0.5)" : "#333",
                    fontFamily: "monospace",
                    fontSize: 9,
                    letterSpacing: "0.1em",
                    marginTop: 2,
                  }}
                >
                  VEHICLES COUNTED
                </span>
              </div>
            </div>
          </motion.div>

          {/* Video + Countdown overlay */}
          <div className="relative">
            <VideoPlayer
              vehicleCount={displayCount}
              isLive={hasActiveMarket}
              cameraName={cameraName}
              onCountUpdate={setLiveCount}
              marketAddress={marketAddress || undefined}
              streamUrl={contractData.streamUrl || undefined}
            />

            <BetToast bets={market.recentBets} />

            {/* Mascot overlay for round events */}
            <MascotOverlay
              status={market.status as "open" | "locked" | "resolving" | "resolved" | "cancelled"}
              winningRangeIndex={winningRangeIndex}
              finalCount={contractData.actualCarCount}
              threshold={market.threshold}
              timeLeft={lockTime > 0 ? Math.max(0, lockTime - Math.floor(Date.now() / 1000)) : 999}
              isCounting={market.status === "open" && lockTime > 0 && Math.floor(Date.now() / 1000) >= lockTime}
            />

            {/* Countdown overlaid on video — top for mobile visibility */}
            <div className="absolute bottom-2 left-2 right-2 z-10" style={{ pointerEvents: "auto" }}>
              {hasActiveMarket ? (
                <div>
                  <Countdown
                    lockTime={lockTime > 0 ? lockTime : undefined}
                    status={market.status}
                    finalCount={market.vehicleCount > 0 ? market.vehicleCount : undefined}
                    winningRangeIndex={winningRangeIndex}
                    liveCount={displayCount}
                    threshold={market.threshold}
                  />
                </div>
              ) : (
                <div className="px-3 py-2 rounded" style={{ background: "rgba(0,0,0,0.7)", border: "1px solid rgba(0,255,136,0.2)", borderRadius: 8 }}>
                  <div className="text-xs font-bold tracking-widest" style={{ color: "#555", fontFamily: "monospace" }}>NEXT ROUND</div>
                  <div className="text-sm font-black tracking-widest starting-soon-pulse" style={{ color: "#00ff88", fontFamily: "monospace" }}>STARTING SOON</div>
                </div>
              )}
            </div>
          </div>

          {/* Mobile betting panel — shows right after video on small screens */}
          <div ref={mobileBettingPanelRef} className="lg:hidden">
            <BettingPanel market={market} marketAddress={marketAddress} winningRangeIndex={winningRangeIndex} lockTime={lockTime} />
          </div>

          {/* Current count card (standalone) — hidden on mobile; countdown overlay already shows it */}
          <div
            className="hidden md:block p-4 rounded"
            style={{ background: "#111", border: "1px solid #1a1a1a" }}
          >
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
                  color: hasActiveMarket ? "#00ff88" : "#333",
                  fontFamily: "monospace",
                  textShadow: hasActiveMarket ? "0 0 16px rgba(0,255,136,0.4)" : "none",
                }}
              >
                {hasActiveMarket ? String(displayCount).padStart(3, "0") : "---"}
              </div>
              <div className="text-xs" style={{ color: "#555", fontFamily: "monospace" }}>
                {hasActiveMarket && market.threshold > 0 ? (
                  <>
                    threshold:{" "}
                    <span style={{ color: "#ffd700" }}>{market.threshold}</span>
                    {" · "}
                    <span
                      style={{
                        color: displayCount > market.threshold ? "#00ff88" : "#ff4444",
                        fontWeight: 700,
                      }}
                    >
                      {displayCount > market.threshold
                        ? `+${displayCount - market.threshold} over`
                        : `${market.threshold - displayCount} to go`}
                    </span>
                  </>
                ) : (
                  <span style={{ color: "#333" }}>--</span>
                )}
              </div>
            </div>
          </div>

          {/* Round history — right below current count */}
          <div
            className="p-4 rounded"
            style={{ background: "#111", border: "1px solid #1a1a1a" }}
          >
            <RoundHistory history={roundHistory} />
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

          {/* Platform Stats */}
          <PlatformStatsSection stats={stats} distributed={onChainDistributed} />

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
          </div>
        </div>

        {/* Center: Betting panel (25%) — hidden on mobile, shown inline after video instead */}
        <div
          ref={bettingPanelRef}
          className="hidden lg:flex flex-col lg:sticky lg:top-0 lg:self-start"
          style={{ flex: "0 0 25%", maxWidth: "100%", minWidth: 0, maxHeight: "100vh" }}
        >
          <div className="overflow-y-auto" style={{ maxHeight: "100vh" }}>
            <BettingPanel market={market} marketAddress={marketAddress} winningRangeIndex={winningRangeIndex} lockTime={lockTime} />
          </div>
        </div>

        {/* Right: Chat (20%) — only mount on desktop to avoid duplicate Ably connections */}
        {isDesktop && (
          <div
            className="flex flex-col sticky top-0 self-start"
            style={{
              flex: "0 0 20%",
              maxWidth: "20%",
              borderLeft: "1px solid #1a1a1a",
              maxHeight: "100vh",
            }}
          >
            <div className="flex flex-col h-full overflow-hidden" style={{ maxHeight: "100vh" }}>
              <Chat />
            </div>
          </div>
        )}
      </div>

      {/* Mobile chat — single instance, only mounted when not desktop */}
      {!isDesktop && <Chat />}

      {/* Mobile sticky betting bar — only on small screens, only when market is OPEN and wallet is connected */}
      {hasActiveMarket && market.status === "open" && isConnected && (
        <MobileStickyBar
          status={market.status}
          threshold={market.threshold}
          onTap={() => {
            mobileBettingPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        />
      )}
    </div>
  );
}

// ─── Platform Stats section ───────────────────────────────────────────────────

function PlatformStatsSection({ stats, distributed }: { stats: { totalVolume: number; marketsResolved: number; feesDistributed: number; uniqueBettors: number }; distributed?: number }) {
  const cards = usePlatformStatCards(stats, distributed);
  return (
    <section aria-label="Platform statistics">
      <div
        className="text-xs font-bold tracking-widest mb-3"
        style={{ color: "#555", fontFamily: "monospace" }}
      >
        PLATFORM STATS
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((stat, i) => (
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
  const tilesContract = useTilesContract();

  const ownedCount = tilesContract.totalActiveTiles;
  const totalDist = parseFloat(tilesContract.totalDistributed);
  const treasury = parseFloat(tilesContract.treasuryBalance);

  const miniTiles = tilesContract.tiles.length > 0
    ? tilesContract.tiles.slice(0, 25).map((t, i) => ({
        id: i,
        owned: t.owner !== "0x0000000000000000000000000000000000000000",
        mine: false,
      }))
    : Array.from({ length: 25 }, (_, i) => ({ id: i, owned: false, mine: false }));

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
          { label: "OWNED", value: String(ownedCount) },
          { label: "DISTRIBUTED", value: `${totalDist.toFixed(4)} ETH` },
          { label: "TREASURY", value: `${treasury.toFixed(4)} ETH` },
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
              background: t.owned ? "rgba(255,215,0,0.25)" : "#1a1a1a",
              border: t.owned ? "1px solid rgba(255,215,0,0.3)" : "1px solid #222",
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

      <div className="mt-2 text-xs flex items-center gap-2 flex-wrap" style={{ color: "#444", fontFamily: "monospace" }}>
        <span>Become a partner · Earn from every trade</span>
        <span style={{ color: "#333" }}>|</span>
        <a
          href="https://flaunch.gg/base/coins/0xB36A127dBa73F3aA7C70B4e00B7395B86A60e73b"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#ffd700" }}
          className="hover:underline"
        >
          $RUSH
        </a>
        <button
          onClick={() => { navigator.clipboard.writeText("0xB36A127dBa73F3aA7C70B4e00B7395B86A60e73b"); }}
          style={{ color: "#666", cursor: "pointer", background: "none", border: "none", fontFamily: "monospace", fontSize: "inherit" }}
          title="Copy contract address"
        >
          0xB36A...e73b
        </button>
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

// ─── Mobile sticky betting bar ────────────────────────────────────────────────

interface MobileStickyBarProps {
  status: "open" | "locked" | "resolving" | "resolved";
  threshold: number;
  onTap: () => void;
}

function MobileStickyBar({ status, threshold, onTap }: MobileStickyBarProps) {
  const statusLabel =
    status === "open"
      ? "OPEN"
      : status === "locked"
      ? "LOCKED"
      : status === "resolving"
      ? "RESOLVING"
      : "RESOLVED";

  const statusColor =
    status === "open" ? "#00ff88" : status === "locked" ? "#ffaa00" : "#888";

  return (
    <div
      className="lg:hidden fixed bottom-0 left-0 right-0 z-50 flex items-center gap-2 px-3"
      style={{
        height: 56,
        background: "#0d0d0d",
        borderTop: "2px solid rgba(0,255,136,0.3)",
        boxShadow: "0 -4px 24px rgba(0,255,136,0.08)",
      }}
      role="navigation"
      aria-label="Quick betting bar"
    >
      {/* Status badge */}
      <div
        className="shrink-0 px-2 py-1 rounded text-xs font-black tracking-widest"
        style={{
          background: `rgba(${status === "open" ? "0,255,136" : "255,170,0"},0.1)`,
          border: `1px solid ${statusColor}44`,
          color: statusColor,
          fontFamily: "monospace",
        }}
      >
        {statusLabel}
      </div>

      {/* OVER button */}
      <button
        onClick={onTap}
        className="flex-1 rounded font-black text-xs tracking-widest transition-all"
        style={{
          height: 36,
          background: "rgba(0,255,136,0.1)",
          border: "1px solid rgba(0,255,136,0.3)",
          color: "#00ff88",
          fontFamily: "monospace",
        }}
        aria-label={`Bet OVER ${threshold} — tap to open betting panel`}
      >
        OVER {threshold}
      </button>

      {/* UNDER button */}
      <button
        onClick={onTap}
        className="flex-1 rounded font-black text-xs tracking-widest transition-all"
        style={{
          height: 36,
          background: "rgba(255,68,68,0.1)",
          border: "1px solid rgba(255,68,68,0.3)",
          color: "#ff4444",
          fontFamily: "monospace",
        }}
        aria-label={`Bet UNDER ${threshold} — tap to open betting panel`}
      >
        UNDER {threshold}
      </button>
    </div>
  );
}
