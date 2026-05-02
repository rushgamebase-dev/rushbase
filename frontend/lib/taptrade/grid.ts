export type TapGridCell = {
  id: string;
  row: number;
  col: number;
  pMin: number;
  pMax: number;
  windowStartMs: number;
  windowEndMs: number;
  windowStartOffsetMs: number;
  windowDurationMs: number;
  distanceBps: number;
  multiplier: number;
  multiplierBps: number;
  disabled: boolean;
  reason?: string;
};

export type TapGridConfig = {
  rows: number;
  cols: number;
  anchorPrice: number;
  nowTime: number;
  columnDurationMs: number;
  activationDelayMs?: number;
  priceStepBps: number;
  minDistanceBps?: number;
  maxDistanceBps?: number;
  minMultiplier?: number;
  maxMultiplier?: number;
  houseEdgeBps?: number;
  volBpsPerSqrtSec?: number;
};

export const DEFAULT_GRID = {
  rows: 9,
  cols: 6,
  columnDurationMs: 3_000,
  activationDelayMs: 3_000,
  priceStepBps: 40,
  minDistanceBps: 0,
  maxDistanceBps: 1_000_000,
  minMultiplier: 1.02,
  maxMultiplier: 20,
  houseEdgeBps: 500,
  volBpsPerSqrtSec: 24,
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function multiplierLabel(multiplier: number) {
  if (multiplier >= 1000) return `${multiplier.toFixed(0)}x`;
  if (multiplier >= 100) return `${multiplier.toFixed(0)}x`;
  if (multiplier >= 10) return `${multiplier.toFixed(1)}x`;
  return `${multiplier.toFixed(2)}x`;
}

export function priceBandForRow(
  row: number,
  rows: number,
  anchorPrice: number,
  priceStepBps: number
) {
  const centerRow = Math.floor(rows / 2);
  const offsetFromCenter = centerRow - row;
  const midBps = offsetFromCenter * priceStepBps;
  const half = priceStepBps / 2;
  const a = anchorPrice * (1 + (midBps - half) / 10_000);
  const b = anchorPrice * (1 + (midBps + half) / 10_000);
  return {
    pMin: Math.min(a, b),
    pMax: Math.max(a, b),
    pMid: (a + b) / 2,
  };
}

export function distanceToBandBps(price: number, pMin: number, pMax: number) {
  if (!Number.isFinite(price) || price <= 0) return 0;
  const distance = Math.min(Math.abs(price - pMin), Math.abs(price - pMax));
  return Math.abs((distance / price) * 10_000);
}

function erfc(x: number) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const p = 0.3275911;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const t = 1 / (1 + p * ax);
  const y =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) *
      t *
      Math.exp(-ax * ax));
  return 1 - sign * y;
}

function pTouchBy(distanceBps: number, seconds: number, volBpsPerSqrtSec: number) {
  if (seconds <= 0) return 0;
  const denom = Math.max(volBpsPerSqrtSec * Math.sqrt(seconds), 1e-6);
  return Math.min(erfc((distanceBps / denom) / Math.SQRT2), 1);
}

function normalPdf(z: number) {
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}

function hitProbabilityFromStart(
  startPrice: number,
  pMin: number,
  pMax: number,
  currentPrice: number,
  windowDurationSeconds: number,
  volBpsPerSqrtSec: number
) {
  if (startPrice >= pMin && startPrice <= pMax) return 1;
  const distance = startPrice < pMin ? pMin - startPrice : startPrice - pMax;
  const distanceBps = Math.abs((distance / currentPrice) * 10_000);
  return pTouchBy(distanceBps, windowDurationSeconds, volBpsPerSqrtSec);
}

function pTouchWindow(params: {
  currentPrice: number;
  pMin: number;
  pMax: number;
  timeUntilStartSeconds: number;
  windowDurationSeconds: number;
  volBpsPerSqrtSec: number;
}) {
  const timeUntilStart = Math.max(0, params.timeUntilStartSeconds);
  const windowDuration = Math.max(0.001, params.windowDurationSeconds);
  if (timeUntilStart <= 0.001) {
    return hitProbabilityFromStart(
      params.currentPrice,
      params.pMin,
      params.pMax,
      params.currentPrice,
      windowDuration,
      params.volBpsPerSqrtSec
    );
  }

  const sigma = (params.volBpsPerSqrtSec / 10_000) * params.currentPrice;
  const startStdDev = sigma * Math.sqrt(timeUntilStart);
  const sigmas = 6;
  const steps = 97;
  const step = (sigmas * 2) / steps;
  let weighted = 0;
  let totalWeight = 0;

  for (let i = 0; i < steps; i += 1) {
    const z = -sigmas + (i + 0.5) * step;
    const startPrice = params.currentPrice + startStdDev * z;
    if (startPrice <= 0) continue;
    const weight = normalPdf(z) * step;
    weighted += weight * hitProbabilityFromStart(
      startPrice,
      params.pMin,
      params.pMax,
      params.currentPrice,
      windowDuration,
      params.volBpsPerSqrtSec
    );
    totalWeight += weight;
  }

  return totalWeight > 0 ? weighted / totalWeight : 0.0001;
}

