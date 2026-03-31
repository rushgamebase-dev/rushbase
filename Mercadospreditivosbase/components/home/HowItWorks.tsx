"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  Zap,
  Wallet,
  TrendingUp,
  Trophy,
  CheckCircle2,
  Clock,
  ChevronRight,
} from "lucide-react";

/*
 * Usage:
 *   <HowItWorks />
 *
 * Interactive 3-step process visualization with a horizontal flow diagram,
 * animated traveling dots, and expandable step cards.
 */

// ── Flow steps data ──────────────────────────────────────────────────────────
const FLOW_STEPS = [
  { id: "you",    label: "Connect Wallet", emoji: null,  Icon: Wallet   },
  { id: "eth",    label: "Deposit",        emoji: "💰",  Icon: null     },
  { id: "market", label: "Choose Market",  emoji: "📊",  Icon: null     },
  { id: "bet",    label: "Place Your Bet", emoji: "🎯",  Icon: null     },
  { id: "win",    label: "Collect Winnings", emoji: "🏆", Icon: null    },
];

const TRUST_BADGES = [
  "Base Chain",
  "Non-Custodial",
  "Instant Settlement",
  "5% Fee Only",
];

// ── Step cards data ──────────────────────────────────────────────────────────
const STEPS = [
  {
    num: "01",
    Icon: Wallet,
    iconBg: "linear-gradient(135deg, rgba(0,255,136,0.2), rgba(0,255,136,0.05))",
    iconColor: "var(--primary)",
    title: "Connect Your Wallet",
    subtitle: "Link your wallet in seconds",
    description: "Connect your existing Web3 wallet to get started. No account creation, no email required.",
    details: [
      "MetaMask, Phantom, or Coinbase Wallet",
      "No sign-up required",
      "Your keys, your funds",
      "Works on Base chain",
    ],
  },
  {
    num: "02",
    Icon: TrendingUp,
    iconBg: "linear-gradient(135deg, rgba(255,215,0,0.2), rgba(255,215,0,0.05))",
    iconColor: "var(--gold)",
    title: "Browse & Bet",
    subtitle: "Find markets and place predictions",
    description: "Browse live prediction markets and bet ETH on the outcome you believe in.",
    details: [
      "Real-time odds",
      "Multiple outcome types",
      "Set your own amount",
      "Track live results",
    ],
  },
  {
    num: "03",
    Icon: Trophy,
    iconBg: "linear-gradient(135deg, rgba(68,136,255,0.2), rgba(68,136,255,0.05))",
    iconColor: "#4488ff",
    title: "Win & Collect",
    subtitle: "Winnings distributed automatically",
    description: "When the market resolves, winners receive their payout automatically. No claims needed.",
    details: [
      "Automatic payout on resolution",
      "No claims needed",
      "5% protocol fee only",
      "Transparent on-chain settlement",
    ],
  },
];

