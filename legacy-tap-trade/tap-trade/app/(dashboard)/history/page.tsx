"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Clock, DollarSign } from "lucide-react";
import { formatCurrency, formatPrice, getAssetSymbol, cn } from "@/lib/utils";
import { tradingApi } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Position } from "@/types";

export default function HistoryPage() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const data = await tradingApi.getPositionHistory(50, 0);
        setPositions(data);
      } catch (error) {
        console.error("Failed to fetch history:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchHistory();
  }, []);

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-6 max-w-2xl">
        <div className="animate-pulse space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-24 bg-background-card rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-text-primary mb-6">Trade History</h1>

      {positions.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Clock className="w-12 h-12 text-text-muted mx-auto mb-4" />
            <p className="text-text-secondary">No trading history yet</p>
            <p className="text-text-muted text-sm mt-1">Your closed positions will appear here</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {positions.map((position, index) => {
            const pnl = (position as any).realizedPnl || 0;
            const isProfit = pnl >= 0;

            return (
              <motion.div
                key={position.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <Card className="hover:bg-background-elevated transition-colors">
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            "w-10 h-10 rounded-lg flex items-center justify-center",
                            position.side === "LONG" ? "bg-long/20" : "bg-short/20"
                          )}
                        >
                          {position.side === "LONG" ? (
                            <TrendingUp className="w-5 h-5 text-long" />
                          ) : (
                            <TrendingDown className="w-5 h-5 text-short" />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-text-primary">
                              {getAssetSymbol(position.symbol)}
                            </span>
                            <Badge variant={position.side === "LONG" ? "long" : "short"}>
                              {position.side}
                            </Badge>
                            <Badge variant="outline">{position.leverage}x</Badge>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-text-muted mt-1">
                            <span>Entry: ${formatPrice(position.entryPrice)}</span>
                            <span>•</span>
                            <span>
                              {new Date(position.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <p
                          className={cn(
                            "font-bold text-lg",
                            isProfit ? "text-long" : "text-short"
                          )}
                        >
                          {isProfit ? "+" : ""}{formatCurrency(pnl)}
                        </p>
                        <Badge
                          variant={position.status === "LIQUIDATED" ? "short" : "default"}
                          className="mt-1"
                        >
                          {position.status}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
