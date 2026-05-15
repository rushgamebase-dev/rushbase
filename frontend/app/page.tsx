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
import { useOracleState } from "@/hooks/useOracleState";
// ClaimBanner removed — distributeAll auto-pays winners, no manual claim needed
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, BarChart3, BookOpen, Brain, Coins, Database, Shield, Swords, Trophy, Zap } from "lucide-react";
import { timeAgo, type LiveMarket } from "@/lib/mock";
import { useMarketStream } from "@/hooks/useMarketStream";
import BetToast from "@/components/BetToast";
import MascotOverlay from "@/components/MascotOverlay";
import ErrorBoundary from "@/components/ErrorBoundary";
import { useBetStream } from "@/hooks/useBetStream";

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
    desc: "AI-powered real-time vehicle detection — verifiable on every round.",
  },
  {
    icon: <Coins size={20} />,
    title: "Public Ledger",
    desc: "Contracts, payouts, matches and protocol accounting stay inspectable from one place.",
  },
];

const BUILT_WITH = [
  { label: "Built on Base" },
  { label: "Powered by AI" },
];

const ECOSYSTEM_APPS = [
  {
    title: "Royale",
    eyebrow: "battle arena",
    href: "/arenas",
    action: "Enter Royale",
    body: "Create fighters, join ETH arenas, watch deterministic replays and audit final payouts.",
    image: "/images/arenas/battle.jpg",
    accent: "#00ddff",
    icon: Swords,
    stats: ["Free Bronze", "VRF seeds", "Live replay"],
  },
  {
    title: "Tap Trading",
    eyebrow: "price-touch game",
    href: "/trade",
    action: "Open Tap Trading",
    body: "Tap a price band, watch the live Rush line and settle real-time ETH outcomes.",
    image: "/taptrade/mascot.gif",
    accent: "#00ff66",
    icon: BarChart3,
    stats: ["Live grid", "Gasless session", "ETH vault"],
  },
  {
    title: "Ledger",
    eyebrow: "proof layer",
    href: "/transparency",
    action: "Open Ledger",
    body: "Review protocol balances, market history, legacy reward claims and on-chain proof.",
    image: "/images/headers/headerarenas.jpg",
    accent: "#ffd700",
    icon: Database,
    stats: ["Base mainnet", "Claims", "Contracts"],
  },
];

const ECOSYSTEM_LINKS = [
  { href: "/leaderboard", label: "Ranks", icon: Trophy },
  { href: "/stats", label: "Stats", icon: BarChart3 },
  { href: "/docs", label: "Docs", icon: BookOpen },
];

// ─── Animation helpers ────────────────────────────────────────────────────────

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: (delay = 0) => ({ opacity: 1, y: 0, transition: { duration: 0.4, delay } }),
};

// ─── Build LiveMarket from contract data ──────────────────────────────────────

function buildMarketFromContract(contractData: ReturnType<typeof useMarketContract>, isWaiting: boolean, marketCount: number, liveBets: ReturnType<typeof useBetStream>["bets"]): LiveMarket {
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
    recentBets: [
      // On-chain polling bets
      ...contractData.realtimeBets.map((b) => ({
        id: b.txHash || `${b.user}-${b.timestamp}`,
        wallet: b.user,
        shortWallet: `${b.user.slice(0, 6)}...${b.user.slice(-4)}`,
        side: (b.rangeIndex === 1 ? "over" : "under") as "over" | "under",
        amount: parseFloat(formatEther(b.amount)),
        txHash: b.txHash,
        timestamp: b.timestamp,
        timeAgo: timeAgo(b.timestamp),
      })),
      // Ably real-time bets (instant)
      ...liveBets.map((b) => ({
        id: b.id,
        wallet: b.user,
        shortWallet: b.shortWallet,
        side: b.side,
        amount: b.amount,
        txHash: b.txHash,
        timestamp: b.timestamp,
        timeAgo: timeAgo(b.timestamp),
      })),
    ].filter((b, i, arr) => arr.findIndex(x => x.txHash === b.txHash) === i) // dedup by txHash
     .sort((a, b) => b.timestamp - a.timestamp)
     .slice(0, 20),
    roundHistory: [],
  };
}

// ─── Home page ────────────────────────────────────────────────────────────────

