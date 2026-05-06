"use client";

import { motion } from "framer-motion";
import { ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useHaptic } from "@/hooks/use-haptic";
import { useTrading } from "@/stores";
import type { Direction } from "@/types";

interface TapButtonsProps {
  onTap: (direction: Direction) => void;
  disabled?: boolean;
  isLoading?: boolean;
}

export function TapButtons({ onTap, disabled, isLoading }: TapButtonsProps) {
  const { hapticHeavy } = useHaptic();
  const { activePosition } = useTrading();

  const handleTap = (direction: Direction) => {
    if (disabled || isLoading || activePosition) return;
    hapticHeavy();
    onTap(direction);
  };

  const buttonDisabled = disabled || isLoading || !!activePosition;

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* LONG Button */}
      <motion.button
        whileTap={{ scale: buttonDisabled ? 1 : 0.95 }}
        whileHover={{ scale: buttonDisabled ? 1 : 1.02 }}
        onClick={() => handleTap("LONG")}
        disabled={buttonDisabled}
        className={cn(
          "tap-button bg-long text-white flex flex-col items-center justify-center gap-2",
          buttonDisabled && "opacity-50 cursor-not-allowed",
          !buttonDisabled && "hover:bg-long-dark shadow-glow"
        )}
      >
        <ArrowUp className="w-10 h-10" strokeWidth={3} />
        <span className="font-bold text-xl">LONG</span>
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20 rounded-3xl">
            <div className="w-8 h-8 border-4 border-white/30 border-t-white rounded-full animate-spin" />
          </div>
        )}
      </motion.button>

      {/* SHORT Button */}
      <motion.button
        whileTap={{ scale: buttonDisabled ? 1 : 0.95 }}
        whileHover={{ scale: buttonDisabled ? 1 : 1.02 }}
        onClick={() => handleTap("SHORT")}
        disabled={buttonDisabled}
        className={cn(
          "tap-button bg-short text-white flex flex-col items-center justify-center gap-2",
          buttonDisabled && "opacity-50 cursor-not-allowed",
          !buttonDisabled && "hover:bg-short-dark shadow-glow-red"
        )}
      >
        <ArrowDown className="w-10 h-10" strokeWidth={3} />
        <span className="font-bold text-xl">SHORT</span>
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20 rounded-3xl">
            <div className="w-8 h-8 border-4 border-white/30 border-t-white rounded-full animate-spin" />
          </div>
        )}
      </motion.button>
    </div>
  );
}
