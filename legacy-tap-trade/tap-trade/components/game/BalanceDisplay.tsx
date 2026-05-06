"use client";

import { UI_CONFIG } from "@/lib/ui-config";
import { Wallet } from "lucide-react";

interface BalanceDisplayProps {
  balance: number;
  lockedBalance?: number;
}

export function BalanceDisplay({
  balance,
  lockedBalance = 0,
}: BalanceDisplayProps) {
  const { colors, typography } = UI_CONFIG;

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded"
      style={{
        backgroundColor: "rgba(0, 0, 0, 0.3)",
        border: `1px solid ${colors.gridLine}`,
      }}
    >
      <Wallet size={14} style={{ color: colors.textMuted }} />
      <span
        style={{
          fontSize: typography.balanceSize,
          fontWeight: 600,
          color: colors.textPrimary,
          fontFamily: typography.fontFamily,
        }}
      >
        ${balance.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </span>
    </div>
  );
}
