"use client";

/*
 * Usage:
 *   {isLoading && Array.from({ length: 6 }).map((_, i) => <MarketCardSkeleton key={i} />)}
 *
 * Mirrors the new MarketCard layout:
 *   header  — icon + title lines + badge
 *   prob    — big % block + sparkline placeholder (side by side)
 *   buttons — 2 buy button skeletons
 *   footer  — vol · traders · date
 */

export function MarketCardSkeleton() {
  return (
    <div
      className="flex flex-col p-4 rounded-xl pointer-events-none"
      style={{ background: "var(--surface)", border: "1px solid var(--border)", gap: "14px" }}
      aria-hidden="true"
    >
      {/* Header: icon + title lines + badge */}
      <div className="flex items-start gap-2.5">
        {/* Icon */}
        <div className="skeleton w-6 h-6 rounded shrink-0 mt-0.5" />

        {/* Title */}
        <div className="flex-1 flex flex-col gap-1.5 min-w-0">
          <div className="skeleton h-3.5 rounded w-full" />
          <div className="skeleton h-3.5 rounded w-4/5" />
        </div>

        {/* Badge */}
        <div className="skeleton h-4 w-10 rounded shrink-0 mt-0.5" />
      </div>

      {/* Probability + sparkline area */}
      <div className="flex items-center justify-between gap-3">
        {/* Big % + change */}
        <div className="flex flex-col gap-1.5">
          <div className="skeleton h-8 w-16 rounded" />
          <div className="skeleton h-3 w-12 rounded" />
        </div>

        {/* Sparkline placeholder */}
        <div
          className="skeleton shrink-0 rounded"
          style={{ width: "120px", height: "40px" }}
        />
      </div>

      {/* Buy buttons × 2 */}
      <div className="grid grid-cols-2 gap-2">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="skeleton rounded-lg"
            style={{ height: "40px" }}
          />
        ))}
      </div>

      {/* Footer: vol · traders · date */}
      <div className="flex items-center gap-1.5">
        <div className="skeleton h-3 w-16 rounded" />
        <div className="skeleton h-3 w-1 rounded opacity-40" />
        <div className="skeleton h-3 w-20 rounded" />
        <div className="skeleton h-3 w-1 rounded opacity-40" />
        <div className="skeleton h-3 w-14 rounded" />
      </div>
    </div>
  );
}
