"use client";

import { motion, AnimatePresence } from "framer-motion";
import { ChevronUp, Zap } from "lucide-react";

interface QuickStakeProps {
  value: number;
  onChange: (value: number) => void;
  maxBalance: number;
  disabled?: boolean;
  expanded: boolean;
  onToggle: () => void;
}

const QUICK_AMOUNTS = [10, 25, 50, 100, 250, 500];

export function QuickStake({
  value,
  onChange,
  maxBalance,
  disabled,
  expanded,
  onToggle,
}: QuickStakeProps) {
  return (
    <div className="glass rounded-2xl overflow-hidden">
      {/* Collapsed View - Just shows current stake */}
      <motion.button
        onClick={onToggle}
        disabled={disabled}
        className="w-full px-4 py-3 flex items-center justify-between disabled:opacity-50"
        whileTap={{ scale: 0.98 }}
      >
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-accent-yellow" />
          <span className="text-text-secondary text-sm">Stake</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-text-primary font-bold">${value}</span>
          <motion.div
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <ChevronUp className="w-4 h-4 text-text-muted" />
          </motion.div>
        </div>
      </motion.button>

      {/* Expanded View - Amount selector */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-2 border-t border-white/10">
              <div className="grid grid-cols-3 gap-2">
                {QUICK_AMOUNTS.map((amount) => (
                  <motion.button
                    key={amount}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => {
                      onChange(amount);
                      onToggle();
                    }}
                    disabled={amount > maxBalance}
                    className={`py-3 rounded-xl font-bold text-sm transition-all ${
                      value === amount
                        ? "bg-primary-500 text-white"
                        : "bg-white/5 text-text-secondary hover:bg-white/10 disabled:opacity-30"
                    }`}
                  >
                    ${amount}
                  </motion.button>
                ))}
              </div>

              {/* Max button */}
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  onChange(Math.floor(maxBalance));
                  onToggle();
                }}
                className="w-full mt-2 py-2 rounded-xl bg-accent-purple/20 text-accent-purple font-semibold text-sm hover:bg-accent-purple/30"
              >
                MAX (${Math.floor(maxBalance).toLocaleString()})
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