// ── Flow visualization ───────────────────────────────────────────────────────
function FlowDiagram() {
  return (
    <div className="mb-12">
      {/* Desktop horizontal flow */}
      <div className="hidden md:flex items-center justify-between relative">
        {FLOW_STEPS.map((step, i) => (
          <div key={step.id} className="flex items-center flex-1">
            {/* Step node */}
            <div className="flex flex-col items-center gap-2 relative z-10">
              <motion.div
                className="flex items-center justify-center w-12 h-12 rounded-full"
                style={{
                  background: "var(--surface)",
                  border: "1px solid rgba(0,255,136,0.25)",
                }}
                initial={{ scale: 0, opacity: 0 }}
                whileInView={{ scale: 1, opacity: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.1 }}
                whileHover={{ scale: 1.1, borderColor: "rgba(0,255,136,0.6)" }}
              >
                {step.Icon ? (
                  <step.Icon size={20} style={{ color: "var(--primary)" }} aria-hidden="true" />
                ) : (
                  <span className="text-xl" role="img" aria-hidden="true">{step.emoji}</span>
                )}
              </motion.div>
              <motion.span
                className="text-[10px] text-center font-bold whitespace-nowrap"
                style={{ color: "var(--muted)", fontFamily: "monospace" }}
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.3, delay: i * 0.1 + 0.15 }}
              >
                {step.label}
              </motion.span>
            </div>

            {/* Connector line with traveling dot */}
            {i < FLOW_STEPS.length - 1 && (
              <div className="flex-1 mx-2 relative" style={{ height: 2 }} aria-hidden="true">
                {/* Static line */}
                <motion.div
                  className="absolute inset-0 rounded-full"
                  style={{ background: "rgba(0,255,136,0.15)" }}
                  initial={{ scaleX: 0 }}
                  whileInView={{ scaleX: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: i * 0.12 + 0.2 }}
                />
                {/* Traveling dot */}
                <motion.div
                  className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full"
                  style={{ background: "var(--primary)", boxShadow: "0 0 6px rgba(0,255,136,0.8)" }}
                  animate={{ left: ["0%", "100%"] }}
                  transition={{
                    duration: 1.8,
                    repeat: Infinity,
                    ease: "linear",
                    delay: i * 0.3,
                  }}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Mobile vertical stack */}
      <div className="md:hidden flex flex-col gap-3">
        {FLOW_STEPS.map((step, i) => (
          <div key={step.id} className="flex items-center gap-3">
            <motion.div
              className="flex items-center justify-center w-10 h-10 rounded-full shrink-0"
              style={{
                background: "var(--surface)",
                border: "1px solid rgba(0,255,136,0.25)",
              }}
              initial={{ scale: 0, opacity: 0 }}
              whileInView={{ scale: 1, opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.3, delay: i * 0.08 }}
            >
              {step.Icon ? (
                <step.Icon size={16} style={{ color: "var(--primary)" }} aria-hidden="true" />
              ) : (
                <span className="text-lg" role="img" aria-hidden="true">{step.emoji}</span>
              )}
            </motion.div>
            <span
              className="text-sm font-semibold"
              style={{ color: "var(--text)", fontFamily: "monospace" }}
            >
              {step.label}
            </span>
            {i < FLOW_STEPS.length - 1 && (
              <ChevronRight size={14} style={{ color: "var(--muted)", marginLeft: "auto" }} aria-hidden="true" />
            )}
          </div>
        ))}
      </div>

      {/* Trust badges */}
      <motion.div
        className="flex flex-wrap justify-center gap-2 mt-6"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.4, delay: 0.5 }}
      >
        {TRUST_BADGES.map((badge) => (
          <span
            key={badge}
            className="text-xs px-3 py-1 rounded-full font-semibold"
            style={{
              background: "rgba(0,255,136,0.08)",
              border: "1px solid rgba(0,255,136,0.2)",
              color: "var(--primary)",
              fontFamily: "monospace",
            }}
          >
            {badge}
          </span>
        ))}
      </motion.div>
    </div>
  );
}

