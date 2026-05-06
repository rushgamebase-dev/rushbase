"use client";

import { UI_CONFIG } from "@/lib/ui-config";

interface PriceAxisProps {
  priceLevels: number[];
  currentPrice: number;
  cellHeight?: number;
}

export function PriceAxis({
  priceLevels,
  currentPrice,
  cellHeight = UI_CONFIG.grid.cellHeight,
}: PriceAxisProps) {
  const { colors, typography, priceAxis } = UI_CONFIG;

  return (
    <div
      className="flex flex-col"
      style={{
        width: priceAxis.width,
        backgroundColor: colors.bgPrimary,
      }}
    >
      {priceLevels.map((price, index) => {
        const isCurrentPrice = Math.abs(price - currentPrice) < 0.5;

        return (
          <div
            key={index}
            className="flex items-center justify-end pr-2 relative"
            style={{
              height: cellHeight,
              borderBottom: `1px solid ${colors.gridLine}`,
            }}
          >
            {/* Price tag highlight for current price */}
            {isCurrentPrice && (
              <div
                className="absolute inset-y-0 right-0 flex items-center"
                style={{
                  backgroundColor: colors.priceTag,
                  padding: "0 8px",
                  marginRight: 0,
                }}
              >
                <span
                  style={{
                    fontSize: typography.priceAxisSize,
                    fontWeight: 600,
                    color: colors.priceTagText,
                    fontFamily: typography.fontFamily,
                  }}
                >
                  ${price.toFixed(1)}
                </span>
              </div>
            )}

            {/* Regular price label */}
            {!isCurrentPrice && (
              <span
                style={{
                  fontSize: typography.priceAxisSize,
                  color: colors.textSecondary,
                  fontFamily: typography.fontFamily,
                }}
              >
                ${price.toFixed(1)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
