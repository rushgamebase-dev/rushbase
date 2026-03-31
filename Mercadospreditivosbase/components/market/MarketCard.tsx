"use client";

/*
 * Usage:
 *   <MarketCard market={marketDisplay} index={0} />
 *
 * Layout (Kalshi + Polymarket hybrid, Rush neon aesthetics):
 *
 * ┌─────────────────────────────────────────────────┐
 * │  🔵  Will Base Chain surpass Solana?      [HOT] │  ← icon + title + badge
 * │                                                  │
 * │  62%                              ╭─────────╮   │  ← big % + mini sparkline
 * │  ▲ +5.2%                          │~sparkline│   │
 * │                                   ╰─────────╯   │
 * │                                                  │
 * │  ┌──────────────────┐ ┌──────────────────┐       │  ← Buy Yes/No buttons
 * │  │  Buy Yes   62¢   │ │  Buy No    38¢   │       │
 * │  └──────────────────┘ └──────────────────┘       │
 * │                                                  │
 * │  $12.4K vol  ·  124 traders  ·  ⏰ Jul 31       │  ← compact footer
 * └─────────────────────────────────────────────────┘
 */

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { Clock } from "lucide-react";
import { cardVariants } from "@/lib/animations";
import type { MarketDisplay } from "@/types/market";

// ─── Constants ──────────────────────────────────────────────────────────────

// Per-outcome color set (index 0 = Yes/first, 1 = No/second, 2+ = more)
const OUTCOME_COLORS = [
  {
    bg:          "rgba(0,255,136,0.06)",
    border:      "rgba(0,255,136,0.15)",
    borderHover: "rgba(0,255,136,0.40)",
    glow:        "rgba(0,255,136,0.18)",
    text:        "#00ff88",
    label:       "Buy Yes",
  },
  {
    bg:          "rgba(255,68,68,0.06)",
    border:      "rgba(255,68,68,0.15)",
    borderHover: "rgba(255,68,68,0.40)",
    glow:        "rgba(255,68,68,0.18)",
    text:        "#ff6b6b",
    label:       "Buy No",
  },
  {
    bg:          "rgba(255,215,0,0.06)",
    border:      "rgba(255,215,0,0.15)",
    borderHover: "rgba(255,215,0,0.40)",
    glow:        "rgba(255,215,0,0.18)",
    text:        "#ffd700",
    label:       "Buy",
  },
  {
    bg:          "rgba(99,102,241,0.06)",
    border:      "rgba(99,102,241,0.15)",
    borderHover: "rgba(99,102,241,0.40)",
    glow:        "rgba(99,102,241,0.18)",
    text:        "#818cf8",
    label:       "Buy",
  },
  {
    bg:          "rgba(168,85,247,0.06)",
    border:      "rgba(168,85,247,0.15)",
    borderHover: "rgba(168,85,247,0.40)",
    glow:        "rgba(168,85,247,0.18)",
    text:        "#c084fc",
    label:       "Buy",
  },
] as const;

const STATUS_BADGE: Record<
  MarketDisplay["status"],
  { label: string; bg: string; color: string; border: string } | null
> = {
  open:      null,
  locked:    { label: "LOCKED",    bg: "rgba(255,215,0,0.12)",  color: "#ffd700", border: "rgba(255,215,0,0.35)"  },
  resolved:  { label: "RESOLVED",  bg: "rgba(99,102,241,0.12)", color: "#818cf8", border: "rgba(99,102,241,0.35)" },
  cancelled: { label: "CANCELLED", bg: "rgba(255,68,68,0.12)",  color: "#ff4444", border: "rgba(255,68,68,0.35)"  },
};

// Max outcome buttons rendered; the rest collapse to "+N more"
const MAX_VISIBLE = 3;

// ─── MiniSparkline ───────────────────────────────────────────────────────────

interface MiniSparklineProps {
  probability: number;
  width?: number;
  height?: number;
}