// Mount exactly ONE Chat instance based on viewport (avoids duplicate Ably connections)
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
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
  const { stats } = useStats();
  const { history: roundHistory } = useRoundHistory();
  const { isConnected } = useAccount();
  const tilesData = useTilesContract();
  const onChainDistributed = parseFloat(tilesData.totalDistributed || "0");

  // Centralized Oracle WebSocket state — owns count, phase, roundId validation
  const oracle = useOracleState(marketAddress);

  // Subscribe to Ably market events for instant oracle broadcasts
  useMarketStream(undefined, marketAddress);

  // Real-time bet stream via Ably
  const { bets: liveBets } = useBetStream(marketAddress ?? undefined);

  const market = buildMarketFromContract(contractData, isWaiting && !lastMarketAddress, marketCount, liveBets);

  // displayCount: oracle WS is authority during counting, contract after resolution
  const displayCount =
    oracle.countSource === "oracle-ws" ? oracle.liveCount :
    contractData.state === 2 ? contractData.actualCarCount :
    (market.vehicleCount ?? 0);

  // ── Beep player — fires on oracle.beepCount increments ──
  const audioCtxRef = useRef<AudioContext | null>(null);
  const lastBeepRef = useRef(0);

  useEffect(() => {
    if (oracle.beepCount <= lastBeepRef.current) return;
    const delta = Math.min(oracle.beepCount - lastBeepRef.current, 5);
    lastBeepRef.current = oracle.beepCount;
    // eslint-disable-next-line no-console
    console.log(`[TIMING] BEEP delta=${delta} count=${oracle.liveCount} | scheduled=${new Date().toISOString()} | perfNow=${performance.now().toFixed(1)}`);
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") return;
      for (let i = 0; i < delta; i++) {
        const t = ctx.currentTime + i * 0.04;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(1200, t);
        osc.frequency.exponentialRampToValueAtTime(600, t + 0.08);
        gain.gain.setValueAtTime(0.15, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        osc.start(t);
        osc.stop(t + 0.12);
      }
    } catch { /* AudioContext unavailable */ }
  }, [oracle.beepCount]);

  // Unlock audio on ANY user gesture (persistent, not once)
  useEffect(() => {
    const unlock = () => {
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
      if (audioCtxRef.current.state === "suspended") audioCtxRef.current.resume();
    };
    document.addEventListener("click", unlock);
    document.addEventListener("touchstart", unlock);
    document.addEventListener("keydown", unlock);
    return () => {
      document.removeEventListener("click", unlock);
      document.removeEventListener("touchstart", unlock);
      document.removeEventListener("keydown", unlock);
    };
  }, []);

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
    <div className="flex flex-col" style={{ background: "#0a0a0a", color: "#e0e0e0", minHeight: "100vh", paddingBottom: "calc(60px + env(safe-area-inset-bottom))" }}>
      <Header />
      <EcosystemHub stats={stats} distributed={onChainDistributed > 0 ? onChainDistributed : stats.feesDistributed} />
      <StatsBar
        volume24h={stats.volume24h}
        totalDistributed={onChainDistributed > 0 ? onChainDistributed : stats.feesDistributed}
        activeBettors={stats.uniqueBettors}
        marketsResolved={stats.marketsResolved}
      />

      {/* Main 3-column layout */}
      <div className="flex flex-col md:flex-row" style={{ flex: "1 1 auto" }}>

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
                className="flex flex-col items-end"
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
              connected={oracle.connected}
              videoUid={oracle.videoUid}
              cameraName={cameraName}
              cameraId={oracle.cameraId ?? undefined}
              frameUrl={oracle.frameUrl}
            />

            <BetToast bets={market.recentBets} />

            {/* Mascot overlay for round events */}
            <MascotOverlay
              status={market.status as "open" | "locked" | "resolving" | "resolved" | "cancelled"}
              winningRangeIndex={winningRangeIndex}
              finalCount={contractData.actualCarCount}
              threshold={market.threshold}
              timeLeft={oracle.remaining > 0 ? Math.ceil(oracle.remaining) : (lockTime > 0 ? Math.max(0, lockTime - Math.floor(Date.now() / 1000)) : 999)}
              isCounting={oracle.phase === "counting"}
            />

            {/* Countdown overlaid on video — top for mobile visibility */}
            <div className="absolute bottom-2 left-2 right-2 z-10" style={{ pointerEvents: "auto" }}>
              {hasActiveMarket ? (
                <div>
                  <ErrorBoundary>
                    <Countdown
                      lockTime={lockTime > 0 ? lockTime : undefined}
                      status={market.status}
                      finalCount={market.vehicleCount > 0 ? market.vehicleCount : undefined}
                      winningRangeIndex={winningRangeIndex}
                      liveCount={displayCount}
                      threshold={market.threshold}
                      oraclePhase={oracle.phase}
                      oracleRemaining={oracle.remaining}
                    />
                  </ErrorBoundary>
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
          <div ref={mobileBettingPanelRef} className="md:hidden">
            <ErrorBoundary>
              <BettingPanel market={market} marketAddress={marketAddress} winningRangeIndex={winningRangeIndex} lockTime={lockTime} oraclePhase={oracle.phase} />
            </ErrorBoundary>
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

          {/* Built With */}
          <BuiltWith />

          {/* Footer links */}
          <div className="flex gap-4 text-xs pb-2" style={{ color: "#333", fontFamily: "monospace" }}>
            <a href="/stats" className="hover:text-[#00ff88] transition-colors">Stats</a>
            <a href="https://basescan.org" target="_blank" rel="noopener noreferrer" className="hover:text-[#00ff88] transition-colors">
              Basescan
            </a>
          </div>
        </div>

        {/* Center: Betting panel (25%) — hidden on mobile, shown inline after video instead */}
        <div
          ref={bettingPanelRef}
          className="hidden md:flex flex-col md:sticky md:top-0 md:self-start"
          style={{ flex: "0 0 25%", maxWidth: "100%", minWidth: 0, maxHeight: "100vh" }}
        >
          <div className="overflow-y-auto" style={{ maxHeight: "100vh" }}>
            <ErrorBoundary>
              <BettingPanel market={market} marketAddress={marketAddress} winningRangeIndex={winningRangeIndex} lockTime={lockTime} oraclePhase={oracle.phase} />
            </ErrorBoundary>
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

function EcosystemHub({
  stats,
  distributed,
}: {
  stats: { totalVolume: number; marketsResolved: number; feesDistributed: number; uniqueBettors: number; volume24h?: number };
  distributed: number;
}) {
  return (
    <section
      className="relative overflow-hidden border-b"
      style={{
        borderColor: "#161616",
        backgroundImage:
          "linear-gradient(90deg, rgba(0,0,0,0.9), rgba(0,0,0,0.58), rgba(0,0,0,0.92)), linear-gradient(0deg, #0a0a0a 0%, rgba(10,10,10,0.18) 48%, #0a0a0a 100%), url('/images/headers/headerarenas.jpg')",
        backgroundPosition: "center",
        backgroundSize: "cover",
      }}
    >
      <div className="absolute inset-0 opacity-[0.12]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)", backgroundSize: "44px 44px" }} />
      <div className="relative mx-auto grid max-w-7xl gap-8 px-4 py-10 md:px-8 md:py-14 xl:grid-cols-[minmax(0,0.86fr)_minmax(460px,1.14fr)]">
        <motion.div initial="hidden" animate="show" variants={fadeUp} custom={0} className="flex min-h-[440px] flex-col justify-center">
          <div className="mb-5 flex flex-wrap gap-2">
            <HubPill label="BASE MAINNET" color="#00ff88" />
            <HubPill label="REAL ETH GAMES" color="#7ddcff" />
            <HubPill label="PUBLIC LEDGER" color="#ffd700" />
          </div>

          <h1 className="max-w-4xl text-5xl font-black leading-[0.92] text-white md:text-7xl" style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", letterSpacing: 0 }}>
            RUSH
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-neutral-200 md:text-xl">
            One ecosystem for Royale battles, Tap Trading and on-chain proof.
          </p>

          <div className="mt-8 grid max-w-xl grid-cols-2 gap-3">
            <HubMetric label="Resolved" value={stats.marketsResolved.toLocaleString()} />
            <HubMetric label="Players" value={stats.uniqueBettors.toLocaleString()} />
            <HubMetric label="Distributed" value={formatHubEth(distributed)} />
            <HubMetric label="Volume" value={formatHubEth(stats.totalVolume)} />
          </div>
        </motion.div>

        <motion.div initial="hidden" animate="show" variants={fadeUp} custom={0.08} className="grid content-center gap-4 lg:grid-cols-3 xl:grid-cols-1">
          {ECOSYSTEM_APPS.map((app) => (
            <ProductCard key={app.href} app={app} />
          ))}
        </motion.div>
      </div>

      <div className="relative mx-auto flex max-w-7xl flex-wrap gap-2 px-4 pb-8 md:px-8">
        {ECOSYSTEM_LINKS.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-black/45 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-neutral-300 transition-colors hover:border-[#00ff88]/40 hover:text-[#00ff88]"
              style={{ fontFamily: "monospace" }}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function ProductCard({ app }: { app: (typeof ECOSYSTEM_APPS)[number] }) {
  const Icon = app.icon;
  return (
    <Link
      href={app.href}
      className="group grid min-h-[178px] overflow-hidden rounded-lg border border-white/10 bg-[#101010]/88 transition-all hover:-translate-y-0.5 hover:border-white/25 md:grid-cols-[172px_minmax(0,1fr)]"
      style={{ boxShadow: `0 0 28px ${app.accent}16` }}
    >
      <div
        className="relative min-h-[130px] bg-cover bg-center"
        style={{ backgroundImage: `linear-gradient(0deg, rgba(0,0,0,0.42), rgba(0,0,0,0.18)), url('${app.image}')` }}
      >
        <div className="absolute left-3 top-3 rounded-md border bg-black/70 p-2" style={{ borderColor: `${app.accent}66`, color: app.accent }}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <div className="flex min-w-0 flex-col justify-between p-4">
        <div>
          <div className="font-mono text-[10px] font-black uppercase tracking-[0.24em]" style={{ color: app.accent }}>
            {app.eyebrow}
          </div>
          <h2 className="mt-1 text-2xl font-black text-white">{app.title}</h2>
          <p className="mt-2 text-sm leading-5 text-neutral-400">{app.body}</p>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {app.stats.map((stat) => (
              <span key={stat} className="rounded border border-white/10 bg-black/40 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">
                {stat}
              </span>
            ))}
          </div>
          <span className="inline-flex items-center gap-1 font-mono text-xs font-black uppercase tracking-[0.16em]" style={{ color: app.accent }}>
            {app.action}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </span>
        </div>
      </div>
    </Link>
  );
}

function formatHubEth(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0.00 ETH";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M ETH`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K ETH`;
  return `${value.toFixed(value >= 100 ? 1 : 2)} ETH`;
}

function HubMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/55 px-3 py-3">
      <div className="font-mono text-[10px] font-black uppercase tracking-[0.18em] text-neutral-500">{label}</div>
      <div className="mt-1 whitespace-nowrap font-mono text-base font-black text-white md:text-lg">{value}</div>
    </div>
  );
}

function HubPill({ label, color }: { label: string; color: string }) {
  return (
    <span className="rounded-md border px-3 py-1.5 font-mono text-[11px] font-black uppercase tracking-[0.16em]" style={{ borderColor: `${color}55`, background: `${color}14`, color }}>
      {label}
    </span>
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
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-center gap-2 px-3"
      style={{
        height: "calc(60px + env(safe-area-inset-bottom))",
        paddingBottom: "env(safe-area-inset-bottom)",
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
        onClick={() => { navigator.vibrate?.(8); onTap(); }}
        className="flex-1 rounded font-black text-xs tracking-widest transition-all"
        style={{
          height: 44,
          background: "rgba(0,255,136,0.1)",
          border: "1px solid rgba(0,255,136,0.3)",
          color: "#00ff88",
          fontFamily: "monospace",
          touchAction: "manipulation",
          WebkitTapHighlightColor: "transparent",
        }}
        aria-label={`Bet OVER ${threshold} — tap to open betting panel`}
      >
        OVER {threshold}
      </button>

      {/* UNDER button */}
      <button
        onClick={() => { navigator.vibrate?.(8); onTap(); }}
        className="flex-1 rounded font-black text-xs tracking-widest transition-all"
        style={{
          height: 44,
          background: "rgba(255,68,68,0.1)",
          border: "1px solid rgba(255,68,68,0.3)",
          color: "#ff4444",
          fontFamily: "monospace",
          touchAction: "manipulation",
          WebkitTapHighlightColor: "transparent",
        }}
        aria-label={`Bet UNDER ${threshold} — tap to open betting panel`}
      >
        UNDER {threshold}
      </button>
    </div>
  );
}
