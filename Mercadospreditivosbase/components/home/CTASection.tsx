"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import {
  Sparkles,
  Gift,
  Zap,
  Users,
  TrendingUp,
  ArrowRight,
} from "lucide-react";

/*
 * Usage:
 *   <CTASection />
 *
 * Final CTA section with countdown timer, floating particles, and benefits grid.
 */

// ── Floating particles ───────────────────────────────────────────────────────
function FloatingParticles() {
  const PARTICLES = Array.from({ length: 20 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    size: Math.random() * 4 + 2,
    duration: Math.random() * 8 + 6,
    delay: Math.random() * 5,
    opacity: Math.random() * 0.4 + 0.1,
  }));

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      {PARTICLES.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full"
          style={{
            left: `${p.x}%`,
            bottom: "-20px",
            width: p.size,
            height: p.size,
            background: p.id % 3 === 0 ? "var(--gold)" : "var(--primary)",
            opacity: p.opacity,
          }}
          animate={{
            y: [0, -(typeof window !== "undefined" ? window.innerHeight * 0.8 : 600)],
            opacity: [0, p.opacity, 0],
            scale: [0.5, 1, 0.5],
          }}
          transition={{
            duration: p.duration,
            repeat: Infinity,
            delay: p.delay,
            ease: "linear",
          }}
        />
      ))}
    </div>
  );
}

// ── Countdown timer ──────────────────────────────────────────────────────────
function useCountdown(targetDate: Date) {
  const [timeLeft, setTimeLeft] = useState({
    days: 0, hours: 0, minutes: 0, seconds: 0,
  });

  useEffect(() => {
    function update() {
      const diff = targetDate.getTime() - Date.now();
      if (diff <= 0) {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 });
        return;
      }
      const days    = Math.floor(diff / 86400000);
      const hours   = Math.floor((diff % 86400000) / 3600000);
      const minutes = Math.floor((diff % 3600000) / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setTimeLeft({ days, hours, minutes, seconds });
    }
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [targetDate]);

  return timeLeft;
}

function CountdownUnit({ value, label }: { value: number; label: string }) {
  const display = String(value).padStart(2, "0");

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className="relative w-16 h-16 md:w-20 md:h-20 rounded-xl flex items-center justify-center overflow-hidden"
        style={{
          background: "rgba(255,255,255,0.1)",
          backdropFilter: "blur(8px)",
          border: "1px solid rgba(255,255,255,0.2)",
        }}
      >
        <AnimatePresence mode="wait">
          <motion.span
            key={display}
            className="text-2xl md:text-3xl font-black tabular"
            style={{ color: "#fff", fontFamily: "monospace" }}
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {display}
          </motion.span>
        </AnimatePresence>
      </div>
      <span
        className="text-[10px] font-bold tracking-widest uppercase"
        style={{ color: "rgba(255,255,255,0.6)", fontFamily: "monospace" }}
      >
        {label}
      </span>
    </div>
  );
}

// ── Benefits grid ────────────────────────────────────────────────────────────
const BENEFITS = [
  { Icon: Gift,       label: "Welcome Bonus"    },
  { Icon: Zap,        label: "Instant Payout"   },
  { Icon: Users,      label: "Active Community" },
  { Icon: TrendingUp, label: "Live Markets"     },
];

