import {
  quoteCell as quoteCellEmpirical,
  type DisabledReason,
} from "./empiricalPricing";

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
  /** Set by the empirical-table quote when the engine would refuse
   *  this cell (UNCALIBRATED, EV_POSITIVE, INVALID_WINDOW, …).
   *  When non-null the canvas MUST treat the cell as disabled — the
   *  multiplier shown is only the floor and clicking would 400. */
  disabledReason?: DisabledReason | null;
  /** Heatmap overlay: number of OTHER players with an ACTIVE bet on
   *  this exact (band, window). 0 / undefined ⇒ paint normal. Set
   *  by the trade page after polling `/trade/heatmap`. */
  nBets?: number;
  /** Sum of stakes across all ACTIVE bets on this cell, in wei (as
   *  a decimal string to preserve precision). Surfaced in the cell
   *  hover tooltip. */
  totalStakeWei?: string;
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
  minMultiplier: 1.1,
  maxMultiplier: 500,
  houseEdgeBps: 500,
  volBpsPerSqrtSec: 2.8,
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

export function tapPreviewOdds(params: {
  currentPrice: number;
  nowTime: number;
  pMin: number;
  pMax: number;
  windowStartMs: number;
  windowEndMs: number;
  stepMs?: number;
  points?: number;
  volatility?: number;
  houseEdgeBps?: number;
  minMultiplier?: number;
  maxMultiplier?: number;
}) {
  const min = params.minMultiplier ?? DEFAULT_GRID.minMultiplier;
  const max = params.maxMultiplier ?? DEFAULT_GRID.maxMultiplier;
  const price = params.currentPrice;
  if (
    !Number.isFinite(price) ||
    !Number.isFinite(params.pMin) ||
    !Number.isFinite(params.pMax) ||
    price <= 0 ||
    params.pMin <= 0 ||
    params.pMax <= 0 ||
    params.windowEndMs <= params.nowTime
  ) {
    return min;
  }

  const stepMs = Math.max(100, params.stepMs ?? 500);
  const points = Math.max(31, Math.min(140, Math.round(params.points ?? 100)));
  const volatility = Math.max(0.000001, params.volatility ?? 0.001);
  const edgeFactor = 1 - (params.houseEdgeBps ?? DEFAULT_GRID.houseEdgeBps) / 10_000;
  const stepStart = Math.max(1, Math.ceil((params.windowStartMs - params.nowTime) / stepMs));
  const stepEnd = Math.max(stepStart, Math.ceil((params.windowEndMs - params.nowTime) / stepMs));
  const y0 = Math.log(price);
  const yMin = y0 - 4 * volatility * Math.sqrt(stepEnd);
  const yMax = y0 + 4 * volatility * Math.sqrt(stepEnd);
  const dy = (yMax - yMin) / (points - 1);
  if (!Number.isFinite(dy) || dy <= 0) return min;

  const targetMin = Math.log(Math.min(params.pMin, params.pMax));
  const targetMax = Math.log(Math.max(params.pMin, params.pMax));
  const inBand: boolean[] = [];
  for (let i = 0; i < points; i += 1) {
    const y = yMin + i * dy;
    inBand.push(y >= targetMin && y <= targetMax);
  }

  let state = new Array<number>(points).fill(0);
  const initialIndex = Math.round(clamp((y0 - yMin) / dy, 0, points - 1));
  state[initialIndex] = 1;

  const transitions: number[][] = [];
  for (let from = 0; from < points; from += 1) {
    const weights = new Array<number>(points);
    let total = 0;
    const fromY = yMin + from * dy;
    for (let to = 0; to < points; to += 1) {
      const toY = yMin + to * dy;
      const z = (toY - fromY) / volatility;
      const weight = Math.exp(-0.5 * z * z);
      weights[to] = weight;
      total += weight;
    }
    transitions.push(total > 0 ? weights.map((weight) => weight / total) : weights);
  }

  for (let step = 1; step <= stepEnd; step += 1) {
    const next = new Array<number>(points).fill(0);
    for (let from = 0; from < points; from += 1) {
      const mass = state[from];
      if (mass <= 0) continue;
      const weights = transitions[from];
      for (let to = 0; to < points; to += 1) {
        next[to] += mass * weights[to];
      }
    }
    if (step >= stepStart) {
      for (let i = 0; i < points; i += 1) {
        if (inBand[i]) next[i] = 0;
      }
    }
    state = next;
  }

  const missProbability = clamp(
    state.reduce((sum, value) => sum + value, 0),
    0,
    1
  );
  const pHit = clamp(1 - missProbability, 0.0001, 0.999);
  return clamp(edgeFactor / pHit, min, max);
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

/// FALLBACK ONLY. The authoritative multiplier for a real bet comes
/// from the signed `/trade/quote` request made on click. This mirrors
/// the backend Bachelier approximation only so geometry builders have
/// a directional placeholder before the trade page overlays preview
/// odds.
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
export type DynamicTapGridConfig = {
  /** Latched reference price ("level 0"). Stays constant for a session
   *  so price levels are absolutely stable: a cell at `level=3` always
   *  occupies `[anchor*(1+(3-0.5)*step/10000), anchor*(1+(3+0.5)*step/10000)]`,
   *  regardless of where the snake is right now. This is what lets bets
   *  pin permanently — placing a bet on level=3 means betting on that
   *  exact price band forever. */
  anchorPrice: number;
  /** Live snake position. Used to decide *which* levels to emit (the
   *  band around current), not to compute pMin/pMax. */
  currentPrice: number;
  /** A fixed origin (ms epoch). Cell windows are
   *  `[origin + col*duration, origin + (col+1)*duration]`. */
  originMs: number;
  nowTime: number;
  /** How many price levels above `currentPrice` to emit. */
  rowsAbove: number;
  /** How many price levels below `currentPrice` to emit. */
  rowsBelow: number;
  /** Past time-columns to keep visible (for cells whose window already
   *  opened — used so locked bets keep showing). */
  pastCols: number;
  /** Future time-columns to emit (still bettable). */
  futureCols: number;
  columnDurationMs: number;
  activationDelayMs?: number;
  priceStepBps?: number;
  /** Fixed absolute price step, in USD/USDT units. Real-price Tap
   *  Trading uses this so the chart ruler can say "one row = $0.50"
   *  instead of moving the row size as a percentage of price. */
  priceStepUsd?: number;
  minDistanceBps?: number;
  maxDistanceBps?: number;
  minMultiplier?: number;
  maxMultiplier?: number;
  houseEdgeBps?: number;
  volBpsPerSqrtSec?: number;
  /** Window durations the engine is configured to accept
   *  (`[touch] allowed_window_ms`). When omitted the catalog only
   *  emits the column duration. Cells whose duration is outside
   *  this list get `disabledReason = "INVALID_WINDOW"` from the
   *  empirical quote. */
  allowedDurationsMs?: ReadonlyArray<number>;
};

/** Cells live at *absolute* integer price levels measured in
 *  `priceStepBps` from `anchorPrice`. The window of emitted levels
 *  follows `currentPrice` so the player always sees a band of cells
 *  around the live snake position — no fixed grid that the snake can
 *  escape, no cells that move once spawned. Stable ids `lvl{N}c{C}`
 *  keep React keys consistent and let bets reference cells across
 *  re-renders.
 *
 *  Geometry mirrors what STONKS-style touch UIs do: dim, infinite
 *  background grid; a bright "active zone" of cells in the snake's
 *  vicinity; bets pinned to absolute (price, time) by their snapshot
 *  rather than by their position in the live grid. */
export function buildDynamicCells(config: DynamicTapGridConfig): TapGridCell[] {
  const duration = config.columnDurationMs;
  const activationDelay = config.activationDelayMs ?? DEFAULT_GRID.activationDelayMs;
  const minDistance = config.minDistanceBps ?? DEFAULT_GRID.minDistanceBps;
  const maxDistance = config.maxDistanceBps ?? DEFAULT_GRID.maxDistanceBps;

  // Absolute price step (units of price). A "level" is an integer
  // number of `step`s away from `anchorPrice`. Levels never move.
  // Legacy RUSH_INDEX uses bps; real-price mode uses a fixed dollar
  // increment per row, e.g. ETH/USD = $0.50.
  const priceStepBps = config.priceStepBps ?? DEFAULT_GRID.priceStepBps;
  const fixedUsdStep = config.priceStepUsd && config.priceStepUsd > 0
    ? config.priceStepUsd
    : null;
  const step = fixedUsdStep ?? config.anchorPrice * (priceStepBps / 10_000);
  if (step <= 0) return [];

  // Current snake level. Real-price mode mirrors Euphoria: row N is the
  // absolute price band `[N * priceInterval, (N + 1) * priceInterval)`.
  // Legacy RUSH_INDEX keeps the old anchor-relative bps grid.
  const currentLevelFloat = fixedUsdStep
    ? config.currentPrice / step
    : (config.currentPrice - config.anchorPrice) / step;
  const centerLevel = fixedUsdStep
    ? Math.floor(currentLevelFloat)
    : Math.round(currentLevelFloat);
  const minLevel = centerLevel - config.rowsBelow;
  const maxLevel = centerLevel + config.rowsAbove;

  const firstFutureCol = Math.ceil(
    (config.nowTime + activationDelay - config.originMs) / duration
  );
  const startCol = firstFutureCol - config.pastCols;
  const endCol = firstFutureCol + config.futureCols - 1;

  const cells: TapGridCell[] = [];
  for (let level = minLevel; level <= maxLevel; level += 1) {
    // Absolute, immutable band for this level. Real-price mode keeps
    // each ruler row at a fixed dollar width; legacy mode keeps the
    // old bps geometry.
    const pMin = fixedUsdStep
      ? Math.max(0.00000001, level * step)
      : config.anchorPrice * (1 + ((level - 0.5) * priceStepBps) / 10_000);
    const pMax = fixedUsdStep
      ? Math.max(0.00000001, (level + 1) * step)
      : config.anchorPrice * (1 + ((level + 0.5) * priceStepBps) / 10_000);
    // Distance from the *current* snake to the band's near edge,
    // in bps. Used for client-side multiplier preview only — the
    // backend re-derives this against its own current price.
    const distanceBps = distanceToBandBps(config.currentPrice, pMin, pMax);
    // `row` is a viewport-relative index (0 = top of visible band)
    // so the canvas can sort/paint deterministically. Note this row
    // index changes as the window slides, but the cell *identity*
    // (price band, id) does not.
    const row = maxLevel - level;

    for (let col = startCol; col <= endCol; col += 1) {
      const windowStartMs = config.originMs + col * duration;
      const windowEndMs = windowStartMs + duration;
      const offset = windowStartMs - config.nowTime;
      const isFuture = windowStartMs >= config.nowTime + activationDelay - 1;

      // Authoritative price comes from the empirical table the
      // engine itself uses. `quoteCell` returns either a real
      // multiplier or a `disabledReason` mirroring whatever the
      // engine would refuse — never a Bachelier guess. The cell
      // carries this multiplier as part of its identity until it
      // expires; nothing recomputes per-tick.
      const quote = quoteCellEmpirical({
        distanceBps,
        durationMs: duration,
        offsetMs: Math.max(0, offset),
        allowedDurationMs: config.allowedDurationsMs ?? [duration],
      });
      const outOfRange = distanceBps < minDistance || distanceBps > maxDistance;
      const disabled = !isFuture || outOfRange || quote.disabledReason !== null;
      cells.push({
        // Stable id keyed on the absolute (level, col) pair — a cell
        // at (level=3, col=12) is *always* the same cell across
        // ticks, regardless of viewport.
        id: `lvl${level}c${col}`,
        row,
        col,
        pMin,
        pMax,
        windowStartMs,
        windowEndMs,
        windowStartOffsetMs: offset,
        windowDurationMs: duration,
        distanceBps,
        multiplier: quote.multiplier,
        multiplierBps: quote.multiplierBps,
        disabled,
        reason: !isFuture
          ? "Locked"
          : outOfRange
            ? "Out of range"
            : quote.disabledReason
              ? humanizeDisabledReason(quote.disabledReason)
              : undefined,
        disabledReason: quote.disabledReason,
      });
    }
  }

  return cells;
}

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

function humanizeDisabledReason(reason: DisabledReason): string {
  switch (reason) {
    case "PAUSED":
      return "Paused";
    case "UNCALIBRATED":
      return "Uncalibrated";
    case "EV_POSITIVE":
      return "Too easy";
    case "INVALID_BAND":
      return "Invalid band";
    case "INVALID_WINDOW":
      return "Invalid window";
  }
}
