"use client";

import { motion } from "framer-motion";
import { Zap, Shield, Globe } from "lucide-react";

/*
 * Usage:
 *   <WhyRush />
 *
 * Feature highlights section: 3 cards + decorative glow orb.
 */

const FEATURES = [
  {
    Icon: Zap,
    iconBg: "linear-gradient(135deg, rgba(0,255,136,0.25), rgba(0,255,136,0.05))",
    iconColor: "var(--primary)",
    title: "Lightning Fast",
    description:
      "Markets resolve in minutes, not days. Real-time odds update with every bet placed on the platform.",
    highlight: "var(--primary)",
  },
  {
    Icon: Shield,
    iconBg: "linear-gradient(135deg, rgba(68,136,255,0.25), rgba(68,136,255,0.05))",
    iconColor: "#4488ff",
    title: "Trustless & Fair",
    description:
      "No house edge. Pari-mutuel pool distribution. Every transaction verified on Base chain — code is law.",
    highlight: "#4488ff",
  },
  {
    Icon: Globe,
    iconBg: "linear-gradient(135deg, rgba(255,215,0,0.25), rgba(255,215,0,0.05))",
    iconColor: "var(--gold)",
    title: "Base Native",
    description:
      "Built for the Base ecosystem. Markets focused on Base chain events, culture, and community growth.",
    highlight: "var(--gold)",
  },
];

export function WhyRush() {
  return (
    <section
      aria-labelledby="why-rush-heading"
      style={{ background: "#0d0d0d" }}
    >
      <div className="max-w-7xl mx-auto px-4 py-16 md:py-24">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">

          {/* ── LEFT: Text + feature cards ── */}
          <div>
            {/* Title */}
            <motion.div
              className="mb-10"
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4 }}
            >
              <h2
                id="why-rush-heading"
                className="text-3xl md:text-4xl font-black mb-4 leading-tight"
                style={{ fontFamily: "monospace" }}
              >
                <span style={{ color: "var(--text)" }}>Why </span>
                <span style={{ color: "var(--primary)" }}>Rush Markets</span>
                <span style={{ color: "var(--text)" }}>?</span>
              </h2>
              <p
                className="text-sm md:text-base leading-relaxed"
                style={{ color: "var(--muted)", fontFamily: "monospace" }}
              >
                Prediction markets built for the Base ecosystem. Fair, fast, and fully on-chain.
              </p>
            </motion.div>

            {/* Feature list */}
            <div className="flex flex-col gap-5">
              {FEATURES.map((feature, i) => (
                <motion.div
                  key={feature.title}
                  className="flex items-start gap-4 p-5 rounded-xl"
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                  }}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: i * 0.12 }}
                  whileHover={{
                    borderColor: `${feature.highlight}33`,
                    boxShadow: `0 4px 24px ${feature.highlight}10`,
                  }}
                >
                  {/* Icon */}
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: feature.iconBg }}
                    aria-hidden="true"
                  >
                    <feature.Icon size={22} style={{ color: feature.iconColor }} />
                  </div>

                  {/* Text */}
                  <div>
                    <h3
                      className="text-base font-black mb-1.5"
                      style={{ color: "var(--text)", fontFamily: "monospace" }}
                    >
                      {feature.title}
                    </h3>
                    <p
                      className="text-xs leading-relaxed"
                      style={{ color: "var(--muted)", fontFamily: "monospace" }}
                    >
                      {feature.description}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          {/* ── RIGHT: Mascot with glow backdrop ── */}
          <motion.div
            className="relative flex items-center justify-center"
            style={{ minHeight: 360 }}
            initial={{ opacity: 0, scale: 0.85 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            {/* Outer glow */}
            <div
              className="absolute rounded-full blur-3xl"
              style={{
                width: 320,
                height: 320,
                background: "radial-gradient(circle, rgba(0,255,136,0.12) 0%, rgba(255,215,0,0.06) 50%, transparent 80%)",
              }}
              aria-hidden="true"
            />

            {/* Middle ring */}
            <motion.div
              className="absolute rounded-full"
              style={{
                width: 280,
                height: 280,
                border: "1px solid rgba(0,255,136,0.12)",
              }}
              animate={{ rotate: 360 }}
              transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
              aria-hidden="true"
            />

            {/* Inner ring */}
            <motion.div
              className="absolute rounded-full"
              style={{
                width: 200,
                height: 200,
                border: "1px solid rgba(255,215,0,0.12)",
              }}
              animate={{ rotate: -360 }}
              transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
              aria-hidden="true"
            />

            {/* Mascot */}
            <img
              src="/mascot/confident.gif"
              alt="Rush Mascot"
              className="w-64 h-auto drop-shadow-2xl relative z-10"
              style={{ filter: "drop-shadow(0 0 24px rgba(0,255,136,0.3))" }}
            />

            {/* Orbiting dots */}
            {[0, 60, 120, 180, 240, 300].map((deg, i) => (
              <motion.div
                key={i}
                className="absolute w-2 h-2 rounded-full"
                style={{
                  background: i % 2 === 0 ? "var(--primary)" : "var(--gold)",
                  boxShadow: `0 0 6px ${i % 2 === 0 ? "rgba(0,255,136,0.8)" : "rgba(255,215,0,0.8)"}`,
                  top: `calc(50% + ${Math.sin((deg * Math.PI) / 180) * 110}px)`,
                  left: `calc(50% + ${Math.cos((deg * Math.PI) / 180) * 110}px)`,
                  transform: "translate(-50%, -50%)",
                  opacity: 0.6,
                }}
                animate={{
                  opacity: [0.3, 0.9, 0.3],
                  scale: [0.8, 1.2, 0.8],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  delay: i * 0.3,
                }}
                aria-hidden="true"
              />
            ))}
          </motion.div>

        </div>
      </div>
    </section>
  );
}
