"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import TradingPanel from "@/components/market/TradingPanel";
import OutcomesList from "@/components/market/OutcomesList";
import LiveActivityFeed from "@/components/market/LiveActivityFeed";
import CollapsibleSection from "@/components/market/CollapsibleSection";
import RelatedMarkets from "@/components/market/RelatedMarkets";
import { InteractiveChart } from "@/components/market/InteractiveChart";
import type { ChartOutcome } from "@/components/market/InteractiveChart";
import LiveStreamOverlay from "@/components/market/LiveStreamOverlay";
import { useMarketDetail } from "@/hooks/useMarketDetail";
import { useMarketOdds } from "@/hooks/useMarketOdds";
import { generateMockPriceHistory, formatVolume, CATEGORIES } from "@/lib/mock-data";

// Outcome color palette (matches OutcomesList + chart)
const OUTCOME_COLORS = ["#00ff88", "#ff4444", "#ffd700", "#4488ff", "#aa44ff"];

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

/* ── Loading skeleton ─────────────────────────────────────────── */
function LoadingSkeleton() {
  return (
    <>
      <Header />
      <main
        className="max-w-7xl mx-auto px-4 py-6 min-h-screen"
        aria-busy="true"
        aria-label="Loading market..."
      >
        <div className="flex gap-6">
          {/* Left */}
          <div className="flex-1 min-w-0 flex flex-col gap-6">
            <div className="skeleton h-3 w-32 rounded" />
            <div>
              <div className="skeleton h-8 w-3/4 rounded mb-3" />
              <div className="skeleton h-4 w-full rounded mb-2" />
              <div className="skeleton h-4 w-2/3 rounded" />
            </div>
            <div className="card p-4">
              <div className="skeleton rounded" style={{ height: 400 }} />
            </div>
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton h-14 rounded-lg" />
              ))}
            </div>
          </div>
          {/* Right */}
          <div className="w-[340px] shrink-0 hidden lg:block">
            <div className="card p-5 flex flex-col gap-4">
              <div className="skeleton h-4 w-32 rounded" />
              <div className="skeleton h-12 rounded-lg" />
              <div className="skeleton h-12 rounded-lg" />
              <div className="skeleton h-12 rounded-full" />
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

/* ── Not-found state ──────────────────────────────────────────── */
function NotFound({ id }: { id: string }) {
  return (
    <>
      <Header />
      <main
        className="max-w-7xl mx-auto px-4 py-6 min-h-screen flex flex-col items-center justify-center gap-6"
        role="main"
        aria-label="Market not found"
      >
        <div className="text-center">
          <p className="text-6xl mb-4" aria-hidden="true">
            📭
          </p>
          <h1
            className="text-xl font-black tracking-wider mb-2"
            style={{ color: "var(--text)" }}
          >
            MARKET NOT FOUND
          </h1>
          <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>
            The market &ldquo;{id}&rdquo; does not exist or was removed.
          </p>
          <Link
            href="/markets"
            className="inline-flex items-center gap-2 text-xs font-bold tracking-wider px-4 py-2 rounded-lg transition-all"
            style={{
              background: "rgba(0,255,136,0.1)",
              border: "1px solid rgba(0,255,136,0.3)",
              color: "var(--primary)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "rgba(0,255,136,0.18)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "rgba(0,255,136,0.1)";
            }}
            aria-label="Back to markets list"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            VIEW ALL MARKETS
          </Link>
        </div>
      </main>
      <Footer />
    </>
  );
}

