"use client";

import { motion } from "framer-motion";
import { Shield, Lock, CheckCircle2, Zap, Award } from "lucide-react";
import { useStats } from "@/hooks/useStats";

/*
 * Usage:
 *   <SocialProof />
 *
 * Partners section, security badges, stats bar, and trust message.
 */

// ── Partner SVG logos ─────────────────────────────────────────────────────────
function BaseLogo() {
  return (
    <div className="flex items-center gap-2">
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-black"
        style={{ background: "#0052ff", color: "#fff" }}
        aria-hidden="true"
      >
        B
      </div>
      <span className="font-bold text-sm" style={{ fontFamily: "monospace" }}>
        Base
      </span>
    </div>
  );
}

function AblyLogo() {
  return (
    <div className="flex items-center gap-2">
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-black"
        style={{ background: "#e64a19", color: "#fff" }}
        aria-hidden="true"
      >
        A
      </div>
      <span className="font-bold text-sm" style={{ fontFamily: "monospace" }}>
        Ably
      </span>
    </div>
  );
}

function WagmiLogo() {
  return (
    <div className="flex items-center gap-2">
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-black"
        style={{ background: "#00aa55", color: "#fff" }}
        aria-hidden="true"
      >
        W
      </div>
      <span className="font-bold text-sm" style={{ fontFamily: "monospace" }}>
        Wagmi
      </span>
    </div>
  );
}

function ViemLogo() {
  return (
    <div className="flex items-center gap-2">
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-black"
        style={{ background: "#7c3aed", color: "#fff" }}
        aria-hidden="true"
      >
        V
      </div>
      <span className="font-bold text-sm" style={{ fontFamily: "monospace" }}>
        Viem
      </span>
    </div>
  );
}

const PARTNERS = [
  { Component: BaseLogo,  label: "Base chain infrastructure" },
  { Component: AblyLogo,  label: "Real-time messaging" },
  { Component: WagmiLogo, label: "React Web3 hooks" },
  { Component: ViemLogo,  label: "Ethereum TypeScript library" },
];

// ── Security badges ───────────────────────────────────────────────────────────
const SECURITY_BADGES = [
  {
    Icon: Shield,
    iconColor: "#10b981",
    bg: "rgba(16,185,129,0.08)",
    border: "rgba(16,185,129,0.2)",
    title: "Audited",
    description: "Smart contracts verified with 155+ unit tests",
  },
  {
    Icon: Lock,
    iconColor: "#3b82f6",
    bg: "rgba(59,130,246,0.08)",
    border: "rgba(59,130,246,0.2)",
    title: "Non-Custodial",
    description: "Your funds stay in your wallet until you bet",
  },
  {
    Icon: CheckCircle2,
    iconColor: "#a855f7",
    bg: "rgba(168,85,247,0.08)",
    border: "rgba(168,85,247,0.2)",
    title: "Transparent",
    description: "All markets and bets visible on-chain",
  },
  {
    Icon: Zap,
    iconColor: "#f59e0b",
    bg: "rgba(245,158,11,0.08)",
    border: "rgba(245,158,11,0.2)",
    title: "Instant",
    description: "Automatic payout when markets resolve",
  },
];

