"use client";

import { UI_CONFIG } from "@/lib/ui-config";

interface TimeAxisProps {
  columns: number;
  cellWidth?: number;
  chartWidth?: number;
}

export function TimeAxis({
  columns,
  cellWidth = UI_CONFIG.grid.cellWidth,
  chartWidth = UI_CONFIG.chart.width,
}: TimeAxisProps) {
  const { colors, typography, timeAxis } = UI_CONFIG;

  // Generate time labels (mock times going forward)
  const now = new Date();
  const timeLabels = Array.from({ length: Math.ceil(columns / 3) }, (_, i) => {
    const time = new Date(now.getTime() + i * 15 * 60 * 1000); // Every 15 minutes
    return time.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  });

  return (
    <div
      className="flex items-center"
      style={{
        height: timeAxis.height,
        backgroundColor: colors.bgPrimary,
      }}
    >
      {/* Space for chart */}
      <div style={{ width: chartWidth }} />

      {/* Time labels */}
      <div className="flex-1 flex">
        {timeLabels.map((label, index) => (
          <div
            key={index}
            className="flex items-center justify-center"
            style={{
              width: cellWidth * 3,
            }}
          >
            <span
              style={{
                fontSize: typography.timeAxisSize,
                color: colors.textMuted,
                fontFamily: typography.fontFamily,
              }}
            >
              {label}
            </span>
          </div>
        ))}
      </div>

      {/* Space for price axis */}
      <div style={{ width: UI_CONFIG.priceAxis.width }} />
    </div>
  );
}
