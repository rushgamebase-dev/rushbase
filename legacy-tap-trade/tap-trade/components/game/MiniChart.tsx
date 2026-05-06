"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { UI_CONFIG } from "@/lib/ui-config";

interface MiniChartProps {
  priceHistory: number[];
  currentPrice: number;
  width?: number;
  height?: number;
}

export function MiniChart({
  priceHistory,
  currentPrice,
  width = UI_CONFIG.chart.width,
  height = 400,
}: MiniChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const lastPriceRef = useRef(currentPrice);
  const [smoothPrice, setSmoothPrice] = useState(currentPrice);
  const [liveHistory, setLiveHistory] = useState<number[]>([]);
  const { colors, typography } = UI_CONFIG;

  // Generate live volatile data that simulates real market movement
  useEffect(() => {
    if (!currentPrice || currentPrice <= 0) return;

    const baseVolatility = currentPrice * 0.0003; // 0.03% volatility per tick
    let localHistory = priceHistory.length > 0 ? [...priceHistory] : [];
    let lastPrice = currentPrice;

    // Initialize with some history if empty
    if (localHistory.length < 50) {
      localHistory = [];
      let p = currentPrice * 0.998;
      for (let i = 0; i < 150; i++) {
        const change = (Math.random() - 0.48) * baseVolatility * 3;
        p += change;
        localHistory.push(p);
      }
      setLiveHistory(localHistory);
    }

    const interval = setInterval(() => {
      if (localHistory.length < 2) return;

      // Simulate realistic price movement with momentum
      const prevPrice = localHistory[localHistory.length - 2] || lastPrice;
      const momentum = (lastPrice - prevPrice) * 0.3;
      const noise = (Math.random() - 0.5) * baseVolatility * 2;
      const drift = (currentPrice - lastPrice) * 0.1; // Pull towards actual price

      const newPrice = lastPrice + momentum + noise + drift;
      lastPrice = newPrice;

      localHistory = [...localHistory.slice(-200), newPrice];
      setLiveHistory([...localHistory]);
    }, 50); // Update every 50ms for smooth animation

    return () => clearInterval(interval);
  }, [currentPrice, priceHistory]);

  // Smooth price animation
  useEffect(() => {
    const animate = () => {
      setSmoothPrice(prev => {
        const diff = currentPrice - prev;
        if (Math.abs(diff) < 0.01) return currentPrice;
        return prev + diff * 0.15;
      });
      animationRef.current = requestAnimationFrame(animate);
    };
    animationRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationRef.current);
  }, [currentPrice]);

  // Draw chart
  useEffect(() => {
    const canvas = canvasRef.current;
    const history = liveHistory && liveHistory.length > 0 ? liveHistory : priceHistory;
    if (!canvas || !history || history.length < 2) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Calculate bounds with some padding
    const visibleHistory = history.slice(-150);
    const minPrice = Math.min(...visibleHistory);
    const maxPrice = Math.max(...visibleHistory);
    const priceRange = maxPrice - minPrice || 1;
    const padding = priceRange * 0.15;

    const getY = (price: number): number => {
      return height - ((price - minPrice + padding) / (priceRange + padding * 2)) * height;
    };

    const getX = (index: number): number => {
      return (index / (visibleHistory.length - 1)) * width;
    };

    // Draw area fill with gradient
    ctx.beginPath();
    ctx.moveTo(0, height);

    // Use bezier curves for smoother line
    for (let i = 0; i < visibleHistory.length; i++) {
      const x = getX(i);
      const y = getY(visibleHistory[i]);

      if (i === 0) {
        ctx.lineTo(x, y);
      } else {
        const prevX = getX(i - 1);
        const prevY = getY(visibleHistory[i - 1]);
        const cpX = (prevX + x) / 2;
        ctx.quadraticCurveTo(prevX, prevY, cpX, (prevY + y) / 2);
      }
    }
    ctx.lineTo(width, getY(visibleHistory[visibleHistory.length - 1]));
    ctx.lineTo(width, height);
    ctx.closePath();

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "rgba(232, 67, 147, 0.25)");
    gradient.addColorStop(0.5, "rgba(232, 67, 147, 0.1)");
    gradient.addColorStop(1, "rgba(232, 67, 147, 0)");
    ctx.fillStyle = gradient;
    ctx.fill();

    // Draw main line with glow effect
    ctx.shadowColor = colors.chartLine;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.strokeStyle = colors.chartLine;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (let i = 0; i < visibleHistory.length; i++) {
      const x = getX(i);
      const y = getY(visibleHistory[i]);

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        const prevX = getX(i - 1);
        const prevY = getY(visibleHistory[i - 1]);
        const cpX = (prevX + x) / 2;
        ctx.quadraticCurveTo(prevX, prevY, cpX, (prevY + y) / 2);
      }
    }
    // Final segment
    const lastX = getX(visibleHistory.length - 1);
    const lastY = getY(visibleHistory[visibleHistory.length - 1]);
    ctx.lineTo(lastX, lastY);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Draw pulsing dot at the end
    const pulseScale = 1 + Math.sin(Date.now() / 150) * 0.3;

    // Outer glow
    ctx.beginPath();
    ctx.arc(lastX, lastY, 6 * pulseScale, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(232, 67, 147, 0.3)";
    ctx.fill();

    // Inner dot
    ctx.beginPath();
    ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
    ctx.fillStyle = colors.chartLine;
    ctx.fill();

    // Draw current price horizontal line
    const currentY = getY(smoothPrice);
    ctx.beginPath();
    ctx.strokeStyle = "rgba(232, 67, 147, 0.4)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.moveTo(0, currentY);
    ctx.lineTo(width, currentY);
    ctx.stroke();
    ctx.setLineDash([]);

  }, [liveHistory, priceHistory, smoothPrice, width, height, colors]);

  // Calculate Y position for price tag
  const getTagY = useCallback(() => {
    if (!liveHistory || liveHistory.length < 2) return height / 2;
    try {
      const history = liveHistory.slice(-150);
      if (history.length === 0) return height / 2;
      const minPrice = Math.min(...history);
      const maxPrice = Math.max(...history);
      const priceRange = maxPrice - minPrice || 1;
      const padding = priceRange * 0.15;
      const y = height - ((smoothPrice - minPrice + padding) / (priceRange + padding * 2)) * height;
      return isNaN(y) ? height / 2 : y;
    } catch {
      return height / 2;
    }
  }, [liveHistory, smoothPrice, height]);

  return (
    <div
      className="relative overflow-hidden"
      style={{
        width,
        height,
        backgroundColor: colors.bgPrimary,
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: "100%",
          height: "100%",
        }}
      />

      {/* Animated price tag that follows the line */}
      <div
        className="absolute right-0 flex items-center transition-all duration-100"
        style={{
          top: Math.max(20, Math.min(height - 30, getTagY())),
          transform: "translateY(-50%)",
          backgroundColor: colors.priceTag,
          padding: "4px 10px",
          borderRadius: "4px 0 0 4px",
          boxShadow: "0 0 10px rgba(232, 67, 147, 0.5)",
        }}
      >
        <span
          style={{
            fontSize: typography.currentPriceSize,
            fontWeight: 600,
            color: colors.priceTagText,
            fontFamily: typography.fontFamily,
          }}
        >
          ${smoothPrice.toFixed(2)}
        </span>
      </div>
    </div>
  );
}
