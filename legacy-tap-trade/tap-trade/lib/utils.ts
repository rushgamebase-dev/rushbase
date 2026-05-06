import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPrice(price: number, decimals: number = 2): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(price);
}

export function formatCurrency(amount: number, decimals: number = 2): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
}

export function formatPnL(pnl: number): string {
  const prefix = pnl >= 0 ? "+" : "";
  return `${prefix}${formatCurrency(pnl)}`;
}

export function formatPercent(value: number, decimals: number = 2): string {
  const prefix = value >= 0 ? "+" : "";
  return `${prefix}${value.toFixed(decimals)}%`;
}

export function formatCompactNumber(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  }
  return num.toString();
}

export function shortenAddress(address: string, chars: number = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

export function getAssetSymbol(asset: string): string {
  return asset.replace("USDT", "");
}

export function getAssetColor(asset: string): string {
  const colors: Record<string, string> = {
    BTCUSDT: "#F7931A",
    ETHUSDT: "#627EEA",
    SOLUSDT: "#00FFA3",
  };
  return colors[asset] || "#ffffff";
}

export function getLeverageColor(leverage: number): string {
  if (leverage <= 10) return "text-primary-400";
  if (leverage <= 25) return "text-accent-yellow";
  if (leverage <= 50) return "text-accent-orange";
  return "text-short";
}

export function calculateLiquidationDistance(
  currentPrice: number,
  liquidationPrice: number,
  side: "LONG" | "SHORT"
): number {
  if (side === "LONG") {
    return ((currentPrice - liquidationPrice) / currentPrice) * 100;
  }
  return ((liquidationPrice - currentPrice) / currentPrice) * 100;
}

export function triggerHaptic(type: "light" | "medium" | "heavy" = "medium") {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    const patterns = {
      light: [10],
      medium: [20],
      heavy: [50],
    };
    navigator.vibrate(patterns[type]);
  }
}

export function playSound(type: "tap" | "win" | "loss") {
  // Audio will be implemented with actual sound files
  const sounds: Record<string, string> = {
    tap: "/sounds/tap.mp3",
    win: "/sounds/win.mp3",
    loss: "/sounds/loss.mp3",
  };

  if (typeof window !== "undefined") {
    const audio = new Audio(sounds[type]);
    audio.volume = 0.5;
    audio.play().catch(() => {
      // Ignore audio play errors (autoplay restrictions)
    });
  }
}

export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}
