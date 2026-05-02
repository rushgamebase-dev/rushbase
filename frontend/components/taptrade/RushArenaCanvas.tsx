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
  disabled?: boolean;
  className?: string;
};

const BG = "#020403";
const GREEN = "#00ff66";
const YELLOW = "#ffe600";
const AMBER = "#ffaa00";
const RED = "#ff3b4d";

const AVATAR_EMOJIS = ["🐸", "🐶", "🦊", "🐱", "🐼", "🐯", "🦁", "🐻", "🐮", "🦄"];

function hashStr(value: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function avatarFor(betId: string): string {
  return AVATAR_EMOJIS[hashStr(betId) % AVATAR_EMOJIS.length];
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
      lastFrameAtRef.current = frameTime;

      const targetPrice = data.currentPrice || renderedPriceRef.current || 1_245.73;
      if (renderedPriceRef.current <= 0) renderedPriceRef.current = targetPrice;
      const smoothing = 1 - Math.exp(-dt / 88);
      renderedPriceRef.current += (targetPrice - renderedPriceRef.current) * smoothing;
      const renderedPrice = renderedPriceRef.current;

      const compact = width < 860;
      const plotLeft = compact ? 56 : 72;
      const plotRight = width - 16;
      const plotTop = 18;
      const plotBottom = height - 32;
      const plotWidth = plotRight - plotLeft;
      const plotHeight = plotBottom - plotTop;

      // Viewport derived directly from the current cell span. The
      // trade page lerps the anchor toward the live price, so the
      // span itself drifts smoothly — no extra lerp needed here.
      // Result: cells fill the entire plot height, the grid is always
      // aligned on the price axis, and the live line stays inside the
      // visible band as the anchor follows it.
      const cellPrices = data.cells.flatMap((c) => [c.pMin, c.pMax])
        .filter((p) => Number.isFinite(p) && p > 0);
      const lockedVp = cellPrices.length > 0
        ? { minPrice: Math.min(...cellPrices), maxPrice: Math.max(...cellPrices) }
        : { minPrice: targetPrice * 0.98, maxPrice: targetPrice * 1.02 };
      priceViewportRef.current = lockedVp;

      // -------------------------------------------------------------
      // Layout: NOW sits at ~30% of plot width. Time runs left→right.
      // Cells have absolute world-time windows; xForTime projects
      // them onto the chart, so they SLIDE LEFT every frame as wallNow
      // advances. Old cols pass NOW and eventually leave the plot;
      // new cols appear on the right when buildSlidingCells emits
      // them.
      // -------------------------------------------------------------
      const futureDuration = data.cells[0]?.windowDurationMs ?? 3_000;
      const rowCount = Math.max(
        1,
        data.cells.reduce((max, c) => Math.max(max, c.row), 0) + 1
      );

      // Square cells fill the entire canvas — height = width.
      const cellSize = plotHeight / rowCount;
      const msPerPx = futureDuration / cellSize;

      // NOW fixed at ~30% of plot width — cells SLIDE through it.
      const nowX = plotLeft + plotWidth * 0.30;
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

      // Pure black plot background. No gridlines (they were confusing
      // the price marks). Cell tile borders alone carry the grid.
      ctx.fillStyle = "rgba(0,255,102,0.015)";
      ctx.fillRect(plotLeft, plotTop, plotWidth, plotHeight);

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

        // Only enabled (still-betable) cells are clickable.
        if (!cell.disabled) {
          screenCells.push({ cell, x0, x1, y0, y1 });
        }

        const drawX = x0 + 1;
        const drawY = y0 + 1;
        const drawW = x1 - x0 - 2;
        const drawH = y1 - y0 - 2;
        const hover = hoverCellIdRef.current === cell.id;

        if (cell.disabled) {
          // Locked cell with no bet. The user wants the cell to fade
          // OUT *before* the price line ever crosses it. So we fade
          // during the last `FADE_MS` of the activation gap and pull
          // the cell completely off the chart at `windowStartMs` —
          // that's the exact instant NOW would touch the cell's left
          // edge. Cells WITH bets are not handled here (they go
          // through Layer 6 and stay alive until windowEnd).
          const FADE_MS = 500;
          const remainingToNow = cell.windowStartMs - wallNow;
          if (remainingToNow <= 0) continue;
          const fadeFrac = remainingToNow >= FADE_MS ? 1 : remainingToNow / FADE_MS;
          const alpha = 0.10 * fadeFrac;
          if (alpha <= 0.005) continue;
          ctx.fillStyle = `rgba(0,255,102,${alpha})`;
          ctx.fillRect(drawX, drawY, drawW, drawH);
          continue;
        }

        // Fade-in: take the stronger of (a) how much of the cell has
        // entered the plot horizontally and (b) how much time it has
        // existed in the pool. The age-based component is what rescues
        // cells emitted already inside the plot from popping in.
        const FADE_IN_MS = 500;
        const seenAt = firstSeen.get(cell.id) ?? wallNow;
        const ageRamp = Math.max(0, Math.min(1, (wallNow - seenAt) / FADE_IN_MS));
        const positionRamp = Math.max(0, Math.min(1, (plotRight - x0) / Math.max(1, drawW)));
        const fadeIn = Math.min(ageRamp, positionRamp);

        const baseAlpha = hover ? 0.20 : 0.10;
        ctx.fillStyle = `rgba(0,255,102,${baseAlpha * fadeIn})`;
        ctx.fillRect(drawX, drawY, drawW, drawH);

        if (hover) {
          ctx.strokeStyle = `rgba(190,255,205,${0.60 * fadeIn})`;
          ctx.lineWidth = 1;
          ctx.strokeRect(drawX + 0.5, drawY + 0.5, drawW - 1, drawH - 1);
        }

        if (drawH >= 14 && drawW >= 30) {
          const textBase = hover ? 0.98 : 0.85;
          ctx.fillStyle = hover
            ? `rgba(235,255,239,${textBase * fadeIn})`
            : `rgba(190,255,205,${textBase * fadeIn})`;
          const fontSize = Math.max(10, Math.min(compact ? 11 : 13, drawH * 0.34));
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
      const liveTrail = data.ticks.filter((t) => (
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
        ctx.strokeStyle = YELLOW;
        ctx.lineWidth = 2;
        ctx.shadowColor = YELLOW;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        let started = false;
        for (const tick of trail) {
          const x = xForTime(tick.timestampMs, viewport);
          const y = yForPrice(tick.price, viewport);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
        if (started) {
          ctx.lineTo(nowX, yForPrice(renderedPrice, viewport));
        }
        ctx.stroke();
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
          fill = "rgba(255,204,51,0.42)";
          stroke = "rgba(255,204,51,0.92)";
          textColor = "#2a1f00";
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

        ctx.fillStyle = fill;
        ctx.fillRect(drawX, drawY, drawW, drawH);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = strokeW;
        ctx.strokeRect(drawX + 0.5, drawY + 0.5, drawW - 1, drawH - 1);

        const cx = drawX + drawW / 2;
        const cy = drawY + drawH / 2;
        const remainingMs = Math.max(0, bet.cell.windowEndMs - wallNow);

        if (isWon || isLost) {
          ctx.fillStyle = textColor;
          ctx.font = `900 ${compact ? 10 : 12}px JetBrains Mono, ui-monospace, monospace`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(isWon ? "WIN" : "LOSS", cx, cy);
        } else if (drawH >= 36 && drawW >= 36) {
          ctx.font = `${Math.min(drawH * 0.32, 18)}px ui-monospace, monospace`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(avatarFor(bet.id), cx, drawY + drawH * 0.28);

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
      }

      ctx.restore(); // end plot clip

      // ----- Layer 7: NOW vertical line (subtle) -----
      const glow = ctx.createLinearGradient(nowX - 12, 0, nowX + 12, 0);
      glow.addColorStop(0, "rgba(255,230,0,0)");
      glow.addColorStop(0.5, "rgba(255,230,0,0.16)");
      glow.addColorStop(1, "rgba(255,230,0,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(nowX - 12, plotTop, 24, plotHeight);

      ctx.strokeStyle = "rgba(255,230,0,0.85)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(nowX, plotTop);
      ctx.lineTo(nowX, plotBottom);
      ctx.stroke();

      // ----- Layer 8: live price marker -----
      const rawLiveY = yForPrice(renderedPrice, viewport);
      const offRange =
        rawLiveY < plotTop + 6
          ? "above"
          : rawLiveY > plotBottom - 6
            ? "below"
            : null;
      const liveY = Math.max(plotTop + 6, Math.min(plotBottom - 6, rawLiveY));
      const markerColor = offRange ? AMBER : YELLOW;

      ctx.save();
      ctx.shadowColor = markerColor;
      ctx.shadowBlur = 10;
      ctx.fillStyle = markerColor;
      ctx.beginPath();
      ctx.arc(nowX, liveY, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = offRange ? "rgba(255,220,140,0.92)" : "rgba(255,255,205,0.92)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(nowX, liveY, 9, 0, Math.PI * 2);
      ctx.stroke();
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

      // Live price chip
      const label = formatPrice(renderedPrice);
      const chipPadX = 6;
      const chipW = Math.max(58, label.length * 7.5 + chipPadX * 2);
      const chipH = 22;
      const chipX = plotLeft - chipW - 4;
      const chipY = liveY - chipH / 2;
      ctx.fillStyle = "rgba(2,20,10,0.96)";
      ctx.fillRect(chipX, chipY, chipW, chipH);
      ctx.strokeStyle = markerColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(chipX + 0.5, chipY + 0.5, chipW - 1, chipH - 1);
      ctx.fillStyle = offRange ? "rgba(255,220,140,0.96)" : "rgba(186,255,202,0.96)";
      ctx.textAlign = "center";
      ctx.fillText(label, chipX + chipW / 2, liveY);

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
    hoverCellIdRef.current = cell && !cell.disabled ? cell.id : null;
  }, [cellAtPointer]);

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