// ── Step card ────────────────────────────────────────────────────────────────
function StepCard({
  step,
  isActive,
  onActivate,
  index,
}: {
  step: typeof STEPS[number];
  isActive: boolean;
  onActivate: () => void;
  index: number;
}) {
  return (
    <motion.div
      className="relative p-6 rounded-xl cursor-pointer transition-all duration-200"
      style={{
        background: isActive ? "rgba(0,255,136,0.05)" : "var(--surface)",
        border: isActive
          ? "1px solid rgba(0,255,136,0.3)"
          : "1px solid var(--border)",
        transform: isActive ? "scale(1.02)" : "scale(1)",
        boxShadow: isActive ? "0 8px 32px rgba(0,255,136,0.08)" : "none",
      }}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, delay: index * 0.12 }}
      onClick={onActivate}
      role="button"
      tabIndex={0}
      aria-expanded={isActive}
      aria-label={`Step ${step.num}: ${step.title}`}
      onKeyDown={(e) => e.key === "Enter" && onActivate()}
    >
      {/* Step number badge */}
      <div
        className="absolute -top-3 -right-3 w-8 h-8 rounded-full flex items-center justify-center text-xs font-black"
        style={{
          background: isActive ? "var(--primary)" : "var(--surface)",
          color: isActive ? "#000" : "var(--muted)",
          border: isActive ? "none" : "1px solid var(--border)",
          fontFamily: "monospace",
        }}
        aria-hidden="true"
      >
        {step.num}
      </div>

      {/* Icon */}
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
        style={{ background: step.iconBg }}
        aria-hidden="true"
      >
        <step.Icon size={24} style={{ color: step.iconColor }} />
      </div>

      {/* Title & subtitle */}
      <h3
        className="text-base font-black mb-1"
        style={{ color: "var(--text)", fontFamily: "monospace" }}
      >
        {step.title}
      </h3>
      <p
        className="text-xs font-semibold mb-3"
        style={{ color: "var(--primary)", fontFamily: "monospace" }}
      >
        {step.subtitle}
      </p>
      <p
        className="text-xs leading-relaxed mb-4"
        style={{ color: "var(--muted)", fontFamily: "monospace" }}
      >
        {step.description}
      </p>

      {/* Detail checklist — shown when active */}
      {isActive && (
        <motion.ul
          className="flex flex-col gap-2"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          transition={{ duration: 0.25 }}
          aria-label={`Details for ${step.title}`}
        >
          {step.details.map((detail, i) => (
            <motion.li
              key={detail}
              className="flex items-center gap-2 text-xs"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2, delay: i * 0.06 }}
              style={{ color: "var(--text)", fontFamily: "monospace" }}
            >
              <CheckCircle2 size={13} style={{ color: "var(--primary)", flexShrink: 0 }} aria-hidden="true" />
              {detail}
            </motion.li>
          ))}
        </motion.ul>
      )}
    </motion.div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function HowItWorks() {
  const [activeStep, setActiveStep] = useState(0);

  return (
    <section
      aria-labelledby="how-it-works-heading"
      style={{
        background: "var(--background)",
        backgroundImage: `
          linear-gradient(rgba(0,255,136,0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(0,255,136,0.03) 1px, transparent 1px)
        `,
        backgroundSize: "40px 40px",
      }}
    >
      <div className="max-w-7xl mx-auto px-4 py-16 md:py-24">

        {/* ── Section header ── */}
        <motion.div
          className="text-center mb-12"
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4 }}
        >
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-6" style={{
            background: "rgba(0,255,136,0.08)",
            border: "1px solid rgba(0,255,136,0.2)",
          }}>
            <Zap size={14} style={{ color: "var(--primary)" }} aria-hidden="true" />
            <span
              className="text-xs font-bold tracking-wider"
              style={{ color: "var(--primary)", fontFamily: "monospace" }}
            >
              Simple &amp; Fast
            </span>
          </div>

          <h2
            id="how-it-works-heading"
            className="text-3xl md:text-4xl font-black mb-4"
            style={{ color: "var(--text)", fontFamily: "monospace" }}
          >
            How It Works
          </h2>
          <p
            className="text-sm md:text-base max-w-xl mx-auto"
            style={{ color: "var(--muted)", fontFamily: "monospace" }}
          >
            Start predicting in minutes. No complicated setup.
          </p>
        </motion.div>

        {/* ── Flow visualization ── */}
        <FlowDiagram />

        {/* ── Step cards ── */}
        <div className="relative grid grid-cols-1 md:grid-cols-3 gap-6">
          {STEPS.map((step, i) => (
            <div key={step.num} className="relative">
              <StepCard
                step={step}
                isActive={activeStep === i}
                onActivate={() => setActiveStep(i)}
                index={i}
              />
              {/* Connector line between cards (desktop only) */}
              {i < STEPS.length - 1 && (
                <div
                  className="hidden md:block absolute top-8 -right-3 w-6 h-px z-20"
                  style={{ background: "rgba(0,255,136,0.2)" }}
                  aria-hidden="true"
                />
              )}
            </div>
          ))}
        </div>

        {/* ── Bottom CTA ── */}
        <motion.div
          className="flex flex-col sm:flex-row items-center justify-center gap-4 mt-12"
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, delay: 0.3 }}
        >
          <div className="flex items-center gap-2">
            <Clock size={16} style={{ color: "var(--muted)" }} aria-hidden="true" />
            <span
              className="text-sm"
              style={{ color: "var(--muted)", fontFamily: "monospace" }}
            >
              Ready to predict?
            </span>
          </div>
          <Link
            href="/markets"
            className="btn-primary px-6 py-2.5 rounded-lg text-sm font-black tracking-widest inline-flex items-center gap-2 neon-glow"
            style={{ fontFamily: "monospace" }}
          >
            Start now
            <Zap size={14} aria-hidden="true" />
          </Link>
        </motion.div>

      </div>
    </section>
  );
}
