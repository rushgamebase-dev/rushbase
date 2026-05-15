"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import toast from "@/lib/toast";
import {
  ChevronDown,
  Plus,
  Settings as SettingsIcon,
  ShieldCheck,
  SlidersHorizontal,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  ParticleSystem,
  type ParticleSystemRef,
  useSoundManager,
} from "@/components/gamification";
import Header from "@/components/Header";
import { RushArenaCanvas } from "@/components/taptrade/RushArenaCanvas";
import { WalletDrawer } from "@/components/taptrade/WalletDrawer";
import { WinFloater } from "@/components/taptrade/WinFloater";
import { useWalletModal } from "@/components/WalletButton";
import {
  RUSH_MARKET,
  rushArenaClient,
  type LeaderboardEntry,
  type ProvablyFairState,
  type PublicBetEntry,
  type RushArenaBet,
  type RushArenaEvent,
  type RushRound,
  type RushTick,
} from "@/lib/api/rushArenaClient";
import {
  DEFAULT_GRID,
  buildDynamicCells,
  type TapGridCell,
} from "@/lib/taptrade/grid";
import { useHaptic } from "@/hooks";
import { useTapTradeAuth } from "@/hooks/use-taptrade-auth";
import { useAccount } from "wagmi";

// Future cells visible at any time. New cells are appended to the
// world-time stream as wallNow advances; old ones slide off the left
// edge of the plot.
const GRID_FUTURE_COLS = 3;
const GRID_PAST_COLS = 16;
const ACTIVATION_DELAY_MS = 3_000;
const COLUMN_MS = 3_000;
const PRICE_STEP_BPS = 40;
// Stake presets are in ETH (the canonical unit on Base). Tier 1 caps
// (Base mainnet smoke test, 2026-05-04) cap max_stake at 0.01 ETH via
// `APP_TOUCH__MAX_STAKE_WEI` override in engine/.env. Anything above
// 0.01 here would 400 with `InvalidStakeAmount`. Bump to [0.005,
// 0.025, 0.05, 0.1] once tier-2 (max_stake = 0.1 ETH) is in effect.
const STAKE_PRESETS = [0.0001, 0.0005, 0.001, 0.005];
// Mirror of `engine/config/default.toml [touch] allowed_window_ms`.
// The empirical table is calibrated against exactly these durations;
// passing the list to `buildDynamicCells` lets the local quote refuse
// (`INVALID_WINDOW`) any cell whose duration drifted off-catalog.
const ALLOWED_WINDOW_MS = [3_000, 6_000, 9_000, 12_000, 18_000, 30_000, 60_000];

// `stakeAmount` carries an ETH amount as a regular JS number — fine
// for the canvas math because the engine accepts a wei string we
// build at submit time (max_stake_wei = 0.01 ETH in Tier 1, well
// inside Number's safe range when measured in ETH × 1e18). Convert
// to wei via `Math.round(amount * 1e18)` to avoid float drift.
function stakeWei(ethAmount: number) {
  if (ethAmount <= 0) return "0";
  // Round to the nearest wei via 1e18 scaling — `Math.round` keeps
  // typical UI inputs (0.001, 0.005, ...) exact down to the last
  // wei within Number precision.
  const wei = BigInt(Math.round(ethAmount * 1e18));
  return wei.toString();
}

/// Format an ETH amount with a fixed precision suited to Tier 1
/// stakes (1 milli-ETH minimum). Trailing zeros are kept so columns
/// align in the panels — UX detail Stake.com / BC.GAME both follow.
function formatEth(value: number, fractionDigits = 4): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
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

interface RushArenaTradePageProps {
  /** When true, skip the SIWE auth redirect — used by the offline
   *  `/preview` sandbox so the canvas renders against the mocked
   *  rushArenaClient without a wallet/engine round-trip. Default
   *  false for production sessions. */
  bypassAuthGate?: boolean;
}

