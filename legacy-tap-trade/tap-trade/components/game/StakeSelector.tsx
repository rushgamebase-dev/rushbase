"use client";

import { useState } from "react";
import { UI_CONFIG } from "@/lib/ui-config";
import { Settings } from "lucide-react";

interface StakeSelectorProps {
  value: number;
  onChange: (value: number) => void;
  options?: number[];
}

const DEFAULT_STAKES = [1, 5, 10, 25, 50, 100];

export function StakeSelector({
  value,
  onChange,
  options = DEFAULT_STAKES,
}: StakeSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { colors, typography } = UI_CONFIG;

  return (
    <div className="relative">
      {/* Main button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded transition-colors"
        style={{
          backgroundColor: "rgba(255, 255, 255, 0.1)",
          border: `1px solid ${colors.gridLine}`,
        }}
      >
        <Settings size={14} style={{ color: colors.textMuted }} />
        <span
          style={{
            fontSize: typography.balanceSize,
            fontWeight: 600,
            color: colors.textPrimary,
            fontFamily: typography.fontFamily,
          }}
        >
          ${value}
        </span>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div
          className="absolute bottom-full right-0 mb-2 rounded overflow-hidden"
          style={{
            backgroundColor: colors.bgSecondary,
            border: `1px solid ${colors.gridLine}`,
            minWidth: 80,
          }}
        >
          {options.map((stake) => (
            <button
              key={stake}
              onClick={() => {
                onChange(stake);
                setIsOpen(false);
              }}
              className="w-full px-3 py-2 text-left transition-colors hover:bg-white/10"
              style={{
                backgroundColor: stake === value ? "rgba(255, 255, 255, 0.1)" : "transparent",
                borderBottom: `1px solid ${colors.gridLine}`,
              }}
            >
              <span
                style={{
                  fontSize: "13px",
                  fontWeight: stake === value ? 600 : 400,
                  color: colors.textPrimary,
                  fontFamily: typography.fontFamily,
                }}
              >
                ${stake}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
