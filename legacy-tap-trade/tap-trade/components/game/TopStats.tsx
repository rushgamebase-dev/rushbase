"use client";

import { UI_CONFIG } from "@/lib/ui-config";
import { ChevronDown } from "lucide-react";

interface TopStatsProps {
  balance: number;
  currentPrice: number;
  symbol?: string;
  priceChange?: number;
}

export function TopStats({
  balance,
  currentPrice,
  symbol = "ETH",
  priceChange = 0,
}: TopStatsProps) {
  const { colors, typography } = UI_CONFIG;
  const isPositive = priceChange >= 0;

  return (
    <div
      className="flex items-center justify-between px-4 py-2"
      style={{
        backgroundColor: colors.bgPrimary,
        borderBottom: `1px solid ${colors.gridLine}`,
      }}
    >
      {/* Left: Current price with dropdown */}
      <div className="flex items-center gap-2">
        <div
          className="flex items-center gap-1 px-3 py-1.5 rounded cursor-pointer hover:bg-white/5"
          style={{
            backgroundColor: "rgba(255, 255, 255, 0.05)",
            border: `1px solid ${colors.gridLine}`,
          }}
        >
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: colors.positive }}
          />
          <span
            style={{
              fontSize: typography.currentPriceSize,
              fontWeight: 600,
              color: colors.textPrimary,
              fontFamily: typography.fontFamily,
            }}
          >
            ${currentPrice.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
          <ChevronDown
            size={14}
            style={{ color: colors.textMuted }}
          />
        </div>
      </div>

      {/* Right: Balance */}
      <div className="flex items-center gap-4">
        {priceChange !== 0 && (
          <span
            style={{
              fontSize: "13px",
              fontWeight: 500,
              color: isPositive ? colors.positive : colors.negative,
              fontFamily: typography.fontFamily,
            }}
          >
            {isPositive ? "+" : ""}{priceChange.toFixed(2)}%
          </span>
        )}
      </div>
    </div>
  );
}
