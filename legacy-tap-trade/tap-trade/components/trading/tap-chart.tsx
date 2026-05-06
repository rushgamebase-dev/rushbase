"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { usePrices } from "@/stores";
import type { Asset } from "@/types";

interface TapChartProps {
  asset: Asset;
  currentPrice: number;
  onTapUp: () => void;
  onTapDown: () => void;
  disabled?: boolean;
  isLoading?: boolean;
}

const ASSET_COLORS: Record<Asset, string> = {
  BTCUSDT: "#F7931A",
  ETHUSDT: "#627EEA",
  SOLUSDT: "#14F195",
};

export function TapChart({
  asset,
  currentPrice,
  onTapUp,
  onTapDown,
  disabled,
  isLoading,
}: TapChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { priceHistory } = usePrices();
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [tapEffect, setTapEffect] = useState<{ x: number; y: number; direction: "up" | "down" } | null>(null);

  const history = priceHistory[asset] || [];
  const assetColor = ASSET_COLORS[asset];

  // Handle resize
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    updateDimensions();
    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, []);

  // Draw chart
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dimensions.width === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width, height } = dimensions;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Draw gradient background
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "rgba(34, 197, 94, 0.05)");
    gradient.addColorStop(0.5, "transparent");
    gradient.addColorStop(1, "rgba(239, 68, 68, 0.05)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Draw center line (current price level)
    const centerY = height / 2;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(width, centerY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw price line if we have history
    if (history.length > 1) {
      const minPrice = Math.min(...history);
      const maxPrice = Math.max(...history);
      const priceRange = maxPrice - minPrice || 1;
      const padding = priceRange * 0.1;

      const getY = (price: number) => {
        return height - ((price - minPrice + padding) / (priceRange + padding * 2)) * height;
      };

      const getX = (index: number) => {
        return (index / (history.length - 1)) * width;
      };

      // Draw area fill
      const areaGradient = ctx.createLinearGradient(0, 0, 0, height);
      areaGradient.addColorStop(0, `${assetColor}30`);
      areaGradient.addColorStop(1, `${assetColor}00`);

      ctx.beginPath();
      ctx.moveTo(0, height);
      history.forEach((price, i) => {
        ctx.lineTo(getX(i), getY(price));
      });
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fillStyle = areaGradient;
      ctx.fill();

      // Draw line
      ctx.beginPath();
      ctx.strokeStyle = assetColor;
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      history.forEach((price, i) => {
        if (i === 0) {
          ctx.moveTo(getX(i), getY(price));
        } else {
          ctx.lineTo(getX(i), getY(price));
        }
      });
      ctx.stroke();

      // Draw current price dot
      const lastPrice = history[history.length - 1];
      const lastX = width;
      const lastY = getY(lastPrice);

      // Glow effect
      ctx.beginPath();
      ctx.arc(lastX - 10, lastY, 8, 0, Math.PI * 2);
      ctx.fillStyle = `${assetColor}40`;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(lastX - 10, lastY, 5, 0, Math.PI * 2);
      ctx.fillStyle = assetColor;
      ctx.fill();
    }
  }, [history, dimensions, assetColor]);

  const handleTap = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (disabled) return;

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      let clientY: number;
      let clientX: number;

      if ("touches" in e) {
        clientY = e.touches[0].clientY;
        clientX = e.touches[0].clientX;
      } else {
        clientY = e.clientY;
        clientX = e.clientX;
      }

      const relativeY = clientY - rect.top;
      const centerY = rect.height / 2;

      const direction = relativeY < centerY ? "up" : "down";

      // Show tap effect
      setTapEffect({ x: clientX - rect.left, y: relativeY, direction });
      setTimeout(() => setTapEffect(null), 500);

      if (direction === "up") {
        onTapUp();
      } else {
        onTapDown();
      }
    },
    [disabled, onTapUp, onTapDown]
  );

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 cursor-pointer select-none"
      onClick={handleTap}
      onTouchStart={handleTap}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{ width: "100%", height: "100%" }}
      />

      {/* Price display */}
      <div className="absolute top-20 left-0 right-0 flex flex-col items-center pointer-events-none">
        <div className="flex items-center gap-2 mb-1">
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: assetColor }}
          />
          <span className="text-text-secondary text-sm font-medium">
            {asset.replace("USDT", "/USD")}
          </span>
        </div>
        <motion.p
          key={currentPrice}
          initial={{ scale: 1.1 }}
          animate={{ scale: 1 }}
          className="text-4xl font-bold text-text-primary font-mono"
        >
          ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </motion.p>
      </div>

      {/* Tap zones indicator */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Up zone */}
        <div className="absolute top-0 left-0 right-0 h-1/2 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
          <div className="text-6xl text-long/20">↑</div>
        </div>
        {/* Down zone */}
        <div className="absolute bottom-0 left-0 right-0 h-1/2 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
          <div className="text-6xl text-short/20">↓</div>
        </div>
      </div>

      {/* Tap effect */}
      {tapEffect && (
        <motion.div
          initial={{ scale: 0, opacity: 1 }}
          animate={{ scale: 2, opacity: 0 }}
          transition={{ duration: 0.5 }}
          className={`absolute w-20 h-20 rounded-full ${
            tapEffect.direction === "up" ? "bg-long/30" : "bg-short/30"
          }`}
          style={{
            left: tapEffect.x - 40,
            top: tapEffect.y - 40,
          }}
        />
      )}

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50">
          <div className="w-12 h-12 border-4 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}
