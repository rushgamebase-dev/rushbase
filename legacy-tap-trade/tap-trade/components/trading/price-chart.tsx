"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, IChartApi, ISeriesApi, LineData, ColorType } from "lightweight-charts";
import { motion } from "framer-motion";
import { cn, formatPrice, getAssetSymbol, getAssetColor } from "@/lib/utils";
import { usePrices } from "@/stores";
import type { Asset } from "@/types";

interface PriceChartProps {
  asset: Asset;
  height?: number;
}

export function PriceChart({ asset, height = 300 }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const { prices, priceHistory } = usePrices();

  const currentPrice = prices[asset] || 0;
  const priceData = priceHistory[asset] || [];
  const previousPrice = priceData.length > 1 ? priceData[priceData.length - 2] : currentPrice;
  const priceChange = currentPrice - previousPrice;
  const priceChangePercent = previousPrice > 0 ? (priceChange / previousPrice) * 100 : 0;
  const isPositive = priceChange >= 0;

  useEffect(() => {
    if (!containerRef.current) return;

    // Create chart
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#a1a1aa",
        fontFamily: "system-ui, sans-serif",
      },
      grid: {
        vertLines: { color: "rgba(39, 39, 42, 0.5)" },
        horzLines: { color: "rgba(39, 39, 42, 0.5)" },
      },
      crosshair: {
        mode: 0,
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: {
          top: 0.1,
          bottom: 0.1,
        },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: false,
      },
      handleScale: false,
      handleScroll: false,
    });

    // Create line series
    const series = chart.addLineSeries({
      color: getAssetColor(asset),
      lineWidth: 2,
      crosshairMarkerVisible: false,
      priceLineVisible: true,
      priceLineColor: getAssetColor(asset),
      priceLineWidth: 1,
      priceLineStyle: 2,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    // Handle resize
    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, [asset, height]);

  // Update data when price history changes
  useEffect(() => {
    if (!seriesRef.current || priceData.length === 0) return;

    const now = Date.now();
    const data: LineData[] = priceData.map((price, index) => ({
      time: (now - (priceData.length - index - 1) * 1000) / 1000 as unknown as string,
      value: price,
    }));

    seriesRef.current.setData(data);
    chartRef.current?.timeScale().fitContent();
  }, [priceData]);

  return (
    <div className="relative">
      {/* Price Display */}
      <div className="absolute top-4 left-4 z-10">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-text-secondary text-sm">{getAssetSymbol(asset)}/USDT</span>
        </div>
        <motion.p
          key={currentPrice}
          initial={{ scale: 1.05 }}
          animate={{ scale: 1 }}
          className="text-3xl font-bold text-text-primary"
        >
          ${formatPrice(currentPrice)}
        </motion.p>
        <p
          className={cn(
            "text-sm font-medium",
            isPositive ? "text-long" : "text-short"
          )}
        >
          {isPositive ? "+" : ""}{formatPrice(priceChange)} ({priceChangePercent.toFixed(2)}%)
        </p>
      </div>

      {/* Chart */}
      <div
        ref={containerRef}
        className="w-full rounded-xl overflow-hidden"
        style={{ height }}
      />

      {/* No data fallback */}
      {priceData.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-background-secondary/50 rounded-xl">
          <p className="text-text-muted">Loading price data...</p>
        </div>
      )}
    </div>
  );
}
