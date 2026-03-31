"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useMarkets } from "@/hooks/useMarkets";
import { MarketCard } from "@/components/market/MarketCard";
import { MarketCardSkeleton } from "@/components/ui/Skeleton";

/*
 * Usage:
 *   <FeaturedMarkets />
 *
 * Grid of 6 featured market cards with loading skeletons.
 * Shows "View all" button in header and mobile CTA at bottom.
 */

export function FeaturedMarkets() {
  const { markets, isLoading } = useMarkets({ sort: "most-volume" });
  const featuredMarkets = markets.slice(0, 6);

  return (
    <section
      aria-labelledby="featured-markets-heading"
      style={{ background: "#0d0d0d" }}
    >
      <div className="max-w-7xl mx-auto px-4 py-12 md:py-16">

        {/* ── Section header ── */}
        <motion.div
          className="flex items-center justify-between mb-8"
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4 }}
        >
          <div>
            <h2
              id="featured-markets-heading"
              className="text-2xl md:text-3xl font-black tracking-wider"
              style={{ color: "var(--text)", fontFamily: "monospace" }}
            >
              Featured Markets
            </h2>
            <p
              className="text-sm mt-1"
              style={{ color: "var(--muted)", fontFamily: "monospace" }}
            >
              Top markets by trading volume
            </p>
          </div>

          <Link
            href="/markets"
            className="hidden md:flex items-center gap-1.5 text-sm font-bold px-4 py-2 rounded-lg transition-all"
            style={{
              border: "1px solid rgba(0,255,136,0.3)",
              color: "var(--primary)",
              fontFamily: "monospace",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "rgba(0,255,136,0.1)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
            }}
          >
            View all
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </motion.div>

        {/* ── Market grid ── */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <MarketCardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {featuredMarkets.map((market, i) => (
              <motion.div
                key={market.id}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.07 }}
              >
                <MarketCard market={market} index={i} />
              </motion.div>
            ))}
          </div>
        )}

        {/* ── Mobile CTA ── */}
        <motion.div
          className="md:hidden mt-8"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, delay: 0.3 }}
        >
          <Link
            href="/markets"
            className="flex items-center justify-center gap-2 w-full py-3 rounded-lg text-sm font-bold transition-all"
            style={{
              background: "rgba(0,255,136,0.08)",
              border: "1px solid rgba(0,255,136,0.25)",
              color: "var(--primary)",
              fontFamily: "monospace",
            }}
          >
            View all markets
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </motion.div>

      </div>
    </section>
  );
}