export default function RushArenaTradePage({
  bypassAuthGate = false,
}: RushArenaTradePageProps = {}) {
  const { address, isConnected } = useAccount();
  const { openModal: openWalletModal, WalletModalComponent } = useWalletModal();
  const {
    isAuthenticated,
    isSigningIn,
    signIn,
    error: authError,
    freeBalanceWei,
    refreshBalance,
  } = useTapTradeAuth();

  const requiresSession = !bypassAuthGate && !isAuthenticated;

  const [round, setRound] = useState<RushRound | null>(null);
  const [fair, setFair] = useState<ProvablyFairState | null>(null);
  const [ticks, setTicks] = useState<RushTick[]>([]);
  const [currentPrice, setCurrentPrice] = useState(1_245.73);
  const [nowTime, setNowTime] = useState(() => Date.now());
  const [bets, setBets] = useState<RushArenaBet[]>([]);
  const [stakeAmount, setStakeAmount] = useState(0.005);
  const [hoveredCellId, setHoveredCellId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  // Win announcements that fly from the centre of the canvas to the
  // Balance widget in the header. One entry per resolved WIN; the
  // floater removes itself after its animation completes.
  const [winFloaters, setWinFloaters] = useState<
    Array<{ id: string; amountEth: number; multiplier: number; from: { x: number; y: number }; to: { x: number; y: number } }>
  >([]);
  // Ref pointed at the Balance card in the header — `WinFloater`
  // reads its bounding rect at the moment of resolution so the win
  // converges on whichever widget is visible (desktop card vs mobile
  // `+` button).
  const balanceRef = useRef<HTMLDivElement>(null!);
  // Free balance in ETH — single source of truth is the engine.
  // Earlier this layer carried an "optimistic delta" so the header
  // could bump on local WIN detection, but the local detector keys
  // off the visual RUSH_INDEX line which is intentionally NOT what
  // resolves bets (per `arena_index.rs`: "The index is not part of
  // bet resolution"). Each false-positive local WIN inflated the
  // delta without ever being cleared, so the display drifted up
  // while the engine held the real (lower) value. Killed: balance
  // now mirrors the engine, period. UX feedback for wins moves to
  // the floater (which only fires when the engine confirms).
  const balance = useMemo(
    () => Number(freeBalanceWei) / 1e18,
    [freeBalanceWei]
  );
  const setBalance = useCallback(
    (_: number | ((prev: number) => number)) => {
      // Trigger an out-of-band engine refresh; ignore the
      // optimistic value the caller passed in.
      void refreshBalance();
    },
    [refreshBalance]
  );
  const lastTickRef = useRef<RushTick | null>(null);
  const particlesRef = useRef<ParticleSystemRef | null>(null);
  const handledResolutionRef = useRef<Set<string>>(new Set());
  const vrfPlaybackActiveRef = useRef(false);
  const wasVrfPlaybackActiveRef = useRef(false);
  const anchorPriceRef = useRef(0);
  const { playSound } = useSoundManager();
  const { hapticTap, hapticMedium, hapticSuccess, hapticError } = useHaptic();

  useEffect(() => {
    setHydrated(true);
  }, []);

  // Anchor is latched ONCE on the first valid price and NEVER moves.
  // Every catalog cell (and every bet snapshot) derives its
  // pMin/pMax from this constant, so a cell stays pinned at the
  // exact absolute price level it was rendered at — clicking a cell
  // bets on that absolute band, period. The Rush Index is bounded
  // (±150 bps soft band) so the snake fits inside the catalog
  // without the anchor needing to chase it; the camera/viewport
  // scrolls vertically to keep the price line visible while the
  // cells stay parked.
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
    // 500 ms wallclock tick. The canvas itself runs at 60 fps via its
    // own requestAnimationFrame loop, so this only governs how often
    // React re-runs the cells `useMemo` (which would otherwise rebuild
    // 4× per second and propagate fresh cell objects into the canvas
    // dataRef, hurting the snake's perceived smoothness).
    const clock = window.setInterval(() => setNowTime(Date.now()), 500);
    return () => {
      stop();
      window.clearInterval(clock);
    };
  }, []);

  // Heatmap polling — feeds the per-cell glow + the "X online" pill.
  // 2 s cadence gives a "live" feeling without melting the engine; the
  // endpoint is one aggregated query so cost is constant per poll.
  const [heatmap, setHeatmap] = useState<{
    onlineCount: number;
    byKey: Map<string, { nBets: number; totalStakeWei: string }>;
  }>({ onlineCount: 0, byKey: new Map() });

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await rushArenaClient.getHeatmap();
        if (cancelled) return;
        const map = new Map<string, { nBets: number; totalStakeWei: string }>();
        for (const c of res.cells) {
          // Match key on absolute (band, window). Cells in this canvas
          // build pMin/pMax from `priceStepBps` floats; the engine
          // stores them as Q8 integers. Compare via rounded Q8 to
          // avoid float-equality misses.
          const key = `${c.targetRowMinQ8}|${c.targetRowMaxQ8}|${c.windowStartMs}|${c.windowEndMs}`;
          map.set(key, { nBets: Number(c.nBets), totalStakeWei: c.totalStakeWei });
        }
        setHeatmap({ onlineCount: res.onlineCount, byKey: map });
      } catch {
        // Endpoint not reachable — keep last snapshot, don't blank the
        // overlay.
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Active-zone center, quantised to integer price levels (multiples
  // of `PRICE_STEP_BPS` from `anchorPrice`). The grid only rebuilds
  // when the snake crosses a level boundary — that's roughly once
  // every 40 bps of drift, NOT every 150 ms tick — so the local
  // preview layer does not churn the full catalog. Cells outside the
  // emitted band drop off the canvas; cells inside stay at their
  // absolute price band forever (clicked bets pin via their own
  // saved snapshot, independent of the live grid).
  const centerLevel = useMemo(() => {
    if (anchorPrice <= 0 || currentPrice <= 0) return 0;
    const stepFraction = PRICE_STEP_BPS / 10_000;
    const step = anchorPrice * stepFraction;
    if (step <= 0) return 0;
    return Math.round((currentPrice - anchorPrice) / step);
  }, [anchorPrice, currentPrice]);

  const firstFutureCol = roundOriginRef.current > 0
    ? Math.ceil((nowTime + ACTIVATION_DELAY_MS - roundOriginRef.current) / COLUMN_MS)
    : 0;

  // Geometry-only cell layer: pMin/pMax/window come from the local
  // dynamic-grid generator (the canvas needs them to project tiles in
  // world-time). Multipliers are recalculated in `cells` from the
  // live price so the display behaves like a responsive tap engine.
  const baseCells = useMemo(() => {
    if (roundOriginRef.current <= 0 || anchorPrice <= 0 || currentPrice <= 0) {
      return [];
    }
    // Active zone: keep the same bettable surface, but let the canvas
    // scale cells smaller visually so it feels closer to Solcasino.
    return buildDynamicCells({
      anchorPrice,
      currentPrice,
      originMs: roundOriginRef.current,
      nowTime,
      rowsAbove: 5,
      rowsBelow: 4,
      pastCols: GRID_PAST_COLS,
      futureCols: GRID_FUTURE_COLS,
      activationDelayMs: ACTIVATION_DELAY_MS,
      columnDurationMs: COLUMN_MS,
      priceStepBps: PRICE_STEP_BPS,
      minDistanceBps: 0,
      maxDistanceBps: DEFAULT_GRID.maxDistanceBps,
      minMultiplier: DEFAULT_GRID.minMultiplier,
      maxMultiplier: DEFAULT_GRID.maxMultiplier,
      houseEdgeBps: DEFAULT_GRID.houseEdgeBps,
      volBpsPerSqrtSec: DEFAULT_GRID.volBpsPerSqrtSec,
      allowedDurationsMs: ALLOWED_WINDOW_MS,
    });
    // `centerLevel` and `firstFutureCol` are the deps that capture
    // meaningful grid movement. `nowTime` and `currentPrice` are
    // intentionally not direct deps: sub-step price ticks and the
    // 500 ms wallclock pulse should not rebuild the catalog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorPrice, centerLevel, firstFutureCol]);

  // Final cells passed to the canvas. The multiplier is part of the
  // cell's identity now — it was set by the empirical-table quote
  // when `baseCells` was last built and stays fixed until the cell
  // expires. This is what `BC.GAME / Tap Trading` and similar
  // touch-grid products do: cells are quoted once and locked, the
  // price line is the only thing that animates. Two side-effects:
  //
  //   1. No more drift between what the canvas shows and what the
  //      engine quotes on click — the empirical table the engine
  //      uses (`pricing.rs:213-243`) is the same one bundled in
  //      `lib/taptrade/empiricalPricing.ts`, so the local lookup
  //      and the server quote agree to the bp.
  //
  //   2. No more flicker on snake movement — the multiplier doesn't
  //      depend on `currentPrice` in this layer, so the wallclock
  //      tick only updates the time-based "Locked" flag and
  //      `windowStartOffsetMs` (used by the canvas to lay out the
  //      cell horizontally).
  const cells = useMemo(() => {
    if (baseCells.length === 0) return baseCells;
    // Build the heatmap key the way the engine emits it. The engine
    // stores prices as Q8 integers; the canvas builds floats from
    // `priceStepBps`. Convert to Q8 with the same rounding the engine
    // does so the lookup hits.
    return baseCells.map((cell) => {
      const offset = cell.windowStartMs - nowTime;
      const locallyLocked = cell.windowStartMs < nowTime + ACTIVATION_DELAY_MS - 1;
      const disabled = locallyLocked || cell.disabled;
      const pMinQ8 = Math.round(cell.pMin * 1e8).toString();
      const pMaxQ8 = Math.round(cell.pMax * 1e8).toString();
      const heatKey = `${pMinQ8}|${pMaxQ8}|${cell.windowStartMs}|${cell.windowEndMs}`;
      const heat = heatmap.byKey.get(heatKey);
      return {
        ...cell,
        windowStartOffsetMs: offset,
        disabled,
        reason: locallyLocked ? "Locked" : cell.reason,
        nBets: heat?.nBets,
        totalStakeWei: heat?.totalStakeWei,
      };
    });
  }, [baseCells, nowTime, heatmap]);

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
          // The visual line (RUSH_INDEX) is now the same path the
          // engine settles against — `arena_index::path_window` reads
          // the exact history that's broadcast on the WS. So clipping
          // the band locally is a safe optimistic WIN: the engine
          // will confirm the same result on its next resolution-loop
          // tick. The polling effect below catches any rare drift
          // (clock skew, ws reconnect dropping a frame) and overwrites
          // local state with the engine's authoritative answer.
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

  // Authoritative bet resolution: poll `/trade/bets/{id}` for every
  // local ACTIVE bet whose window has already elapsed (with a small
  // grace for engine commit). The local state stays ACTIVE until the
  // engine reports WON or LOST — which is the only source of truth
  // for the VRF arena. Gives up after a few attempts so a stuck bet
  // doesn't poll forever; the user can still see it on a manual
  // page refresh.
  const resolutionAttemptsRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    const candidates = bets.filter(
      (bet) =>
        bet.status === "ACTIVE" &&
        nowTime > bet.cell.windowEndMs + 250 &&
        (resolutionAttemptsRef.current.get(bet.id) ?? 0) < 12
    );
    if (candidates.length === 0) return;
    let cancelled = false;
    candidates.forEach((bet) => {
      const prior = resolutionAttemptsRef.current.get(bet.id) ?? 0;
      resolutionAttemptsRef.current.set(bet.id, prior + 1);
      void rushArenaClient
        .getBet(bet.id)
        .then((engineBet) => {
          if (cancelled) return;
          if (engineBet.status !== "WON" && engineBet.status !== "LOST") return;
          setBets((items) =>
            items.map((b) =>
              b.id === bet.id
                ? {
                    ...b,
                    status: engineBet.status,
                    finalResult: engineBet.finalResult ?? engineBet.status,
                    resolvedAt: engineBet.resolvedAt ?? Date.now(),
                    path: engineBet.path ?? b.path,
                  }
                : b
            )
          );
          resolutionAttemptsRef.current.delete(bet.id);
        })
        .catch(() => {
          /* swallow — next tick will retry until cap */
        });
    });
    return () => {
      cancelled = true;
    };
  }, [bets, nowTime]);

  // Race-resilient balance polling. The engine's resolution loop ticks
  // every 100 ms, but the frontend's local cell-touch detector can
  // beat the server by a few hundred ms. Hitting `/user/balance` once
  // right after the local WIN reads stale data; staggered refreshes
  // (300 ms / 1.2 s / 3 s) cover the worst-case engine commit window
  // without hammering the endpoint.
  const scheduleBalancePolling = useCallback(() => {
    const delays = [300, 1_200, 3_000, 6_000];
    delays.forEach((ms) => {
      window.setTimeout(() => void refreshBalance(), ms);
    });
  }, [refreshBalance]);

  // Background poll while the trade page is mounted. Keeps the
  // header balance honest even when WS / event detection misses a
  // resolution (e.g. tab regained focus mid-bet, listener stalled,
  // floater fired before engine commit). 1 s cadence so a fresh
  // deposit/withdraw lands in the UI within seconds of the engine
  // crediting it — the rate limiter (20 rps/IP) has plenty of head-
  // room and `/user/balance` is a single-row read.
  //
  // We ALSO refresh on visibilitychange + window focus: Chrome
  // throttles background `setInterval` aggressively (down to once
  // per minute when the tab is hidden), and the user-flow that
  // breaks balance the most is "switch to MetaMask, confirm tx,
  // switch back". The focus/visibility listeners hit `refreshBalance`
  // the instant the tab regains attention — no waiting for the
  // throttled timer to catch up.
  useEffect(() => {
    if (!isAuthenticated) return;
    const id = window.setInterval(() => {
      void refreshBalance();
    }, 1_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshBalance();
    };
    const onFocus = () => void refreshBalance();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [isAuthenticated, refreshBalance]);

  useEffect(() => {
    for (const bet of bets) {
      if ((bet.status !== "WON" && bet.status !== "LOST") || handledResolutionRef.current.has(bet.id)) {
        continue;
      }
      handledResolutionRef.current.add(bet.id);
      // Always poll the real balance after a resolution — both WIN
      // (release + payout) and LOSS (release only) move the off-chain
      // ledger. Polling early + late catches whichever side committed
      // first.
      scheduleBalancePolling();
      if (bet.status === "WON") {
        setBalance((value) => value + bet.potentialWin);
        hapticSuccess();
        // Bigger payoff sound when the multiplier was meaningful.
        // 3× is the threshold at which the cell visibly stood out
        // in the grid; below that, the chime is enough; above, the
        // shimmer cascade fires for that "you really hit it" feel.
        const wasBig = (bet.cell?.multiplier ?? 1) >= 3;
        playSound(wasBig ? "bigWin" : "win");
        // Spawn the "+amount ETH" floater. `from` defaults to the
        // viewport centre; `to` reads the Balance widget rect at
        // resolution time so the trajectory adapts to the active
        // breakpoint (desktop card vs mobile `+` button). Falls
        // back to the top-right corner if the ref isn't mounted
        // yet (shouldn't happen post-hydration).
        if (typeof window !== "undefined") {
          const fromX = window.innerWidth * 0.5;
          const fromY = window.innerHeight * 0.45;
          const rect = balanceRef.current?.getBoundingClientRect();
          const toX = rect ? rect.left + rect.width / 2 : window.innerWidth - 60;
          const toY = rect ? rect.top + rect.height / 2 : 32;
          // Floater shows the NET profit only — `potentialWin` is the
          // gross payout (stake × multiplier), so subtracting the stake
          // gives the actual ETH the player gained on this bet. Otherwise
          // a 0.0001 stake at 1.7× displays "+0.0002" and the player
          // assumes that's pure profit when half of it is just the stake
          // coming back from the lock.
          const netGain = Math.max(0, bet.potentialWin - bet.stakeAmount);
          setWinFloaters((prev) => [
            ...prev,
            {
              id: bet.id,
              amountEth: netGain,
              multiplier: bet.multiplier ?? 0,
              from: { x: fromX, y: fromY },
              to: { x: toX, y: toY },
            },
          ]);
        }
      } else {
        const x = typeof window === "undefined" ? 0 : window.innerWidth * 0.5;
        const y = typeof window === "undefined" ? 0 : window.innerHeight * 0.45;
        hapticError();
        particlesRef.current?.emitLoss(x, y);
      }
    }
  }, [bets, hapticError, hapticSuccess, playSound, setBalance, scheduleBalancePolling]);

  const handleCellClick = useCallback(
    async (cell: TapGridCell) => {
      if (cell.disabled || stakeAmount <= 0) return;
      if (requiresSession) {
        hapticError();
        if (!isConnected) {
          openWalletModal();
          toast.error("Connect a Base wallet to play Tap Trading");
        } else if (!isSigningIn) {
          void signIn();
          toast.error("Sign the Rush session before placing a bet");
        }
        return;
      }
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
        const quote = await rushArenaClient.requestQuote({
          cell,
          stakeAmountWei,
          livePrice: currentPrice,
        });
        const quotedCell: TapGridCell = {
          ...cell,
          multiplier: quote.multiplier,
          multiplierBps: quote.multiplierBps,
        };
        setBets((items) =>
          items.map((bet) =>
            bet.id === id
              ? {
                  ...bet,
                  cell: quotedCell,
                  multiplier: quote.multiplier,
                  multiplierBps: quote.multiplierBps,
                  potentialWin: stakeAmount * quote.multiplier,
                }
              : bet
          )
        );
        const placed = await rushArenaClient.placeBet({
          quote,
          cell: quotedCell,
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
                  cell: quotedCell,
                  multiplier: quote.multiplier,
                  multiplierBps: quote.multiplierBps,
                  potentialWin: stakeAmount * quote.multiplier,
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
    [balance, currentPrice, hapticError, hapticMedium, hapticTap, isConnected, isSigningIn, nowTime, openWalletModal, playSound, requiresSession, signIn, stakeAmount]
  );

  const pctMove = round && round.initialPrice > 0
    ? ((currentPrice - round.initialPrice) / round.initialPrice) * 100
    : 0;
  const roundEndsInMs = round ? Math.max(0, round.endsAt - nowTime) : 0;
  const activeBet = useMemo(() => {
    return bets.find((bet) => bet.status === "PENDING" || bet.status === "ACTIVE") ?? null;
  }, [bets]);
  const hoveredCell = hoveredCellId
    ? cells.find((cell) => cell.id === hoveredCellId && !cell.disabled) ?? null
    : null;
  const selectedCell = activeBet?.cell ?? hoveredCell ?? cells.find((cell) => !cell.disabled);
  const selectedTargetRaw = activeBet?.multiplier ?? selectedCell?.multiplier ?? 0;
  const selectedTarget = hydrated ? selectedTargetRaw : 0;
  const selectedPayout = stakeAmount * selectedTarget;
  const selectedTargetSeconds = hydrated
    ? activeBet
      ? Math.max(0, Math.ceil((activeBet.cell.windowEndMs - nowTime) / 1000))
      : Math.max(0, Math.ceil(((selectedCell?.windowEndMs ?? nowTime) - nowTime) / 1000))
    : 0;
  const ctaState = hydrated && activeBet ? "tracking" : hydrated && hoveredCell ? "ready" : "idle";

  return (
    <div className="flex min-h-screen flex-col bg-[#020403] text-[#dfffe6]">
      <Header />
      <div className="flex h-[calc(100dvh-3.5rem)] min-h-[640px] w-full flex-col overflow-hidden pb-[72px] sm:min-h-[720px] xl:pb-0">
        <ParticleSystem onRef={(ref) => (particlesRef.current = ref)} />

        <TopHeader
          symbol="RUSH/ETH"
          price={currentPrice}
          pctMove={pctMove}
          balance={balance}
          onOpenWallet={() => setWalletOpen(true)}
          balanceRef={balanceRef}
        />

        <WalletDrawer open={walletOpen} onClose={() => setWalletOpen(false)} />
        <WalletModalComponent />

        {winFloaters.map((f) => (
          <WinFloater
            key={f.id}
            amountEth={f.amountEth}
            multiplier={f.multiplier}
            from={f.from}
            to={f.to}
            onComplete={() => {
              setWinFloaters((prev) => prev.filter((entry) => entry.id !== f.id));
              // After the float lands in the balance widget, ask the
              // engine for the canonical post-settlement balance so
              // the number visibly bumps right as the floater absorbs.
              void refreshBalance();
            }}
          />
        ))}

        <main className="flex min-h-0 flex-1 gap-3 p-2 sm:p-3">
          <section className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-[#10251d] bg-[#020806] shadow-[0_0_34px_rgba(0,255,102,0.05)]">
              <div className="pointer-events-none absolute left-4 top-4 z-10 flex items-center gap-2">
                <span className="rounded border border-[#1d3327] bg-[#020806]/85 px-2 py-1 font-mono text-xs font-black text-white">M1</span>
                <span className="grid h-7 w-7 place-items-center rounded border border-[#1d3327] bg-[#020806]/85 text-[#b8c7d9]">⌁</span>
                <span className="grid h-7 w-7 place-items-center rounded border border-[#1d3327] bg-[#020806]/85 text-[#b8c7d9]">
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                </span>
              </div>
              <div className="pointer-events-none absolute right-4 top-4 z-10 flex items-center gap-1.5 rounded border border-[#1d3327] bg-[#020806]/85 px-2 py-1 font-mono text-[11px] font-bold text-[#00ff66]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#00ff66] shadow-[0_0_6px_#00ff66]" />
                <span>{heatmap.onlineCount} online</span>
              </div>
              <RushArenaCanvas
                ticks={ticks}
                currentPrice={currentPrice}
                nowTime={nowTime}
                cells={cells}
                bets={bets}
                onCellClick={handleCellClick}
                onCellHover={(cell) => setHoveredCellId(cell?.id ?? null)}
                className="h-full w-full"
              />
              {requiresSession ? (
                <SessionAccessPanel
                  isConnected={isConnected}
                  address={address}
                  isSigningIn={isSigningIn}
                  error={authError}
                  onConnect={openWalletModal}
                  onSignIn={() => void signIn()}
                />
              ) : null}
            </div>

            <MarketPanels nowTime={nowTime} />
          </section>

          <TradeSidebar
            stakeAmount={stakeAmount}
            setStakeAmount={setStakeAmount}
            balance={balance}
            selectedTarget={selectedTarget}
            selectedPayout={selectedPayout}
            selectedTargetSeconds={selectedTargetSeconds}
            ctaState={ctaState}
          />
        </main>

        <MobileStakeStrip
          stakeAmount={stakeAmount}
          setStakeAmount={setStakeAmount}
          balance={balance}
        />

        <RoundFooter
          roundEndsInMs={roundEndsInMs}
          serverSeedHash={activeVrfPathBet?.seedHash ?? fair?.serverSeedHash}
          seedId={activeVrfPathBet?.seedId}
          pathRegime={activeVrfPathBet?.pathRegime}
          betStatus={activeVrfPathBet?.status}
        />
      </div>
    </div>
  );
}

function SessionAccessPanel({
  isConnected,
  address,
  isSigningIn,
  error,
  onConnect,
  onSignIn,
}: {
  isConnected: boolean;
  address?: `0x${string}`;
  isSigningIn: boolean;
  error: string | null;
  onConnect: () => void;
  onSignIn: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-3 z-20 flex justify-center sm:inset-x-auto sm:bottom-5 sm:left-5">
      <div className="pointer-events-auto w-full max-w-[430px] rounded-xl border border-[#00ff66]/35 bg-[#020806]/94 p-4 shadow-[0_0_38px_rgba(0,255,102,0.18)] backdrop-blur-md">
        <div className="font-mono text-[10px] font-black uppercase tracking-[0.28em] text-[#00ff66]">
          Tap Trading session
        </div>
        <h2 className="mt-1 text-xl font-black text-white">Play inside Rush</h2>
        <p className="mt-2 text-sm leading-5 text-[#9bbca7]">
          Watch the live arena now. Connect and sign one gasless session when you are ready to place real ETH bets.
        </p>

        {isConnected && address ? (
          <div className="mt-3 rounded-lg border border-[#1d3327] bg-[#06100f] px-3 py-2 font-mono text-xs font-bold text-[#b8c7d9]">
            {address.slice(0, 6)}...{address.slice(-4)}
          </div>
        ) : null}

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {!isConnected ? (
            <button
              type="button"
              onClick={onConnect}
              className="h-12 rounded-lg border border-[#00ff66]/50 bg-[#00ff66] px-4 font-mono text-sm font-black uppercase tracking-[0.16em] text-[#021b0b] shadow-[0_0_22px_rgba(0,255,102,0.25)] transition hover:bg-[#35ff88]"
            >
              Connect Wallet
            </button>
          ) : (
            <button
              type="button"
              onClick={onSignIn}
              disabled={isSigningIn}
              className="h-12 rounded-lg border border-[#00ff66]/50 bg-[#00ff66] px-4 font-mono text-sm font-black uppercase tracking-[0.16em] text-[#021b0b] shadow-[0_0_22px_rgba(0,255,102,0.25)] transition hover:bg-[#35ff88] disabled:cursor-wait disabled:opacity-70"
            >
              {isSigningIn ? "Signing..." : "Sign Session"}
            </button>
          )}
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="h-12 rounded-lg border border-[#1d3327] bg-[#06100f] px-4 font-mono text-sm font-black uppercase tracking-[0.16em] text-[#b8c7d9] transition hover:border-[#00ff66]/40 hover:text-[#00ff66]"
          >
            Watch First
          </button>
        </div>

        {error ? (
          <p className="mt-3 break-words rounded-md border border-[#ff3b4d]/35 bg-[#1a0a0c] px-3 py-2 text-xs font-bold text-[#ff8a94]">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function TopHeader({
  symbol,
  price,
  pctMove,
  balance,
  onOpenWallet,
  balanceRef,
}: {
  symbol: string;
  price: number;
  pctMove: number;
  balance: number;
  onOpenWallet: () => void;
  balanceRef?: React.RefObject<HTMLDivElement>;
}) {
  const { enabled: soundEnabled, toggleSound } = useSoundManager();

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 overflow-hidden border-b border-[#10251d] bg-[#02070b] px-2 shadow-[0_1px_0_rgba(255,255,255,0.03)] sm:h-[72px] sm:gap-5 sm:px-5">
      {/* Logo — compact on phone, full on desktop */}
      <div className="flex min-w-0 shrink-0 items-center gap-2 sm:min-w-[210px] sm:gap-3">
        <div
          role="img"
          aria-label="Rush logo"
          className="h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-[#1aff84]/35 bg-[#858585] shadow-[0_0_24px_rgba(0,255,102,0.22)] sm:h-11 sm:w-11"
          style={{
            backgroundImage: "url('/logo.png')",
            backgroundPosition: "50% 31%",
            backgroundRepeat: "no-repeat",
            backgroundSize: "184%",
          }}
        />
        {/* RUSH text + trade subtitle — desktop only.
            Mobile gets just the logo to save horizontal space for
            price + balance which the player actually needs. */}
        <div className="hidden sm:block">
          <div className="font-sans text-3xl font-black leading-6 text-white">RUSH</div>
          <div className="font-mono text-[11px] font-black uppercase tracking-[0.28em] text-[#00ff66]">Tap Trading</div>
        </div>
      </div>

      {/* Symbol pill — compact on phone (no chevron, no R-circle, smaller font) */}
      <button className="flex h-9 min-w-0 shrink-0 items-center gap-1.5 rounded-md border border-[#1d3327] bg-[#040b0f] px-2 font-mono text-[12px] font-black text-white transition hover:border-[#00ff66]/60 sm:h-11 sm:gap-3 sm:rounded-lg sm:px-4 sm:text-lg">
        <span className="hidden h-5 w-5 place-items-center rounded-full bg-[#00ff66] text-xs text-[#02260f] sm:grid">R</span>
        {symbol}
        <ChevronDown className="hidden h-4 w-4 text-[#7b9186] sm:block" />
      </button>

      {/* Price + pct — now visible on mobile too (compact). Was
          desktop-only before; mobile players had no live price text
          outside of the canvas itself. */}
      <div className="flex min-w-0 items-baseline gap-1.5 sm:gap-3">
        <span
          className={`truncate font-mono text-base font-black sm:text-2xl ${pctMove >= 0 ? "text-[#00ff66]" : "text-[#ff3b4d]"}`}
          style={{ textShadow: pctMove >= 0 ? "0 0 16px rgba(0,255,102,0.34)" : "none" }}
        >
          {price > 0 ? price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
        </span>
        <span className={`font-mono text-[10px] font-bold sm:text-sm ${pctMove >= 0 ? "text-[#00ff66]" : "text-[#ff3b4d]"}`}>
          {formatPct(pctMove)}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-1.5 sm:gap-3">
        <div className="hidden h-10 items-center gap-2 rounded-lg border border-[#1d3327] bg-[#040b0f] px-4 font-mono text-xs font-black uppercase text-[#00ff66] lg:flex">
          <span className="h-2 w-2 rounded-full bg-[#00ff66] shadow-[0_0_10px_rgba(0,255,102,0.85)]" />
          Live
        </div>
        {/* Sound + Settings hidden on phone — non-essential and
            crowd the header. Reachable from a future menu if needed. */}
        <button
          onClick={toggleSound}
          className={`hidden h-10 w-10 place-items-center rounded-lg border bg-[#040b0f] transition hover:border-[#00ff66]/60 hover:text-[#00ff66] sm:grid ${
            soundEnabled ? "border-[#1d3327] text-[#b8c7d9]" : "border-[#33211d] text-[#ff7d65]"
          }`}
          aria-label={soundEnabled ? "Mute sound" : "Enable sound"}
        >
          {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        </button>
        <button className="hidden h-10 w-10 place-items-center rounded-lg border border-[#1d3327] bg-[#040b0f] text-[#b8c7d9] transition hover:border-[#00ff66]/60 hover:text-[#00ff66] sm:grid" aria-label="Settings">
          <SettingsIcon className="h-4 w-4" />
        </button>
        {/* Wallet trigger — full card on md+, compact icon on mobile.
            Wrapped in a div carrying `balanceRef` so the WinFloater
            converges on whichever button is visible at the current
            breakpoint (the hidden one collapses to width:0 inside
            this flex container). */}
        <div ref={balanceRef} className="flex items-center">
          <button
            type="button"
            onClick={onOpenWallet}
            aria-label="Open wallet"
            className="hidden h-12 min-w-[220px] items-center justify-between rounded-lg border border-[#1d3327] bg-[#040b0f] pl-4 pr-2 transition hover:border-[#00ff66]/60 hover:bg-[#062014] md:flex"
          >
            <div className="text-left font-mono">
              <div className="text-[9px] font-black uppercase tracking-widest text-[#5a8068]">Balance</div>
              <div className="text-base font-black text-white">{formatEth(balance, 4)} <span className="text-xs text-[#8aa393]">ETH</span></div>
            </div>
            <span className="grid h-8 w-8 place-items-center rounded-md border border-[#72ff9d]/50 bg-[#00ff66] text-[#02260f] shadow-[0_0_18px_rgba(0,255,102,0.38)]">
              <Plus className="h-5 w-5" />
            </span>
          </button>
          {/* Mobile: compact balance pill + plus icon.
              Without the balance number visible the user can't see
              their funds without opening the drawer — and many
              players assumed their deposit was lost. */}
          <button
            type="button"
            onClick={onOpenWallet}
            aria-label="Open wallet"
            className="flex h-10 items-center gap-2 rounded-lg border border-[#1d3327] bg-[#040b0f] pl-3 pr-1 transition hover:border-[#00ff66]/60 md:hidden"
          >
            <span className="font-mono text-sm font-black text-white">
              {formatEth(balance, 4)}
              <span className="ml-1 text-[10px] font-bold text-[#8aa393]">ETH</span>
            </span>
            <span className="grid h-8 w-8 place-items-center rounded-md border border-[#72ff9d]/50 bg-[#00ff66] text-[#02260f] shadow-[0_0_18px_rgba(0,255,102,0.38)]">
              <Plus className="h-4 w-4" />
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}

function TradeSidebar({
  stakeAmount,
  setStakeAmount,
  selectedTarget,
  selectedPayout,
  selectedTargetSeconds,
  ctaState,
}: {
  stakeAmount: number;
  setStakeAmount: (value: number) => void;
  balance: number;
  selectedTarget: number;
  selectedPayout: number;
  selectedTargetSeconds: number;
  ctaState: "idle" | "ready" | "tracking";
}) {
  const ctaLabel =
    ctaState === "tracking"
      ? "Tracking Target"
      : ctaState === "ready" && selectedTarget > 0
        ? `Place ${selectedTarget.toFixed(2)}x`
        : "Tap To Enter";
  const ctaSubline =
    ctaState === "tracking"
      ? `${selectedTargetSeconds}s remaining`
      : ctaState === "ready"
        ? "Click the highlighted cell"
        : "Select a cell in the grid";

  // Same draft-string pattern as MobileStakeStrip — Number()
  // coercion on every keystroke would reset the field while the user
  // types intermediate values like "0", "0.0", "0.00".
  const [stakeDraft, setStakeDraft] = useState(() => String(stakeAmount));
  useEffect(() => {
    setStakeDraft((prev) => (Number(prev) === stakeAmount ? prev : String(stakeAmount)));
  }, [stakeAmount]);

  return (
    <aside className="hidden w-[330px] shrink-0 flex-col gap-3 xl:flex">
      <div className="rounded-lg border border-[#10251d] bg-[#06100f] p-4 shadow-[0_0_28px_rgba(0,255,102,0.04)]">
        <div className="font-mono text-xs font-black uppercase tracking-widest text-[#8aa393]">Stake Amount</div>
        <label className="mt-3 flex h-14 items-center rounded-md border border-[#183229] bg-[#020806] px-4 shadow-[inset_0_0_18px_rgba(0,255,102,0.03)]">
          <input
            value={stakeDraft}
            onChange={(event) => {
              const raw = event.target.value;
              if (raw !== "" && !/^\d*\.?\d*$/.test(raw)) return;
              setStakeDraft(raw);
              const next = Number(raw);
              if (raw !== "" && Number.isFinite(next) && next > 0) {
                setStakeAmount(next);
              }
            }}
            onBlur={() => {
              const next = Number(stakeDraft);
              if (!Number.isFinite(next) || next <= 0) {
                setStakeAmount(0.0001);
                setStakeDraft("0.0001");
              }
            }}
            inputMode="decimal"
            className="min-w-0 flex-1 bg-transparent font-mono text-2xl font-black text-white outline-none"
          />
          <span className="font-mono text-xs font-bold text-[#8aa393]">ETH</span>
        </label>

        <div className="mt-3 grid grid-cols-4 gap-2">
          {STAKE_PRESETS.map((preset) => (
            <button
              key={preset}
              onClick={() => setStakeAmount(preset)}
              className={`h-9 rounded-md border font-mono text-[11px] font-black transition ${
                stakeAmount === preset
                  ? "border-[#00ff66] bg-[#00ff66]/18 text-[#00ff66] shadow-[0_0_14px_rgba(0,255,102,0.18)]"
                  : "border-[#1d3327] bg-[#07100f] text-[#b8c7d9] hover:border-[#00ff66]/55 hover:text-[#00ff66]"
              }`}
            >
              {preset}
            </button>
          ))}
        </div>

        <div className="mt-5 font-mono text-xs font-black uppercase tracking-widest text-[#8aa393]">
          Auto Cashout <span className="text-[10px] text-[#5a8068]">(optional)</span>
        </div>
        <div className="mt-2 flex h-11 items-center justify-between rounded-md border border-[#183229] bg-[#020806] px-3 font-mono text-sm font-bold uppercase text-[#6f8179]">
          <span>Disabled</span>
          <span className="h-5 w-9 rounded-full bg-[#1a2522] p-0.5">
            <span className="block h-4 w-4 rounded-full bg-[#b8c7d9]" />
          </span>
        </div>

        <div className="mt-5 font-mono text-xs font-black uppercase tracking-widest text-[#8aa393]">Selected Target</div>
        <div className="mt-2 rounded-md border border-[#183229] bg-[#020806] p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-3xl font-black text-[#00ff66]">
              {selectedTarget > 0 ? `${selectedTarget.toFixed(2)}x` : "--"}
            </span>
            <span className="font-mono text-lg font-black text-white">{selectedTargetSeconds}s</span>
          </div>
          <div className="mt-3 flex items-center justify-between font-mono text-sm">
            <span className="font-bold uppercase text-[#708a7c]">Payout</span>
            <span className="font-black text-[#00ff66]">{formatEth(selectedPayout, 4)} <span className="text-xs text-[#8aa393]">ETH</span></span>
          </div>
        </div>

        <button
          className={`mt-4 h-16 w-full rounded-md border font-mono text-lg font-black uppercase shadow-[0_0_24px_rgba(0,255,102,0.35)] transition ${
            ctaState === "tracking"
              ? "border-[#7dff9b]/45 bg-[#0b2518] text-[#00ff66]"
              : ctaState === "ready"
                ? "border-[#dfff2a]/70 bg-[#dfff2a] text-[#071400] hover:bg-[#ecff5a]"
                : "border-[#7dff9b]/55 bg-[#00e866] text-[#021b0b] hover:bg-[#23ff7d]"
          }`}
        >
          {ctaLabel}
          <span className={`block text-xs font-bold normal-case ${
            ctaState === "tracking" ? "text-[#8affb8]" : "text-[#043414]"
          }`}>
            {ctaSubline}
          </span>
        </button>
      </div>

      <div className="rounded-lg border border-[#10251d] bg-[#06100f] p-4">
        <div className="flex items-center justify-between font-mono text-xs font-black uppercase tracking-widest text-[#8aa393]">
          <span>Game Mode</span>
          <span className="text-[#5a8068]">ⓘ</span>
        </div>
        <button className="mt-3 flex h-11 w-full items-center justify-between rounded-md border border-[#183229] bg-[#020806] px-3 font-mono text-sm font-black uppercase text-[#00ff66]">
          Classic
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}

function MobileStakeStrip({
  stakeAmount,
  setStakeAmount,
  balance,
}: {
  stakeAmount: number;
  setStakeAmount: (value: number) => void;
  balance: number;
}) {
  // Touch-target ergonomics: Apple HIG + Material both recommend
  // ≥44 px tap surface. The previous 36 px buttons were misclick-prone
  // on phones, especially during fast play. Bumped to 48 px.
  const cheapestRatio = stakeAmount > 0 ? Math.min(1, stakeAmount / Math.max(balance, 0.0001)) : 0;

  // Local string state lets the user type intermediate values
  // ("0", "0.0", "0.00", "0.005") without the parent immediately
  // coercing to Number and resetting to the fallback. We only push
  // a numeric stake up on blur or when the field already parses to a
  // valid number above the floor. Keeps the parent in sync when a
  // preset is tapped from outside (the parent's `stakeAmount` flips
  // and we mirror it).
  const [draft, setDraft] = useState(() => String(stakeAmount));
  useEffect(() => {
    setDraft((prev) => (Number(prev) === stakeAmount ? prev : String(stakeAmount)));
  }, [stakeAmount]);

  return (
    <div className="flex h-16 shrink-0 items-center gap-2 border-t border-[#10251d] bg-[#02070b] px-2 xl:hidden">
      <label className="flex h-12 w-28 shrink-0 items-center rounded-lg border border-[#1d3327] bg-[#06100f] px-2.5 sm:w-32 sm:px-3">
        <input
          value={draft}
          onChange={(event) => {
            const raw = event.target.value;
            // Allow only digits + a single dot (rejects letters, signs,
            // multiple dots). Empty string is allowed so the user can
            // clear and retype.
            if (raw !== "" && !/^\d*\.?\d*$/.test(raw)) return;
            setDraft(raw);
            // Push parent only when the draft parses to a finite
            // value > 0. While the user types "0", "0.", "0.0" etc.,
            // we keep the local draft but DO NOT reset the parent.
            const next = Number(raw);
            if (raw !== "" && Number.isFinite(next) && next > 0) {
              setStakeAmount(next);
            }
          }}
          onBlur={() => {
            // Final commit on blur — falls back to the floor if the
            // user left the input empty or invalid.
            const next = Number(draft);
            if (!Number.isFinite(next) || next <= 0) {
              setStakeAmount(0.0001);
              setDraft("0.0001");
            }
          }}
          inputMode="decimal"
          aria-label="Bet stake (ETH)"
          className="min-w-0 flex-1 bg-transparent font-mono text-base font-black text-white outline-none"
        />
        <span className="font-mono text-[10px] font-bold text-[#8aa393]">ETH</span>
      </label>
      <div
        className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto"
        style={{ scrollbarWidth: "none" }}
      >
        {STAKE_PRESETS.map((preset) => {
          const isSelected = stakeAmount === preset;
          const overBalance = preset > balance;
          return (
            <button
              key={preset}
              onClick={() => setStakeAmount(preset)}
              disabled={overBalance}
              className={`flex h-12 w-16 shrink-0 flex-col items-center justify-center rounded-lg border font-mono text-xs font-black transition active:scale-95 ${
                overBalance
                  ? "cursor-not-allowed border-[#1a1a1a] bg-[#0a0a0a] text-[#3a3a3a]"
                  : isSelected
                    ? "border-[#00ff66] bg-[#00ff66]/18 text-[#00ff66] shadow-[0_0_18px_rgba(0,255,102,0.3)]"
                    : "border-[#1d3327] bg-[#06100f] text-[#b8c7d9] hover:border-[#00ff66]/40"
              }`}
            >
              {preset}
            </button>
          );
        })}
      </div>
      {/* Stake-to-balance bar — visual cue when stake nears bankroll
          so the player notices before clicking and getting an
          InsufficientFreeMargin reject. Keeps the visible balance in
          the strip so they don't have to look up at the header. */}
      <div className="hidden flex-col items-end gap-1 font-mono sm:flex">
        <span className="text-[10px] font-bold uppercase tracking-widest text-[#5a8068]">Balance</span>
        <span className={`text-sm font-black ${cheapestRatio > 0.8 ? "text-[#ff7d65]" : "text-white"}`}>
          {formatEth(balance, 4)}
        </span>
      </div>
    </div>
  );
}

// Stake/payout in the public-feed entries are wei strings; render in
// ETH so the canvas shows the same canonical unit everywhere.
function weiToEth(wei: string): number {
  try {
    const big = BigInt(wei);
    // Two-step divide keeps large numbers within Number's safe range
    // without losing the 5–6 decimal places we care about for Tier 1.
    return Number(big / BigInt("1000000000000")) / 1_000_000;
  } catch {
    return 0;
  }
}

function MarketPanels({
  nowTime,
}: {
  nowTime: number;
}) {
  // Public-feed polling. 4 s is a sweet spot: cells move at ~150 ms,
  // but the social-proof panels don't need to flicker every tick —
  // 4 s gives "alive" without burning bandwidth or rate limit. In
  // mock mode the helpers return canned data so /preview still
  // shows the same UX.
  const [active, setActive] = useState<PublicBetEntry[]>([]);
  const [wins, setWins] = useState<PublicBetEntry[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    const loadAll = async () => {
      try {
        const [a, w, l] = await Promise.all([
          rushArenaClient.listPublicActiveBets(),
          rushArenaClient.listPublicRecentWins(),
          rushArenaClient.getLeaderboard(10),
        ]);
        if (cancelled) return;
        setActive(a);
        setWins(w);
        setLeaderboard(l);
      } catch {
        // Silent failure: mock fallback already populated the panels
        // through the first successful tick (or never if engine is
        // down on first render — but that's fine, panels show empty).
      }
    };
    void loadAll();
    const id = window.setInterval(() => void loadAll(), 4_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Cap visible rows so the panel never grows past ~5 lines of
  // signal — the canvas is the hero, panels are sidekicks.
  const activeRows = active.slice(0, 5);
  const winRows = wins.slice(0, 5);
  const leaderRows = leaderboard.slice(0, 5);

  return (
    <div className="hidden shrink-0 grid-cols-1 gap-2 md:grid md:grid-cols-3">
      <DataPanel title="Active Bets" count={active.length}>
        {activeRows.map((row) => (
          <PanelRow
            key={row.id}
            player={row.playerHandle}
            stake={weiToEth(row.stakeWei)}
            target={row.multiplierBps / 10_000}
            payout={weiToEth(row.potentialPayoutWei)}
          />
        ))}
      </DataPanel>

      <DataPanel title="Recent Wins" count={wins.length}>
        {winRows.map((row) => {
          const ago = row.resolvedAtMs
            ? `${Math.max(0, Math.ceil((nowTime - row.resolvedAtMs) / 1000))}s`
            : undefined;
          return (
            <PanelRow
              key={row.id}
              player={row.playerHandle}
              stake={weiToEth(row.stakeWei)}
              target={row.multiplierBps / 10_000}
              payout={weiToEth(row.potentialPayoutWei)}
              time={ago}
            />
          );
        })}
      </DataPanel>

      <DataPanel title="Leaderboard">
        {leaderRows.map((row) => (
          <div
            key={`${row.rank}-${row.player}`}
            className="grid grid-cols-[22px_1fr_38px_64px] items-center gap-1.5 border-b border-[#0d2a1f]/70 py-1 font-mono text-[11px] last:border-0"
          >
            <span className="grid h-4 w-4 place-items-center rounded-full border border-[#244235] text-[9px] font-black text-[#b8c7d9]">
              {row.rank}
            </span>
            <span className="truncate font-bold text-white">{row.player}</span>
            <span className="text-right text-[#b8c7d9]">{row.wins}</span>
            <span className="text-right font-black text-[#00ff66]">
              {formatEth(weiToEth(row.realizedPnlWei), 3)}
            </span>
          </div>
        ))}
      </DataPanel>
    </div>
  );
}

function DataPanel({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-[#10251d] bg-[#06100f] px-2.5 py-2">
      <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] font-black uppercase tracking-[0.18em] text-[#dfffe6]">
        {title}
        {typeof count === "number" ? (
          <span className="rounded-full border border-[#1d3327] bg-[#10201a] px-1.5 py-px text-[9px] text-[#9ec3aa]">
            {count}
          </span>
        ) : null}
      </div>
      <div className="grid grid-cols-[1.3fr_0.6fr_0.55fr_0.7fr] gap-1.5 border-b border-[#0d2a1f] pb-0.5 font-mono text-[9px] font-black uppercase tracking-widest text-[#708a7c]">
        <span>Player</span>
        <span className="text-right">Stake</span>
        <span className="text-right">×</span>
        <span className="text-right">Win</span>
      </div>
      {children}
    </div>
  );
}

function PanelRow({
  player,
  stake,
  target,
  payout,
  time,
}: {
  player: string;
  stake: number;
  target: number;
  payout: number;
  time?: string;
}) {
  return (
    <div className="grid grid-cols-[1.3fr_0.6fr_0.55fr_0.7fr] items-center gap-1.5 border-b border-[#0d2a1f]/70 py-0.5 font-mono text-[11px] last:border-0">
      <span className="flex items-center gap-1 truncate font-bold text-white">
        <span className="truncate">{player}</span>
        {time ? (
          <span className="shrink-0 text-[9px] font-bold text-[#708a7c]">· {time}</span>
        ) : null}
      </span>
      <span className="text-right text-[#b8c7d9]">{formatEth(stake, 3)}</span>
      <span className="text-right font-black text-[#00ff66]">{target.toFixed(2)}×</span>
      <span className="text-right font-black text-[#00ff66]">{formatEth(payout, 3)}</span>
    </div>
  );
}

function RoundFooter({
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
    <footer className="hidden h-10 shrink-0 items-center gap-5 overflow-hidden border-t border-[#10251d] bg-[#02070b] px-5 font-mono text-[11px] text-[#708a7c] md:flex">
      <div className="flex items-center gap-2 font-black uppercase tracking-widest text-[#8aa393]">
        <ShieldCheck className="h-3.5 w-3.5 text-[#00ff66]" />
        Fairness
        <span className="h-2 w-2 rounded-full bg-[#00ff66] shadow-[0_0_10px_rgba(0,255,102,0.85)]" />
      </div>
      <span>Round ends in <b className="text-[#dfffe6]">{formatHms(roundEndsInMs)}</b></span>
      <span>Server seed <b className="text-[#8aa393]">{shortHash(serverSeedHash)}</b></span>
      <span>Round ID <b className="text-[#8aa393]">{seedId ? `#${seedId.slice(-7)}` : "#9283745"}</b></span>
      {isLocked ? (
        <span className="text-[#00ff66]">
          {betStatus === "PENDING" ? "Path in 3...2...1" : "Line live"} {pathRegime ? `· ${pathRegime}` : ""}
        </span>
      ) : null}
      <span className="ml-auto">Network <b className="text-[#00ff66]">124ms</b></span>
    </footer>
  );
}
