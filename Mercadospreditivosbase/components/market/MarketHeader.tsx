"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/animations";
import { Badge } from "@/components/ui/Badge";
import { formatVolume } from "@/lib/mock-data";
import { CATEGORIES } from "@/lib/mock-data";
import type { Market } from "@/types/market";

interface MarketHeaderProps {
  market: Market;
}

const STATUS_LABELS: Record<string, string> = {
  open: "OPEN",
  locked: "LOCKED",
  resolved: "RESOLVED",
  cancelled: "CANCELLED",
};

function timeRemaining(closeDate: Date): string {
  const diff = closeDate.getTime() - Date.now();
  if (diff <= 0) return "Ended";
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  if (days > 0) return `${days}d ${hours}h`;
  const mins = Math.floor((diff % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export default function MarketHeader({ market }: MarketHeaderProps) {
  const category = CATEGORIES[market.category];
  const estimatedBettors = Math.floor(Number(market.totalPool) / 1e18 * 15 + 5);

  return (
    <motion.div
      className="card p-5"
      {...fadeInUp}
    >
      {/* Back link */}
      <Link
        href="/markets"
        className="inline-flex items-center gap-1.5 text-xs mb-4 transition-colors"
        style={{ color: "var(--muted)", fontFamily: "monospace" }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--text)")}
        onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--muted)")}
        aria-label="Back to markets list"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Markets
      </Link>

      {/* Icon + Title row */}
      <div className="flex items-start gap-3 mb-3">
        {market.icon && (
          <span className="text-4xl shrink-0 leading-none" aria-hidden="true">
            {market.icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <Badge variant="category">{category.label}</Badge>
            <Badge variant="status" data-status={market.status}>
              {STATUS_LABELS[market.status] ?? market.status.toUpperCase()}
            </Badge>
            {market.isHot && (
              <Badge variant="hot">HOT</Badge>
            )}
          </div>
          <h1 className="text-xl md:text-2xl font-black leading-snug" style={{ color: "var(--text)" }}>
            {market.title}
          </h1>
        </div>
      </div>

      {/* Description */}
      <p className="text-sm mb-4" style={{ color: "var(--muted)", lineHeight: 1.6 }}>
        {market.description}
      </p>

      {/* Meta row */}
      <div
        className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-3"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <MetaItem label="Volume" value={formatVolume(market.totalPool)} />
        <MetaItem label="Traders" value={`~${estimatedBettors}`} />
        <MetaItem
          label="Closes in"
          value={timeRemaining(market.closeDate)}
          highlight={market.status === "open" && market.closeDate.getTime() - Date.now() < 3600000}
        />
        <MetaItem label="Source" value={market.resolutionSource} truncate />
      </div>
    </motion.div>
  );
}

function MetaItem({
  label,
  value,
  highlight = false,
  truncate = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  truncate?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className="text-xs uppercase tracking-wider"
        style={{ color: "var(--muted)", fontFamily: "monospace" }}
      >
        {label}
      </span>
      <span
        className={`text-xs font-semibold tabular ${truncate ? "max-w-[160px] truncate" : ""}`}
        style={{
          color: highlight ? "var(--danger)" : "var(--text)",
          fontFamily: "monospace",
        }}
        title={truncate ? value : undefined}
      >
        {value}
      </span>
    </div>
  );
}
