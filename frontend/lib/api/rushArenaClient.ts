import type { TapGridCell } from "@/lib/taptrade/grid";
import { getAccessToken } from "@/lib/api/taptradeAuth";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ||
  API_URL.replace(/^http/, "ws").replace(/\/$/, "") + "/ws";

export const RUSH_MARKET = "RUSH_INDEX" as const;
export const RUSH_DISPLAY = "Rush Index";
export type TapTradeSymbol = typeof RUSH_MARKET | "ETHUSDT" | "BTCUSDT" | "SOLUSDT" | string;
// Mock mode is OPT-IN for development. In production builds it stays
// off no matter what — the trade page must consume real quotes from the
// backend or refuse to take a bet. See audit report ("Pricing OK to
// ship requires backend-authoritative multiplier").
//
// Per-page override: `app/preview/page.tsx` calls
// `setRushArenaMockMode(true)` at module load so the sandbox always
// runs against the local seeded RNG, while `app/(dashboard)/trade`
// uses the real backend.
let _mockOverride: boolean | null = null;
export function setRushArenaMockMode(v: boolean | null) {
  _mockOverride = v;
}
export function isRushArenaMockMode(): boolean {
  if (_mockOverride !== null) return _mockOverride;
  return (
    typeof process !== "undefined" &&
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_RUSH_ARENA_MOCK === "true"
  );
}
// Back-compat re-export. Some call sites still read the snapshot at
// import time (which is wrong now that we have an override). Marked
// `as` to keep TS happy but always returns the live value.
export const rushArenaMockMode = false as unknown as boolean;

export type RushTick = {
  tick: number;
  timestampMs: number;
  price: number;
};

export type RushPathPoint = RushTick;

export type RushRound = {
  roundId: string;
  market: TapTradeSymbol;
  displayName: string;
  startedAt: number;
  endsAt: number;
  tickMs: number;
  totalTicks: number;
  currentTick: number;
  initialPrice: number;
  currentPrice: number;
  volatility: number;
  serverSeedHash: string;
  revealedSeed: string | null;
  status: "active" | "ended";
};

export type ProvablyFairState = {
  roundId: string;
  algorithm: string;
  serverSeedHash: string;
  revealedSeed: string | null;
  tickMs: number;
  volatility: number;
  initialPrice: number;
  nextSeedRevealAt: number;
};

export type RushQuote = {
  multiplierBps: number;
  multiplier: number;
  quoteToken: string;
  expiresAt: string;
};

export type RushBetStatus = "PENDING" | "ACTIVE" | "WON" | "LOST" | "CANCELLED";

export type RushArenaBet = {
  id: string;
  market: TapTradeSymbol;
  symbol: TapTradeSymbol;
  cell: TapGridCell;
  stakeAmount: number;
  stakeAmountWei: string;
  multiplier: number;
  multiplierBps: number;
  potentialWin: number;
  status: RushBetStatus;
  finalResult?: RushBetStatus | null;
  pMin?: number;
  pMax?: number;
  windowStartMs?: number;
  windowEndMs?: number;
  price0: number;
  t0: number;
  placedAt: number;
  activationAt?: number;
  resolvedAt?: number;
  touchedAt?: number;
  seedId?: string;
  vrfSeed?: string | null;
  seedHash?: string;
  vrfRequestId?: string | null;
  vrfTxHash?: string | null;
  randomWords?: string[];
  tickMs?: number;
  pathConfigVersion?: string;
  pathPointsHash?: string;
  pathRegime?: string;
  path?: RushPathPoint[];
};

export type RushArenaEvent =
  | { type: "PriceUpdate"; payload: RushTick }
  | { type: "RoundState"; payload: RushRound }
  | { type: "ProvablyFairState"; payload: ProvablyFairState }
  | { type: "BetsSnapshot"; payload: RushArenaBet[] }
  | { type: "BetPlaced"; payload: RushArenaBet }
  | { type: "ResolutionEvent"; payload: RushArenaBet };

export type RushBetVerification = {
  betId: string;
  seedId: string;
  seedHash: string;
  vrfRequestId: string | null;
  vrfTxHash: string | null;
  pathConfigVersion: string;
  pathPointsHash: string;
  regeneratedPathPointsHash: string;
  squareId: string;
  pMin: number;
  pMax: number;
  tStart: number;
  tEnd: number;
  result: string;
  regeneratedResult: string;
  verificationStatus: "VALID" | "INVALID";
  pathRegime: string;
};

type BackendWsMessage =
  | {
      type: "PriceUpdate";
      payload: { symbol: string; price_q8: string | number; timestamp: number };
    }
  | {
      type: "PricesSnapshot";
      payload: {
        prices: Array<{ symbol: string; price_q8: string | number; timestamp: number }>;
      };
    }
  | { type: string; payload?: unknown };

type RequestQuoteParams = {
  symbol?: TapTradeSymbol;
  cell: TapGridCell;
  stakeAmountWei: string;
  livePrice?: number;
  nowMs?: number;
};

export type QuoteGridCellRequest = {
  cellId: string;
  direction: "UP" | "DOWN";
  targetRowMinQ8: string;
  targetRowMaxQ8: string;
  windowStartOffsetMs: number;
  windowDurationMs: number;
};

/** Anonymised bet row from `/trade/bets/public` and `/trade/wins/public`. */
export type PublicBetEntry = {
  id: string;
  symbol: string;
  /** Display name — `username` if set, else short wallet (0xABCD…1234). */
  playerHandle: string;
  /** Stake in wei (string to preserve precision). */
  stakeWei: string;
  multiplierBps: number;
  /** Stake × multiplier_bps / 10_000, in wei. */
  potentialPayoutWei: string;
  placedAtMs: number;
  windowEndMs: number;
  /** ms timestamp; non-null only on rows from `/wins/public`. */
  resolvedAtMs: number | null;
};

export type LeaderboardEntry = {
  rank: number;
  player: string;
  wins: number;
  /** Cumulative realised PnL in wei (string for precision). */
  realizedPnlWei: string;
};

