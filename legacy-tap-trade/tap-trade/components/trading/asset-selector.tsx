"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Check } from "lucide-react";
import { cn, getAssetSymbol, getAssetColor, formatPrice } from "@/lib/utils";
import { useHaptic } from "@/hooks/use-haptic";
import { usePrices } from "@/stores";
import type { Asset } from "@/types";

const ASSETS: Asset[] = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

interface AssetSelectorProps {
  value: Asset;
  onChange: (asset: Asset) => void;
  disabled?: boolean;
}

export function AssetSelector({ value, onChange, disabled }: AssetSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { hapticTap } = useHaptic();
  const { prices } = usePrices();

  const handleSelect = (asset: Asset) => {
    if (disabled) return;
    hapticTap();
    onChange(asset);
    setIsOpen(false);
  };

  return (
    <div className="relative">
      <motion.button
        whileTap={{ scale: disabled ? 1 : 0.98 }}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={cn(
          "w-full flex items-center justify-between px-4 py-3 rounded-xl bg-background-secondary border border-border transition-all",
          isOpen && "border-primary-500 ring-2 ring-primary-500/20",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
            style={{ backgroundColor: getAssetColor(value) + "20", color: getAssetColor(value) }}
          >
            {getAssetSymbol(value).charAt(0)}
          </div>
          <div className="text-left">
            <p className="font-semibold text-text-primary">{getAssetSymbol(value)}</p>
            <p className="text-sm text-text-secondary">{formatPrice(prices[value] || 0)}</p>
          </div>
        </div>
        <ChevronDown
          className={cn(
            "w-5 h-5 text-text-muted transition-transform",
            isOpen && "rotate-180"
          )}
        />
      </motion.button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full left-0 right-0 mt-2 bg-background-elevated border border-border rounded-xl overflow-hidden z-50 shadow-lg"
          >
            {ASSETS.map((asset) => (
              <motion.button
                key={asset}
                whileHover={{ backgroundColor: "rgba(255,255,255,0.05)" }}
                onClick={() => handleSelect(asset)}
                className="w-full flex items-center justify-between px-4 py-3 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
                    style={{ backgroundColor: getAssetColor(asset) + "20", color: getAssetColor(asset) }}
                  >
                    {getAssetSymbol(asset).charAt(0)}
                  </div>
                  <div className="text-left">
                    <p className="font-semibold text-text-primary">{getAssetSymbol(asset)}</p>
                    <p className="text-sm text-text-secondary">{formatPrice(prices[asset] || 0)}</p>
                  </div>
                </div>
                {value === asset && (
                  <Check className="w-5 h-5 text-primary-500" />
                )}
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
