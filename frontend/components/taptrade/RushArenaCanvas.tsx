"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import type { RushArenaBet, RushTick } from "@/lib/api/rushArenaClient";
import {
  type ChartViewport,
  xForTime,
  yForPrice,
} from "@/lib/taptrade/coordinates";
import { multiplierLabel, type TapGridCell } from "@/lib/taptrade/grid";
import { cn } from "@/lib/utils";

type ScreenCell = {
  cell: TapGridCell;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
};

type LockedPriceViewport = {
  minPrice: number;
  maxPrice: number;
};

type ClickFlash = {
  cellId: string;
  startedAt: number;
};

export type RushArenaCanvasProps = {
  ticks: RushTick[];
  currentPrice: number;
  nowTime: number;
  cells: TapGridCell[];
  bets: RushArenaBet[];
  onCellClick: (cell: TapGridCell) => void;
  onCellHover?: (cell: TapGridCell | null) => void;
  disabled?: boolean;
  className?: string;
};

const BG = "#020403";
const GREEN = "#00ff66";
const YELLOW = "#ffe600";
const AMBER = "#ffaa00";
const RED = "#ff3b4d";

const TARGET_REFRESH_MS = 500;
const SPRING_STIFFNESS = 34;
const SPRING_DAMPING = 7.4;
const MAX_SPEED_PER_SECOND = 0.011;
const CAMERA_EASE_MS = 520;
const TRAIL_SAMPLE_MS = 70;
const TRAIL_HISTORY_MS = 45_000;
const WIN_BURST_MS = 1_850;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function easeOutCubic(value: number) {
  const t = clamp(value, 0, 1);
  return 1 - Math.pow(1 - t, 3);
}

function hashStr(value: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function seededUnit(seed: number, salt: number): number {
  let x = (seed ^ Math.imul(salt + 1, 374761393)) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 3266489917) >>> 0;
  x ^= x >>> 16;
  return x / 4294967295;
}

