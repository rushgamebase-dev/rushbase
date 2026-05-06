"use client";

import { motion } from "framer-motion";
import { DollarSign } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { useHaptic } from "@/hooks/use-haptic";
import { useBalance } from "@/stores";

const QUICK_AMOUNTS = [25, 50, 100, 250];

interface StakeInputProps {
  value: number;
  onChange: (amount: number) => void;
  disabled?: boolean;
}

export function StakeInput({ value, onChange, disabled }: StakeInputProps) {
  const { hapticTap } = useHaptic();
  const { balance } = useBalance();

  const handleQuickAmount = (amount: number) => {
    if (disabled) return;
    hapticTap();
    onChange(amount);
  };

  const handleMax = () => {
    if (disabled) return;
    hapticTap();
    onChange(Math.floor(balance.availableBalance));
  };

  return (
    <div className="space-y-3">
      {/* Input */}
      <div className="relative">
        <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted" />
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          disabled={disabled}
          min={0}
          max={balance.availableBalance}
          className={cn(
            "w-full rounded-xl bg-background-secondary border border-border pl-10 pr-4 py-4 text-xl font-bold text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all",
            disabled && "opacity-50 cursor-not-allowed"
          )}
          placeholder="Enter stake"
        />
      </div>

      {/* Quick amounts */}
      <div className="flex gap-2">
        {QUICK_AMOUNTS.map((amount) => (
          <motion.button
            key={amount}
            whileTap={{ scale: disabled ? 1 : 0.95 }}
            onClick={() => handleQuickAmount(amount)}
            disabled={disabled || amount > balance.availableBalance}
            className={cn(
              "flex-1 py-2 rounded-lg font-semibold transition-all text-sm",
              value === amount
                ? "bg-primary-500 text-white"
                : "bg-background-secondary text-text-secondary hover:bg-background-elevated",
              (disabled || amount > balance.availableBalance) && "opacity-50 cursor-not-allowed"
            )}
          >
            ${amount}
          </motion.button>
        ))}
        <motion.button
          whileTap={{ scale: disabled ? 1 : 0.95 }}
          onClick={handleMax}
          disabled={disabled}
          className={cn(
            "flex-1 py-2 rounded-lg font-semibold transition-all text-sm bg-accent-purple/20 text-accent-purple hover:bg-accent-purple/30",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        >
          MAX
        </motion.button>
      </div>

      {/* Available balance */}
      <p className="text-sm text-text-secondary text-center">
        Available: <span className="text-text-primary font-medium">{formatCurrency(balance.availableBalance)}</span>
      </p>
    </div>
  );
}