export type QuoteGridCellResponse = {
  cellId: string;
  probability: number;
  distanceBps: number;
  impliedPTouchBps: number;
  multiplierBps: number;
  multiplier: number;
  maxStakeWei: string;
  disabledReason: string | null;
  fromEmpirical: boolean;
  flags: string[];
  userEv: number;
};

export type QuoteGridResponse = {
  symbol: string;
  serverTimeMs: number;
  entryPriceQ8: string;
  houseEdgeBps: number;
  maxPayoutPerBetWei: string;
  cells: QuoteGridCellResponse[];
};

export type QuoteMatrixRequest = {
  symbol: TapTradeSymbol;
  timeIntervalMs: number;
  priceInterval: number;
  startTimeIndex: number;
  timeSteps: number;
  startPriceIndex: number;
  priceSteps: number;
};

export type QuoteMatrixResponse = {
  symbol: string;
  serverTimeMs: number;
  entryPriceQ8: string;
  startingIndex: {
    timeIndex: number;
    priceIndex: number;
  };
  timeSteps: number;
  priceSteps: number;
  grid: Uint16Array;
  houseEdgeBps: number;
  maxPayoutPerBetWei: string;
  acceptingBets: boolean;
};

type PlaceBetParams = {
  symbol?: TapTradeSymbol;
  quote: RushQuote;
  cell: TapGridCell;
  stakeAmount: number;
  stakeAmountWei: string;
  price0: number;
  clientBetId?: string;
};

type BackendRushArenaBet = Partial<Omit<RushArenaBet, "cell" | "status">> & {
  id?: string;
  status?: string;
  finalResult?: string | null;
  cell?: Partial<TapGridCell>;
  cellId?: string;
  row?: number;
  col?: number;
  distanceBps?: number;
  pMin?: number;
  pMax?: number;
  windowStartMs?: number;
  windowEndMs?: number;
  windowDurationMs?: number;
  seedId?: string;
  vrfSeed?: string | null;
  seedHash?: string;
  vrfRequestId?: string | null;
  vrfTxHash?: string | null;
  randomWords?: string[];
  pathConfigVersion?: string;
  pathPointsHash?: string;
  pathRegime?: string;
  path?: RushPathPoint[];
};

const DAY_MS = 86_400_000;
const tickMs = 150;
const initialPrice = 1_245.73;
let mockTick = 235_987;
let mockPrice = initialPrice;
let mockVelocity = 0;
let mockRng = 0x9f2c8b7a;
let mockRoundStartedAt = Date.now() - mockTick * tickMs;
const mockSeedHash = "9f2c8b7a1d3e5f6a4c0d43fcd9f6aa88351245898d1619603132e34";

function syncMockClock() {
  mockRoundStartedAt = Date.now() - mockTick * tickMs;
}

function seededRandom() {
  mockRng ^= mockRng << 13;
  mockRng ^= mockRng >>> 17;
  mockRng ^= mockRng << 5;
  return ((mockRng >>> 0) / 4_294_967_296);
}