function MiniSparkline({ probability, width = 120, height = 40 }: MiniSparklineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctxRaw = canvas.getContext("2d");
    if (!ctxRaw) return;
    // Alias with assertion so TS narrows correctly inside nested closures
    const ctx = ctxRaw as CanvasRenderingContext2D;

    // HiDPI
    const dpr      = window.devicePixelRatio || 1;
    canvas.width   = width * dpr;
    canvas.height  = height * dpr;
    ctx.scale(dpr, dpr);

    // Generate 20-point random walk that trends toward `probability`
    const points: number[] = [];
    let val = probability - 15 + Math.random() * 10;
    for (let i = 0; i < 20; i++) {
      val += (probability - val) * 0.08 + (Math.random() - 0.48) * 3;
      val = Math.max(5, Math.min(95, val));
      points.push(val);
    }
    points.push(probability);

    // Animated draw — left-to-right over ~600 ms (36 frames @ 60 fps)
    let frame        = 0;
    const totalFrames = 36;

    function draw() {
      ctx.clearRect(0, 0, width, height);

      const progress     = Math.min(frame / totalFrames, 1);
      const eased        = 1 - Math.pow(1 - progress, 3); // cubic ease-out
      const visibleCount = Math.max(2, Math.floor(points.length * eased));

      // ── Gradient fill ──────────────────────────────────────────────────────
      ctx.beginPath();
      for (let i = 0; i < visibleCount; i++) {
        const x    = (i / (points.length - 1)) * width;
        const y    = height - (points[i] / 100) * height;
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          const prevX = ((i - 1) / (points.length - 1)) * width;
          const prevY = height - (points[i - 1] / 100) * height;
          // step-chart: horizontal then vertical
          ctx.lineTo(x, prevY);
          ctx.lineTo(x, y);
        }
      }
      const lastX = ((visibleCount - 1) / (points.length - 1)) * width;
      ctx.lineTo(lastX, height);
      ctx.lineTo(0, height);
      ctx.closePath();

      const grad = ctx.createLinearGradient(0, 0, 0, height);
      grad.addColorStop(0, "rgba(0,255,136,0.15)");
      grad.addColorStop(1, "rgba(0,255,136,0)");
      ctx.fillStyle = grad;
      ctx.fill();

      // ── Step line ──────────────────────────────────────────────────────────
      ctx.beginPath();
      for (let i = 0; i < visibleCount; i++) {
        const x = (i / (points.length - 1)) * width;
        const y = height - (points[i] / 100) * height;
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          const prevY = height - (points[i - 1] / 100) * height;
          ctx.lineTo(x, prevY);
          ctx.lineTo(x, y);
        }
      }
      ctx.strokeStyle = "#00ff88";
      ctx.lineWidth   = 1.5;
      ctx.stroke();

      if (frame < totalFrames) {
        frame++;
        rafRef.current = requestAnimationFrame(draw);
      }
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [probability, width, height]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height, display: "block" }}
      className="opacity-80"
      aria-hidden="true"
    />
  );
}

// ─── MarketCard ──────────────────────────────────────────────────────────────

interface MarketCardProps {
  market: MarketDisplay;
  index: number;
}

