"use client";

import { formatVolume } from "@/lib/mock-data";
import type { Market } from "@/types/market";

interface MarketStatsProps {
  market: Market;
}

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

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function MarketStats({ market }: MarketStatsProps) {
  const ethTotal = Number(market.totalPool) / 1e18;
  const estimatedBettors = Math.max(1, Math.floor(ethTotal * 15 + 5));
  const avgBet = ethTotal / estimatedBettors;

  const stats = [
    {
      label: "Total Volume",
      value: formatVolume(market.totalPool),
    },
    {
      label: "Traders",
      value: `~${estimatedBettors}`,
    },
    {
      label: "Avg Bet",
      value: avgBet < 0.001 ? `${(avgBet * 1000).toFixed(3)} mETH` : `${avgBet.toFixed(4)} ETH`,
    },
    {
      label: "Closes in",
      value: timeRemaining(market.closeDate),
      highlight: market.status === "open" && market.closeDate.getTime() - Date.now() < 3600000,
    },
    {
      label: "Source",
      value: market.resolutionSource,
      truncate: true,
    },
    {
      label: "Created",
      value: formatDate(market.createdAt),
    },
  ];

  return (
    <dl
      className="grid grid-cols-2 md:grid-cols-4 gap-3"
      aria-label="Market statistics"
    >
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="card p-4"
          style={{ background: "#0d0d0d" }}
        >
          <dt
            className="text-xs uppercase tracking-wider mb-1"
            style={{ color: "var(--muted)", fontFamily: "monospace" }}
          >
            {stat.label}
          </dt>
          <dd
            className={`text-sm font-bold num ${stat.truncate ? "truncate" : ""}`}
            style={{
              color: stat.highlight ? "var(--danger)" : "var(--primary)",
              fontFamily: "monospace",
            }}
            title={stat.truncate ? stat.value : undefined}
          >
            {stat.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