/// FALLBACK ONLY. The authoritative multiplier comes from the backend
/// `/trade/quote-grid` endpoint. This mirrors the backend Bachelier
/// approximation only so first paint has a directional placeholder;
/// the trade page keeps cells unbettable until the backend quote lands.
export function multiplierForCell(params: {
  distanceBps: number;
  windowStartOffsetMs: number;
  windowDurationMs: number;
  currentPrice?: number;
  pMin?: number;
  pMax?: number;
  houseEdgeBps?: number;
  volBpsPerSqrtSec?: number;
  minMultiplier?: number;
  maxMultiplier?: number;
}) {
  const houseEdgeBps = params.houseEdgeBps ?? DEFAULT_GRID.houseEdgeBps;
  const vol = params.volBpsPerSqrtSec ?? DEFAULT_GRID.volBpsPerSqrtSec;
  const min = params.minMultiplier ?? DEFAULT_GRID.minMultiplier;
  const max = params.maxMultiplier ?? DEFAULT_GRID.maxMultiplier;

  const windowDuration = Math.max(0.001, params.windowDurationMs / 1000);
  const pCell = Math.max(
    params.currentPrice !== undefined && params.pMin !== undefined && params.pMax !== undefined
      ? pTouchWindow({
          currentPrice: params.currentPrice,
          pMin: params.pMin,
          pMax: params.pMax,
          timeUntilStartSeconds: Math.max(0, params.windowStartOffsetMs / 1000),
          windowDurationSeconds: windowDuration,
          volBpsPerSqrtSec: vol,
        })
      : pTouchBy(params.distanceBps, windowDuration, vol),
    0.0001
  );
  const edgeFactor = 1 - houseEdgeBps / 10_000;
  const raw = edgeFactor / pCell;
  const clamped = clamp(raw, min, max);
  return pCell * clamped - 1 > 0 ? raw : clamped;
}

export function buildFutureCells(config: TapGridConfig): TapGridCell[] {
  const rows = config.rows;
  const cols = config.cols;
  const duration = config.columnDurationMs;
  const activationDelay = config.activationDelayMs ?? DEFAULT_GRID.activationDelayMs;
  const minDistance = config.minDistanceBps ?? DEFAULT_GRID.minDistanceBps;
  const maxDistance = config.maxDistanceBps ?? DEFAULT_GRID.maxDistanceBps;
  // No alignment to the global epoch grid: the catalog is purely
  // relative to NOW, so the gap between NOW and col 1 is always exactly
  // `activationDelay` (instead of pulsing between 1× and 2× that as the
  // boundary drifts past). Bets created from a click capture an
  // absolute window at click time and stay fixed.
  const firstStart = config.nowTime + activationDelay;
  const cells: TapGridCell[] = [];

  for (let row = 0; row < rows; row += 1) {
    const band = priceBandForRow(
      row,
      rows,
      config.anchorPrice,
      config.priceStepBps
    );
    const distanceBps = distanceToBandBps(config.anchorPrice, band.pMin, band.pMax);

    for (let col = 0; col < cols; col += 1) {
      const windowStartMs = firstStart + col * duration;
      const offset = windowStartMs - config.nowTime;
      const multiplier = multiplierForCell({
        distanceBps,
        windowStartOffsetMs: offset,
        windowDurationMs: duration,
        currentPrice: config.anchorPrice,
        pMin: band.pMin,
        pMax: band.pMax,
        houseEdgeBps: config.houseEdgeBps,
        volBpsPerSqrtSec: config.volBpsPerSqrtSec,
        minMultiplier: config.minMultiplier,
        maxMultiplier: config.maxMultiplier,
      });
      const disabled = distanceBps < minDistance || distanceBps > maxDistance;
      cells.push({
        id: `${row}:${col}:${Math.round(band.pMin * 100)}:${windowStartMs}`,
        row,
        col,
        pMin: band.pMin,
        pMax: band.pMax,
        windowStartMs,
        windowEndMs: windowStartMs + duration,
        windowStartOffsetMs: offset,
        windowDurationMs: duration,
        distanceBps,
        multiplier,
        multiplierBps: Math.round(multiplier * 10_000),
        disabled,
        reason: disabled ? "Out of quote range" : undefined,
      });
    }
  }

  return cells;
}

