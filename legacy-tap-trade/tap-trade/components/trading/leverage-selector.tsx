"use client";

import { motion } from "framer-motion";
import { cn, getLeverageColor } from "@/lib/utils";
import { useHaptic } from "@/hooks/use-haptic";
import type { Leverage } from "@/types";

const LEVERAGES: Leverage[] = [10, 25, 50, 100];

interface LeverageSelectorProps {
  value: Leverage;
  onChange: (leverage: Leverage) => void;
  disabled?: boolean;
}

export function LeverageSelector({ value, onChange, disabled }: LeverageSelectorProps) {
  const { hapticTap } = useHaptic();

  const handleSelect = (leverage: Leverage) => {
    if (disabled) return;
    hapticTap();
    onChange(leverage);
  };

  return (
    <div className="flex gap-2">
      {LEVERAGES.map((leverage) => (
        <motion.button
          key={leverage}
          whileTap={{ scale: disabled ? 1 : 0.95 }}
          onClick={() => handleSelect(leverage)}
          disabled={disabled}
          className={cn(
            "flex-1 py-3 rounded-xl font-bold text-lg transition-all",
            value === leverage
              ? "bg-primary-500 text-white shadow-glow"
              : "bg-background-secondary text-text-secondary hover:bg-background-elevated hover:text-text-primary",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        >
          <span className={value === leverage ? "text-white" : getLeverageColor(leverage)}>
            {leverage}x
          </span>
        </motion.button>
      ))}
    </div>
  );
}
