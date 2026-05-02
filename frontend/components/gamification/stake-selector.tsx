"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { DollarSign, Minus, Plus, Zap, Sparkles } from "lucide-react";
import { useHaptic } from "@/hooks/use-haptic";

// =============================================================================
// ENHANCED STAKE SELECTOR - TAPTRADER
// Quick Buttons + Slider + Presets with Neon Green Styling
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
    if (balancePercentage > 50) return { text: "HIGH RISK", color: "text-short", bg: "bg-short/20" };
    if (balancePercentage > 25) return { text: "MEDIUM", color: "text-yellow-400", bg: "bg-yellow-500/20" };
    return { text: "SAFE", color: "text-neon", bg: "bg-neon/20" };
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
          className="w-10 h-10 rounded bg-background-card border border-border flex items-center justify-center text-neon disabled:opacity-50 disabled:cursor-not-allowed hover:border-border-neon hover:bg-neon/10 active:bg-neon/20 transition-all"
        >
          <Minus className="w-5 h-5" />
        </motion.button>

        {/* Amount display */}
        <div className="flex-1 relative">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-neon">
            <DollarSign className="w-5 h-5" />
          </div>
          <motion.input
            type="number"
            inputMode="decimal"
            min={minStake}
            max={effectiveMax}
            step={1}
            value={value}
            onChange={(e) => {
              const parsed = parseFloat(e.target.value);
              if (isNaN(parsed) || parsed < 0) {
                onChange(minStake);
              } else {
                onChange(Math.max(minStake, Math.min(effectiveMax, Math.floor(parsed))));
              }
            }}
            onBlur={(e) => {
              // Ensure valid value on blur
              const parsed = parseFloat(e.target.value);
              if (isNaN(parsed) || parsed < minStake) {
                onChange(minStake);
              }
            }}
            disabled={disabled}
            className={`
              w-full h-12 rounded bg-background border-2 border-border-neon
              pl-10 pr-4 text-2xl font-bold text-neon text-center font-mono
              focus:outline-none focus:border-neon focus:ring-2 focus:ring-neon/30
              transition-all disabled:opacity-50 disabled:cursor-not-allowed
              [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none
            `}
            animate={{
              borderColor: disabled ? "rgba(0, 255, 65, 0.2)" : "rgba(0, 255, 65, 0.5)",
            }}
          />

          {/* Glow effect on the input - TAPTRADER */}
          <motion.div
            className="absolute inset-0 rounded pointer-events-none"
            animate={{
              boxShadow: [
                "0 0 5px rgba(0, 255, 65, 0.2)",
                "0 0 15px rgba(0, 255, 65, 0.3)",
                "0 0 5px rgba(0, 255, 65, 0.2)",
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
          className="w-10 h-10 rounded bg-background-card border border-border flex items-center justify-center text-neon disabled:opacity-50 disabled:cursor-not-allowed hover:border-border-neon hover:bg-neon/10 active:bg-neon/20 transition-all"
        >
          <Plus className="w-5 h-5" />
        </motion.button>
      </div>

      {/* Quick amount buttons - TAPTRADER */}
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
                flex-shrink-0 px-3 py-2 rounded font-bold text-sm font-mono transition-all
                ${isSelected
                  ? "bg-neon text-background shadow-neon-sm"
                  : "bg-background-card text-neon border border-border hover:border-border-neon"
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
            flex-shrink-0 px-3 py-2 rounded font-bold text-sm font-mono
            bg-neon text-background
            hover:bg-neon-400
            disabled:opacity-50 disabled:cursor-not-allowed
            shadow-neon-sm
          `}
        >
          <span className="flex items-center gap-1">
            <Zap className="w-3 h-3" />
            MAX
          </span>
        </motion.button>
      </div>

      {/* Slider - TAPTRADER */}
      <div className="relative pt-2">
        <input
          type="range"
          min={minStake}
          max={effectiveMax}
          value={value}
          onChange={handleSliderChange}
          disabled={disabled}
          className="w-full h-2 appearance-none bg-background-card rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background: `linear-gradient(to right,
              #00ff41 0%,
              #00ff41 ${(value - minStake) / (effectiveMax - minStake) * 100}%,
              #1a1a1a ${(value - minStake) / (effectiveMax - minStake) * 100}%,
              #1a1a1a 100%)`,
          }}
        />

        {/* Percentage markers */}
        <div className="flex justify-between text-xs text-text-muted mt-1 font-mono">
          <span>${minStake}</span>
          <span>25%</span>
          <span>50%</span>
          <span>75%</span>
          <span>${Math.floor(effectiveMax)}</span>
        </div>
      </div>

      {/* Advanced controls toggle - TAPTRADER */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="w-full text-center text-xs text-text-muted hover:text-neon transition-colors font-mono"
      >
        {showAdvanced ? "[ HIDE ]" : "[ SHOW ]"} advanced options
      </button>

      {/* Advanced options - TAPTRADER */}
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
              className="flex-1 py-2 rounded bg-background-card text-neon text-sm font-semibold font-mono border border-border hover:border-border-neon disabled:opacity-50"
            >
              1/2
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={handleDouble}
              disabled={disabled || value * 2 > effectiveMax}
              className="flex-1 py-2 rounded bg-background-card text-neon text-sm font-semibold font-mono border border-border hover:border-border-neon disabled:opacity-50"
            >
              2x
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => onChange(Math.floor(balance * 0.1))}
              disabled={disabled}
              className="flex-1 py-2 rounded bg-background-card text-neon text-sm font-semibold font-mono border border-border hover:border-border-neon disabled:opacity-50"
            >
              10%
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => onChange(Math.floor(balance * 0.25))}
              disabled={disabled}
              className="flex-1 py-2 rounded bg-background-card text-neon text-sm font-semibold font-mono border border-border hover:border-border-neon disabled:opacity-50"
            >
              25%
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Balance and risk indicator - TAPTRADER */}
      <div className="flex items-center justify-between text-xs font-mono">
        <div className="flex items-center gap-2">
          <span className="text-text-muted">Balance:</span>
          <span className="text-neon font-semibold">${balance.toFixed(2)}</span>
        </div>

        <motion.div
          className={`flex items-center gap-1 px-2 py-0.5 rounded ${risk.bg} border border-current/20`}
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
// COMPACT STAKE SELECTOR - TAPTRADER THEME
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
          flex items-center gap-2 px-3 py-2 rounded
          bg-background-card border border-border
          text-neon font-bold font-mono
          hover:border-border-neon disabled:opacity-50
        `}
      >
        <DollarSign className="w-4 h-4 text-neon" />
        <span>{value}</span>
      </motion.button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            className="absolute bottom-full left-0 mb-2 p-2 bg-background-card border border-border rounded shadow-lg z-50"
          >
            <div className="grid grid-cols-3 gap-1">
              {[1, 5, 10, 25, 50, 100].map((amount) => (
                <button
                  key={amount}
                  onClick={() => handleSelect(amount)}
                  disabled={amount > balance}
                  className={`
                    px-3 py-2 rounded text-sm font-bold font-mono transition-all
                    ${value === amount
                      ? "bg-neon text-background"
                      : "bg-background text-neon border border-border hover:border-border-neon"
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
