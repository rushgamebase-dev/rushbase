"use client";

import { useState } from "react";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { MarketCard } from "@/components/market/MarketCard";
import { MarketCardSkeleton } from "@/components/market/MarketCardSkeleton";
import { MarketFilters } from "@/components/market/MarketFilters";
import { EmptyState } from "@/components/market/EmptyState";
import { useMarkets } from "@/hooks/useMarkets";
import { useMarketStream } from "@/hooks/useMarketStream";
import type { MarketCategory, MarketSort } from "@/types/market";

export default function MarketsPage() {
  const [category, setCategory] = useState<MarketCategory | "all">("all");
  const [sortBy, setSortBy] = useState<MarketSort>("newest");
  const [searchQuery, setSearchQuery] = useState("");

  // Fire-and-forget real-time subscription — invalidates queries on market events
  useMarketStream();

  const { markets, isLoading } = useMarkets({
    category,
    sort: sortBy,
    search: searchQuery,
  });

  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      <main className="max-w-7xl mx-auto px-4 py-8 w-full flex-1">
        {/* Page title */}
        <div className="mb-6">
          <h1 className="text-2xl font-black tracking-wider">MARKETS</h1>
          <p className="text-xs text-muted mt-1">On-chain prediction markets on Base</p>
        </div>

        {/* Filters */}
        <MarketFilters
          activeCategory={category}
          onCategoryChange={setCategory}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          sortBy={sortBy}
          onSortChange={setSortBy}
          totalCount={isLoading ? 0 : markets.length}
        />

        {/* Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mt-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <MarketCardSkeleton key={i} />
            ))}
          </div>
        ) : markets.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mt-6">
            {markets.map((market, i) => (
              <MarketCard key={market.id} market={market} index={i} />
            ))}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
