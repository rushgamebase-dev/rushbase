"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import toast from "@/lib/toast";
import {
  ChevronDown,
  Settings as SettingsIcon,
  ShieldCheck,
  Star,
} from "lucide-react";
import {
  ParticleSystem,
  type ParticleSystemRef,
  useSoundManager,
} from "@/components/gamification";
import { RushArenaCanvas } from "@/components/taptrade/RushArenaCanvas";
import {
  RUSH_MARKET,
  rushArenaClient,
  type ProvablyFairState,
  type QuoteGridCellResponse,
  type RushArenaBet,
  type RushArenaEvent,
  type RushRound,
  type RushTick,
} from "@/lib/api/rushArenaClient";
import {
  DEFAULT_GRID,
  buildSlidingCells,
  type TapGridCell,
} from "@/lib/taptrade/grid";
import { useHaptic } from "@/hooks";

const GRID_ROWS = 9;
// Future cells visible at any time. New cells are appended to the
// world-time stream as wallNow advances; old ones slide off the left
// edge of the plot.
const GRID_FUTURE_COLS = 4;
const GRID_PAST_COLS = 16;
const ACTIVATION_DELAY_MS = 3_000;
const COLUMN_MS = 3_000;
const PRICE_STEP_BPS = 40;
const STARTING_BALANCE = 2_450.75;
const STAKE_PRESETS = [10, 25, 75, 250];

function stakeWei(amount: number) {
  return (BigInt(Math.round(amount * 100)) * BigInt("10000000000000000")).toString();
}

