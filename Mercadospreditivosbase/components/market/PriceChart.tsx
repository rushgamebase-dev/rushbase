"use client";

import { useMemo } from "react";
import { generateMockPriceHistory } from "@/lib/mock-data";
import { InteractiveChart } from "@/components/market/InteractiveChart";
import type { ChartOutcome } from "@/components/market/InteractiveChart";

interface PriceChartProps {
  marketId: string;
}

export default function PriceChart({ marketId }: PriceChartProps) {
  const chartOutcomes: ChartOutcome[] = useMemo(() => {
    const history = generateMockPriceHistory(marketId);
    return [{
      id: "probability",
      name: "Probability",
      color: "#00ff88",
      data: history.map(p => ({ timestamp: p.timestamp, value: p.probability })),
    }];
  }, [marketId]);

  return (
    <div className="card p-4" role="region" aria-label="Probability history">
      <div className="flex items-center justify-between mb-4">
        <h2
          className="text-sm font-bold tracking-wider"
          style={{ color: "var(--text)", fontFamily: "monospace" }}
        >
          PROBABILITY HISTORY
        </h2>
      </div>

      <InteractiveChart
        outcomes={chartOutcomes}
        height={280}
        showTimeRange={true}
        showTooltip={true}
        defaultTimeRange="1M"
      />
    </div>
  );
}
