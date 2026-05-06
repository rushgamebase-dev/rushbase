// UI Configuration Tokens - Adjust these to match the reference exactly
export const UI_CONFIG = {
  // Colors
  colors: {
    // Background
    bgPrimary: "#1a0a1f",      // Main dark purple background
    bgSecondary: "#2d1035",    // Slightly lighter purple
    bgGrid: "#1e0d24",         // Grid background

    // Grid
    gridLine: "#4a1d5c",       // Purple grid lines
    gridLineAlpha: 0.6,        // Grid line opacity
    gridHover: "#6b2d7d",      // Hover state
    gridInvalid: "#ff4444",    // Invalid cell flash

    // Tiles
    tileYellow: "#e8f34c",     // Primary yellow for tiles
    tileYellowDark: "#c4cc3d", // Darker yellow for contrast
    tileText: "#1a1a1a",       // Dark text on yellow tiles
    tileInvalid: "#ff6b35",    // Orange/red for invalid tiles
    tileLosing: "#8b7355",     // Muted color for losing positions

    // Chart
    chartLine: "#e84393",      // Pink/magenta chart line
    chartFill: "rgba(232, 67, 147, 0.15)", // Chart area fill
    chartGrid: "rgba(255, 255, 255, 0.05)", // Chart grid lines

    // Text
    textPrimary: "#ffffff",
    textSecondary: "rgba(255, 255, 255, 0.7)",
    textMuted: "rgba(255, 255, 255, 0.4)",
    textMultiplier: "rgba(255, 255, 255, 0.85)",

    // Accent
    priceTag: "#e84393",       // Pink price tag
    priceTagText: "#ffffff",
    positive: "#4ade80",       // Green for positive
    negative: "#f87171",       // Red for negative
  },

  // Grid
  grid: {
    cellWidth: 55,             // Width of each cell in pixels
    cellHeight: 36,            // Height of each cell
    lineWidth: 1,              // Grid line thickness
    columns: 12,               // Number of columns visible
    rows: 12,                  // Number of rows visible
    padding: 2,                // Padding inside cells
  },

  // Typography
  typography: {
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    multiplierSize: "11px",    // Size for multipliers in grid
    multiplierWeight: 500,
    tileValueSize: "14px",     // "$5" text size
    tileMultiplierSize: "11px", // Multiplier on tile
    priceAxisSize: "12px",
    timeAxisSize: "11px",
    balanceSize: "14px",
    currentPriceSize: "14px",
  },

  // Tiles
  tiles: {
    width: 48,                 // Tile width (slightly smaller than cell)
    height: 50,                // Tile height
    borderRadius: 4,
    borderWidth: 2,
    shadowBlur: 0,             // No soft shadows - flat design
  },

  // Chart (left panel)
  chart: {
    width: 280,                // Width of chart area
    lineWidth: 2,
    pointRadius: 0,            // No points, just line
    areaOpacity: 0.15,
  },

  // Price axis (right)
  priceAxis: {
    width: 70,
    tickHeight: 36,            // Same as cell height
  },

  // Time axis (bottom)
  timeAxis: {
    height: 24,
  },

  // Toast
  toast: {
    duration: 2000,            // ms
    fadeIn: 150,
    fadeOut: 300,
  },

  // Animations
  animations: {
    hoverDuration: 100,        // ms
    invalidFlashDuration: 200,
    tilePlaceDuration: 150,
  },

  // Debug mode
  debug: {
    enabled: false,
    showCellSize: true,
    showGridLines: true,
    showFontSizes: true,
  },
};

// Multiplier calculation based on distance from current price
export function calculateMultiplier(
  priceLevel: number,
  currentPrice: number,
  leverage: number = 10
): number {
  const distance = Math.abs(priceLevel - currentPrice) / currentPrice;
  // Higher distance = higher multiplier (more risk)
  const baseMultiplier = 1 + (distance * leverage * 10);
  return Math.round(baseMultiplier * 100) / 100;
}

// Generate price levels for the grid
export function generatePriceLevels(
  currentPrice: number,
  rows: number,
  priceStep: number
): number[] {
  const levels: number[] = [];
  const midRow = Math.floor(rows / 2);

  for (let i = rows - 1; i >= 0; i--) {
    const offset = (i - midRow) * priceStep;
    levels.push(currentPrice + offset);
  }

  return levels;
}

export type UIConfig = typeof UI_CONFIG;
