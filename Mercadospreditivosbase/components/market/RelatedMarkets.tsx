"use client";

import Link from "next/link";
import { MOCK_MARKETS, formatVolume } from "@/lib/mock-data";
import type { Market } from "@/types/market";

interface RelatedMarketsProps {
  currentMarketId: string;
  category: Market["category"];
  limit?: number;
}

export default function RelatedMarkets({
  currentMarketId,
  category,
  limit = 3,
}: RelatedMarketsProps) {
  const related = MOCK_MARKETS.filter(
    (m) => m.id !== currentMarketId && m.category === category && m.status === "open"
  ).slice(0, limit);

  // Fall back to any open markets if not enough in same category
  const fallback =
    related.length < limit
      ? MOCK_MARKETS.filter(
          (m) =>
            m.id !== currentMarketId &&
            !related.find((r) => r.id === m.id) &&
            m.status === "open"
        ).slice(0, limit - related.length)
      : [];

  const markets = [...related, ...fallback];

  if (markets.length === 0) return null;

  return (
    <div>
      <h3
        className="text-sm font-bold mb-4"
        style={{ color: "var(--text)" }}
      >
        People are also trading
      </h3>

      <div className="flex flex-col" style={{ gap: 0 }}>
        {markets.map((market, idx) => {
          const topOutcome = market.outcomes[0];
          const prob = topOutcome?.probability ?? 0;

          return (
            <Link
              key={market.id}
              href={`/markets/${market.id}`}
              className="flex items-center gap-3 py-3 transition-colors group"
              style={{
                borderBottom:
                  idx < markets.length - 1
                    ? "1px solid var(--border)"
                    : undefined,
                textDecoration: "none",
              }}
              aria-label={`Related market: ${market.title}`}
            >
              {/* Icon */}
              <span
                className="text-2xl shrink-0 leading-none"
                aria-hidden="true"
              >
                {market.icon ?? "📊"}
              </span>

              {/* Title + meta */}
              <div className="flex-1 min-w-0">
                <p
                  className="text-sm font-medium leading-snug truncate group-hover:underline"
                  style={{ color: "var(--text)" }}
                >
                  {market.title}
                </p>
                <p
                  className="text-xs mt-0.5"
                  style={{ color: "var(--muted)" }}
                >
                  {formatVolume(market.totalPool)} vol
                </p>
              </div>

              {/* Probability pill */}
              <div className="shrink-0 text-right">
                <span
                  className="text-sm font-bold tabular"
                  style={{ color: "var(--primary)" }}
                >
                  {prob}%
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
