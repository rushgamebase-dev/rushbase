"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { Eye, ArrowRight } from "lucide-react";

/*
 * Usage:
 *   <LiveMarketCard />
 *
 * Live market ticker banner at the top of the landing page.
 * Simulates a CCTV-style vehicle counter with a countdown timer.
 */

// ── Hook: useMiniLiveTicker ──────────────────────────────────────────────────
function useMiniLiveTicker() {
  const [count, setCount] = useState(47);
  const [timeLeft, setTimeLeft] = useState(() => Math.floor(Math.random() * 240) + 30);
  const prevCountRef = useRef(47);

  useEffect(() => {
    const interval = setInterval(() => {
      // 15% chance per second to increment count
      if (Math.random() < 0.15) {
        setCount((c) => {
          prevCountRef.current = c;
          return c + 1;
        });
      }

      setTimeLeft((t) => {
        if (t <= 1) {
          // Reset timer randomly between 30-270 seconds
          return Math.floor(Math.random() * 240) + 30;
        }
        return t - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const mm = String(Math.floor(timeLeft / 60)).padStart(2, "0");
  const ss = String(timeLeft % 60).padStart(2, "0");

  return { count, timeFormatted: `${mm}:${ss}` };
}

// ── Sub-component: CCTV simulation ──────────────────────────────────────────
function CCTVSimulation({ count }: { count: number }) {
  return (
    <div
      className="relative rounded-lg overflow-hidden shrink-0"
      style={{
        width: 96,
        height: 72,
        background: "#000",
        border: "1px solid rgba(0,255,136,0.2)",
      }}
      aria-hidden="true"
    >
      {/* Scanlines */}
      {Array.from({ length: 12 }).map((_, i) => (
        <div
          key={i}
          className="absolute w-full"
          style={{
            top: `${(i / 12) * 100}%`,
            height: "1px",
            background: "rgba(0,255,136,0.04)",
          }}
        />
      ))}

      {/* Road hint */}
      <div
        className="absolute bottom-0 left-0 right-0"
        style={{ height: 28, background: "rgba(20,20,20,0.9)" }}
      />
      <div
        className="absolute"
        style={{
          bottom: 12,
          left: "50%",
          transform: "translateX(-50%)",
          width: 8,
          height: 4,
          background: "rgba(255,255,255,0.3)",
          borderRadius: 1,
        }}
      />

      {/* Vehicle dots */}
      {[
        { x: "20%", y: "35%", size: 4 },
        { x: "55%", y: "42%", size: 5 },
        { x: "75%", y: "38%", size: 3 },
      ].map((v, i) => (
        <div
          key={i}
          className="absolute rounded-full"
          style={{
            left: v.x,
            top: v.y,
            width: v.size,
            height: v.size,
            background: "#00ff88",
            opacity: 0.7,
          }}
        />
      ))}

      {/* REC indicator */}
      <div className="absolute top-1.5 left-1.5 flex items-center gap-1">
        <span className="live-dot" style={{ width: 5, height: 5 }} />
        <span style={{ fontSize: 7, color: "#ff4444", fontFamily: "monospace", fontWeight: 700 }}>
          REC
        </span>
      </div>

      {/* Count overlay */}
      <div
        className="absolute bottom-1 right-1"
        style={{ fontSize: 8, color: "#00ff88", fontFamily: "monospace" }}
      >
        {count.toString().padStart(3, "0")}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function LiveMarketCard() {
  const { count, timeFormatted } = useMiniLiveTicker();
  const [prevCount, setPrevCount] = useState(count);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    if (count !== prevCount) {
      setPrevCount(count);
      setChanged(true);
      const t = setTimeout(() => setChanged(false), 400);
      return () => clearTimeout(t);
    }
  }, [count, prevCount]);

  return (
    <div
      style={{
        background: "linear-gradient(135deg, #0a0a0a 0%, #0a0a0a 60%, rgba(0,255,136,0.05) 100%)",
        borderBottom: "1px solid rgba(0,255,136,0.12)",
      }}
      aria-label="Live market ticker"
      role="banner"
    >
      <div className="max-w-7xl mx-auto px-4 py-3">
        <div className="flex items-center gap-4 lg:gap-8">

          {/* ── LEFT: CCTV simulation ── */}
          <div className="hidden sm:flex items-center gap-3 shrink-0">
            <CCTVSimulation count={count} />
            <img src="/mascot/chill.gif" alt="" className="w-10 h-10 rounded-full" aria-hidden="true" />

            <div className="flex flex-col gap-1">
              {/* LIVE badge */}
              <div className="flex items-center gap-1.5">
                <span className="live-dot" aria-hidden="true" />
                <span
                  className="text-xs font-bold tracking-widest"
                  style={{ color: "var(--danger)", fontFamily: "monospace" }}
                >
                  LIVE
                </span>
              </div>

              {/* Animated count */}
              <div className="flex items-baseline gap-1.5">
                <AnimatePresence mode="wait">
                  <motion.span
                    key={count}
                    initial={{ scale: changed ? 1.3 : 1, color: changed ? "#ffd700" : "var(--primary)" }}
                    animate={{ scale: 1, color: "var(--primary)" }}
                    transition={{ duration: 0.3 }}
                    className="text-2xl font-black tabular"
                    style={{ fontFamily: "monospace", color: "var(--primary)" }}
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    {count}
                  </motion.span>
                </AnimatePresence>
                <span
                  className="text-xs"
                  style={{ color: "var(--muted)", fontFamily: "monospace" }}
                >
                  vehicles counted
                </span>
              </div>

              {/* Camera icon */}
              <div className="flex items-center gap-1">
                <Eye size={10} style={{ color: "var(--muted)" }} aria-hidden="true" />
                <span
                  className="text-[10px]"
                  style={{ color: "var(--muted)", fontFamily: "monospace" }}
                >
                  CAM-01 ACTIVE
                </span>
              </div>
            </div>
          </div>

          {/* Divider */}
          <div
            className="hidden lg:block shrink-0 self-stretch"
            style={{ width: 1, background: "var(--border)" }}
            aria-hidden="true"
          />

          {/* ── RIGHT: Market info ── */}
          <div className="flex-1 flex items-center justify-between gap-4 min-w-0">

            <div className="flex flex-col gap-1 min-w-0">
              {/* Live Market badge + Highway */}
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="text-xs font-bold px-2 py-0.5 rounded-full"
                  style={{
                    border: "1px solid rgba(0,255,136,0.4)",
                    color: "var(--primary)",
                    fontFamily: "monospace",
                  }}
                >
                  Live Market
                </span>
                <span
                  className="text-xs"
                  style={{ color: "var(--muted)", fontFamily: "monospace" }}
                >
                  Highway
                </span>
              </div>

              {/* Title */}
              <h3
                className="text-sm font-bold leading-snug"
                style={{ color: "var(--text)", fontFamily: "monospace" }}
              >
                How many cars pass in 5 minutes?
              </h3>

              {/* Description — hidden on mobile */}
              <p
                className="hidden md:block text-xs leading-relaxed"
                style={{ color: "var(--muted)", fontFamily: "monospace" }}
              >
                Live camera on Peace Bridge. Predict if more or fewer vehicles will pass the threshold and win.
              </p>
            </div>

            {/* Timer + CTA */}
            <div className="flex items-center gap-3 shrink-0">
              {/* Timer */}
              <div className="flex items-center gap-1.5">
                <span
                  className="inline-block w-2 h-2 rounded-full shrink-0"
                  style={{ background: "#f59e0b", boxShadow: "0 0 6px rgba(245,158,11,0.6)" }}
                  aria-hidden="true"
                />
                <span
                  className="text-sm font-black tabular"
                  style={{ color: "#f59e0b", fontFamily: "monospace" }}
                  aria-label={`Time remaining: ${timeFormatted}`}
                >
                  {timeFormatted}
                </span>
              </div>

              {/* CTA button */}
              <Link
                href="/markets"
                className="hidden sm:flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-all"
                style={{
                  background: "rgba(0,255,136,0.1)",
                  border: "1px solid rgba(0,255,136,0.3)",
                  color: "var(--primary)",
                  fontFamily: "monospace",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "rgba(0,255,136,0.2)";
                  (e.currentTarget as HTMLElement).style.boxShadow = "0 0 12px rgba(0,255,136,0.2)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "rgba(0,255,136,0.1)";
                  (e.currentTarget as HTMLElement).style.boxShadow = "none";
                }}
              >
                Watch
                <ArrowRight size={12} aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