/* ── Main page ────────────────────────────────────────────────── */
export default function MarketDetailPage() {
  const params = useParams();
  const id =
    typeof params.id === "string"
      ? params.id
      : Array.isArray(params.id)
      ? params.id[0]
      : "";

  const { market, isLoading } = useMarketDetail(id);
  const { outcomes, flashingIds } = useMarketOdds(
    market?.address ?? null,
    market?.outcomes ?? []
  );

  const chartOutcomes: ChartOutcome[] = useMemo(() => {
    if (!market) return [];
    const history = generateMockPriceHistory(id);
    // One line per outcome using mock price history as baseline
    return outcomes.map((o, idx) => ({
      id: o.id,
      name: o.label,
      color: OUTCOME_COLORS[idx % OUTCOME_COLORS.length],
      data: history.map((p, i) => ({
        timestamp: p.timestamp,
        // Stagger lines so multi-outcome markets don't overlap
        value: Math.max(
          2,
          Math.min(98, p.probability + (idx === 0 ? 0 : -(idx * 12) + Math.sin(i / 8) * 5))
        ),
      })),
    }));
  }, [market, id, outcomes]);

  if (isLoading) return <LoadingSkeleton />;
  if (!market) return <NotFound id={id} />;

  const category = CATEGORIES[market.category];

  return (
    <>
      <Header />
      <main
        className="max-w-7xl mx-auto px-4 py-6 min-h-screen"
        role="main"
        aria-label={`Market: ${market.title}`}
      >
        <div className="flex gap-6 items-start">

          {/* ── LEFT: main content ──────────────────────────────── */}
          <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 24 }}>

            {/* Breadcrumb */}
            <nav
              className="flex items-center gap-1.5 text-xs"
              style={{ color: "var(--muted)" }}
              aria-label="Breadcrumb"
            >
              <Link
                href="/markets"
                style={{ color: "var(--muted)", textDecoration: "none" }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--text)")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--muted)")}
              >
                Markets
              </Link>
              <span aria-hidden="true">›</span>
              <span>{category.label}</span>
            </nav>

            {/* Market header: icon + title + action buttons */}
            <div className="flex items-start gap-4">
              {market.icon && (
                <span
                  className="text-4xl shrink-0 leading-none"
                  aria-hidden="true"
                  style={{ marginTop: 2 }}
                >
                  {market.icon}
                </span>
              )}
              <div className="flex-1 min-w-0">
                <h1
                  className="text-xl md:text-2xl font-black leading-snug"
                  style={{ color: "var(--text)" }}
                >
                  {market.title}
                </h1>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => {
                    if (navigator?.share) {
                      navigator.share({ title: market.title, url: window.location.href });
                    } else {
                      navigator.clipboard.writeText(window.location.href);
                    }
                  }}
                  className="flex items-center justify-center rounded-lg transition-colors"
                  style={{
                    width: 34,
                    height: 34,
                    border: "1px solid var(--border)",
                    background: "var(--surface)",
                    color: "var(--muted)",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.color = "var(--text)";
                    (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,255,136,0.3)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.color = "var(--muted)";
                    (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
                  }}
                  aria-label="Share market"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="18" cy="5" r="3" />
                    <circle cx="6" cy="12" r="3" />
                    <circle cx="18" cy="19" r="3" />
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                  </svg>
                </button>

                <button
                  className="flex items-center justify-center rounded-lg transition-colors"
                  style={{
                    width: 34,
                    height: 34,
                    border: "1px solid var(--border)",
                    background: "var(--surface)",
                    color: "var(--muted)",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.color = "var(--text)";
                    (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,255,136,0.3)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.color = "var(--muted)";
                    (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
                  }}
                  aria-label="Bookmark market"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Outcome legend: colored dots + name + % */}
            {outcomes.length > 0 && (
              <div className="flex flex-wrap items-center gap-4" role="list" aria-label="Outcome probabilities">
                {outcomes.map((o, idx) => (
                  <div
                    key={o.id}
                    className="flex items-center gap-1.5"
                    role="listitem"
                  >
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        background: OUTCOME_COLORS[idx % OUTCOME_COLORS.length],
                        display: "inline-block",
                        flexShrink: 0,
                      }}
                      aria-hidden="true"
                    />
                    <span className="text-sm" style={{ color: "var(--muted)" }}>
                      {o.label}
                    </span>
                    <span
                      className="text-sm font-bold tabular"
                      style={{ color: OUTCOME_COLORS[idx % OUTCOME_COLORS.length] }}
                    >
                      {o.probability}%
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Live Stream + Detection Overlay */}
            <div className="card p-0 overflow-hidden" role="region" aria-label="Live vehicle detection stream">
              <LiveStreamOverlay
                wsUrl={typeof window !== "undefined"
                  ? new URLSearchParams(window.location.search).get("ws") || process.env.NEXT_PUBLIC_ORACLE_WS_URL || `ws://${window.location.hostname}:9000`
                  : "ws://localhost:9000"}
                threshold={50}
                videoUid={typeof window !== "undefined"
                  ? new URLSearchParams(window.location.search).get("video") || ""
                  : ""}
              />
            </div>

            {/* Chart — full width, 400px tall */}
            <div
              className="card p-4"
              role="region"
              aria-label="Probability chart"
            >
              <InteractiveChart
                outcomes={chartOutcomes}
                height={400}
                showTimeRange={true}
                showTooltip={true}
                defaultTimeRange="1M"
              />
            </div>

            {/* Volume + time meta row */}
            <div className="flex items-center justify-between text-xs" style={{ color: "var(--muted)" }}>
              <div className="flex items-center gap-4">
                <span>
                  <strong style={{ color: "var(--text)" }}>
                    {formatVolume(market.totalPool)}
                  </strong>{" "}
                  vol
                </span>
                <span>
                  Closes{" "}
                  <strong style={{ color: market.status === "open" && market.closeDate.getTime() - Date.now() < 3600000 ? "var(--danger)" : "var(--text)" }}>
                    {timeRemaining(market.closeDate)}
                  </strong>
                </span>
                {market.isHot && (
                  <span
                    className="text-xs font-bold px-2 py-0.5 rounded hot-badge"
                    aria-label="Hot market"
                  >
                    HOT
                  </span>
                )}
              </div>
            </div>

            {/* Outcomes list — Kalshi rows with Yes/No buttons */}
            <div>
              <OutcomesList
                outcomes={outcomes}
                flashingIds={flashingIds}
                marketIcon={market.icon}
              />
            </div>

            {/* Rules section */}
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 24 }}>
              <p className="text-sm leading-relaxed mb-3" style={{ color: "var(--muted)" }}>
                {market.description}
              </p>
              {market.resolutionSource && (
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  Resolution source:{" "}
                  <span style={{ color: "var(--text)" }}>{market.resolutionSource}</span>
                </p>
              )}
            </div>

            {/* Collapsible sections */}
            <div>
              <CollapsibleSection title="Timeline and Payout">
                <div className="flex flex-col gap-2 text-sm">
                  <div className="flex justify-between">
                    <span>Close date</span>
                    <span style={{ color: "var(--text)" }}>
                      {market.closeDate.toLocaleDateString("en-US", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Resolution date</span>
                    <span style={{ color: "var(--text)" }}>
                      {market.resolutionDate.toLocaleDateString("en-US", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Created</span>
                    <span style={{ color: "var(--text)" }}>
                      {market.createdAt.toLocaleDateString("en-US", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </span>
                  </div>
                  <p className="text-xs mt-2" style={{ color: "var(--muted)" }}>
                    Winners receive a payout proportional to their share of the winning pool after
                    the market resolves. All bets are settled on-chain.
                  </p>
                </div>
              </CollapsibleSection>

              <CollapsibleSection title="Market Rules">
                <p className="text-sm">
                  {market.description}
                </p>
                <p className="text-xs mt-3" style={{ color: "var(--muted)" }}>
                  Resolution source: {market.resolutionSource}
                </p>
              </CollapsibleSection>

              <CollapsibleSection title="Trading Prohibitions">
                <p className="text-sm">
                  Manipulation, coordinated trading to influence outcomes, and trading with
                  privileged non-public information are strictly prohibited. Accounts engaging in
                  such activity may have positions cancelled.
                </p>
              </CollapsibleSection>
            </div>

            {/* Activity feed */}
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
              <LiveActivityFeed marketId={id} />
            </div>

            {/* Related markets */}
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 24 }}>
              <RelatedMarkets
                currentMarketId={id}
                category={market.category}
                limit={3}
              />
            </div>
          </div>

          {/* ── RIGHT: sticky trading sidebar ───────────────────── */}
          <div className="w-[340px] shrink-0 hidden lg:block" style={{ alignSelf: "flex-start" }}>
            <div className="sticky" style={{ top: 80 }}>
              <TradingPanel
                market={market}
                outcomes={outcomes}
                flashingIds={flashingIds}
              />
            </div>
          </div>
        </div>

        {/* Mobile: trading panel at bottom */}
        <div
          className="lg:hidden fixed bottom-0 left-0 right-0 z-40 p-4"
          style={{
            background: "rgba(10,10,10,0.97)",
            borderTop: "1px solid var(--border)",
            backdropFilter: "blur(12px)",
          }}
        >
          <TradingPanel
            market={market}
            outcomes={outcomes}
            flashingIds={flashingIds}
          />
        </div>

        {/* Mobile bottom padding so content isn't hidden behind fixed panel */}
        <div className="lg:hidden" style={{ height: 280 }} aria-hidden="true" />
      </main>
      <Footer />
    </>
  );
}