export function buildTapGrid(config: TapGridConfig): TapGridCell[] {
  return buildFutureCells(config);
}

export type SlidingTapGridConfig = {
  rows: number;
  /** A fixed origin (ms epoch) latched once at round start. Cell
   *  windows are deterministic from `origin + col * columnDurationMs`. */
  originMs: number;
  /** Current wall time. Used to decide which cells fall inside the
   *  visible window, the activation gap, and which are disabled
   *  (already locked). The cells themselves do NOT depend on this — only
   *  which subset gets emitted. */
  nowTime: number;
  /** How many absolute columns to emit BEFORE the current `nowTime`.
   *  These are cells whose window has already started or already
   *  ended; they slide leftward as time passes. */
  pastCols: number;
  /** How many absolute columns to emit AFTER `nowTime + activationDelay`.
   *  These are cells the user can still bet on. */
  futureCols: number;
  anchorPrice: number;
  columnDurationMs: number;
  activationDelayMs?: number;
  priceStepBps: number;
  minDistanceBps?: number;
  maxDistanceBps?: number;
  minMultiplier?: number;
  maxMultiplier?: number;
  houseEdgeBps?: number;
  volBpsPerSqrtSec?: number;
};

/** Build cells with windows that are FIXED in world time. Each cell
 *  occupies `[origin + col*duration, origin + (col+1)*duration]`. The
 *  cell does not move when `nowTime` advances — instead the row of
 *  cells visible *around* `nowTime` shifts to a different `col` band.
 *
 *  Cells whose window has already entered the activation gap (or is in
 *  the past) are emitted with `disabled=true` so the canvas can render
 *  them dimmed and ignore clicks; they remain visible until they slide
 *  off the plot. */
export function buildSlidingCells(config: SlidingTapGridConfig): TapGridCell[] {
  const duration = config.columnDurationMs;
  const activationDelay = config.activationDelayMs ?? DEFAULT_GRID.activationDelayMs;
  const minDistance = config.minDistanceBps ?? DEFAULT_GRID.minDistanceBps;
  const maxDistance = config.maxDistanceBps ?? DEFAULT_GRID.maxDistanceBps;

  // The first column whose window opens at or AFTER (now + gap). Past
  // cells are everything before this threshold.
  const firstFutureCol = Math.ceil(
    (config.nowTime + activationDelay - config.originMs) / duration
  );
  const startCol = firstFutureCol - config.pastCols;
  const endCol = firstFutureCol + config.futureCols - 1;

  const cells: TapGridCell[] = [];
  for (let row = 0; row < config.rows; row += 1) {
    const band = priceBandForRow(
      row,
      config.rows,
      config.anchorPrice,
      config.priceStepBps
    );
    const distanceBps = distanceToBandBps(config.anchorPrice, band.pMin, band.pMax);

    for (let col = startCol; col <= endCol; col += 1) {
      const windowStartMs = config.originMs + col * duration;
      const windowEndMs = windowStartMs + duration;
      const offset = windowStartMs - config.nowTime;
      const isFuture = windowStartMs >= config.nowTime + activationDelay - 1;
      const multiplier = multiplierForCell({
        distanceBps,
        windowStartOffsetMs: Math.max(0, offset),
        windowDurationMs: duration,
        currentPrice: config.anchorPrice,
        pMin: band.pMin,
        pMax: band.pMax,
        houseEdgeBps: config.houseEdgeBps,
        volBpsPerSqrtSec: config.volBpsPerSqrtSec,
        minMultiplier: config.minMultiplier,
        maxMultiplier: config.maxMultiplier,
      });
      const outOfRange = distanceBps < minDistance || distanceBps > maxDistance;
      const disabled = !isFuture || outOfRange;
      cells.push({
        id: `r${row}c${col}`,
        row,
        col,
        pMin: band.pMin,
        pMax: band.pMax,
        windowStartMs,
        windowEndMs,
        windowStartOffsetMs: offset,
        windowDurationMs: duration,
        distanceBps,
        multiplier,
        multiplierBps: Math.round(multiplier * 10_000),
        disabled,
        reason: !isFuture
          ? "Locked"
          : outOfRange
            ? "Out of range"
            : undefined,
      });
    }
  }

  return cells;
}
