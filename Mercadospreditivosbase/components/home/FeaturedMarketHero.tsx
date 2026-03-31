"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, Clock, Users } from "lucide-react";
import { CATEGORIES } from "@/lib/mock-data";
import { useMarkets } from "@/hooks/useMarkets";
import { InteractiveChart } from "@/components/market/InteractiveChart";
import type { ChartOutcome } from "@/components/market/InteractiveChart";
import type { MarketDisplay } from "@/types/market";

/*
 * Usage:
 *   <FeaturedMarketHero />
 *
 * Auto-rotating carousel of featured markets with:
 *   - Scrollable trending pills at the top
 *   - Two-column layout (market info + probability chart)
 *   - 8-second rotation with pause on hover
 *   - Navigation arrows + indicator dots
 */

// ── Colors ──────────────────────────────────────────────────────────────────
const OUTCOME_COLORS = [
  "#00ff88",
  "#ff4444",
  "#ffd700",
  "#4488ff",
  "#ff88ff",
  "#00cccc",
];

// ── Chart data generator ──────────────────────────────────────────────────────
function generateChartDataForOutcome(currentProb: number, days: number = 30) {
  const now = Date.now();
  const msPerDay = 24 * 60 * 60 * 1000;
  const dataPoints = Math.min(days * 4, 120);
  const data: { timestamp: number; value: number }[] = [];
  let value = Math.max(5, currentProb - 20 + Math.random() * 10);

  for (let i = 0; i < dataPoints; i++) {
    const timestamp = now - (dataPoints - i) * (msPerDay / 4);
    const volatility = Math.random() * 4 - 2;
    const trend = (currentProb - value) * 0.05;
    value = Math.max(1, Math.min(99, value + volatility + trend));
    data.push({ timestamp, value: Math.round(value * 10) / 10 });
  }
  data.push({ timestamp: now, value: currentProb });
  return data;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function estimateBettors(market: MarketDisplay): number {
  return market.totalBettors ?? 0;
}

// ── Outcome row ───────────────────────────────────────────────────────────────
function OutcomeRow({
  label,
  probability,
  odds,
  color,
}: {
  label: string;
  probability: number;
  odds: number;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="w-1 h-8 rounded-full shrink-0"
        style={{ background: color }}
        aria-hidden="true"
      />
      <span
        className="text-sm font-semibold min-w-0 flex-1 truncate"
        style={{ color: "var(--text)", fontFamily: "monospace" }}
      >
        {label}
      </span>
      <span
        className="text-xl font-black tabular shrink-0"
        style={{ color, fontFamily: "monospace" }}
      >
        {probability}%
      </span>
      <span
        className="text-xs tabular shrink-0 px-2 py-0.5 rounded"
        style={{
          fontFamily: "monospace",
          background: "var(--background)",
          border: "1px solid var(--border)",
          color: "var(--muted)",
        }}
      >
        {odds.toFixed(2)}x
      </span>
    </div>
  );
}

// ── Trending pills ────────────────────────────────────────────────────────────
function TrendingPills({
  markets,
  activeIndex,
  onSelect,
}: {
  markets: MarketDisplay[];
  activeIndex: number;
  onSelect: (i: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll active pill into view
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const pill = container.children[activeIndex] as HTMLElement;
    if (pill) {
      const containerRect = container.getBoundingClientRect();
      const pillRect = pill.getBoundingClientRect();
      const scrollLeft = pill.offsetLeft - container.offsetLeft - containerRect.width / 2 + pillRect.width / 2;
      container.scrollTo({ left: scrollLeft, behavior: "smooth" });
    }
  }, [activeIndex]);

  return (
    <div
      ref={scrollRef}
      className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide"
      style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      role="tablist"
      aria-label="Featured market selector"
    >
      {markets.map((market, i) => {
        const isActive = i === activeIndex;
        return (
          <button
            key={market.id}
            role="tab"
            aria-selected={isActive}
            aria-label={market.title}
            onClick={() => onSelect(i)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all duration-150 shrink-0"
            style={{
              background: isActive ? "rgba(0,255,136,0.15)" : "var(--surface)",
              border: isActive ? "1px solid rgba(0,255,136,0.4)" : "1px solid var(--border)",
              color: isActive ? "var(--primary)" : "var(--muted)",
              fontFamily: "monospace",
              boxShadow: isActive ? "0 0 10px rgba(0,255,136,0.1)" : "none",
            }}
          >
            <span aria-hidden="true">{market.icon}</span>
            {market.title.length > 28
              ? market.title.slice(0, 28) + "…"
              : market.title}
          </button>
        );
      })}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export function FeaturedMarketHero() {
  const { markets: allMarkets, isLoading } = useMarkets({ sort: "most-volume", limit: 10 });
  // Prefer hot open markets, fall back to any open markets
  const featuredMarkets = useMemo(() => {
    const hot = allMarkets.filter((m) => m.isHot && m.status === "open");
    if (hot.length >= 3) return hot.slice(0, 5);
    const open = allMarkets.filter((m) => m.status === "open");
    return open.slice(0, 5);
  }, [allMarkets]);

  const [activeIndex, setActiveIndex] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const [direction, setDirection] = useState<1 | -1>(1);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clamp activeIndex if markets shrink
  const safeIndex = featuredMarkets.length > 0 ? Math.min(activeIndex, featuredMarkets.length - 1) : 0;
  const market = featuredMarkets[safeIndex] ?? null;

  const chartOutcomes = useMemo<ChartOutcome[]>(() => {
    if (!market) return [];
    return market.outcomes.slice(0, 4).map((outcome, index) => {
      const data = generateChartDataForOutcome(outcome.prob, 30);
      return {
        id: `${market.id}-${index}`,
        name: outcome.label.length > 15 ? outcome.label.slice(0, 15) + "..." : outcome.label,
        color: OUTCOME_COLORS[index % OUTCOME_COLORS.length],
        data,
      };
    });
  }, [market]);

  const goTo = useCallback(
    (index: number, dir: 1 | -1) => {
      setDirection(dir);
      setActiveIndex(index);
    },
    []
  );

  const goNext = useCallback(() => {
    if (!featuredMarkets.length) return;
    goTo((safeIndex + 1) % featuredMarkets.length, 1);
  }, [safeIndex, featuredMarkets.length, goTo]);

  const goPrev = useCallback(() => {
    if (!featuredMarkets.length) return;
    goTo(
      (safeIndex - 1 + featuredMarkets.length) % featuredMarkets.length,
      -1
    );
  }, [safeIndex, featuredMarkets.length, goTo]);

  const handlePillSelect = useCallback(
    (i: number) => {
      goTo(i, i > safeIndex ? 1 : -1);
    },
    [safeIndex, goTo]
  );

  // Auto-rotation
  useEffect(() => {
    if (isHovered || !featuredMarkets.length) return;
    timerRef.current = setTimeout(goNext, 8000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isHovered, safeIndex, goNext, featuredMarkets.length]);

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8 md:py-12">
        <div className="flex items-center gap-3 mb-6">
          <div className="skeleton w-12 h-12 rounded-full" />
          <div className="flex flex-col gap-2">
            <div className="skeleton h-5 w-40 rounded" />
            <div className="skeleton h-3 w-52 rounded" />
          </div>
        </div>
        <div className="skeleton rounded-xl" style={{ height: 440 }} />
      </div>
    );
  }

  if (!market) return null;

  const category = CATEGORIES[market.category];
  const volume = market.volume;
  const endDate = market.endDate;
  const bettors = estimateBettors(market);

  const slideVariants = {
    enter: (dir: number) => ({ opacity: 0, x: dir * 32 }),
    center: { opacity: 1, x: 0 },
    exit: (dir: number) => ({ opacity: 0, x: dir * -32 }),
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 md:py-12">

      {/* ── Hero heading with welcome mascot ── */}
      <motion.div
        className="flex items-center gap-3 mb-6"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <img src="/mascot/welcome.gif" alt="" className="w-12 h-12" aria-hidden="true" />
        <div>
          <h1
            className="text-xl font-black tracking-wider"
            style={{ color: "var(--text)", fontFamily: "monospace" }}
          >
            FEATURED MARKETS
          </h1>
          <p
            className="text-xs"
            style={{ color: "var(--muted)", fontFamily: "monospace" }}
          >
            Live prediction markets on Base chain
          </p>
        </div>
      </motion.div>

      {/* ── Trending pills ── */}
      <motion.div
        className="mb-4"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <TrendingPills
          markets={featuredMarkets}
          activeIndex={safeIndex}
          onSelect={handlePillSelect}
        />
      </motion.div>

      {/* ── Main card ── */}
      <div
        className="relative rounded-xl overflow-hidden"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        aria-label="Featured market carousel"
        role="region"
      >
        {/* ── Two-column layout ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2">

          {/* ── LEFT SIDE ── */}
          <div className="relative p-6 md:p-8 flex flex-col gap-5 min-h-[420px] lg:min-h-[440px]">
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={market.id}
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="flex flex-col gap-5 flex-1"
              >
                {/* Metadata row */}
                <div className="flex flex-wrap items-center gap-3">
                  {/* LIVE indicator */}
                  <div className="flex items-center gap-1.5" aria-label="Live market">
                    <span className="live-dot" aria-hidden="true" />
                    <span
                      className="text-xs font-bold tracking-widest"
                      style={{ color: "var(--primary)", fontFamily: "monospace" }}
                    >
                      LIVE
                    </span>
                  </div>

                  {/* Category */}
                  <span
                    className="category-badge"
                    style={{ color: "var(--muted)" }}
                  >
                    {category.icon} {category.label}
                  </span>

                  {/* Volume */}
                  <span
                    className="text-xs font-bold tabular"
                    style={{ color: "var(--muted)", fontFamily: "monospace" }}
                  >
                    {volume}
                  </span>

                  {/* Hot badge */}
                  {market.isHot && (
                    <span className="hot-badge text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider">
                      HOT
                    </span>
                  )}
                </div>

                {/* Title */}
                <h2
                  className="text-xl lg:text-2xl font-black leading-snug"
                  style={{ color: "var(--text)", fontFamily: "monospace" }}
                >
                  {market.title}
                </h2>

                {/* Outcomes list */}
                <div className="flex flex-col gap-3">
                  {market.outcomes.slice(0, 4).map((outcome, i) => (
                    <OutcomeRow
                      key={`${market.id}-${i}`}
                      label={outcome.label}
                      probability={outcome.prob}
                      odds={outcome.odds}
                      color={OUTCOME_COLORS[i] ?? "#666666"}
                    />
                  ))}
                </div>

                {/* Footer row */}
                <div
                  className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-auto pt-4"
                  style={{ borderTop: "1px solid var(--border)" }}
                >
                  <span
                    className="flex items-center gap-1.5 text-xs"
                    style={{ color: "var(--muted)", fontFamily: "monospace" }}
                    aria-label={`Ends ${endDate}`}
                  >
                    <Clock size={12} aria-hidden="true" />
                    Ends {endDate}
                  </span>
                  <span
                    className="flex items-center gap-1.5 text-xs"
                    style={{ color: "var(--muted)", fontFamily: "monospace" }}
                    aria-label={`${bettors} traders`}
                  >
                    <Users size={12} aria-hidden="true" />
                    {bettors} traders
                  </span>
                  <Link
                    href={`/markets/${market.id}`}
                    className="ml-auto text-xs font-bold tracking-widest transition-colors flex items-center gap-1"
                    style={{ color: "var(--primary)", fontFamily: "monospace" }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.textShadow =
                        "0 0 8px rgba(0,255,136,0.5)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.textShadow = "none";
                    }}
                    aria-label={`View market: ${market.title}`}
                  >
                    VIEW MARKET →
                  </Link>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* ── RIGHT SIDE: Chart ── */}
          <div
            className="lg:w-[500px] xl:w-[560px] shrink-0 border-t lg:border-t-0 lg:border-l"
            style={{ borderColor: "var(--border)", background: "#0d0d0d" }}
          >
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={`chart-${market.id}`}
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="h-[360px] lg:h-full min-h-[360px] p-4"
                aria-label="Probability chart"
              >
                <InteractiveChart
                  outcomes={chartOutcomes}
                  height={340}
                  showTimeRange={true}
                  showTooltip={true}
                  defaultTimeRange="1M"
                />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* ── Navigation arrows (visible on hover) ── */}
        {featuredMarkets.length > 1 && (
          <>
            <button
              onClick={goPrev}
              className="absolute left-3 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center w-8 h-8 rounded-full transition-all duration-150"
              style={{
                background: "rgba(0,0,0,0.6)",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "var(--muted)",
                opacity: isHovered ? 1 : 0,
                pointerEvents: isHovered ? "auto" : "none",
              }}
              aria-label="Previous market"
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <button
              onClick={goNext}
              className="absolute right-3 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center w-8 h-8 rounded-full transition-all duration-150"
              style={{
                background: "rgba(0,0,0,0.6)",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "var(--muted)",
                opacity: isHovered ? 1 : 0,
                pointerEvents: isHovered ? "auto" : "none",
              }}
              aria-label="Next market"
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </>
        )}

        {/* ── Carousel indicator dots ── */}
        {featuredMarkets.length > 1 && (
          <div
            className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 z-10"
            role="tablist"
            aria-label="Market carousel indicators"
          >
            {featuredMarkets.map((m, i) => (
              <button
                key={m.id}
                role="tab"
                aria-selected={i === safeIndex}
                aria-label={`Market ${i + 1}: ${m.title}`}
                onClick={() => goTo(i, i > safeIndex ? 1 : -1)}
                className="transition-all duration-200"
                style={{
                  width: i === safeIndex ? 24 : 6,
                  height: 6,
                  borderRadius: 999,
                  background: i === safeIndex ? "var(--primary)" : "var(--muted)",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  opacity: i === safeIndex ? 1 : 0.4,
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
