"use client";

import { motion } from "framer-motion";
import { X, TrendingUp, TrendingDown } from "lucide-react";
import type { PositionWithPnL } from "@/types";

interface ActivePositionOverlayProps {
  position: PositionWithPnL;
  onClose: () => void;
  isClosing: boolean;
}

export function ActivePositionOverlay({
  position,
  onClose,
  isClosing,
}: ActivePositionOverlayProps) {
  const isProfit = position.unrealizedPnl >= 0;
  const pnlColor = isProfit ? "text-long" : "text-short";
  const bgColor = isProfit ? "from-long/20" : "from-short/20";

  return (
    <motion.div
      initial={{ opacity: 0, y: 100 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 100 }}
      className="absolute bottom-24 left-4 right-4 z-30"
    >
      <div className={`glass rounded-3xl p-6 bg-gradient-to-br ${bgColor} to-transparent`}>
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                position.side === "LONG" ? "bg-long/20" : "bg-short/20"
              }`}
            >
              {position.side === "LONG" ? (
                <TrendingUp className="w-5 h-5 text-long" />
              ) : (
                <TrendingDown className="w-5 h-5 text-short" />
              )}
            </div>
            <div>
              <p className="font-bold text-text-primary">
                {position.side} {position.symbol.replace("USDT", "")}
              </p>
              <p className="text-xs text-text-muted">
                {position.leverage}x • ${position.margin.toFixed(2)}
              </p>
            </div>
          </div>
        </div>

        {/* PnL Display */}
        <div className="text-center mb-6">
          <motion.p
            key={position.unrealizedPnl}
            initial={{ scale: 1.1 }}
            animate={{ scale: 1 }}
            className={`text-4xl font-bold ${pnlColor}`}
          >
            {isProfit ? "+" : ""}${position.unrealizedPnl.toFixed(2)}
          </motion.p>
          <p className={`text-sm ${pnlColor}`}>
            {isProfit ? "+" : ""}{position.roePercent.toFixed(2)}% ROE
          </p>
        </div>

        {/* Liquidation Progress */}
        <div className="mb-6">
          <div className="flex justify-between text-xs text-text-muted mb-1">
            <span>Distance to Liq</span>
            <span>{position.distanceToLiqPercent.toFixed(1)}%</span>
          </div>
          <div className="h-2 bg-background-secondary rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(100 - position.distanceToLiqPercent, 100)}%` }}
              className="h-full bg-gradient-to-r from-long via-accent-yellow to-short rounded-full"
            />
          </div>
        </div>

        {/* Close Button */}
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={onClose}
          disabled={isClosing}
          className="w-full py-4 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 text-white font-bold text-lg flex items-center justify-center gap-2 active:bg-white/20 disabled:opacity-50"
        >
          {isClosing ? (
            <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <>
              <X className="w-5 h-5" />
              Close Position
            </>
          )}
        </motion.button>
      </div>
    </motion.div>
  );
}