function normalSample() {
  const u = Math.max(seededRandom(), 1e-9);
  const v = Math.max(seededRandom(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Soft band: how far the line is *allowed* to wander before mean
// reversion ramps up. Beyond `HARD_CAP_BPS` an extra elastic pull is
// added so it can never escape the playable zone. These numbers were
// tuned so that the snake makes the cells reachable: with priceStepBps
// = 40 and 9 rows, the catalog covers ±180 bps from the anchor — the
// line therefore needs to roam comfortably inside ~±150 bps and only
// rarely brush the edges.
const SOFT_BAND_BPS = 60;   // ramp mean reversion
const HARD_CAP_BPS = 150;   // hard elastic boundary

function nextMockTick(): RushTick {
  mockTick += 1;

  const deviationBps = ((mockPrice - initialPrice) / initialPrice) * 10_000;
  const absDev = Math.abs(deviationBps);

  // Slow cyclical so the line has texture, not a perfect random walk.
  const cyclical =
    Math.sin(mockTick / 19) * 0.00006 +
    Math.sin(mockTick / 61) * 0.00004;

  // Base mean reversion grows quadratically once we're past the soft
  // band: tiny near center, strong near the cap. This is what stops
  // the price from chasing extremes.
  const baseReversion = -deviationBps / 10_000 * 0.0003;
  const overflow = Math.max(0, absDev - SOFT_BAND_BPS) / Math.max(1, HARD_CAP_BPS - SOFT_BAND_BPS);
  const elastic = -Math.sign(deviationBps) * overflow * overflow * 0.0018;
  const meanReversion = baseReversion + elastic;

  // Random impulse — slightly tamer than before so a single bad tick
  // can't fling the line off the chart.
  const impulse = normalSample() * 0.00050 + cyclical + meanReversion;

  // Velocity damping + clamp.
  mockVelocity = Math.max(-0.0024, Math.min(0.0024, mockVelocity * 0.86 + impulse));
  mockPrice = mockPrice * (1 + mockVelocity);

  // Hard wall: even if the simulation ever reaches the cap, snap it
  // back inside the playable band on the same tick. This is a safety
  // net — the elastic term should already have bent the trajectory.
  const capPrice = initialPrice * HARD_CAP_BPS / 10_000;
  if (mockPrice > initialPrice + capPrice) {
    mockPrice = initialPrice + capPrice;
    mockVelocity = -Math.abs(mockVelocity) * 0.5;
  } else if (mockPrice < initialPrice - capPrice) {
    mockPrice = initialPrice - capPrice;
    mockVelocity = Math.abs(mockVelocity) * 0.5;
  }
  mockPrice = Math.max(100, mockPrice);

  return {
    tick: mockTick,
    timestampMs: mockRoundStartedAt + mockTick * tickMs,
    price: mockPrice,
  };
}

function currentRound(): RushRound {
  syncMockClock();
  const startedAt = mockRoundStartedAt;
  return {
    roundId: "2026-04-30-RUSH-INDEX",
    market: RUSH_MARKET,
    displayName: RUSH_DISPLAY,
    startedAt,
    endsAt: startedAt + DAY_MS,
    tickMs,
    totalTicks: Math.floor(DAY_MS / tickMs),
    currentTick: mockTick,
    initialPrice,
    currentPrice: mockPrice,
    volatility: 0.001,
    serverSeedHash: mockSeedHash,
    revealedSeed: null,
    status: "active",
  };
}

/// Distance in bps from the latest mock price to the nearest cell edge.
function bpsBetween(price: number, cell: QuoteGridCellRequest): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  const pMin = Number(cell.targetRowMinQ8) / 1e8;
  const pMax = Number(cell.targetRowMaxQ8) / 1e8;
  const distance = Math.min(Math.abs(price - pMin), Math.abs(price - pMax));
  return Math.abs((distance / price) * 10_000);
}

function decimalPriceToQ8(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return BigInt(Math.round(value * 1e8)).toString();
}

function decodeUint16Base64(value: string): Uint16Array {
  const binary = typeof globalThis.atob === "function"
    ? globalThis.atob(value)
    : ((globalThis as unknown as {
        Buffer?: { from(input: string, encoding: "base64"): { toString(encoding: "binary"): string } };
      }).Buffer?.from(value, "base64").toString("binary") ?? "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const out = new Uint16Array(Math.floor(bytes.length / 2));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = view.getUint16(i * 2, true);
  }
  return out;
}

function provablyFair(): ProvablyFairState {
  const round = currentRound();
  return {
    roundId: round.roundId,
    algorithm: "BLAKE2b(seed + tick) -> uniform -> normal return -> price",
    serverSeedHash: round.serverSeedHash,
    revealedSeed: null,
    tickMs: round.tickMs,
    volatility: round.volatility,
    initialPrice: round.initialPrice,
    nextSeedRevealAt: round.endsAt,
  };
}

function normalizeBetStatus(value: string | undefined): RushBetStatus {
  if (value === "WIN") return "WON";
  if (value === "LOSS") return "LOST";
  if (
    value === "PENDING" ||
    value === "ACTIVE" ||
    value === "WON" ||
    value === "LOST" ||
    value === "CANCELLED"
  ) {
    return value;
  }
  return "PENDING";
}

function cellFromBackendBet(
  response: BackendRushArenaBet,
  fallback?: TapGridCell
): TapGridCell {
  const source = response.cell ?? {};
  const pMin = response.pMin ?? source.pMin ?? fallback?.pMin ?? 0;
  const pMax = response.pMax ?? source.pMax ?? fallback?.pMax ?? pMin;
  const windowStartMs =
    response.windowStartMs ?? source.windowStartMs ?? fallback?.windowStartMs ?? Date.now();
  const windowEndMs =
    response.windowEndMs ??
    source.windowEndMs ??
    fallback?.windowEndMs ??
    windowStartMs + (response.windowDurationMs ?? fallback?.windowDurationMs ?? 3_000);
  return {
    id: response.cellId ?? source.id ?? fallback?.id ?? response.id ?? "bet-cell",
    row: response.row ?? source.row ?? fallback?.row ?? 0,
    col: response.col ?? source.col ?? fallback?.col ?? 0,
    pMin,
    pMax,
    windowStartMs,
    windowEndMs,
    windowStartOffsetMs:
      source.windowStartOffsetMs ?? fallback?.windowStartOffsetMs ?? windowStartMs - Date.now(),
    windowDurationMs:
      response.windowDurationMs ??
      source.windowDurationMs ??
      fallback?.windowDurationMs ??
      Math.max(1, windowEndMs - windowStartMs),
    distanceBps: response.distanceBps ?? source.distanceBps ?? fallback?.distanceBps ?? 0,
    multiplier: response.multiplier ?? source.multiplier ?? fallback?.multiplier ?? 1,
    multiplierBps:
      response.multiplierBps ??
      source.multiplierBps ??
      fallback?.multiplierBps ??
      Math.round((response.multiplier ?? 1) * 10_000),
    disabled: true,
    reason: source.reason ?? fallback?.reason,
  };
}

function normalizeBackendBet(
  response: BackendRushArenaBet,
  fallback?: Partial<RushArenaBet> & { cell?: TapGridCell }
): RushArenaBet {
  const cell = cellFromBackendBet(response, fallback?.cell);
  const multiplier =
    response.multiplier ??
    fallback?.multiplier ??
    ((response.multiplierBps ?? fallback?.multiplierBps ?? 10_000) / 10_000);
  const stakeAmount = response.stakeAmount ?? fallback?.stakeAmount ?? 0;
  const fallbackStatus = fallback?.status ?? "PENDING";
  const symbol = response.symbol ?? fallback?.symbol ?? RUSH_MARKET;
  return {
    id: response.id ?? fallback?.id ?? `rush-${Date.now()}`,
    market: symbol,
    symbol,
    cell,
    stakeAmount,
    stakeAmountWei: response.stakeAmountWei ?? fallback?.stakeAmountWei ?? "0",
    multiplier,
    multiplierBps: response.multiplierBps ?? fallback?.multiplierBps ?? Math.round(multiplier * 10_000),
    potentialWin: response.potentialWin ?? fallback?.potentialWin ?? stakeAmount * multiplier,
    status: response.status ? normalizeBetStatus(response.status) : fallbackStatus,
    finalResult: response.finalResult ? normalizeBetStatus(response.finalResult) : fallback?.finalResult,
    pMin: response.pMin ?? cell.pMin,
    pMax: response.pMax ?? cell.pMax,
    windowStartMs: response.windowStartMs ?? cell.windowStartMs,
    windowEndMs: response.windowEndMs ?? cell.windowEndMs,
    price0: response.price0 ?? fallback?.price0 ?? 0,
    t0: response.t0 ?? fallback?.t0 ?? response.placedAt ?? Date.now(),
    placedAt: response.placedAt ?? fallback?.placedAt ?? Date.now(),
    activationAt: response.activationAt ?? fallback?.activationAt,
    resolvedAt: response.resolvedAt ?? fallback?.resolvedAt,
    touchedAt: response.touchedAt ?? fallback?.touchedAt,
    seedId: response.seedId ?? fallback?.seedId,
    vrfSeed: response.vrfSeed ?? fallback?.vrfSeed,
    seedHash: response.seedHash ?? fallback?.seedHash,
    vrfRequestId: response.vrfRequestId ?? fallback?.vrfRequestId,
    vrfTxHash: response.vrfTxHash ?? fallback?.vrfTxHash,
    randomWords: response.randomWords ?? fallback?.randomWords,
    tickMs: response.tickMs ?? fallback?.tickMs,
    pathConfigVersion: response.pathConfigVersion ?? fallback?.pathConfigVersion,
    pathPointsHash: response.pathPointsHash ?? fallback?.pathPointsHash,
    pathRegime: response.pathRegime ?? fallback?.pathRegime,
    path: response.path ?? fallback?.path,
  };
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  // Engine auth middleware reads `Authorization: Bearer <jwt>` from the
  // header. The token sits in a `taptrade_access_token` document cookie
  // (planted client-side after SIWE), so we lift it explicitly — relying
  // on `credentials: "include"` alone would only ship cookies, not the
  // header the middleware checks.
  const token = getAccessToken();
  const response = await fetch(`${API_URL}/api/v1${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    let message = `${path} failed: ${response.status}`;
    try {
      const error = await response.json() as { message?: string };
      if (error.message) message = error.message;
    } catch {
      // Keep the status fallback when the backend returns a non-JSON error.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

// ── Public-feed helpers (panels) ──────────────────────────────────

function shortWallet(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function normalizePublicBet(b: {
  id: string;
  symbol: string;
  player_handle: string;
  stake_wei: string;
  multiplier_bps: number;
  potential_payout_wei: string;
  placed_at_ms: number;
  window_end_ms: number;
  resolved_at_ms: number | null;
}): PublicBetEntry {
  return {
    id: b.id,
    symbol: b.symbol,
    playerHandle: b.player_handle,
    stakeWei: b.stake_wei,
    multiplierBps: b.multiplier_bps,
    potentialPayoutWei: b.potential_payout_wei,
    placedAtMs: b.placed_at_ms,
    windowEndMs: b.window_end_ms,
    resolvedAtMs: b.resolved_at_ms,
  };
}

// Mock rows preserve the look-and-feel of the panels in `/preview`,
// where there's no engine to query. They mirror the multiplier curve
// you'd see post-Caminho-B (~1.5–2.5× near the snake, scaling out).
function mockPublicActive(): PublicBetEntry[] {
  const now = Date.now();
  const seed = [
    { handle: "CryptoNinja", stake: 5, mult: 2.05 },
    { handle: "MoonWalker", stake: 2, mult: 1.72 },
    { handle: "NightTrader", stake: 5, mult: 2.48 },
    { handle: "GreenArrow", stake: 10, mult: 1.95 },
    { handle: "BullRush", stake: 5, mult: 4.21 },
    { handle: "0x4f9c…b21d", stake: 1, mult: 8.36 },
    { handle: "Satoshi_7", stake: 2, mult: 2.32 },
    { handle: "HODLQueen", stake: 1, mult: 1.41 },
  ];
  return seed.map((row, i) => {
    const stakeMilliEth = row.stake;
    const stakeWei = (BigInt(stakeMilliEth) * BigInt("1000000000000000")).toString();
    const payoutMilliEth = stakeMilliEth * row.mult;
    const payoutWei = BigInt(Math.round(payoutMilliEth * 1e15)).toString();
    return {
      id: `mock-active-${i}`,
      symbol: RUSH_MARKET,
      playerHandle: row.handle,
      stakeWei,
      multiplierBps: Math.round(row.mult * 10_000),
      potentialPayoutWei: payoutWei,
      placedAtMs: now - (i + 1) * 700,
      windowEndMs: now + 3_000 + i * 500,
      resolvedAtMs: null,
    };
  });
}

function mockPublicWins(): PublicBetEntry[] {
  const now = Date.now();
  const seed = [
    { handle: "BullRush", stake: 5, mult: 1.85, agoMs: 8_000 },
    { handle: "Satoshi_7", stake: 2, mult: 2.24, agoMs: 23_000 },
    { handle: "HODLQueen", stake: 1, mult: 1.6, agoMs: 41_000 },
    { handle: "CryptoNinja", stake: 10, mult: 2.05, agoMs: 67_000 },
    { handle: "0x88af…3c01", stake: 5, mult: 4.86, agoMs: 92_000 },
    { handle: "MoonWalker", stake: 2, mult: 8.73, agoMs: 134_000 },
  ];
  return seed.map((row, i) => {
    const stakeMilliEth = row.stake;
    const stakeWei = (BigInt(stakeMilliEth) * BigInt("1000000000000000")).toString();
    const payoutWei = BigInt(Math.round(stakeMilliEth * row.mult * 1e15)).toString();
    return {
      id: `mock-win-${i}`,
      symbol: RUSH_MARKET,
      playerHandle: row.handle,
      stakeWei,
      multiplierBps: Math.round(row.mult * 10_000),
      potentialPayoutWei: payoutWei,
      placedAtMs: now - row.agoMs - 3_000,
      windowEndMs: now - row.agoMs,
      resolvedAtMs: now - row.agoMs,
    };
  });
}

function mockLeaderboard(): LeaderboardEntry[] {
  return [
    { rank: 1, player: "BullRush", wins: 23, realizedPnlWei: "12540000000000000000" },
    { rank: 2, player: "MoonWalker", wins: 19, realizedPnlWei: "9875500000000000000" },
    { rank: 3, player: "Satoshi_7", wins: 16, realizedPnlWei: "7420750000000000000" },
    { rank: 4, player: "HODLQueen", wins: 14, realizedPnlWei: "6125200000000000000" },
    { rank: 5, player: "CryptoNinja", wins: 11, realizedPnlWei: "4860000000000000000" },
  ];
}

export const rushArenaClient = {
  async getHealth() {
    if (isRushArenaMockMode()) return { ok: true, mode: "mock" };
    return requestJson<{ ok: boolean }>("/health");
  },

  async getPrices() {
    if (isRushArenaMockMode()) {
      return [{ market: RUSH_MARKET, symbol: RUSH_MARKET, price: mockPrice, timestampMs: Date.now() }];
    }
    return requestJson<unknown>("/prices");
  },

  async getMultiplierConfig() {
    if (isRushArenaMockMode()) {
      return {
        houseEdgeBps: 500,
        minMultiplierBps: 10_200,
        maxMultiplierBps: 200_000,
        volBpsPerSqrtSec: 24,
        minDistanceBps: 0,
        maxDistanceBps: 1_000_000,
        activationDelayMs: 3_000,
        allowedWindowMs: [3_000],
      };
    }
    return requestJson<unknown>("/trade/multiplier_config");
  },

  async getQuoteMatrix(request: QuoteMatrixRequest): Promise<QuoteMatrixResponse> {
    if (isRushArenaMockMode()) {
      const total = Math.max(0, request.timeSteps * request.priceSteps);
      const grid = new Uint16Array(total);
      grid.fill(110);
      return {
        symbol: request.symbol,
        serverTimeMs: Date.now(),
        entryPriceQ8: String(Math.round(mockPrice * 1e8)),
        startingIndex: {
          timeIndex: request.startTimeIndex,
          priceIndex: request.startPriceIndex,
        },
        timeSteps: request.timeSteps,
        priceSteps: request.priceSteps,
        grid,
        houseEdgeBps: 500,
        maxPayoutPerBetWei: "10000000000000000000",
        acceptingBets: true,
      };
    }

    const response = await requestJson<{
      symbol: string;
      server_time_ms: number;
      entry_price_q8: string;
      starting_index: {
        time_index: number;
        price_index: number;
      };
      time_steps: number;
      price_steps: number;
      grid: string;
      house_edge_bps: number;
      max_payout_per_bet_wei: string;
      accepting_bets: boolean;
    }>("/trade/quote-matrix", {
      method: "POST",
      body: JSON.stringify({
        symbol: request.symbol,
        time_interval_ms: request.timeIntervalMs,
        price_interval_q8: decimalPriceToQ8(request.priceInterval),
        start_time_index: request.startTimeIndex,
        time_steps: request.timeSteps,
        start_price_index: request.startPriceIndex,
        price_steps: request.priceSteps,
      }),
    });

    return {
      symbol: response.symbol,
      serverTimeMs: response.server_time_ms,
      entryPriceQ8: response.entry_price_q8,
      startingIndex: {
        timeIndex: response.starting_index.time_index,
        priceIndex: response.starting_index.price_index,
      },
      timeSteps: response.time_steps,
      priceSteps: response.price_steps,
      grid: decodeUint16Base64(response.grid),
      houseEdgeBps: response.house_edge_bps,
      maxPayoutPerBetWei: response.max_payout_per_bet_wei,
      acceptingBets: response.accepting_bets,
    };
  },

  async getActiveBets(): Promise<RushArenaBet[]> {
    if (isRushArenaMockMode()) return [];
    // Engine wraps the list as `{ bets, total }`. We only need the
    // array — `total` is also `bets.length`.
    const response = await requestJson<{
      bets: BackendRushArenaBet[];
      total: number;
    }>("/trade/bets");
    return response.bets.map((bet) => normalizeBackendBet(bet));
  },

  async verifyBet(id: string): Promise<RushBetVerification> {
    return requestJson<RushBetVerification>(`/trade/bets/${encodeURIComponent(id)}/verify`);
  },

  /// Engine-authoritative status for a single bet. Used by the
  /// canvas to settle a local ACTIVE bet once its window has
  /// elapsed — the local snake (RUSH_INDEX) is just visual; the
  /// VRF path that determines WIN/LOST is server-side.
  async getBet(id: string): Promise<RushArenaBet> {
    if (isRushArenaMockMode()) {
      // Mock branch: tag every queried bet as LOST so /preview never
      // claims to settle wins offline.
      return {
        id,
        market: RUSH_MARKET,
        symbol: RUSH_MARKET,
        cell: { id: "mock", row: 0, col: 0, pMin: 0, pMax: 0, windowStartMs: 0, windowEndMs: 0, windowStartOffsetMs: 0, windowDurationMs: 3000, distanceBps: 0, multiplier: 1, multiplierBps: 10000, disabled: false } as unknown as TapGridCell,
        stakeAmount: 0,
        stakeAmountWei: "0",
        multiplier: 1,
        multiplierBps: 10000,
        potentialWin: 0,
        status: "LOST",
        finalResult: "LOST",
        price0: 0,
        t0: 0,
        placedAt: Date.now(),
      };
    }
    const raw = await requestJson<BackendRushArenaBet>(
      `/trade/bets/${encodeURIComponent(id)}`
    );
    return normalizeBackendBet(raw);
  },

  /// Price the entire visible grid in one call. Mock mode falls back to
  /// the cells' frontend-computed multiplier so /preview keeps working
  /// offline. In production this hits the backend, which is the only
  /// source of truth for multiplier_bps and disabled_reason.
  async getQuoteGrid(
    symbol: string,
    cells: QuoteGridCellRequest[]
  ): Promise<QuoteGridResponse> {
    if (isRushArenaMockMode()) {
      // Same fields the canvas needs; multiplier comes from the cell as
      // generated by `buildSlidingCells`. Mock preview does not remove
      // cells near the price; high-probability cells simply display low
      // multipliers, matching the backend pricing model.
      const minMultiplier = 1.02;
      return {
        symbol,
        serverTimeMs: Date.now(),
        entryPriceQ8: String(Math.round(mockPrice * 1e8)),
        houseEdgeBps: 500,
        maxPayoutPerBetWei: "10000000000000000000",
        cells: cells.map((c) => {
          const distanceBps = bpsBetween(mockPrice, c);
          return {
            cellId: c.cellId,
            probability: 0,
            distanceBps,
            impliedPTouchBps: 0,
            multiplierBps: 0,
            multiplier: minMultiplier,
            maxStakeWei: "10000000000000000000",
            disabledReason: null,
            fromEmpirical: false,
            flags: [],
            userEv: 0,
          };
        }),
      };
    }

    const response = await requestJson<{
      symbol: string;
      server_time_ms: number;
      entry_price_q8: string;
      house_edge_bps: number;
      max_payout_per_bet_wei: string;
      cells: Array<{
        cell_id: string;
        probability?: number;
        distance_bps: number;
        implied_p_touch_bps: number;
        multiplier_bps: number;
        max_stake_wei: string;
        disabled_reason: string | null;
        from_empirical: boolean;
        flags?: string[];
        user_ev?: number;
      }>;
    }>("/trade/quote-grid", {
      method: "POST",
      body: JSON.stringify({
        symbol,
        cells: cells.map((c) => ({
          cell_id: c.cellId,
          direction: c.direction,
          target_row_min_q8: c.targetRowMinQ8,
          target_row_max_q8: c.targetRowMaxQ8,
          window_start_offset_ms: c.windowStartOffsetMs,
          window_duration_ms: c.windowDurationMs,
        })),
      }),
    });
    return {
      symbol: response.symbol,
      serverTimeMs: response.server_time_ms,
      entryPriceQ8: response.entry_price_q8,
      houseEdgeBps: response.house_edge_bps,
      maxPayoutPerBetWei: response.max_payout_per_bet_wei,
      cells: response.cells.map((c) => ({
        cellId: c.cell_id,
        probability: c.probability ?? c.implied_p_touch_bps / 10_000,
        distanceBps: c.distance_bps,
        impliedPTouchBps: c.implied_p_touch_bps,
        multiplierBps: c.multiplier_bps,
        multiplier: c.multiplier_bps / 10_000,
        maxStakeWei: c.max_stake_wei,
        disabledReason: c.disabled_reason,
        fromEmpirical: c.from_empirical,
        flags: c.flags ?? [],
        userEv: c.user_ev ?? 0,
      })),
    };
  },

  async requestQuote({
    symbol = RUSH_MARKET,
    cell,
    stakeAmountWei: _stakeAmountWei,
    livePrice,
    nowMs,
  }: RequestQuoteParams): Promise<RushQuote> {
    if (isRushArenaMockMode()) {
      await new Promise((resolve) => setTimeout(resolve, 90));
      return {
        multiplierBps: cell.multiplierBps,
        multiplier: cell.multiplier,
        quoteToken: `mock:${cell.id}:${Date.now()}`,
        expiresAt: new Date(Date.now() + 2_000).toISOString(),
      };
    }

    // Pick UP/DOWN from the band's centre relative to the live
    // price captured by the page at click time. Same heuristic the
    // quote-grid call uses; needed here because the engine's
    // QuoteRequest requires `direction` and validates the band
    // geometry against it.
    const bandMid = (cell.pMin + cell.pMax) / 2;
    // Fall back to the legacy ad-hoc cell field, then the band centre
    // so mock-mode interactions don't crash.
    const referencePrice =
      livePrice ?? (cell as TapGridCell & { livePrice?: number }).livePrice ?? bandMid;
    const direction: "UP" | "DOWN" = bandMid >= referencePrice ? "UP" : "DOWN";
    const requestNow = nowMs ?? Date.now();

    const response = await requestJson<{
      symbol: string;
      direction: string;
      entry_price_q8: string;
      target_row_min_q8: string;
      target_row_max_q8: string;
      window_duration_ms: number;
      window_start_offset_ms: number;
      distance_bps: number;
      implied_p_touch_bps: number;
      multiplier_bps: number;
      server_time_ms: number;
      from_empirical: boolean;
      quote_token: string;
      quote_expires_at_ms: number;
    }>("/trade/quote", {
      method: "POST",
      body: JSON.stringify({
        symbol,
        direction,
        target_row_min_q8: BigInt(Math.round(cell.pMin * 1e8)).toString(),
        target_row_max_q8: BigInt(Math.round(cell.pMax * 1e8)).toString(),
        window_duration_ms: cell.windowDurationMs,
        window_start_offset_ms: Math.max(0, cell.windowStartMs - requestNow),
      }),
    });
    return {
      multiplierBps: response.multiplier_bps,
      multiplier: response.multiplier_bps / 10_000,
      quoteToken: response.quote_token,
      expiresAt: new Date(response.quote_expires_at_ms).toISOString(),
    };
  },

  async placeBet({
    symbol = RUSH_MARKET,
    quote,
    cell,
    stakeAmount,
    stakeAmountWei,
    price0,
    clientBetId,
  }: PlaceBetParams): Promise<RushArenaBet> {
    const id = clientBetId ?? `rush-${Date.now()}-${cell.row}-${cell.col}`;
    if (isRushArenaMockMode()) {
      await new Promise((resolve) => setTimeout(resolve, 80));
      return {
        id,
        market: symbol,
        symbol,
        cell,
        stakeAmount,
        stakeAmountWei,
        multiplier: quote.multiplier,
        multiplierBps: quote.multiplierBps,
        potentialWin: stakeAmount * quote.multiplier,
        status: "ACTIVE",
        price0,
        t0: Date.now(),
        placedAt: Date.now(),
      };
    }

    // Direction must match what was signed into the quote token —
    // recompute the same way as `requestQuote` above.
    const bandMid = (cell.pMin + cell.pMax) / 2;
    const livePrice = (cell as TapGridCell & { livePrice?: number }).livePrice
      ?? price0
      ?? bandMid;
    const direction: "UP" | "DOWN" = bandMid >= livePrice ? "UP" : "DOWN";

    const response = await requestJson<BackendRushArenaBet>("/trade/bets", {
      method: "POST",
      headers: {
        "Idempotency-Key": id,
      },
      body: JSON.stringify({
        symbol,
        direction,
        stake_wei: stakeAmountWei,
        target_row_min_q8: BigInt(Math.round(cell.pMin * 1e8)).toString(),
        target_row_max_q8: BigInt(Math.round(cell.pMax * 1e8)).toString(),
        window_start_ms: cell.windowStartMs,
        window_end_ms: cell.windowEndMs,
        expected_multiplier_bps: quote.multiplierBps,
        quote_token: quote.quoteToken,
      }),
    });

    return normalizeBackendBet(response, {
      id,
      symbol,
      cell,
      stakeAmount,
      stakeAmountWei,
      multiplier: quote.multiplier,
      multiplierBps: quote.multiplierBps,
      potentialWin: stakeAmount * quote.multiplier,
      status: "PENDING",
      price0,
      t0: Date.now(),
      placedAt: Date.now(),
    });
  },

  /// "Round" is a logical concept the standalone repo carried over
  /// from the legacy paper trade UI. The VRF arena has no rounds —
  /// the Rush Index is a single continuous stream and per-bet VRF
  /// paths handle the resolution. This shim builds a RushRound
  /// shape so the canvas, which still reads `currentPrice` and
  /// `serverSeedHash`, keeps working until it's refactored to
  /// consume the index directly.
  async getSynthRound(symbol: TapTradeSymbol = RUSH_MARKET): Promise<RushRound> {
    if (isRushArenaMockMode()) return currentRound();
    const data = await requestJson<{
      symbol: string;
      price_q8: string;
      timestamp: number;
      server_seed_hash?: string;
      kind?: string;
    }>(`/prices/${encodeURIComponent(symbol)}`);
    const currentPrice = Number(data.price_q8) / 1e8;
    return {
      roundId: `${data.symbol.toLowerCase()}-${(data.server_seed_hash ?? "real-price").slice(0, 12)}`,
      market: data.symbol,
      displayName: data.symbol === RUSH_MARKET ? RUSH_DISPLAY : data.symbol,
      startedAt: 0,
      endsAt: Number.MAX_SAFE_INTEGER,
      tickMs: 150,
      totalTicks: Number.MAX_SAFE_INTEGER,
      currentTick: 0,
      initialPrice: currentPrice,
      currentPrice,
      volatility: 0.001,
      serverSeedHash: data.server_seed_hash ?? "",
      revealedSeed: null,
      status: "active",
    };
  },

  /// No historical-tick endpoint on the engine — the canvas
  /// bootstraps from an empty trail and the live WS stream fills
  /// it. Mock mode keeps a synthetic tick generator for the
  /// `/preview` sandbox.
  async getSynthTicks(from = mockTick - 180, to = mockTick): Promise<RushTick[]> {
    if (isRushArenaMockMode()) {
      syncMockClock();
      const ticks: RushTick[] = [];
      const count = Math.max(1, to - Math.max(0, from));
      const rawEnd =
        Math.sin(to / 18) * 3.8 +
        Math.sin(to / 53) * 6.4 +
        Math.cos(to / 91) * 2.2;
      for (let tick = Math.max(0, from); tick <= to; tick += 1) {
        const age = to - tick;
        const trend = -8.5 * (age / count);
        const raw =
          Math.sin(tick / 18) * 3.8 +
          Math.sin(tick / 53) * 6.4 +
          Math.cos(tick / 91) * 2.2;
        ticks.push({
          tick,
          timestampMs: mockRoundStartedAt + tick * tickMs,
          price: Math.max(100, mockPrice + trend + raw - rawEnd),
        });
      }
      return ticks.slice(-220);
    }
    return [];
  },

  /// Provably-fair state for the Rush Index. The engine publishes
  /// the seed hash that drives the index trajectory; per-bet
  /// commit/reveal lives separately on each bet's `/verify`
  /// endpoint.
  async getProvablyFair(symbol: TapTradeSymbol = RUSH_MARKET): Promise<ProvablyFairState> {
    if (isRushArenaMockMode()) return provablyFair();
    const data = await requestJson<{
      symbol: string;
      price_q8: string;
      timestamp: number;
      server_seed_hash?: string;
      kind?: string;
      source?: string;
    }>(`/prices/${encodeURIComponent(symbol)}`);
    const isRushIndex = data.symbol === RUSH_MARKET;
    return {
      roundId: `${data.symbol.toLowerCase()}-${(data.server_seed_hash ?? "real-price").slice(0, 12)}`,
      algorithm: isRushIndex
        ? "VRF arena: SHA256(seed||counter) -> uniform -> regime + path"
        : `Real market feed: ${data.source ?? "market"} trade stream -> first touch`,
      serverSeedHash: data.server_seed_hash ?? "",
      revealedSeed: null,
      tickMs: 150,
      volatility: 0.001,
      initialPrice: Number(data.price_q8) / 1e8,
      // The Rush Index seed isn't time-rotated yet (single hash for
      // the engine process lifetime). Set far in the future to
      // mean "no scheduled reveal".
      nextSeedRevealAt: Number.MAX_SAFE_INTEGER,
    };
  },

  /// Public, anonymised list of currently-active bets across all
  /// users. Drives the "Active Bets" social-proof panel. Mock mode
  /// returns canned rows so /preview keeps the panel populated
  /// without an engine.
  async listPublicActiveBets(): Promise<PublicBetEntry[]> {
    if (isRushArenaMockMode()) return mockPublicActive();
    const res = await requestJson<{
      bets: Array<{
        id: string;
        symbol: string;
        player_handle: string;
        stake_wei: string;
        multiplier_bps: number;
        potential_payout_wei: string;
        placed_at_ms: number;
        window_end_ms: number;
        resolved_at_ms: number | null;
      }>;
      total: number;
    }>("/trade/bets/public");
    return res.bets.map(normalizePublicBet);
  },

  /// Public, anonymised list of recent WON bets. Drives "Recent Wins".
  async listPublicRecentWins(): Promise<PublicBetEntry[]> {
    if (isRushArenaMockMode()) return mockPublicWins();
    const res = await requestJson<{
      bets: Array<{
        id: string;
        symbol: string;
        player_handle: string;
        stake_wei: string;
        multiplier_bps: number;
        potential_payout_wei: string;
        placed_at_ms: number;
        window_end_ms: number;
        resolved_at_ms: number | null;
      }>;
      total: number;
    }>("/trade/wins/public");
    return res.bets.map(normalizePublicBet);
  },

  /// Aggregate ACTIVE bets per cell + count of distinct players in
  /// the room. Drives the canvas heatmap glow + the "X online" pill.
  /// Polled every 2 s; cells are matched by absolute (band, window)
  /// against the locally-built TapGridCell instances.
  async getHeatmap(): Promise<{
    onlineCount: number;
    cells: Array<{
      targetRowMinQ8: string;
      targetRowMaxQ8: string;
      windowStartMs: number;
      windowEndMs: number;
      nBets: number;
      totalStakeWei: string;
    }>;
  }> {
    if (isRushArenaMockMode()) return { onlineCount: 0, cells: [] };
    const res = await requestJson<{
      online_count: number;
      cells: Array<{
        target_row_min_q8: string;
        target_row_max_q8: string;
        window_start_ms: number;
        window_end_ms: number;
        n_bets: number;
        total_stake_wei: string;
      }>;
    }>("/trade/heatmap");
    return {
      onlineCount: res.online_count,
      cells: res.cells.map((c) => ({
        targetRowMinQ8: c.target_row_min_q8,
        targetRowMaxQ8: c.target_row_max_q8,
        windowStartMs: c.window_start_ms,
        windowEndMs: c.window_end_ms,
        nBets: c.n_bets,
        totalStakeWei: c.total_stake_wei,
      })),
    };
  },

  /// Top players by aggregate winnings. Engine ranks via
  /// `users.realized_pnl_wei` desc; the canvas renders top N rows.
  async getLeaderboard(limit = 10): Promise<LeaderboardEntry[]> {
    if (isRushArenaMockMode()) return mockLeaderboard();
    const res = await requestJson<{
      entries: Array<{
        rank: number;
        username: string | null;
        wallet_address: string;
        realized_pnl_wei: string;
        win_rate: number;
        total_trades: number;
        best_win_streak: number;
      }>;
      period: string;
    }>(`/leaderboard?limit=${limit}`);
    return res.entries.map((e) => ({
      rank: e.rank,
      player: e.username && e.username.length > 0 ? e.username : shortWallet(e.wallet_address),
      // Backend doesn't track `wins` directly; reconstruct from
      // total_trades × win_rate. Both fields ship along with the
      // pnl, so the calc is loss-free.
      wins: Math.round(e.total_trades * e.win_rate),
      realizedPnlWei: e.realized_pnl_wei,
    }));
  },

  connectWebSocket(
    onEvent: (event: RushArenaEvent) => void,
    symbol: TapTradeSymbol = RUSH_MARKET
  ) {
    if (isRushArenaMockMode()) {
      syncMockClock();
      const id = window.setInterval(() => {
        const tick = nextMockTick();
        onEvent({ type: "PriceUpdate", payload: tick });
        onEvent({ type: "RoundState", payload: currentRound() });
      }, tickMs);
      return () => window.clearInterval(id);
    }

    let closed = false;
    let socket: WebSocket | null = null;
    let retryTimer: number | null = null;
    let tick = 0;

    // Engine emits `price_q8` (uint256-as-string) per the
    // ServerMessage::PriceUpdate shape; the canvas wants a decimal
    // number. Divide by 1e8 here, once.
    const emitBackendPrice = (priceData: {
      symbol: string;
      price_q8: string | number;
      timestamp: number;
    }) => {
      if (priceData.symbol !== symbol) return;
      const q8 = Number(priceData.price_q8);
      if (!Number.isFinite(q8) || q8 <= 0) return;
      const price = q8 / 1e8;
      tick += 1;
      onEvent({
        type: "PriceUpdate",
        payload: {
          tick,
          timestampMs: priceData.timestamp,
          price,
        },
      });
    };

    const connect = () => {
      socket = new WebSocket(WS_URL);
      socket.onopen = () => {
        // Engine subscription protocol: `SubscribePrices` with the
        // active symbol. `GetPrices` forces an immediate snapshot so
        // the canvas doesn't show an empty trail until the next tick.
        socket?.send(
          JSON.stringify({
            type: "SubscribePrices",
            payload: { symbols: [symbol] },
          })
        );
        socket?.send(JSON.stringify({ type: "GetPrices" }));
      };
      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(message.data) as BackendWsMessage;
          if (event.type === "PriceUpdate") {
            emitBackendPrice(
              event.payload as {
                symbol: string;
                price_q8: string | number;
                timestamp: number;
              }
            );
            return;
          }
          if (event.type === "PricesSnapshot") {
            const payload = event.payload as {
              prices?: Array<{
                symbol: string;
                price_q8: string | number;
                timestamp: number;
              }>;
            };
            payload.prices?.forEach(emitBackendPrice);
            return;
          }
          onEvent(event as RushArenaEvent);
        } catch {
          // Ignore malformed transport frames; reconnect handles real failures.
        }
      };
      socket.onclose = () => {
        if (closed) return;
        retryTimer = window.setTimeout(connect, 1_500);
      };
    };

    connect();
    return () => {
      closed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      socket?.close();
    };
  },
};