function formatBalance(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPct(value: number) {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatHms(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function shortHash(hash?: string | null) {
  if (!hash) return "—";
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

function segmentTouchesCell(previous: RushTick, current: RushTick, cell: TapGridCell) {
  const from = Math.max(previous.timestampMs, cell.windowStartMs);
  const to = Math.min(current.timestampMs, cell.windowEndMs);
  if (from > to) return false;
  if (current.timestampMs === previous.timestampMs) {
    return current.price >= cell.pMin && current.price <= cell.pMax;
  }
  const priceAt = (time: number) =>
    previous.price +
    ((current.price - previous.price) * (time - previous.timestampMs)) /
      (current.timestampMs - previous.timestampMs);
  const a = priceAt(from);
  const b = priceAt(to);
  return Math.max(a, b) >= cell.pMin && Math.min(a, b) <= cell.pMax;
}

function betActivationTime(bet: RushArenaBet) {
  return bet.activationAt ?? bet.cell.windowStartMs;
}

function betPathStartTime(bet: RushArenaBet) {
  return bet.path?.[0]?.timestampMs ?? betActivationTime(bet);
}

function betPathEndTime(bet: RushArenaBet) {
  const path = bet.path;
  return path?.[path.length - 1]?.timestampMs ?? bet.cell.windowEndMs;
}

export default function RushArenaTradePage() {
  const [round, setRound] = useState<RushRound | null>(null);
  const [fair, setFair] = useState<ProvablyFairState | null>(null);
  const [ticks, setTicks] = useState<RushTick[]>([]);
  const [currentPrice, setCurrentPrice] = useState(1_245.73);
  const [nowTime, setNowTime] = useState(() => Date.now());
  const [bets, setBets] = useState<RushArenaBet[]>([]);
  const [stakeAmount, setStakeAmount] = useState(75);
  const [balance, setBalance] = useState(STARTING_BALANCE);
  const lastTickRef = useRef<RushTick | null>(null);
  const particlesRef = useRef<ParticleSystemRef | null>(null);
  const handledResolutionRef = useRef<Set<string>>(new Set());
  const vrfPlaybackActiveRef = useRef(false);
  const wasVrfPlaybackActiveRef = useRef(false);
  const anchorPriceRef = useRef(0);
  const { playSound } = useSoundManager();
  const { hapticTap, hapticMedium, hapticSuccess, hapticError } = useHaptic();

  // Anchor is strictly latched on the first valid price and never
  // moves. Every cell — catalog and bet snapshot — derives its
  // pMin/pMax from this constant, so a bet stays pinned to the exact
  // row it was clicked on, forever. The seed-bounded snake (±150 bps)
  // fits inside the 9-row × 40 bps catalog, so the line is always
  // reachable without needing the anchor to chase it.
  if (anchorPriceRef.current <= 0 && currentPrice > 0) {
    anchorPriceRef.current = currentPrice;
  }
  const anchorPrice = anchorPriceRef.current || currentPrice;

  // World-time origin of the round. Latched once. Cells produced by
  // `buildSlidingCells` derive their absolute windows from this origin
  // and never shift afterwards.
  const roundOriginRef = useRef(0);
  if (roundOriginRef.current <= 0 && nowTime > 0) {
    roundOriginRef.current = Math.ceil((nowTime + ACTIVATION_DELAY_MS) / COLUMN_MS) * COLUMN_MS;
  }
  useEffect(() => {
    let cancelled = false;
    async function load() {
      // Each endpoint is fetched independently — synth/round and
      // provably-fair are demo-only on the engine, missing in
      // production builds. We still want the trade page to mount and
      // render a chart from whatever IS available (price feed via WS,
      // active bets if signed in). Failures are silenced after the
      // first instance to avoid spamming the console.
      const settle = <T,>(p: Promise<T>): Promise<T | null> =>
        p.catch((err) => {
          if (process.env.NODE_ENV !== "production") {
            // eslint-disable-next-line no-console
            console.debug("[RushArena] optional load failed", err);
          }
          return null;
        });
      const [nextRound, history, fairState, activeBets] = await Promise.all([
        settle(rushArenaClient.getSynthRound()),
        settle(rushArenaClient.getSynthTicks()),
        settle(rushArenaClient.getProvablyFair()),
        settle(rushArenaClient.getActiveBets()),
      ]);
      if (cancelled) return;
      if (nextRound) setRound(nextRound);
      if (fairState) setFair(fairState);
      if (history && history.length > 0) {
        setTicks(history);
        const latestPrice = history[history.length - 1]?.price;
        if (latestPrice) setCurrentPrice(latestPrice);
      } else if (nextRound) {
        setCurrentPrice(nextRound.currentPrice);
      }
      if (activeBets) setBets(activeBets);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const stop = rushArenaClient.connectWebSocket((event: RushArenaEvent) => {
      if (event.type === "PriceUpdate") {
        if (!vrfPlaybackActiveRef.current) {
          setCurrentPrice(event.payload.price);
          setTicks((items) => [...items, event.payload].slice(-260));
        }
        setNowTime(Date.now());
      }
      if (event.type === "RoundState") setRound(event.payload);
      if (event.type === "ProvablyFairState") setFair(event.payload);
      if (event.type === "BetsSnapshot") setBets(event.payload);
      if (event.type === "BetPlaced") setBets((items) => [event.payload, ...items]);
      if (event.type === "ResolutionEvent") {
        setBets((items) => items.map((bet) => bet.id === event.payload.id ? event.payload : bet));
      }
    });
    const clock = window.setInterval(() => setNowTime(Date.now()), 250);
    return () => {
      stop();
      window.clearInterval(clock);
    };
  }, []);

  // Geometry-only cell layer: pMin/pMax/window come from the local
  // sliding-grid generator (the canvas needs them to project tiles in
  // world-time). Multiplier and disabled_reason come from the backend
  // quote-grid (see effect below); we merge them in `cells` so the
  // canvas reads a single, coherent record per cell.
  const baseCells = useMemo(() => {
    if (roundOriginRef.current <= 0 || anchorPrice <= 0) return [];
    return buildSlidingCells({
      rows: GRID_ROWS,
      originMs: roundOriginRef.current,
      nowTime,
      pastCols: GRID_PAST_COLS,
      futureCols: GRID_FUTURE_COLS,
      anchorPrice,
      activationDelayMs: ACTIVATION_DELAY_MS,
      columnDurationMs: COLUMN_MS,
      priceStepBps: PRICE_STEP_BPS,
      minDistanceBps: 0,
      maxDistanceBps: DEFAULT_GRID.maxDistanceBps,
      minMultiplier: DEFAULT_GRID.minMultiplier,
      maxMultiplier: DEFAULT_GRID.maxMultiplier,
      houseEdgeBps: DEFAULT_GRID.houseEdgeBps,
      volBpsPerSqrtSec: DEFAULT_GRID.volBpsPerSqrtSec,
    });
  }, [anchorPrice, nowTime]);

  // Backend quotes per cell, polled every 250ms while the page is open.
  // Map keyed by cell id so canvas lookups are O(1). Initial value is
  // empty — until the first response lands the canvas falls back to
  // the geometry-only multiplier (clearly labeled "loading").
  const [quoteGrid, setQuoteGrid] = useState<Map<string, QuoteGridCellResponse>>(() => new Map());
  const quoteGridPriceRef = useRef(currentPrice);
  useEffect(() => {
    quoteGridPriceRef.current = currentPrice;
  }, [currentPrice]);

  useEffect(() => {
    if (baseCells.length === 0) return;
    let cancelled = false;
    let timer: number | null = null;
    let consecutiveFailures = 0;

    const tick = async () => {
      // Snapshot the future + locked cells we want priced. Past cells
      // have nothing to bet on, so we skip them.
      const future = baseCells.filter((c) => c.windowEndMs > Date.now());
      if (future.length === 0) {
        timer = window.setTimeout(tick, 250);
        return;
      }
      try {
        const res = await rushArenaClient.getQuoteGrid(
          RUSH_MARKET,
          future.map((c) => {
            const p = quoteGridPriceRef.current;
            const direction: "UP" | "DOWN" =
              p > 0 && (c.pMin + c.pMax) / 2 >= p ? "UP" : "DOWN";
            return {
              cellId: c.id,
              direction,
              targetRowMinQ8: BigInt(Math.round(c.pMin * 1e8)).toString(),
              targetRowMaxQ8: BigInt(Math.round(c.pMax * 1e8)).toString(),
              windowStartOffsetMs: Math.max(0, c.windowStartOffsetMs),
              windowDurationMs: c.windowDurationMs,
            };
          })
        );
        if (cancelled) return;
        const next = new Map<string, QuoteGridCellResponse>();
        for (const cell of res.cells) next.set(cell.cellId, cell);
        setQuoteGrid(next);
        consecutiveFailures = 0;
      } catch (error) {
        if (!cancelled) {
          consecutiveFailures += 1;
          // Log only the first failure in a streak so the console
          // doesn't fill up when the engine is down or quote-grid is
          // not yet deployed.
          if (consecutiveFailures === 1 && process.env.NODE_ENV !== "production") {
            // eslint-disable-next-line no-console
            console.warn(
              "[RushArena] quote-grid unavailable; falling back to local skeleton multipliers",
              error
            );
          }
        }
      }
      // Back off when the endpoint is unreachable so we don't hammer
      // the engine. 250ms when healthy → up to 5s while failing.
      const delay = consecutiveFailures > 0
        ? Math.min(5_000, 250 * 2 ** Math.min(5, consecutiveFailures))
        : 250;
      if (!cancelled) timer = window.setTimeout(tick, delay);
    };

    timer = window.setTimeout(tick, 0);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [baseCells]);

  // Final cells passed to the canvas: backend multiplier + disabled
  // reason replace the geometry layer's local guesses. Cells without
  // a backend record yet (first 250ms after mount) use the local
  // values as a "loading" placeholder; they're clearly tagged and the
  // canvas can choose to render them dimmer if it wants.
  const cells = useMemo(() => {
    if (baseCells.length === 0) return baseCells;
    return baseCells.map((cell) => {
      const quote = quoteGrid.get(cell.id);
      if (!quote) {
        return {
          ...cell,
          disabled: true,
          reason: cell.disabled ? cell.reason : "Pricing loading",
        };
      }
      const disabled = cell.windowStartMs < nowTime + ACTIVATION_DELAY_MS - 1 || quote.disabledReason !== null;
      return {
        ...cell,
        multiplier: quote.multiplier > 0 ? quote.multiplier : cell.multiplier,
        multiplierBps: quote.multiplierBps > 0 ? quote.multiplierBps : cell.multiplierBps,
        disabled,
        reason: quote.disabledReason ?? (disabled ? cell.reason : undefined),
      };
    });
  }, [baseCells, nowTime, quoteGrid]);

  const activeVrfPathBet = useMemo(() => {
    return [...bets]
      .filter((bet) => (
        Array.isArray(bet.path) &&
        bet.path.length > 1 &&
        bet.status !== "CANCELLED" &&
        nowTime <= betPathEndTime(bet) + 500
      ))
      .sort((a, b) => a.placedAt - b.placedAt)[0] ?? null;
  }, [bets, nowTime]);

  const vrfPlaybackActive = useMemo(() => {
    if (!activeVrfPathBet?.path?.length) return false;
    const pathStart = betPathStartTime(activeVrfPathBet);
    const pathEnd = betPathEndTime(activeVrfPathBet);
    return nowTime >= pathStart - 30 && nowTime <= pathEnd + 500;
  }, [activeVrfPathBet, nowTime]);

  useEffect(() => {
    vrfPlaybackActiveRef.current = vrfPlaybackActive;
    if (wasVrfPlaybackActiveRef.current !== vrfPlaybackActive) {
      lastTickRef.current = null;
    }
    wasVrfPlaybackActiveRef.current = vrfPlaybackActive;
  }, [vrfPlaybackActive]);

  useEffect(() => {
    if (!activeVrfPathBet?.path?.length || !vrfPlaybackActive) return;
    let frame = 0;

    const replay = () => {
      const wallNow = Date.now();
      const played = activeVrfPathBet.path!.filter((point) => point.timestampMs <= wallNow + 20);
      if (played.length > 0) {
        const latest = played[played.length - 1];
        setCurrentPrice(latest.price);
        setTicks(played.slice(-260));
      }
      frame = window.requestAnimationFrame(replay);
    };

    frame = window.requestAnimationFrame(replay);
    return () => window.cancelAnimationFrame(frame);
  }, [activeVrfPathBet?.id, activeVrfPathBet?.path, vrfPlaybackActive]);

  // Server-side resolution: walks each new tick and resolves bets whose
  // band the line crossed during their window. Mock-mode runs fully on
  // the client; in WS mode this still mirrors the server's decision so
  // the UI doesn't lag the broadcast by a frame.
  useEffect(() => {
    const latest = ticks[ticks.length - 1];
    if (!latest) return;
    const previous = lastTickRef.current;
    lastTickRef.current = latest;
    if (!previous) return;

    setBets((items) =>
      items
        .map((bet) => {
          if (bet.status === "WON" || bet.status === "LOST" || bet.status === "CANCELLED") return bet;
          let next = bet;
          if (next.status === "PENDING") {
            if (latest.timestampMs < betActivationTime(next)) return next;
            next = { ...next, status: "ACTIVE" as const };
          }
          if (next.status !== "ACTIVE") return next;
          if (segmentTouchesCell(previous, latest, next.cell)) {
            return {
              ...next,
              status: "WON" as const,
              touchedAt: latest.timestampMs,
              resolvedAt: latest.timestampMs,
            };
          }
          if (latest.timestampMs > next.cell.windowEndMs) {
            return {
              ...next,
              status: "LOST" as const,
              resolvedAt: latest.timestampMs,
            };
          }
          return next;
        })
        .filter((bet) => (
          bet.status === "PENDING" ||
          bet.status === "ACTIVE" ||
          !bet.resolvedAt ||
          nowTime - bet.resolvedAt < 18_000
        ))
    );
  }, [nowTime, ticks]);

  useEffect(() => {
    for (const bet of bets) {
      if ((bet.status !== "WON" && bet.status !== "LOST") || handledResolutionRef.current.has(bet.id)) {
        continue;
      }
      handledResolutionRef.current.add(bet.id);
      const x = typeof window === "undefined" ? 0 : window.innerWidth * 0.5;
      const y = typeof window === "undefined" ? 0 : window.innerHeight * 0.45;
      if (bet.status === "WON") {
        setBalance((value) => value + bet.potentialWin);
        hapticSuccess();
        playSound("win");
        particlesRef.current?.emitWin(x, y, bet.potentialWin);
      } else {
        hapticError();
        playSound("loss");
        particlesRef.current?.emitLoss(x, y);
      }
    }
  }, [bets, hapticError, hapticSuccess, playSound]);

  const handleCellClick = useCallback(
    async (cell: TapGridCell) => {
      if (cell.disabled || stakeAmount <= 0) return;
      if (stakeAmount > balance) {
        hapticError();
        toast.error("Insufficient balance");
        return;
      }

      const id = `pending-${Date.now()}-${cell.row}-${cell.col}`;
      const stakeAmountWei = stakeWei(stakeAmount);
      const pendingBet: RushArenaBet = {
        id,
        market: RUSH_MARKET,
        symbol: RUSH_MARKET,
        cell: { ...cell },
        stakeAmount,
        stakeAmountWei,
        multiplier: cell.multiplier,
        multiplierBps: cell.multiplierBps,
        potentialWin: stakeAmount * cell.multiplier,
        status: "PENDING",
        price0: currentPrice,
        t0: nowTime,
        placedAt: nowTime,
      };

      setBalance((value) => value - stakeAmount);
      setBets((items) => [pendingBet, ...items]);
      hapticTap();
      playSound("tap");

      try {
        const quote = await rushArenaClient.requestQuote({ cell, stakeAmountWei });
        const placed = await rushArenaClient.placeBet({
          quote,
          cell: { ...cell },
          stakeAmount,
          stakeAmountWei,
          price0: currentPrice,
          clientBetId: id,
        });
        setBets((items) =>
          items.map((bet) =>
            bet.id === id
              ? {
                  ...placed,
                  id,
                  cell: { ...cell },
                }
              : bet
          )
        );
        hapticMedium();
        playSound("bet");
      } catch (error) {
        setBalance((value) => value + stakeAmount);
        setBets((items) => items.filter((bet) => bet.id !== id));
        hapticError();
        playSound("error");
        toast.error(error instanceof Error ? error.message : "Bet failed");
      }
    },
    [balance, currentPrice, hapticError, hapticMedium, hapticTap, nowTime, playSound, stakeAmount]
  );

  const pctMove = round && round.initialPrice > 0
    ? ((currentPrice - round.initialPrice) / round.initialPrice) * 100
    : 0;
  const roundEndsInMs = round ? Math.max(0, round.endsAt - nowTime) : 0;

  return (
    <div className="flex h-screen min-h-[640px] w-full flex-col overflow-hidden bg-[#020403] text-[#dfffe6]">
      <ParticleSystem onRef={(ref) => (particlesRef.current = ref)} />

      <TopHeader
        symbol="STONKS/USDT"
        price={currentPrice}
        pctMove={pctMove}
      />

      <RoundBanner
        roundEndsInMs={roundEndsInMs}
        serverSeedHash={activeVrfPathBet?.seedHash ?? fair?.serverSeedHash}
        seedId={activeVrfPathBet?.seedId}
        pathRegime={activeVrfPathBet?.pathRegime}
        betStatus={activeVrfPathBet?.status}
      />

      <div className="relative min-h-0 flex-1">
        <RushArenaCanvas
          ticks={ticks}
          currentPrice={currentPrice}
          nowTime={nowTime}
          cells={cells}
          bets={bets}
          onCellClick={handleCellClick}
          className="h-full w-full"
        />
      </div>

      <StakeBar
        stakeAmount={stakeAmount}
        setStakeAmount={setStakeAmount}
        balance={balance}
      />
    </div>
  );
}

function TopHeader({
  symbol,
  price,
  pctMove,
}: {
  symbol: string;
  price: number;
  pctMove: number;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[#0c2118] bg-[#02060a] px-4">
      <button className="flex items-center justify-center text-[#3a5d49] transition hover:text-[#ffe600]" aria-label="Favorite">
        <Star className="h-4 w-4" />
      </button>
      <div className="grid h-8 w-8 place-items-center rounded-full border border-[#1d3327] bg-[#06140d]">
        <span className="font-mono text-base">📈</span>
      </div>
      <button className="flex items-center gap-1 font-sans text-base font-black tracking-wide text-white transition hover:text-[#00ff66]">
        {symbol}
        <ChevronDown className="h-4 w-4 text-[#5a8068]" />
      </button>

      <div className="ml-3 flex items-baseline gap-2">
        <span
          className={`font-mono text-2xl font-black ${pctMove >= 0 ? "text-[#00ff66]" : "text-[#ff3b4d]"}`}
          style={{ textShadow: "0 0 12px rgba(0,255,102,0.32)" }}
        >
          {price > 0 ? price.toFixed(2) : "—"}
        </span>
        <span className={`font-mono text-xs font-bold ${pctMove >= 0 ? "text-[#00ff66]" : "text-[#ff3b4d]"}`}>
          {formatPct(pctMove)}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <button className="flex items-center justify-center text-[#5a8068] transition hover:text-[#00ff66]" aria-label="Recenter">
          <span className="grid h-7 w-7 place-items-center rounded-full border border-[#1d3327] text-xs">⊕</span>
        </button>
        <button className="flex items-center justify-center text-[#5a8068] transition hover:text-[#00ff66]" aria-label="Settings">
          <SettingsIcon className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}

function RoundBanner({
  roundEndsInMs,
  serverSeedHash,
  seedId,
  pathRegime,
  betStatus,
}: {
  roundEndsInMs: number;
  serverSeedHash?: string | null;
  seedId?: string;
  pathRegime?: string;
  betStatus?: string;
}) {
  const isLocked = Boolean(seedId);
  return (
    <div className="flex h-7 shrink-0 items-center gap-3 border-b border-[#0c2118] bg-[#02060a] px-4 font-mono text-[11px] text-[#5a8068]">
      <span className="text-[#5a8068]">ⓘ</span>
      <span>
        Round ends in <span className="font-bold text-[#dfffe6]">{formatHms(roundEndsInMs)}</span>
      </span>
      <span className="text-[#1d3327]">·</span>
      <button className="flex items-center gap-1 transition hover:text-[#00ff66]">
        <ShieldCheck className="h-3 w-3" />
        {isLocked ? "VRF locked" : "Verify fairness"}
        <span className="text-[#3a5d49]">{shortHash(serverSeedHash)}</span>
      </button>
      {isLocked ? (
        <>
          <span className="text-[#1d3327]">·</span>
          <span className="text-[#00ff66]">{betStatus === "PENDING" ? "Path in 3...2...1" : "Line live"}</span>
          <span className="hidden text-[#3a5d49] sm:inline">
            Seed {seedId?.slice(-6)} {pathRegime ? `· ${pathRegime}` : ""}
          </span>
        </>
      ) : null}
    </div>
  );
}

function StakeBar({
  stakeAmount,
  setStakeAmount,
  balance,
}: {
  stakeAmount: number;
  setStakeAmount: (value: number) => void;
  balance: number;
}) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-3 border-t border-[#0c2118] bg-[#02060a] px-4">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-[#5a8068]">Stake</span>
        <input
          value={stakeAmount}
          onChange={(event) => {
            const next = Number(event.target.value);
            setStakeAmount(Number.isFinite(next) && next > 0 ? next : 1);
          }}
          inputMode="numeric"
          className="h-9 w-24 border border-[#1d3327] bg-[#06140d] px-3 font-mono text-base font-black text-white outline-none transition focus:border-[#00ff66]"
        />
        <button
          onClick={() => setStakeAmount(Math.max(1, Math.floor(stakeAmount / 2)))}
          className="h-9 w-10 border border-[#1d3327] bg-[#06140d] font-mono text-xs font-black text-[#dfffe6] transition hover:border-[#00ff66]"
        >
          /2
        </button>
        <button
          onClick={() => setStakeAmount(Math.min(balance, stakeAmount * 2))}
          className="h-9 w-10 border border-[#1d3327] bg-[#06140d] font-mono text-xs font-black text-[#dfffe6] transition hover:border-[#00ff66]"
        >
          x2
        </button>
        <button
          onClick={() => setStakeAmount(Math.max(1, Math.floor(balance)))}
          className="h-9 w-12 border border-[#1d3327] bg-[#06140d] font-mono text-xs font-black text-[#dfffe6] transition hover:border-[#00ff66]"
        >
          MAX
        </button>
      </div>

      <div className="flex items-center gap-1 overflow-x-auto">
        {STAKE_PRESETS.map((preset) => (
          <button
            key={preset}
            onClick={() => setStakeAmount(preset)}
            className={`h-9 w-12 border font-mono text-xs font-black transition ${
              stakeAmount === preset
                ? "border-[#00ff66] bg-[#00ff66]/15 text-[#00ff66]"
                : "border-[#1d3327] bg-[#06140d] text-[#9ec3aa] hover:border-[#00ff66]/55 hover:text-[#00ff66]"
            }`}
          >
            {preset}
          </button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-2 font-mono text-xs">
        <span className="text-[#5a8068] uppercase tracking-widest">Balance</span>
        <span className="font-black text-white">{formatBalance(balance)}</span>
      </div>
    </div>
  );
}
