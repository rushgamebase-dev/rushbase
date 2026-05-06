"use client";

import { motion } from "framer-motion";
import { X, TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";
import { cn, formatCurrency, formatPercent, formatPrice, getAssetSymbol } from "@/lib/utils";
import { useHaptic } from "@/hooks/use-haptic";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { PositionWithPnL } from "@/types";

interface ActivePositionProps {
  position: PositionWithPnL;
  onClose: () => void;
  isClosing?: boolean;
}

export function ActivePosition({ position, onClose, isClosing }: ActivePositionProps) {
  const { hapticMedium } = useHaptic();
  const isProfit = position.unrealizedPnl >= 0;
  const isNearLiquidation = position.distanceToLiqPercent < 20;

  const handleClose = () => {
    hapticMedium();
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
    >
      <Card className="border-2" style={{ borderColor: isProfit ? "rgb(34, 197, 94)" : "rgb(239, 68, 68)" }}>
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Badge variant={position.side === "LONG" ? "long" : "short"}>
              {position.side === "LONG" ? (
                <TrendingUp className="w-3 h-3 mr-1" />
              ) : (
                <TrendingDown className="w-3 h-3 mr-1" />
              )}
              {position.side}
            </Badge>
            <span className="font-semibold text-text-primary">{getAssetSymbol(position.symbol)}</span>
            <span className="text-text-muted text-sm">{position.leverage}x</span>
          </div>
          {isNearLiquidation && (
            <motion.div
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ repeat: Infinity, duration: 1 }}
              className="flex items-center gap-1 text-accent-yellow"
            >
              <AlertTriangle className="w-4 h-4" />
              <span className="text-xs font-medium">Near Liq.</span>
            </motion.div>
          )}
        </div>

        {/* PnL Display */}
        <div className="text-center mb-4">
          <motion.p
            key={position.unrealizedPnl}
            initial={{ scale: 1.1 }}
            animate={{ scale: 1 }}
            className={cn(
              "text-4xl font-bold",
              isProfit ? "text-long" : "text-short"
            )}
          >
            {formatCurrency(position.unrealizedPnl)}
          </motion.p>
          <p className={cn("text-lg font-medium", isProfit ? "text-long" : "text-short")}>
            {formatPercent(position.roePercent)} ROE
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-background-secondary rounded-lg p-3">
            <p className="text-xs text-text-muted">Entry Price</p>
            <p className="font-semibold text-text-primary">{formatPrice(position.entryPrice)}</p>
          </div>
          <div className="bg-background-secondary rounded-lg p-3">
            <p className="text-xs text-text-muted">Current Price</p>
            <p className="font-semibold text-text-primary">{formatPrice(position.currentPrice)}</p>
          </div>
          <div className="bg-background-secondary rounded-lg p-3">
            <p className="text-xs text-text-muted">Margin</p>
            <p className="font-semibold text-text-primary">{formatCurrency(position.margin)}</p>
          </div>
          <div className="bg-background-secondary rounded-lg p-3">
            <p className="text-xs text-text-muted">Liquidation</p>
            <p className={cn(
              "font-semibold",
              isNearLiquidation ? "text-accent-yellow" : "text-text-primary"
            )}>
              {formatPrice(position.liquidationPrice)}
            </p>
          </div>
        </div>

        {/* Liquidation Progress */}
        <div className="mb-4">
          <div className="flex justify-between text-xs text-text-muted mb-1">
            <span>Distance to Liquidation</span>
            <span>{position.distanceToLiqPercent.toFixed(1)}%</span>
          </div>
          <div className="h-2 bg-background-secondary rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(100, position.distanceToLiqPercent)}%` }}
              className={cn(
                "h-full rounded-full",
                position.distanceToLiqPercent > 50 ? "bg-long" :
                position.distanceToLiqPercent > 20 ? "bg-accent-yellow" : "bg-short"
              )}
            />
          </div>
        </div>

        {/* Close Button */}
        <Button
          onClick={handleClose}
          disabled={isClosing}
          isLoading={isClosing}
          variant="outline"
          size="lg"
          className="w-full"
        >
          <X className="w-5 h-5 mr-2" />
          Close Position
        </Button>
      </Card>
    </motion.div>
  );
}