// ── Main component ────────────────────────────────────────────────────────────
export function CTASection() {
  // Target: 7 days from now
  const targetDate = useRef(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)).current;
  const { days, hours, minutes, seconds } = useCountdown(targetDate);

  return (
    <section
      className="relative overflow-hidden"
      aria-labelledby="cta-heading"
      style={{
        background: "linear-gradient(135deg, #00ff88 0%, #00aa55 20%, #003322 50%, #0a0a0a 100%)",
      }}
    >
      {/* Grid pattern overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        aria-hidden="true"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='40' height='40' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 0h40v40H0z' fill='none'/%3E%3Cpath d='M0 0h1v40H0zm40 0h1v40h-1zM0 0v1h40V0zM0 40v1h40v-1z' fill='rgba(0,255,136,0.06)'/%3E%3C/svg%3E")`,
          backgroundRepeat: "repeat",
        }}
      />

      {/* Floating particles */}
      <FloatingParticles />

      <div className="relative z-10 max-w-7xl mx-auto px-4 py-20 md:py-28 text-center">

        {/* ── Mascot ── */}
        <motion.div
          className="flex justify-center mb-4"
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4 }}
          aria-hidden="true"
        >
          <img src="/mascot/happy-dance.gif" alt="" className="w-20 h-20" />
        </motion.div>

        {/* ── Special offer badge ── */}
        <motion.div
          className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-8"
          style={{
            background: "rgba(255,215,0,0.15)",
            border: "1px solid rgba(255,215,0,0.4)",
          }}
          initial={{ opacity: 0, scale: 0.9 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4 }}
        >
          <Sparkles size={14} style={{ color: "var(--gold)" }} aria-hidden="true" />
          <span
            className="text-xs font-black tracking-wider"
            style={{ color: "var(--gold)", fontFamily: "monospace" }}
          >
            Early Access Bonus
          </span>
        </motion.div>

        {/* ── Headline ── */}
        <motion.h2
          id="cta-heading"
          className="text-4xl md:text-5xl lg:text-6xl font-black mb-4 leading-tight"
          style={{ fontFamily: "monospace" }}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <span style={{ color: "#fff" }}>Start Predicting </span>
          <br />
          <span
            style={{
              background: "linear-gradient(135deg, var(--gold), #ffaa00)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            The Future of Base
          </span>
        </motion.h2>

        {/* ── Subheadline ── */}
        <motion.p
          className="text-sm md:text-base mb-10 max-w-lg mx-auto"
          style={{ color: "rgba(255,255,255,0.7)", fontFamily: "monospace" }}
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, delay: 0.2 }}
        >
          Join thousands of traders making predictions on Base chain events
        </motion.p>

        {/* ── Countdown timer ── */}
        <motion.div
          className="flex items-start justify-center gap-3 md:gap-4 mb-10"
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.3 }}
          aria-label="Countdown timer"
        >
          <CountdownUnit value={days} label="Days" />
          <span
            className="text-3xl md:text-4xl font-black mt-3"
            style={{ color: "rgba(255,255,255,0.5)", fontFamily: "monospace" }}
            aria-hidden="true"
          >
            :
          </span>
          <CountdownUnit value={hours} label="Hours" />
          <span
            className="text-3xl md:text-4xl font-black mt-3"
            style={{ color: "rgba(255,255,255,0.5)", fontFamily: "monospace" }}
            aria-hidden="true"
          >
            :
          </span>
          <CountdownUnit value={minutes} label="Minutes" />
          <span
            className="text-3xl md:text-4xl font-black mt-3"
            style={{ color: "rgba(255,255,255,0.5)", fontFamily: "monospace" }}
            aria-hidden="true"
          >
            :
          </span>
          <CountdownUnit value={seconds} label="Seconds" />
        </motion.div>

        {/* ── Benefits grid ── */}
        <motion.div
          className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-xl mx-auto mb-10"
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, delay: 0.35 }}
        >
          {BENEFITS.map((benefit, i) => (
            <motion.div
              key={benefit.label}
              className="flex flex-col items-center gap-2 py-3 rounded-lg"
              style={{
                background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.12)",
              }}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.3, delay: 0.4 + i * 0.06 }}
            >
              <benefit.Icon
                size={18}
                style={{ color: "rgba(255,255,255,0.8)" }}
                aria-hidden="true"
              />
              <span
                className="text-[11px] font-bold text-center"
                style={{ color: "rgba(255,255,255,0.7)", fontFamily: "monospace" }}
              >
                {benefit.label}
              </span>
            </motion.div>
          ))}
        </motion.div>

        {/* ── CTA buttons ── */}
        <motion.div
          className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-10"
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, delay: 0.45 }}
        >
          <Link
            href="/markets"
            className="flex items-center gap-2 px-8 py-3.5 rounded-xl text-sm font-black tracking-wider transition-all"
            style={{
              background: "#fff",
              color: "#000",
              fontFamily: "monospace",
              boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.transform = "scale(1.04)";
              (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 32px rgba(0,0,0,0.4)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.transform = "scale(1)";
              (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 24px rgba(0,0,0,0.3)";
            }}
          >
            Start Trading
            <ArrowRight size={16} aria-hidden="true" />
          </Link>

          <Link
            href="/markets"
            className="flex items-center gap-2 px-8 py-3.5 rounded-xl text-sm font-black tracking-wider transition-all"
            style={{
              background: "transparent",
              border: "2px solid rgba(255,255,255,0.5)",
              color: "#fff",
              fontFamily: "monospace",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.1)";
              (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.8)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
              (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.5)";
            }}
          >
            Learn More
          </Link>
        </motion.div>

        {/* ── Trust indicators ── */}
        <motion.div
          className="flex items-center justify-center gap-3"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, delay: 0.55 }}
          aria-label="Active user count"
        >
          {/* Avatar circles */}
          <div className="flex -space-x-2">
            {["A", "B", "C", "D"].map((letter, i) => (
              <div
                key={letter}
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black border-2"
                style={{
                  background: `hsl(${i * 60 + 120}, 60%, 40%)`,
                  borderColor: "rgba(0,0,0,0.3)",
                  color: "#fff",
                  fontFamily: "monospace",
                  zIndex: 4 - i,
                }}
                aria-hidden="true"
              >
                {letter}
              </div>
            ))}
          </div>
          <span
            className="text-sm font-bold"
            style={{ color: "rgba(255,255,255,0.8)", fontFamily: "monospace" }}
          >
            +24.5k users
          </span>
        </motion.div>

      </div>
    </section>
  );
}
