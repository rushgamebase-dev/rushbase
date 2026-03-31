"use client";
import { useState, useRef, useEffect } from "react";
import { Search, ChevronDown, Check } from "lucide-react";
import { CATEGORIES } from "@/lib/mock-data";
import type { MarketCategory, MarketSort } from "@/types/market";

/*
 * Usage:
 *   <MarketFilters
 *     activeCategory="all"
 *     onCategoryChange={setCategory}
 *     searchQuery={search}
 *     onSearchChange={setSearch}
 *     sortBy="newest"
 *     onSortChange={setSort}
 *     totalCount={markets.length}
 *   />
 */

interface MarketFiltersProps {
  activeCategory: MarketCategory | "all";
  onCategoryChange: (cat: MarketCategory | "all") => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  sortBy: MarketSort;
  onSortChange: (sort: MarketSort) => void;
  totalCount: number;
}

const SORT_OPTIONS: { value: MarketSort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "ending-soon", label: "Ending Soon" },
  { value: "most-volume", label: "Highest Volume" },
  { value: "most-bets", label: "Most Bets" },
];

const CATEGORY_KEYS = Object.keys(CATEGORIES) as (MarketCategory | "all")[];

export function MarketFilters({
  activeCategory,
  onCategoryChange,
  searchQuery,
  onSearchChange,
  sortBy,
  onSortChange,
  totalCount,
}: MarketFiltersProps) {
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setSortOpen(false);
      }
    }
    if (sortOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [sortOpen]);

  const currentSortLabel =
    SORT_OPTIONS.find((o) => o.value === sortBy)?.label ?? "Newest";

  return (
    <div className="flex flex-col gap-3">
      {/* Category tabs */}
      <div
        className="flex flex-wrap gap-1.5"
        role="tablist"
        aria-label="Filter by category"
      >
        {CATEGORY_KEYS.map((key) => {
          const meta = CATEGORIES[key];
          const isActive = activeCategory === key;
          return (
            <button
              key={key}
              role="tab"
              aria-selected={isActive}
              onClick={() => onCategoryChange(key)}
              className={[
                "flex items-center gap-1.5 text-xs uppercase tracking-wider px-3 py-1.5 rounded-md font-semibold transition-colors duration-150",
                isActive
                  ? "bg-primary text-black"
                  : "bg-surface text-muted hover:text-text-color border border-border-color",
              ].join(" ")}
            >
              <span aria-hidden="true">{meta.icon}</span>
              {meta.label}
            </button>
          );
        })}
      </div>

      {/* Search + Sort + Count row */}
      <div className="flex items-center gap-2">
        {/* Search input */}
        <div className="relative flex-1">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search markets..."
            aria-label="Search markets"
            className="input-base w-full pl-8 text-sm"
          />
        </div>

        {/* Sort dropdown */}
        <div className="relative shrink-0" ref={sortRef}>
          <button
            onClick={() => setSortOpen((prev) => !prev)}
            aria-haspopup="listbox"
            aria-expanded={sortOpen}
            aria-label="Sort markets"
            className="flex items-center gap-1.5 input-base text-sm px-3 whitespace-nowrap"
          >
            {currentSortLabel}
            <ChevronDown
              size={13}
              className={`transition-transform duration-150 ${sortOpen ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </button>

          {sortOpen && (
            <ul
              role="listbox"
              aria-label="Sort options"
              className="absolute right-0 top-full mt-1 z-50 min-w-[160px] rounded-xl border border-border-color bg-surface shadow-lg overflow-hidden"
            >
              {SORT_OPTIONS.map((option) => {
                const isSelected = sortBy === option.value;
                return (
                  <li key={option.value} role="option" aria-selected={isSelected}>
                    <button
                      onClick={() => {
                        onSortChange(option.value);
                        setSortOpen(false);
                      }}
                      className={[
                        "w-full flex items-center justify-between gap-3 px-4 py-2.5 text-sm text-left transition-colors duration-100",
                        isSelected
                          ? "text-primary bg-primary/10"
                          : "text-text-color hover:bg-white/5",
                      ].join(" ")}
                    >
                      {option.label}
                      {isSelected && (
                        <Check size={13} className="text-primary shrink-0" aria-hidden="true" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Results count */}
      <p className="text-xs text-muted" aria-live="polite" aria-atomic="true">
        {totalCount} {totalCount === 1 ? "market" : "markets"}
      </p>
    </div>
  );
}
