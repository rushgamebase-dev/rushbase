"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useSpring, useTransform, MotionValue } from "framer-motion";

// =============================================================================
// ANIMATED NUMBER - Odometer-Style Number Counter with Smooth Animations
// =============================================================================

interface AnimatedNumberProps {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
  duration?: number;
  showSign?: boolean;
  highlightChange?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  format?: 'currency' | 'percent' | 'number';
}

function Digit({ digit, isActive }: { digit: string; isActive: boolean }) {
  return (
    <motion.span
      initial={{ y: isActive ? -20 : 0, opacity: isActive ? 0 : 1 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 20, opacity: 0 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className="inline-block"
    >
      {digit}
    </motion.span>
  );
}

function AnimatedDigit({ value }: { value: MotionValue<number> }) {
  const rounded = useTransform(value, (latest) => Math.round(latest));
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    return rounded.on("change", (v) => setDisplay(v));
  }, [rounded]);

  return <span>{display}</span>;
}

export function AnimatedNumber({
  value,
  decimals = 2,
  prefix = "",
  suffix = "",
  className = "",
  duration = 0.5,
  showSign = false,
  highlightChange = true,
  size = 'md',
  format = 'number',
}: AnimatedNumberProps) {
  const prevValueRef = useRef(value);
  const [isIncreasing, setIsIncreasing] = useState<boolean | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);

  const spring = useSpring(value, {
    stiffness: 100,
    damping: 30,
    duration: duration * 1000,
  });

  const displayValue = useTransform(spring, (latest) => {
    const formatted = Math.abs(latest).toFixed(decimals);
    const [whole, decimal] = formatted.split('.');
    const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return decimal ? `${withCommas}.${decimal}` : withCommas;
  });

  const [displayString, setDisplayString] = useState('0.00');

  useEffect(() => {
    spring.set(value);

    if (highlightChange && value !== prevValueRef.current) {
      setIsIncreasing(value > prevValueRef.current);
      setIsAnimating(true);
      setTimeout(() => setIsAnimating(false), 500);
    }

    prevValueRef.current = value;
  }, [value, spring, highlightChange]);

  useEffect(() => {
    return displayValue.on("change", (v) => setDisplayString(v));
  }, [displayValue]);

  const sizeClasses = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-xl',
    xl: 'text-3xl font-bold',
  };

  const getPrefix = () => {
    if (format === 'currency') return '$';
    if (showSign && value > 0) return '+';
    if (showSign && value < 0) return '-';
    return prefix;
  };

  const getSuffix = () => {
    if (format === 'percent') return '%';
    return suffix;
  };

  // Neon green and red with glow
  const getHighlightColor = () => {
    if (!isAnimating || isIncreasing === null) return '';
    return isIncreasing
      ? 'text-neon drop-shadow-[0_0_8px_rgba(0,255,65,0.6)]'
      : 'text-short drop-shadow-[0_0_8px_rgba(255,51,51,0.6)]';
  };

  return (
    <motion.span
      className={`
        inline-flex items-baseline tabular-nums font-mono
        ${sizeClasses[size]}
        ${className}
        ${getHighlightColor()}
        transition-colors duration-300
      `}
      animate={isAnimating ? {
        scale: [1, 1.1, 1],
      } : {}}
      transition={{ duration: 0.3 }}
    >
      <span className="opacity-70">{getPrefix()}</span>
      {showSign && value < 0 ? displayString : displayString}
      <span className="opacity-70">{getSuffix()}</span>
    </motion.span>
  );
}

// =============================================================================
// ANIMATED BALANCE - Special Component for Balance Display
// =============================================================================

interface AnimatedBalanceProps {
  value: number;
  previousValue?: number;
  className?: string;
}

export function AnimatedBalance({ value, previousValue, className = "" }: AnimatedBalanceProps) {
  const [changeAmount, setChangeAmount] = useState<number | null>(null);
  const [showChange, setShowChange] = useState(false);

  useEffect(() => {
    if (previousValue !== undefined && previousValue !== value) {
      setChangeAmount(value - previousValue);
      setShowChange(true);
      setTimeout(() => setShowChange(false), 2000);
    }
  }, [value, previousValue]);

  const isPositive = changeAmount !== null && changeAmount > 0;

  return (
    <div className={`relative inline-flex items-center ${className}`}>
      <AnimatedNumber
        value={value}
        format="currency"
        size="lg"
        highlightChange={true}
        decimals={2}
      />

      {/* Floating change indicator */}
      {showChange && changeAmount !== null && (
        <motion.div
          initial={{ opacity: 0, y: 0, x: 10 }}
          animate={{ opacity: 1, y: -20, x: 20 }}
          exit={{ opacity: 0, y: -40 }}
          className={`absolute right-0 top-0 text-sm font-bold font-mono ${
            isPositive ? 'text-neon' : 'text-short'
          }`}
          style={{ textShadow: isPositive ? '0 0 10px rgba(0, 255, 65, 0.6)' : '0 0 10px rgba(255, 51, 51, 0.6)' }}
        >
          {isPositive ? '+' : ''}{changeAmount.toFixed(2)}
        </motion.div>
      )}
    </div>
  );
}

// =============================================================================
// ANIMATED PNL - Special Component for P&L Display
// =============================================================================

interface AnimatedPnLProps {
  value: number;
  className?: string;
}

export function AnimatedPnL({ value, className = "" }: AnimatedPnLProps) {
  const isPositive = value >= 0;

  return (
    <motion.div
      className={`inline-flex items-center gap-1 font-mono ${className}`}
      animate={{
        color: isPositive ? '#00ff41' : '#ff3333',
      }}
    >
      <span className="text-xs opacity-70">P&L:</span>
      <AnimatedNumber
        value={value}
        format="currency"
        showSign={true}
        size="md"
        highlightChange={true}
        decimals={2}
      />
    </motion.div>
  );
}

// =============================================================================
// ANIMATED WIN RATE - Circular Progress with Percentage
// =============================================================================

interface AnimatedWinRateProps {
  wins: number;
  total: number;
  className?: string;
}

export function AnimatedWinRate({ wins, total, className = "" }: AnimatedWinRateProps) {
  const rate = total > 0 ? (wins / total) * 100 : 0;
  const spring = useSpring(rate, { stiffness: 50, damping: 20 });
  const [displayRate, setDisplayRate] = useState(0);

  useEffect(() => {
    spring.set(rate);
  }, [rate, spring]);

  useEffect(() => {
    return spring.on("change", (v) => setDisplayRate(v));
  }, [spring]);

  // Color based on win rate
  const getColor = () => {
    if (rate >= 60) return '#00ff41'; // Neon green
    if (rate >= 50) return '#ffcc00'; // Yellow
    return '#ff3333'; // Red
  };

  const circumference = 2 * Math.PI * 18;
  const offset = circumference - (displayRate / 100) * circumference;

  return (
    <div className={`relative inline-flex items-center gap-2 ${className}`}>
      <svg width="44" height="44" className="-rotate-90">
        <circle
          cx="22"
          cy="22"
          r="18"
          fill="none"
          stroke="rgba(0, 255, 65, 0.1)"
          strokeWidth="4"
        />
        <motion.circle
          cx="22"
          cy="22"
          r="18"
          fill="none"
          stroke={getColor()}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{
            filter: `drop-shadow(0 0 4px ${getColor()})`,
          }}
        />
      </svg>
      <div className="flex flex-col">
        <span className="text-xs text-text-muted font-mono">Win Rate</span>
        <span className="font-bold font-mono" style={{ color: getColor() }}>
          {displayRate.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}