function formatPrice(price: number): string {
  if (!Number.isFinite(price)) return "--";
  return price.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatShortTime(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m`;
}

function stakeLabel(value: number): string {
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toFixed(0);
}

function fallbackTrail(
  startTime: number,
  endTime: number,
  renderedPrice: number,
  viewport: LockedPriceViewport,
  pointCount: number
): RushTick[] {
  if (!Number.isFinite(renderedPrice) || renderedPrice <= 0 || pointCount < 2) {
    return [];
  }

  const span = Math.max(viewport.maxPrice - viewport.minPrice, renderedPrice * 0.002);
  const amplitude = Math.min(span * 0.18, Math.max(span * 0.055, renderedPrice * 0.0007));
  const pad = span * 0.035;
  const minPrice = viewport.minPrice + pad;
  const maxPrice = viewport.maxPrice - pad;
  const duration = Math.max(1, endTime - startTime);
  const points: RushTick[] = [];

  for (let i = 0; i < pointCount; i += 1) {
    const progress = i / (pointCount - 1);
    const timestampMs = startTime + duration * progress;
    const phase = timestampMs / 1000;
    const taper = Math.sin(progress * Math.PI);
    const wave =
      Math.sin(phase * 1.15) * 0.72 +
      Math.sin(phase * 2.8 + 1.3) * 0.24 +
      Math.cos(phase * 0.52 - 0.8) * 0.18;
    const price =
      i === pointCount - 1
        ? renderedPrice
        : Math.max(minPrice, Math.min(maxPrice, renderedPrice + wave * amplitude * taper));

    points.push({
      tick: i,
      timestampMs,
      price,
    });
  }

  return points;
}

function drawSplinePath(
  ctx: CanvasRenderingContext2D,
  points: Array<{ x: number; y: number }>
) {
  if (points.length < 2) return;

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }
  ctx.stroke();
}

function drawWinBurst(
  ctx: CanvasRenderingContext2D,
  params: {
    x: number;
    y: number;
    width: number;
    height: number;
    age: number;
    label: string;
    seed: number;
    compact: boolean;
  }
) {
  const age = Math.max(0, params.age);
  const progress = clamp(age / WIN_BURST_MS, 0, 1);
  const burstIn = easeOutCubic(age / 520);
  const fade = Math.pow(1 - progress, 1.35);
  if (fade <= 0.01) return;

  const tile = Math.max(18, Math.min(params.width, params.height));
  const radius = tile * (0.48 + burstIn * 1.9);
  const cx = params.x;
  const cy = params.y;

  ctx.save();
  ctx.globalCompositeOperation = "screen";

  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  glow.addColorStop(0, `rgba(223,255,42,${0.78 * fade})`);
  glow.addColorStop(0.24, `rgba(0,255,102,${0.34 * fade})`);
  glow.addColorStop(0.68, `rgba(0,255,102,${0.10 * fade})`);
  glow.addColorStop(1, "rgba(0,255,102,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

  for (let ring = 0; ring < 3; ring += 1) {
    const ringAge = age - ring * 150;
    if (ringAge < 0) continue;
    const ringProgress = clamp(ringAge / 720, 0, 1);
    const ringFade = Math.pow(1 - ringProgress, 1.8) * fade;
    if (ringFade <= 0.01) continue;
    ctx.beginPath();
    ctx.arc(cx, cy, tile * (0.36 + ringProgress * (1.75 + ring * 0.32)), 0, Math.PI * 2);
    ctx.strokeStyle = ring % 2 === 0
      ? `rgba(223,255,42,${0.58 * ringFade})`
      : `rgba(0,255,102,${0.42 * ringFade})`;
    ctx.lineWidth = Math.max(1, tile * (0.05 - ringProgress * 0.025));
    ctx.stroke();
  }

  const coreFade = Math.max(0, 1 - age / 980);
  if (coreFade > 0.01) {
    for (let i = 0; i < 24; i += 1) {
      const angle = seededUnit(params.seed, i * 7) * Math.PI * 2;
      const dist = tile * (0.05 + seededUnit(params.seed, i * 7 + 1) * 0.55) * burstIn;
      const dotSize = tile * (0.10 + seededUnit(params.seed, i * 7 + 2) * 0.14) * coreFade;
      ctx.beginPath();
      ctx.arc(
        cx + Math.cos(angle) * dist,
        cy + Math.sin(angle) * dist,
        dotSize,
        0,
        Math.PI * 2
      );
      ctx.fillStyle = i % 3 === 0
        ? `rgba(223,255,42,${0.42 * coreFade})`
        : `rgba(0,255,102,${0.34 * coreFade})`;
      ctx.fill();
    }
  }

  const sparks = params.compact ? 30 : 42;
  for (let i = 0; i < sparks; i += 1) {
    const delay = seededUnit(params.seed, i * 11) * 230;
    const life = 720 + seededUnit(params.seed, i * 11 + 1) * 720;
    const local = (age - delay) / life;
    if (local < 0 || local > 1) continue;

    const move = easeOutCubic(local);
    const alpha = Math.pow(1 - local, 1.55) * fade;
    if (alpha <= 0.01) continue;

    const angle = seededUnit(params.seed, i * 11 + 2) * Math.PI * 2;
    const speed = tile * (0.85 + seededUnit(params.seed, i * 11 + 3) * 2.25);
    const wobble = Math.sin(local * Math.PI * 2 + seededUnit(params.seed, i * 11 + 4) * 6) * tile * 0.08;
    const px = cx + Math.cos(angle) * speed * move + Math.cos(angle + Math.PI / 2) * wobble;
    const py = cy + Math.sin(angle) * speed * move + Math.sin(angle + Math.PI / 2) * wobble + tile * 0.34 * local * local;
    const tailX = cx + Math.cos(angle) * speed * Math.max(0, move - 0.14);
    const tailY = cy + Math.sin(angle) * speed * Math.max(0, move - 0.14);

    ctx.strokeStyle = i % 2 === 0
      ? `rgba(223,255,42,${0.55 * alpha})`
      : `rgba(0,255,102,${0.48 * alpha})`;
    ctx.lineWidth = Math.max(1, tile * (0.018 + seededUnit(params.seed, i * 11 + 5) * 0.018));
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(px, py);
    ctx.stroke();

    if (i % 5 === 0 && tile >= 24) {
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate((seededUnit(params.seed, i * 11 + 6) - 0.5) * 1.2 + local * 1.6);
      ctx.fillStyle = i % 10 === 0
        ? `rgba(223,255,42,${0.88 * alpha})`
        : `rgba(0,255,102,${0.82 * alpha})`;
      ctx.font = `900 ${Math.max(9, Math.min(16, tile * 0.2))}px JetBrains Mono, ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(i % 10 === 0 ? "$" : "R", 0, 0);
      ctx.restore();
    }
  }

  if (age < 1_180 && tile >= 22) {
    const textProgress = clamp(age / 300, 0, 1);
    const textFade = Math.min(1, age / 120) * Math.max(0, 1 - Math.max(0, age - 900) / 280);
    const fontSize = Math.max(
      14,
      Math.min(params.compact ? 22 : 30, tile * (0.34 + 0.12 * Math.sin(textProgress * Math.PI)))
    );
    ctx.globalCompositeOperation = "source-over";
    ctx.shadowColor = "#dfff2a";
    ctx.shadowBlur = 12;
    ctx.fillStyle = `rgba(238,255,214,${textFade})`;
    ctx.font = `900 ${fontSize}px JetBrains Mono, ui-monospace, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(params.label, cx, cy);
  }

  ctx.restore();
}

function initialPriceViewport(
  currentPrice: number,
  cells: TapGridCell[]
): LockedPriceViewport {
  const fallback = currentPrice > 0 ? currentPrice : 1_245.73;
  const cellPrices = cells
    .flatMap((cell) => [cell.pMin, cell.pMax])
    .filter((p) => Number.isFinite(p) && p > 0);

  if (cellPrices.length > 0) {
    const minPrice = Math.min(...cellPrices);
    const maxPrice = Math.max(...cellPrices);
    const span = Math.max(maxPrice - minPrice, fallback * 0.001);
    const pad = span * 0.18;
    let lo = minPrice - pad;
    let hi = maxPrice + pad;
    if (Number.isFinite(currentPrice) && currentPrice > 0) {
      lo = Math.min(lo, currentPrice - span * 0.18);
      hi = Math.max(hi, currentPrice + span * 0.18);
    }
    return { minPrice: lo, maxPrice: hi };
  }

  const span = fallback * 0.04;
  return { minPrice: fallback - span, maxPrice: fallback + span };
}

export function RushArenaCanvas({
  ticks,
  currentPrice,
  nowTime,
  cells,
  bets,
  onCellClick,
  onCellHover,
  disabled = false,
  className,
}: RushArenaCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const screenCellsRef = useRef<ScreenCell[]>([]);
  const priceViewportRef = useRef<LockedPriceViewport | null>(null);
  const dataRef = useRef({ ticks, currentPrice, nowTime, cells, bets, disabled });
  const hoverCellIdRef = useRef<string | null>(null);
  const renderedPriceRef = useRef(0);
  const renderedVelocityRef = useRef(0);
  const visualTargetPriceRef = useRef(0);
  const visualTargetAtRef = useRef(0);
  const displayTrailRef = useRef<RushTick[]>([]);
  const lastFrameAtRef = useRef(0);
  const clickFlashesRef = useRef<ClickFlash[]>([]);
  // Tracks the first wallclock instant we saw each cell id, so we can
  // fade newcomers in instead of popping them on screen full alpha.
  const cellFirstSeenRef = useRef<Map<string, number>>(new Map());
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    dataRef.current = { ticks, currentPrice, nowTime, cells, bets, disabled };
    if (renderedPriceRef.current <= 0 && currentPrice > 0) {
      renderedPriceRef.current = currentPrice;
    }
  }, [ticks, currentPrice, nowTime, cells, bets, disabled]);

  useEffect(() => {
    if (!priceViewportRef.current && currentPrice > 0 && cells.length > 0) {
      priceViewportRef.current = initialPriceViewport(currentPrice, cells);
    }
  }, [cells, currentPrice]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const resize = () => setSize({ width: node.clientWidth, height: node.clientHeight });
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width <= 0 || size.height <= 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(size.width * dpr);
    canvas.height = Math.floor(size.height * dpr);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let frame = 0;

    const draw = (frameTime: number) => {
      const data = dataRef.current;
      const width = size.width;
      const height = size.height;
      const wallNow = Date.now();
      const lastFrame = lastFrameAtRef.current || frameTime;
      const dt = Math.min(50, Math.max(1, frameTime - lastFrame));
      const dtSeconds = dt / 1000;
      lastFrameAtRef.current = frameTime;

      const rawPrice = data.currentPrice || renderedPriceRef.current || 1_245.73;
      if (renderedPriceRef.current <= 0) renderedPriceRef.current = rawPrice;
      if (visualTargetPriceRef.current <= 0) visualTargetPriceRef.current = rawPrice;
      const targetAge = wallNow - visualTargetAtRef.current;
      const rawGap = Math.abs(rawPrice - visualTargetPriceRef.current);
      if (
        targetAge >= TARGET_REFRESH_MS ||
        rawGap > rawPrice * 0.0025
      ) {
        visualTargetPriceRef.current = rawPrice;
        visualTargetAtRef.current = wallNow;
      }
      const targetPrice = visualTargetPriceRef.current;
      const springGap = targetPrice - renderedPriceRef.current;
      const acceleration =
        springGap * SPRING_STIFFNESS -
        renderedVelocityRef.current * SPRING_DAMPING;
      renderedVelocityRef.current += acceleration * dtSeconds;
      const maxSpeed = Math.max(rawPrice * MAX_SPEED_PER_SECOND, Math.abs(springGap) * 2.4, 0.25);
      renderedVelocityRef.current = clamp(renderedVelocityRef.current, -maxSpeed, maxSpeed);
      renderedPriceRef.current += renderedVelocityRef.current * dtSeconds;
      if (
        Math.abs(springGap) < rawPrice * 0.000015 &&
        Math.abs(renderedVelocityRef.current) < rawPrice * 0.00008
      ) {
        renderedPriceRef.current = targetPrice;
        renderedVelocityRef.current = 0;
      }
      const renderedPrice = renderedPriceRef.current;

      const displayTrail = displayTrailRef.current;
      const latestDisplayTick = data.ticks[data.ticks.length - 1];
      const lastDisplayPoint = displayTrail[displayTrail.length - 1];
      if (!lastDisplayPoint || wallNow - lastDisplayPoint.timestampMs >= TRAIL_SAMPLE_MS) {
        displayTrail.push({
          tick: latestDisplayTick?.tick ?? displayTrail.length,
          timestampMs: wallNow,
          price: renderedPrice,
        });
      }
      while (
        displayTrail.length > 2 &&
        displayTrail[0].timestampMs < wallNow - TRAIL_HISTORY_MS
      ) {
        displayTrail.shift();
      }

      const compact = width < 860;
      const plotLeft = compact ? 56 : 72;
      const plotRight = width - 16;
      const plotTop = compact ? 42 : 46;
      const plotBottom = height - 36;
      const plotWidth = plotRight - plotLeft;
      const plotHeight = plotBottom - plotTop;
      const visualRowCount = compact ? 15 : 10;

      // Viewport is the vertical camera over fixed price-space cells.
      // The dynamic grid changes level in discrete 40 bps steps; lerp
      // the camera so those level changes do not snap the whole chart.
      const cellPrices = data.cells.flatMap((c) => [c.pMin, c.pMax])
        .filter((p) => Number.isFinite(p) && p > 0);
      const bandCell = data.cells.find((cell) => cell.pMax > cell.pMin);
      const bandStep = bandCell ? bandCell.pMax - bandCell.pMin : targetPrice * 0.004;
      const bandSeed = cellPrices.length > 0 ? Math.min(...cellPrices) : targetPrice;
      const targetVp = (() => {
        if (cellPrices.length === 0) {
          return { minPrice: targetPrice * 0.98, maxPrice: targetPrice * 1.02 };
        }
        const activeMin = Math.min(...cellPrices);
        const activeMax = Math.max(...cellPrices);
        const activeSpan = Math.max(activeMax - activeMin, bandStep);
        const targetSpan = Math.max(
          bandStep * visualRowCount,
          activeSpan * 1.08,
          targetPrice * 0.002
        );
        let minPrice = renderedPrice - targetSpan / 2;
        let maxPrice = renderedPrice + targetSpan / 2;
        if (activeMin < minPrice) {
          minPrice = activeMin;
          maxPrice = minPrice + targetSpan;
        }
        if (activeMax > maxPrice) {
          maxPrice = activeMax;
          minPrice = maxPrice - targetSpan;
        }
        return { minPrice, maxPrice };
      })();
      const previousVp = priceViewportRef.current;
      if (!previousVp) {
        priceViewportRef.current = targetVp;
      } else {
        const cameraSmoothing = 1 - Math.exp(-dt / CAMERA_EASE_MS);
        priceViewportRef.current = {
          minPrice: previousVp.minPrice + (targetVp.minPrice - previousVp.minPrice) * cameraSmoothing,
          maxPrice: previousVp.maxPrice + (targetVp.maxPrice - previousVp.maxPrice) * cameraSmoothing,
        };
      }
      const lockedVp = priceViewportRef.current ?? targetVp;

      // -------------------------------------------------------------
      // Layout: NOW sits at ~30% of plot width. Time runs left→right.
      // Cells have absolute world-time windows; xForTime projects
      // them onto the chart, so they SLIDE LEFT every frame as wallNow
      // advances. Old cols pass NOW and eventually leave the plot;
      // new cols appear on the right when buildSlidingCells emits
      // them.
      // -------------------------------------------------------------
      // NOW is the split between price history and the future target
      // zone. Cells still slide in world-time, but the chart no longer
      // reads like one complete all-over tile grid.
      const nowX = plotLeft + plotWidth * (compact ? 0.38 : 0.40);
      const futureDuration = data.cells[0]?.windowDurationMs ?? 3_000;
      const rowCount = visualRowCount;

      // Keep mobile cells compact enough for the visible future
      // columns to fit inside the right target zone.
      const futureZoneWidth = Math.max(1, plotRight - nowX);
      const cellSize = compact
        ? Math.min(plotHeight / rowCount, futureZoneWidth / 4.25)
        : plotHeight / rowCount;
      const msPerPx = futureDuration / cellSize;
      const visibleStartTime = wallNow - (nowX - plotLeft) * msPerPx;
      const visibleEndTime = wallNow + (plotRight - nowX) * msPerPx;
      const viewport: ChartViewport = {
        plotLeft,
        plotRight,
        plotTop,
        plotBottom,
        visibleMinPrice: lockedVp.minPrice,
        visibleMaxPrice: lockedVp.maxPrice,
        visibleStartTime,
        visibleEndTime,
        nowTime: wallNow,
      };

      const screenCells: ScreenCell[] = [];

      // ----- Layer 1: background -----
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, width, height);

      // Plot clip
      ctx.save();
      ctx.beginPath();
      ctx.rect(plotLeft, plotTop, plotWidth, plotHeight);
      ctx.clip();

      // Left side is the price chart. Right side is the target zone.
      // Keep the background grid faint and stop it at NOW so cells are
      // the only strong grid on the future side.
      ctx.fillStyle = "rgba(0,255,102,0.012)";
      ctx.fillRect(plotLeft, plotTop, nowX - plotLeft, plotHeight);
      const futureShade = ctx.createLinearGradient(nowX, 0, plotRight, 0);
      futureShade.addColorStop(0, "rgba(0,255,102,0.075)");
      futureShade.addColorStop(0.22, "rgba(0,255,102,0.035)");
      futureShade.addColorStop(1, "rgba(0,255,102,0.012)");
      ctx.fillStyle = futureShade;
      ctx.fillRect(nowX, plotTop, plotRight - nowX, plotHeight);
      ctx.save();
      ctx.strokeStyle = "rgba(198,214,205,0.075)";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      const firstGridTime = Math.ceil(visibleStartTime / futureDuration) * futureDuration;
      for (let t = firstGridTime; t <= wallNow; t += futureDuration) {
        const x = xForTime(t, viewport);
        if (x < plotLeft - 1 || x > nowX + 1) continue;
        ctx.beginPath();
        ctx.moveTo(x, plotTop);
        ctx.lineTo(x, plotBottom);
        ctx.stroke();
      }
      const firstPriceLine = bandStep > 0
        ? bandSeed + Math.floor((lockedVp.minPrice - bandSeed) / bandStep) * bandStep
        : lockedVp.minPrice;
      for (
        let priceLine = firstPriceLine;
        priceLine <= lockedVp.maxPrice + bandStep * 0.5;
        priceLine += bandStep
      ) {
        const y = yForPrice(priceLine, viewport);
        if (y < plotTop - 1 || y > plotBottom + 1) continue;
        ctx.beginPath();
        ctx.moveTo(plotLeft, y);
        ctx.lineTo(nowX, y);
        ctx.stroke();
      }
      ctx.restore();

      const liveGuideY = yForPrice(renderedPrice, viewport);
      if (liveGuideY >= plotTop && liveGuideY <= plotBottom) {
        ctx.save();
        ctx.strokeStyle = "rgba(0,255,102,0.24)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(plotLeft, liveGuideY);
        ctx.lineTo(nowX, liveGuideY);
        ctx.stroke();

        const label = formatPrice(renderedPrice);
        ctx.font = "900 10px JetBrains Mono, ui-monospace, monospace";
        const labelW = Math.max(62, ctx.measureText(label).width + 20);
        const labelH = 24;
        const labelY = clamp(liveGuideY - labelH / 2, plotTop + 2, plotBottom - labelH - 2);
        ctx.fillStyle = "#020806";
        ctx.strokeStyle = "#00ff66";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(plotLeft + 8, labelY, labelW, labelH, 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#00ff66";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, plotLeft + 8 + labelW / 2, labelY + labelH / 2);
        ctx.restore();
      }

      // ----- Layer 3: cells (sliding world-time) -----
      // Bets-by-id so cells with bets skip the empty render and the
      // bet pass paints the saturated state in their place.
      const visualBetByCellId = new Map<string, RushArenaBet>();
      for (const bet of data.bets) {
        if (bet.status === "CANCELLED") continue;
        if (
          bet.status !== "PENDING" &&
          bet.status !== "ACTIVE" &&
          (!bet.resolvedAt || wallNow - bet.resolvedAt > 4_500)
        ) {
          continue;
        }
        visualBetByCellId.set(bet.cell.id, bet);
      }

      // Refresh the first-seen registry so newcomers fade in.
      const firstSeen = cellFirstSeenRef.current;
      const visibleIds = new Set<string>();
      for (const cell of data.cells) {
        if (!firstSeen.has(cell.id)) firstSeen.set(cell.id, wallNow);
        visibleIds.add(cell.id);
      }
      // Drop entries for cells that aren't in the pool anymore.
      firstSeen.forEach((_, id) => {
        if (!visibleIds.has(id)) firstSeen.delete(id);
      });

      for (const cell of data.cells) {
        const x0 = xForTime(cell.windowStartMs, viewport);
        const x1 = xForTime(cell.windowEndMs, viewport);
        const y0 = yForPrice(cell.pMax, viewport);
        const y1 = yForPrice(cell.pMin, viewport);
        // Skip cells fully off-plot.
        if (x1 < plotLeft - 4 || x0 > plotRight + 4 || y1 < plotTop - 4 || y0 > plotBottom + 4) continue;
        if (x1 - x0 <= 6 || y1 - y0 <= 6) continue;

        // Cells with bets skip the empty render and let Layer 6 paint.
        if (visualBetByCellId.has(cell.id)) continue;

        // If a tile is visible as a tile, it must be clickable. Locked
        // cells are not rendered at all, so the user never sees a
        // non-actionable green square.
        if (cell.disabled) continue;
        screenCells.push({ cell, x0, x1, y0, y1 });

        const drawX = x0 + 1;
        const drawY = y0 + 1;
        const drawW = x1 - x0 - 2;
        const drawH = y1 - y0 - 2;
        const hover = hoverCellIdRef.current === cell.id;

        // Fade-in: take the stronger of (a) how much of the cell has
        // entered the plot horizontally and (b) how much time it has
        // existed in the pool. The age-based component is what rescues
        // cells emitted already inside the plot from popping in.
        const FADE_IN_MS = 500;
        const seenAt = firstSeen.get(cell.id) ?? wallNow;
        const ageRamp = Math.max(0, Math.min(1, (wallNow - seenAt) / FADE_IN_MS));
        const positionRamp = Math.max(0, Math.min(1, (plotRight - x0) / Math.max(1, drawW)));
        const fadeIn = Math.min(ageRamp, positionRamp);

        const baseAlpha = hover ? 0.28 : 0.18;
        ctx.fillStyle = `rgba(0,255,102,${baseAlpha * fadeIn})`;
        ctx.fillRect(drawX, drawY, drawW, drawH);
        ctx.strokeStyle = `rgba(0,255,102,${0.18 * fadeIn})`;
        ctx.lineWidth = 1;
        ctx.strokeRect(drawX + 0.5, drawY + 0.5, drawW - 1, drawH - 1);

        // Heatmap overlay: cells with bets from other players get an
        // amber wash whose intensity scales with log(n_bets). Subtle
        // enough to not fight the green tile but obvious enough to
        // signal "people are here". Capped at 5 bets (~0.7 alpha
        // boost) so a hot cell doesn't blast pure orange.
        const nBets = (cell as { nBets?: number }).nBets ?? 0;
        if (nBets > 0) {
          const heat = Math.min(1, Math.log2(nBets + 1) / 2.5);
          ctx.fillStyle = `rgba(255,180,0,${0.18 * heat * fadeIn})`;
          ctx.fillRect(drawX, drawY, drawW, drawH);
          ctx.strokeStyle = `rgba(255,180,0,${0.55 * heat * fadeIn})`;
          ctx.lineWidth = 1.2;
          ctx.strokeRect(drawX + 0.5, drawY + 0.5, drawW - 1, drawH - 1);
          // Tiny dot count in the corner when the cell is big enough.
          if (drawW >= 28 && drawH >= 18) {
            const dotR = Math.min(3, drawH * 0.12);
            ctx.beginPath();
            ctx.fillStyle = `rgba(255,210,90,${0.95 * fadeIn})`;
            ctx.arc(drawX + drawW - 6, drawY + 6, dotR, 0, Math.PI * 2);
            ctx.fill();
            if (nBets > 1) {
              ctx.fillStyle = `rgba(2,8,6,${0.95 * fadeIn})`;
              ctx.font = `800 ${Math.max(8, drawH * 0.22)}px JetBrains Mono, ui-monospace, monospace`;
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillText(String(nBets), drawX + drawW - 6, drawY + 6);
            }
          }
        }

        if (hover) {
          ctx.strokeStyle = `rgba(0,255,102,${0.75 * fadeIn})`;
          ctx.lineWidth = 1;
          ctx.strokeRect(drawX + 0.5, drawY + 0.5, drawW - 1, drawH - 1);
        }

        if (drawH >= 14 && drawW >= 30) {
          const textBase = hover ? 0.98 : 0.85;
          ctx.fillStyle = hover
            ? `rgba(255,230,0,${textBase * fadeIn})`
            : `rgba(0,255,102,${textBase * fadeIn})`;
          const fontSize = Math.max(9, Math.min(compact ? 10 : 12, drawH * 0.28));
          ctx.font = `${hover ? 800 : 700} ${fontSize}px JetBrains Mono, ui-monospace, monospace`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(multiplierLabel(cell.multiplier), drawX + drawW / 2, drawY + drawH / 2);
        }
      }

      // ----- Layer 4: click flash -----
      const flashes = clickFlashesRef.current.filter((f) => wallNow - f.startedAt < 320);
      clickFlashesRef.current = flashes;
      for (const flash of flashes) {
        const cell = data.cells.find((c) => c.id === flash.cellId);
        if (!cell) continue;
        const x0 = xForTime(cell.windowStartMs, viewport);
        const x1 = xForTime(cell.windowEndMs, viewport);
        const y0 = yForPrice(cell.pMax, viewport);
        const y1 = yForPrice(cell.pMin, viewport);
        const age = wallNow - flash.startedAt;
        const alpha = 1 - age / 320;
        ctx.fillStyle = `rgba(255,230,0,${0.20 * alpha})`;
        ctx.fillRect(x0 + 1, y0 + 1, x1 - x0 - 2, y1 - y0 - 2);
        ctx.strokeStyle = `rgba(255,230,0,${0.85 * alpha})`;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x0 + 1.5, y0 + 1.5, x1 - x0 - 3, y1 - y0 - 3);
      }

      // ----- Layer 5: live price line (trail to NOW) -----
      const liveTrail = displayTrailRef.current.filter((t) => (
        t.timestampMs >= visibleStartTime - 2_000 &&
        t.timestampMs <= wallNow + 250
      ));
      const trail = liveTrail.length > 1
        ? liveTrail
        : fallbackTrail(
            visibleStartTime,
            wallNow,
            renderedPrice,
            lockedVp,
            compact ? 72 : 112
          );

      if (trail.length > 1) {
        ctx.save();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = "#70ff8a";
        ctx.lineWidth = 2;
        ctx.shadowColor = "#00ff66";
        ctx.shadowBlur = 5;
        const points = trail
          .map((tick) => ({
            x: xForTime(tick.timestampMs, viewport),
            y: yForPrice(tick.price, viewport),
          }))
          .filter((point) => (
            Number.isFinite(point.x) &&
            Number.isFinite(point.y) &&
            point.x <= nowX + 2
          ));
        points.push({ x: nowX, y: yForPrice(renderedPrice, viewport) });

        if (points.length > 1) {
          drawSplinePath(ctx, points);
        }
        ctx.restore();
      }

      // ----- Layer 6: bets sliding in world-time -----
      // Each bet has a fixed (windowStartMs, windowEndMs, pMin, pMax).
      // Project to screen via xForTime / yForPrice. As wallNow advances,
      // the bet drifts left across the catalog and eventually crosses
      // NOW. WIN is settled the moment the price line enters its band
      // during its window.
      for (const bet of data.bets) {
        if (bet.status === "CANCELLED") continue;
        if (
          bet.status !== "PENDING" &&
          bet.status !== "ACTIVE" &&
          (!bet.resolvedAt || wallNow - bet.resolvedAt > 4_500)
        ) {
          continue;
        }

        const x0 = xForTime(bet.cell.windowStartMs, viewport);
        const x1 = xForTime(bet.cell.windowEndMs, viewport);
        const y0 = yForPrice(bet.cell.pMax, viewport);
        const y1 = yForPrice(bet.cell.pMin, viewport);
        if (x1 < plotLeft - 4 || x0 > plotRight + 4 || y1 < plotTop - 4 || y0 > plotBottom + 4) continue;
        const drawX = x0 + 1;
        const drawY = y0 + 1;
        const drawW = Math.max(6, x1 - x0 - 2);
        const drawH = Math.max(6, y1 - y0 - 2);

        const isPending = bet.status === "PENDING";
        const isActive = bet.status === "ACTIVE";
        const isWon = bet.status === "WON";
        const isLost = bet.status === "LOST";
        let fill = "rgba(255,230,0,0.55)";
        let stroke = "rgba(255,230,0,0.96)";
        let strokeW = 1.5;
        let textColor = "#1a1400";
        let resolveAlpha = 1;
        if (isPending) {
          fill = "rgba(223,255,42,0.20)";
          stroke = "rgba(223,255,42,0.92)";
          textColor = "#f6ffd6";
        } else if (isActive) {
          fill = "rgba(0,255,102,0.30)";
          stroke = "rgba(112,255,138,0.96)";
          strokeW = 2;
          textColor = "#effff3";
        } else if (isWon) {
          const age = bet.resolvedAt ? wallNow - bet.resolvedAt : 0;
          resolveAlpha = Math.max(0.2, 1 - age / 4_500);
          fill = `rgba(0,255,102,${0.62 * resolveAlpha})`;
          stroke = `rgba(160,255,180,${0.96 * resolveAlpha})`;
          strokeW = 2;
          textColor = `rgba(0,32,12,${resolveAlpha})`;
        } else if (isLost) {
          const age = bet.resolvedAt ? wallNow - bet.resolvedAt : 0;
          resolveAlpha = Math.max(0.15, 1 - age / 4_500);
          fill = `rgba(255,51,72,${0.50 * resolveAlpha})`;
          stroke = `rgba(255,80,100,${0.92 * resolveAlpha})`;
          textColor = `rgba(38,3,7,${resolveAlpha})`;
        }

        ctx.save();
        if (isPending || isActive) {
          ctx.shadowColor = isActive ? GREEN : YELLOW;
          ctx.shadowBlur = isActive ? 10 : 7;
        }
        ctx.fillStyle = fill;
        ctx.fillRect(drawX, drawY, drawW, drawH);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = strokeW;
        ctx.strokeRect(drawX + 0.5, drawY + 0.5, drawW - 1, drawH - 1);
        ctx.restore();

        const cx = drawX + drawW / 2;
        const cy = drawY + drawH / 2;
        const remainingMs = Math.max(0, bet.cell.windowEndMs - wallNow);
        const betWindowMs = Math.max(1, bet.cell.windowEndMs - bet.cell.windowStartMs);
        const betProgress = isPending
          ? clamp(1 - (bet.cell.windowStartMs - wallNow) / Math.max(1, bet.cell.windowStartMs - bet.placedAt), 0, 1)
          : clamp((wallNow - bet.cell.windowStartMs) / betWindowMs, 0, 1);
        const winAge = isWon && bet.resolvedAt
          ? wallNow - bet.resolvedAt
          : Number.POSITIVE_INFINITY;

        if (isWon && winAge >= 0 && winAge < WIN_BURST_MS) {
          drawWinBurst(ctx, {
            x: cx,
            y: cy,
            width: drawW,
            height: drawH,
            age: winAge,
            label: multiplierLabel(bet.multiplier),
            seed: hashStr(bet.id),
            compact,
          });
        }

        if (isWon && winAge < WIN_BURST_MS) {
          // The burst owns the win label while it is active.
        } else if (isWon || isLost) {
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          if (isWon) {
            const labelAlpha = Math.max(0, Math.min(1, resolveAlpha));
            const labelSize = Math.max(compact ? 10 : 12, Math.min(drawH * 0.34, compact ? 14 : 17));
            ctx.save();
            ctx.shadowColor = GREEN;
            ctx.shadowBlur = 10 * labelAlpha;
            ctx.lineWidth = 2;
            ctx.strokeStyle = `rgba(0,20,8,${0.62 * labelAlpha})`;
            ctx.fillStyle = `rgba(230,255,210,${labelAlpha})`;
            ctx.font = `950 ${labelSize}px JetBrains Mono, ui-monospace, monospace`;
            ctx.strokeText("WIN", cx, cy);
            ctx.fillText("WIN", cx, cy);
            ctx.shadowBlur = 4 * labelAlpha;
            ctx.fillStyle = `rgba(223,255,42,${0.58 * labelAlpha})`;
            ctx.fillText("WIN", cx, cy);
            ctx.restore();
          } else {
            ctx.fillStyle = textColor;
            ctx.font = `900 ${compact ? 10 : 12}px JetBrains Mono, ui-monospace, monospace`;
            ctx.fillText("LOSS", cx, cy);
          }
        } else if (drawH >= 36 && drawW >= 36) {
          const markerY = drawY + drawH * 0.28;
          const markerRadius = Math.max(3.5, Math.min(drawH * 0.13, compact ? 5.5 : 7));
          ctx.save();
          ctx.shadowColor = textColor;
          ctx.shadowBlur = isPending ? 10 : 7;
          ctx.lineWidth = Math.max(1.25, markerRadius * 0.24);
          ctx.strokeStyle = textColor;
          ctx.fillStyle = textColor;
          ctx.beginPath();
          ctx.arc(cx, markerY, markerRadius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha *= isPending ? 0.82 : 0.68;
          ctx.beginPath();
          ctx.arc(cx, markerY, markerRadius * 0.42, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();

          ctx.fillStyle = textColor;
          ctx.font = `900 ${compact ? 9 : 10}px JetBrains Mono, ui-monospace, monospace`;
          ctx.fillText(
            `${stakeLabel(bet.stakeAmount)} ${multiplierLabel(bet.multiplier)}`,
            cx,
            drawY + drawH * 0.6
          );

          if (isActive || isPending) {
            ctx.fillStyle = textColor;
            ctx.font = `800 ${compact ? 9 : 10}px JetBrains Mono, ui-monospace, monospace`;
            ctx.fillText(formatShortTime(remainingMs), cx, drawY + drawH * 0.84);
          }
        } else {
          ctx.fillStyle = textColor;
          ctx.font = `900 ${compact ? 9 : 10}px JetBrains Mono, ui-monospace, monospace`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(multiplierLabel(bet.multiplier), cx, cy);
        }

        if ((isActive || isPending) && drawW >= 18 && drawH >= 18) {
          const barX = drawX + 5;
          const barY = drawY + drawH - 5;
          const barW = Math.max(8, drawW - 10);
          ctx.save();
          ctx.fillStyle = "rgba(0,0,0,0.38)";
          ctx.fillRect(barX, barY, barW, 2);
          ctx.fillStyle = isActive ? GREEN : YELLOW;
          ctx.shadowColor = isActive ? GREEN : YELLOW;
          ctx.shadowBlur = 4;
          ctx.fillRect(barX, barY, barW * betProgress, 2);
          ctx.restore();
        }
      }

      ctx.restore(); // end plot clip

      // ----- Layer 7: NOW vertical line -----
      const glow = ctx.createLinearGradient(nowX - 12, 0, nowX + 12, 0);
      glow.addColorStop(0, "rgba(0,255,102,0)");
      glow.addColorStop(0.5, "rgba(0,255,102,0.18)");
      glow.addColorStop(1, "rgba(0,255,102,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(nowX - 12, plotTop, 24, plotHeight);

      ctx.save();
      ctx.shadowColor = GREEN;
      ctx.shadowBlur = 10;
      ctx.strokeStyle = "rgba(112,255,138,0.88)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(nowX, plotTop);
      ctx.lineTo(nowX, plotBottom);
      ctx.stroke();
      ctx.fillStyle = GREEN;
      ctx.font = "900 10px JetBrains Mono, ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText("NOW", nowX, plotBottom + 7);
      ctx.beginPath();
      ctx.moveTo(nowX, plotBottom + 2);
      ctx.lineTo(nowX - 5, plotBottom + 12);
      ctx.lineTo(nowX + 5, plotBottom + 12);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // ----- Layer 8: live price marker -----
      const rawLiveY = yForPrice(renderedPrice, viewport);
      const offRange =
        rawLiveY < plotTop + 6
          ? "above"
          : rawLiveY > plotBottom - 6
            ? "below"
            : null;
      const liveY = Math.max(plotTop + 6, Math.min(plotBottom - 6, rawLiveY));
      const markerColor = offRange ? AMBER : GREEN;

      ctx.save();
      ctx.shadowColor = markerColor;
      ctx.shadowBlur = 4;
      ctx.fillStyle = markerColor;
      ctx.beginPath();
      ctx.arc(nowX, liveY, 2.5, 0, Math.PI * 2);
      ctx.fill();
      if (offRange) {
        ctx.fillStyle = AMBER;
        ctx.font = "800 10px JetBrains Mono, ui-monospace, monospace";
        ctx.textAlign = "left";
        ctx.textBaseline = offRange === "above" ? "top" : "bottom";
        ctx.fillText(
          offRange === "above" ? "↑ above range" : "↓ below range",
          nowX + 12,
          liveY
        );
      }
      ctx.restore();

      // ----- Layer 9: Y-axis labels at row boundaries -----
      // Show the price right at every row boundary instead of equal
      // pixel ticks — this puts the labels exactly aligned with the
      // cell grid lines.
      ctx.font = "600 10px JetBrains Mono, ui-monospace, monospace";
      ctx.textBaseline = "middle";
      ctx.textAlign = "right";
      for (let r = 0; r <= rowCount; r += 1) {
        const t = r / rowCount;
        const y = plotTop + t * plotHeight;
        const price = lockedVp.maxPrice - t * (lockedVp.maxPrice - lockedVp.minPrice);
        ctx.fillStyle = "rgba(184,199,217,0.5)";
        ctx.fillText(formatPrice(price), plotLeft - 8, y);
      }

      // ----- Layer 10: time labels — only the next few future windows -----
      ctx.fillStyle = "rgba(184,199,217,0.6)";
      ctx.font = "600 10px JetBrains Mono, ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const futureCells = data.cells.filter((c) => !c.disabled).slice(0, 4);
      for (const cell of futureCells) {
        const xMid = (xForTime(cell.windowStartMs, viewport) + xForTime(cell.windowEndMs, viewport)) / 2;
        if (xMid <= nowX || xMid >= plotRight - 4) continue;
        const offsetMs = cell.windowStartMs - wallNow;
        ctx.fillText(formatShortTime(offsetMs), xMid, plotBottom + 6);
      }

      screenCellsRef.current = screenCells;
      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [size]);

  const cellAtPointer = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return screenCellsRef.current.find((s) => (
      x >= s.x0 && x <= s.x1 && y >= s.y0 && y <= s.y1
    ))?.cell ?? null;
  }, []);

  const handleMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const cell = cellAtPointer(event);
    const nextHover = cell && !cell.disabled ? cell : null;
    const nextId = nextHover?.id ?? null;
    if (hoverCellIdRef.current !== nextId) {
      hoverCellIdRef.current = nextId;
      onCellHover?.(nextHover);
    }
  }, [cellAtPointer, onCellHover]);

  const handleClick = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const cell = cellAtPointer(event);
    if (!cell || cell.disabled) return;
    clickFlashesRef.current.push({ cellId: cell.id, startedAt: Date.now() });
    onCellClick(cell);
  }, [cellAtPointer, disabled, onCellClick]);

  return (
    <div
      ref={containerRef}
      role="application"
      aria-label="TapTrading collision grid"
      onPointerMove={handleMove}
      onPointerLeave={() => {
        hoverCellIdRef.current = null;
        onCellHover?.(null);
      }}
      onPointerDown={handleClick}
      className={cn(
        "relative min-h-[440px] overflow-hidden",
        disabled ? "cursor-not-allowed" : "cursor-crosshair",
        className
      )}
      style={{ background: BG }}
    >
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  );
}