export function MarketCard({ market, index }: MarketCardProps) {
  const firstOutcome    = market.outcomes[0];
  const probability     = firstOutcome?.prob ?? 0;
  const change          = market.change24h ?? 0;
  const changeUp        = change >= 0;
  const statusBadge     = STATUS_BADGE[market.status];
  const visibleOutcomes = market.outcomes.slice(0, MAX_VISIBLE);
  const hiddenCount     = Math.max(0, market.outcomes.length - MAX_VISIBLE);
  const isBinary        = market.outcomes.length === 2;
  const cols            = visibleOutcomes.length === 1 ? 1 : visibleOutcomes.length === 2 ? 2 : 3;

  // Probability shown in cents (e.g., "62¢")
  const probToCents = (p: number) => `${Math.round(p)}¢`;

  return (
    <Link
      href={`/markets/${market.id}`}
      className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00ff88] rounded-xl"
      aria-label={`${market.title} — ${probability}% probability`}
    >
      <motion.div
        className="flex flex-col p-4 rounded-xl cursor-pointer"
        style={{
          background: "var(--surface)",
          border:     "1px solid var(--border)",
          gap:        "14px",
        }}
        variants={cardVariants}
        initial="hidden"
        animate="visible"
        custom={index}
        whileHover={{
          y:          -3,
          borderColor: "rgba(0,255,136,0.20)",
          boxShadow:  "0 8px 32px rgba(0,0,0,0.45), 0 0 0 1px rgba(0,255,136,0.06)",
          transition: { type: "spring", stiffness: 300, damping: 22 },
        }}
      >

        {/* ── 1. Header: icon + title + badge ── */}
        <div className="flex items-start gap-2.5">
          <span
            className="text-xl leading-none shrink-0 mt-0.5"
            role="img"
            aria-hidden="true"
          >
            {market.icon}
          </span>

          <p
            className="text-sm font-semibold leading-snug line-clamp-2 flex-1 min-w-0"
            style={{ color: "var(--text)" }}
          >
            {market.title}
          </p>

          <div className="shrink-0 mt-0.5">
            {market.isHot && !statusBadge && (
              <span className="hot-badge text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider whitespace-nowrap">
                HOT
              </span>
            )}
            {statusBadge && (
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider whitespace-nowrap"
                style={{
                  background: statusBadge.bg,
                  color:      statusBadge.color,
                  border:     `1px solid ${statusBadge.border}`,
                }}
              >
                {statusBadge.label}
              </span>
            )}
          </div>
        </div>

        {/* ── 2. Probability + Mini Sparkline (side by side) ── */}
        <div className="flex items-center justify-between gap-3">
          {/* Big probability + 24h change */}
          <div className="flex flex-col gap-0.5">
            <span
              className="text-3xl font-black tabular-nums leading-none"
              style={{ color: "var(--text)" }}
              aria-label={`${probability}% probability`}
            >
              {probability}%
            </span>
            <span
              className="text-xs font-semibold tabular-nums flex items-center gap-0.5"
              style={{ color: changeUp ? "#00ff88" : "#ff6b6b" }}
              aria-label={`24h change: ${changeUp ? "up" : "down"} ${Math.abs(change).toFixed(1)}%`}
            >
              <span aria-hidden="true">{changeUp ? "▲" : "▼"}</span>
              {Math.abs(change).toFixed(1)}%
            </span>
          </div>

          {/* Mini sparkline */}
          <div
            className="shrink-0 rounded overflow-hidden"
            style={{ lineHeight: 0 }}
          >
            <MiniSparkline probability={probability} width={120} height={40} />
          </div>
        </div>

        {/* ── 3. Buy buttons ── */}
        <div
          className="grid gap-2"
          style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
        >
          {visibleOutcomes.map((outcome, i) => {
            const c        = OUTCOME_COLORS[i] ?? OUTCOME_COLORS[2];
            // For binary markets use "Buy Yes" / "Buy No"; for multi-outcome show the label
            const buyLabel = isBinary
              ? (i === 0 ? "Buy Yes" : "Buy No")
              : `Buy ${outcome.label}`;
            const cents    = probToCents(outcome.prob);

            return (
              <motion.div
                key={outcome.label}
                className="flex flex-col items-center justify-center rounded-lg select-none"
                style={{
                  height:     "40px",
                  background: c.bg,
                  border:     `1px solid ${c.border}`,
                }}
                whileHover={{
                  scale:       1.02,
                  borderColor: c.borderHover,
                  boxShadow:   `0 0 10px ${c.glow}`,
                  transition:  { duration: 0.12 },
                }}
                aria-label={`${buyLabel} at ${cents}`}
              >
                <span
                  className="text-[10px] font-medium uppercase tracking-wider leading-none"
                  style={{ color: "var(--muted)" }}
                >
                  {buyLabel}
                </span>
                <span
                  className="text-base font-black tabular-nums leading-none mt-0.5"
                  style={{ color: c.text }}
                >
                  {cents}
                </span>
              </motion.div>
            );
          })}

          {hiddenCount > 0 && (
            <div
              className="flex items-center justify-center rounded-lg text-xs font-semibold"
              style={{
                height:     "40px",
                background: "rgba(255,255,255,0.03)",
                border:     "1px solid rgba(255,255,255,0.07)",
                color:      "var(--muted)",
              }}
            >
              +{hiddenCount} more
            </div>
          )}
        </div>

        {/* ── 4. Footer stats (compact, single row) ── */}
        <div
          className="flex items-center gap-0 text-xs tabular-nums"
          style={{ color: "var(--muted)" }}
        >
          <span>{market.volume} vol</span>

          <span className="mx-1.5 opacity-40">·</span>

          <span>{market.totalBettors.toLocaleString()} traders</span>

          <span className="mx-1.5 opacity-40">·</span>

          <span className="flex items-center gap-1">
            <Clock size={10} aria-hidden="true" />
            {market.endDate}
          </span>
        </div>

      </motion.div>
    </Link>
  );
}
