"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { DollarSign, Minus, Plus, Zap, Sparkles } from "lucide-react";
import { useHaptic } from "@/hooks/use-haptic";

// =============================================================================
// ENHANCED STAKE SELECTOR - Quick Buttons + Slider + Presets
// =============================================================================

interface StakeSelectorProps {
  value: number;
  onChange: (amount: number) => void;
  balance: number;
  disabled?: boolean;
  minStake?: number;
  maxStake?: number;
  className?: string;
}

const QUICK_AMOUNTS = [1, 5, 10, 25, 50, 100];

export function StakeSelector({
  value,
  onChange,
  balance,
  disabled = false,
  minStake = 1,
  maxStake = 1000,
  className = "",
}: StakeSelectorProps) {
  const { hapticTap } = useHaptic();
  const [showAdvanced, setShowAdvanced] = useState(false);

  const effectiveMax = Math.min(maxStake, balance);

  const handleQuickAmount = useCallback((amount: number) => {
    if (disabled || amount > balance) return;
    hapticTap();
    onChange(amount);
  }, [disabled, balance, hapticTap, onChange]);

  const handleIncrement = useCallback((delta: number) => {
    if (disabled) return;
    hapticTap();
    const newValue = Math.max(minStake, Math.min(effectiveMax, value + delta));
    onChange(newValue);
  }, [disabled, minStake, effectiveMax, value, hapticTap, onChange]);

  const handleSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    onChange(Number(e.target.value));
  }, [disabled, onChange]);

  const handleMax = useCallback(() => {
    if (disabled) return;
    hapticTap();
    onChange(Math.floor(balance));
  }, [disabled, balance, hapticTap, onChange]);

  const handleDouble = useCallback(() => {
    if (disabled) return;
    hapticTap();
    const doubled = Math.min(value * 2, effectiveMax);
    onChange(doubled);
  }, [disabled, value, effectiveMax, hapticTap, onChange]);

  const handleHalf = useCallback(() => {
    if (disabled) return;
    hapticTap();
    const halved = Math.max(value / 2, minStake);
    onChange(Math.floor(halved));
  }, [disabled, value, minStake, hapticTap, onChange]);

  // Calculate percentage of balance
  const balancePercentage = balance > 0 ? (value / balance) * 100 : 0;

  // Risk level indicator
  const getRiskLevel = () => {
    if (balancePercentage > 50) return { text: "HIGH RISK", color: "text-red-400", bg: "bg-red-500/20" };
    if (balancePercentage > 25) return { text: "MEDIUM", color: "text-yellow-400", bg: "bg-yellow-500/20" };
    return { text: "SAFE", color: "text-green-400", bg: "bg-green-500/20" };
  };

  const risk = getRiskLevel();

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Main stake input with +/- buttons */}
      <div className="flex items-center gap-2">
        {/* Minus button */}
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={() => handleIncrement(-5)}
          disabled={disabled || value <= minStake}
          className="w-10 h-10 rounded-xl bg-gray-800 border border-gray-700 flex items-center justify-center text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-700 active:bg-gray-600"
        >
          <Minus className="w-5 h-5" />
        </motion.button>

        {/* Amount display */}
        <div className="flex-1 relative">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-green-400">
            <DollarSign className="w-5 h-5" />
          </div>
          <motion.input
            type="number"
            value={value}
            onChange={(e) => onChange(Math.max(minStake, Math.min(effectiveMax, Number(e.target.value) || 0)))}
            disabled={disabled}
            className={`
              w-full h-12 rounded-xl bg-gray-900 border-2 border-purple-500/50
              pl-10 pr-4 text-2xl font-bold text-white text-center
              focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-400/30
              transition-all disabled:opacity-50 disabled:cursor-not-allowed
            `}
            animate={{
              borderColor: disabled ? "rgba(107, 114, 128, 0.5)" : "rgba(168, 85, 247, 0.5)",
            }}
          />

          {/* Glow effect on the input */}
          <motion.div
            className="absolute inset-0 rounded-xl pointer-events-none"
            animate={{
              boxShadow: [
                "0 0 5px rgba(168, 85, 247, 0.2)",
                "0 0 15px rgba(168, 85, 247, 0.3)",
                "0 0 5px rgba(168, 85, 247, 0.2)",
              ],
            }}
            transition={{ duration: 2, repeat: Infinity }}
          />
        </div>

        {/* Plus button */}
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={() => handleIncrement(5)}
          disabled={disabled || value >= effectiveMax}
          className="w-10 h-10 rounded-xl bg-gray-800 border border-gray-700 flex items-center justify-center text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-700 active:bg-gray-600"
        >
          <Plus className="w-5 h-5" />
        </motion.button>
      </div>

      {/* Quick amount buttons */}
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
        {QUICK_AMOUNTS.map((amount) => {
          const isSelected = value === amount;
          const isDisabled = amount > balance;

          return (
            <motion.button
              key={amount}
              whileTap={{ scale: isDisabled ? 1 : 0.95 }}
              onClick={() => handleQuickAmount(amount)}
              disabled={disabled || isDisabled}
              className={`
                flex-shrink-0 px-3 py-2 rounded-lg font-bold text-sm transition-all
                ${isSelected
                  ? "bg-purple-500 text-white shadow-[0_0_15px_rgba(168,85,247,0.5)]"
                  : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                }
                ${isDisabled ? "opacity-40 cursor-not-allowed" : ""}
              `}
            >
              ${amount}
            </motion.button>
          );
        })}

        {/* MAX button */}
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={handleMax}
          disabled={disabled}
          className={`
            flex-shrink-0 px-3 py-2 rounded-lg font-bold text-sm
            bg-gradient-to-r from-purple-500 to-pink-500 text-white
            hover:from-purple-400 hover:to-pink-400
            disabled:opacity-50 disabled:cursor-not-allowed
            shadow-[0_0_10px_rgba(168,85,247,0.3)]
          `}
        >
          <span className="flex items-center gap-1">
            <Zap className="w-3 h-3" />
            MAX
          </span>
        </motion.button>
      </div>

      {/* Slider */}
      <div className="relative pt-2">
        <input
          type="range"
          min={minStake}
          max={effectiveMax}
          value={value}
          onChange={handleSliderChange}
          disabled={disabled}
          className="w-full h-2 appearance-none bg-gray-800 rounded-full cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background: `linear-gradient(to right,
              rgb(168, 85, 247) 0%,
              rgb(168, 85, 247) ${(value - minStake) / (effectiveMax - minStake) * 100}%,
              rgb(31, 41, 55) ${(value - minStake) / (effectiveMax - minStake) * 100}%,
              rgb(31, 41, 55) 100%)`,
          }}
        />

        {/* Percentage markers */}
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>${minStake}</span>
          <span>25%</span>
          <span>50%</span>
          <span>75%</span>
          <span>${Math.floor(effectiveMax)}</span>
        </div>
      </div>

      {/* Advanced controls toggle */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="w-full text-center text-xs text-gray-500 hover:text-gray-300 transition-colors"
      >
        {showAdvanced ? "Hide" : "Show"} advanced options
      </button>

      {/* Advanced options */}
      <AnimatePresence>
        {showAdvanced && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="flex gap-2 overflow-hidden"
          >
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={handleHalf}
              disabled={disabled}
              className="flex-1 py-2 rounded-lg bg-gray-800 text-gray-300 text-sm font-semibold hover:bg-gray-700 disabled:opacity-50"
            >
              1/2
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={handleDouble}
              disabled={disabled || value * 2 > effectiveMax}
              className="flex-1 py-2 rounded-lg bg-gray-800 text-gray-300 text-sm font-semibold hover:bg-gray-700 disabled:opacity-50"
            >
              2x
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => onChange(Math.floor(balance * 0.1))}
              disabled={disabled}
              className="flex-1 py-2 rounded-lg bg-gray-800 text-gray-300 text-sm font-semibold hover:bg-gray-700 disabled:opacity-50"
            >
              10%
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => onChange(Math.floor(balance * 0.25))}
              disabled={disabled}
              className="flex-1 py-2 rounded-lg bg-gray-800 text-gray-300 text-sm font-semibold hover:bg-gray-700 disabled:opacity-50"
            >
              25%
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Balance and risk indicator */}
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className="text-gray-500">Balance:</span>
          <span className="text-white font-semibold">${balance.toFixed(2)}</span>
        </div>

        <motion.div
          className={`flex items-center gap-1 px-2 py-0.5 rounded-full ${risk.bg}`}
          animate={{
            scale: balancePercentage > 50 ? [1, 1.05, 1] : 1,
          }}
          transition={{ duration: 0.5, repeat: balancePercentage > 50 ? Infinity : 0 }}
        >
          <Sparkles className={`w-3 h-3 ${risk.color}`} />
          <span className={`font-bold ${risk.color}`}>{risk.text}</span>
        </motion.div>
      </div>
    </div>
  );
}

// =============================================================================
// COMPACT STAKE SELECTOR - For inline use
// =============================================================================

interface CompactStakeSelectorProps {
  value: number;
  onChange: (amount: number) => void;
  balance: number;
  disabled?: boolean;
  className?: string;
}

export function CompactStakeSelector({
  value,
  onChange,
  balance,
  disabled = false,
  className = "",
}: CompactStakeSelectorProps) {
  const { hapticTap } = useHaptic();
  const [isOpen, setIsOpen] = useState(false);

  const handleSelect = (amount: number) => {
    if (disabled || amount > balance) return;
    hapticTap();
    onChange(amount);
    setIsOpen(false);
  };

  return (
    <div className={`relative ${className}`}>
      <motion.button
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        className={`
          flex items-center gap-2 px-3 py-2 rounded-xl
          bg-gray-800 border border-gray-700
          text-white font-bold
          hover:bg-gray-700 disabled:opacity-50
        `}
      >
        <DollarSign className="w-4 h-4 text-green-400" />
        <span>{value}</span>
      </motion.button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            className="absolute bottom-full left-0 mb-2 p-2 bg-gray-900 border border-gray-700 rounded-xl shadow-lg z-50"
          >
            <div className="grid grid-cols-3 gap-1">
              {[1, 5, 10, 25, 50, 100].map((amount) => (
                <button
                  key={amount}
                  onClick={() => handleSelect(amount)}
                  disabled={amount > balance}
                  className={`
                    px-3 py-2 rounded-lg text-sm font-bold transition-all
                    ${value === amount
                      ? "bg-purple-500 text-white"
                      : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                    }
                    ${amount > balance ? "opacity-40 cursor-not-allowed" : ""}
                  `}
                >
                  ${amount}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
