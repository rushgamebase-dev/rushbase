"use client";
import { SearchX } from "lucide-react";

/*
 * Usage:
 *   {markets.length === 0 && !isLoading && <EmptyState />}
 */

export function EmptyState() {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 py-16 text-center"
      role="status"
      aria-live="polite"
    >
      <SearchX
        size={40}
        className="text-muted opacity-50"
        aria-hidden="true"
        strokeWidth={1.5}
      />
      <p className="text-base font-semibold text-text-color">
        No markets found
      </p>
      <p className="text-sm text-muted max-w-xs">
        Try changing your filters
      </p>
    </div>
  );
}