// ── Main component ────────────────────────────────────────────────────────────
export function SocialProof() {
  const { stats, isLoading: statsLoading } = useStats();

  const dash = "—";
  const platformStats = [
    {
      value: statsLoading ? dash : `${stats.totalVolume.toFixed(1)} ETH`,
      label: "Total Volume",
    },
    {
      value: statsLoading ? dash : String(stats.marketsOpen),
      label: "Open Markets",
    },
    {
      value: statsLoading ? dash : String(stats.uniqueBettors),
      label: "Unique Traders",
    },
    {
      value: statsLoading ? dash : `${stats.volume24h.toFixed(2)} ETH`,
      label: "Volume 24h",
    },
  ];

  return (
    <section
      aria-labelledby="social-proof-heading"
      style={{ background: "var(--background)", borderTop: "1px solid var(--border)" }}
    >
      <div className="max-w-7xl mx-auto px-4 py-16 md:py-24">

        {/* ── Partners ── */}
        <motion.div
          className="mb-16"
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4 }}
        >
          <p
            className="text-center text-xs font-bold tracking-widest mb-8"
            style={{ color: "var(--muted)", fontFamily: "monospace" }}
            aria-label="Powered by"
          >
            POWERED BY
          </p>
          <div className="flex flex-wrap justify-center gap-8 md:gap-12">
            {PARTNERS.map(({ Component, label }, i) => (
              <motion.div
                key={label}
                className="transition-all duration-200 cursor-default"
                style={{ color: "var(--muted)", filter: "grayscale(1) opacity(0.5)" }}
                whileHover={{
                  filter: "grayscale(0) opacity(1)",
                  scale: 1.05,
                }}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.3, delay: i * 0.08 }}
                aria-label={label}
                role="img"
              >
                <Component />
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* ── Section title ── */}
        <motion.div
          className="text-center mb-10"
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4 }}
        >
          <h2
            id="social-proof-heading"
            className="text-2xl md:text-3xl font-black mb-3"
            style={{ color: "var(--text)", fontFamily: "monospace" }}
          >
            Security You Can Trust
          </h2>
          <p
            className="text-sm"
            style={{ color: "var(--muted)", fontFamily: "monospace" }}
          >
            Built on battle-tested infrastructure, verified on-chain.
          </p>
        </motion.div>

        {/* ── Security badges grid ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
          {SECURITY_BADGES.map((badge, i) => (
            <motion.div
              key={badge.title}
              className="flex flex-col gap-3 p-5 rounded-xl"
              style={{
                background: badge.bg,
                border: `1px solid ${badge.border}`,
              }}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.08 }}
              whileHover={{ scale: 1.02 }}
            >
              <badge.Icon
                size={24}
                style={{ color: badge.iconColor }}
                aria-hidden="true"
              />
              <div>
                <h3
                  className="text-sm font-black mb-1"
                  style={{ color: "var(--text)", fontFamily: "monospace" }}
                >
                  {badge.title}
                </h3>
                <p
                  className="text-xs leading-relaxed"
                  style={{ color: "var(--muted)", fontFamily: "monospace" }}
                >
                  {badge.description}
                </p>
              </div>
            </motion.div>
          ))}
        </div>

        {/* ── Stats bar ── */}
        <motion.div
          className="rounded-xl p-6 md:p-8"
          style={{
            background: "linear-gradient(135deg, rgba(0,255,136,0.05) 0%, rgba(17,17,17,1) 60%, rgba(255,215,0,0.03) 100%)",
            border: "1px solid rgba(0,255,136,0.15)",
          }}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-4">
            {platformStats.map((stat, i) => (
              <motion.div
                key={stat.label}
                className="text-center"
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.35, delay: 0.25 + i * 0.07 }}
              >
                <div
                  className="text-2xl md:text-3xl font-black tabular mb-1"
                  style={{ color: "var(--primary)", fontFamily: "monospace" }}
                  aria-label={`${stat.value} ${stat.label}`}
                  aria-live="polite"
                >
                  {stat.value}
                </div>
                <div
                  className="text-xs"
                  style={{ color: "var(--muted)", fontFamily: "monospace" }}
                >
                  {stat.label}
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* ── Trust message ── */}
        <motion.div
          className="flex items-center justify-center gap-2 mt-8"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, delay: 0.4 }}
        >
          <Award size={16} style={{ color: "var(--primary)" }} aria-hidden="true" />
          <span
            className="text-xs font-semibold"
            style={{ color: "var(--muted)", fontFamily: "monospace" }}
          >
            Secured by Base chain smart contracts
          </span>
        </motion.div>

      </div>
    </section>
  );
}
