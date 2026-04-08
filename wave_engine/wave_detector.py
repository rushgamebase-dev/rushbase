#!/usr/bin/env python3
"""
Wave Engine — Gamified wave/tide detection for beach cams.
Standalone. No dependency on Nova Engine.

Concept: "Territory Invasion" — ocean advances onto beach, crossing threshold zones.
Gamification: momentum tracking, wave state machine, pressure meter, breach celebrations,
streak counter, proximity warnings, dynamic zone fills.
"""

import argparse
import json
import math
import os
import subprocess
import sys
import time

import av
import cv2
import numpy as np


def resolve_youtube(url: str) -> str:
    if "youtube.com" not in url and "youtu.be" not in url:
        return url
    result = subprocess.run(
        ["yt-dlp", "-f", "best[height<=720]", "-g", url],
        capture_output=True, text=True, timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(f"yt-dlp failed: {result.stderr.strip()}")
    return result.stdout.strip()


class WaveDetector:

    def __init__(self, lines: list[dict], roi: list[list[float]] | None = None,
                 water_threshold: float = 0.20, baseline_frames: int = 30):
        self.raw_lines = lines
        self.raw_roi = roi
        self.water_threshold = water_threshold
        self.pixel_lines: list[tuple[tuple[int,int], tuple[int,int]]] = []
        self.roi_mask: np.ndarray | None = None
        self._setup_done = False

        # Core state
        self.line_states: dict[str, bool] = {}
        self.max_reached: int = 0
        self.crossings: list[dict] = []
        self.crossing_count: int = 0

        # Baseline
        self._baseline: np.ndarray | None = None
        self._baseline_frames: list[np.ndarray] = []
        self._baseline_count = baseline_frames

        # ── Gamification state ──
        self._pct_history: dict[str, list[float]] = {}
        self._momentum: str = "STABLE"
        self._wave_state: str = "CALM"
        self._breach_times: dict[str, float] = {}
        self._streak: int = 0
        self._last_all_off_time: float = 0
        self._pressure: float = 0
        self._frame_tick: int = 0

        # Particle system (sparks along lines)
        self._particles: list[list] = []  # [x, y, vx, vy, life, color]

        # Events for frontend (breach, warning, surge)
        self.pending_events: list[dict] = []

    def _setup(self, w: int, h: int):
        self.pixel_lines = []
        for line in self.raw_lines:
            pts = line.get("points", "")
            if isinstance(pts, str):
                p = [float(x) for x in pts.split(",")]
            else:
                p = pts
            start = (int(p[0] * w), int(p[1] * h))
            end = (int(p[2] * w), int(p[3] * h))
            self.pixel_lines.append((start, end))
            print(f"[Wave] {line.get('label', f'zone{len(self.pixel_lines)}')}: {start} -> {end}")

        if self.raw_roi:
            self.roi_mask = np.zeros((h, w), dtype=np.uint8)
            pts = np.array([[int(x * w), int(y * h)] for x, y in self.raw_roi], dtype=np.int32)
            cv2.fillPoly(self.roi_mask, [pts], 255)
            print(f"[Wave] ROI: {len(self.raw_roi)} points")

        self._setup_done = True

    def _detect_water(self, frame: np.ndarray) -> np.ndarray:
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        water_mask = cv2.inRange(hsv, np.array([80, 50, 80]), np.array([130, 255, 255]))
        foam_mask1 = cv2.inRange(hsv, np.array([0, 5, 220]), np.array([18, 50, 255]))
        foam_mask2 = cv2.inRange(hsv, np.array([45, 5, 220]), np.array([180, 50, 255]))
        foam_mask = cv2.bitwise_or(foam_mask1, foam_mask2)

        diff_mask = np.zeros_like(water_mask)
        if self._baseline is not None:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            diff = cv2.absdiff(gray, self._baseline)
            _, diff_mask = cv2.threshold(diff, 25, 255, cv2.THRESH_BINARY)

        combined = cv2.bitwise_or(water_mask, foam_mask)
        combined = cv2.bitwise_or(combined, diff_mask)
        if self.roi_mask is not None:
            combined = cv2.bitwise_and(combined, self.roi_mask)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        combined = cv2.morphologyEx(combined, cv2.MORPH_OPEN, kernel)
        return combined

    def _sample_line(self, mask: np.ndarray, start: tuple, end: tuple, num_samples: int = 100) -> float:
        x1, y1 = start
        x2, y2 = end
        h, w = mask.shape
        water_count = 0
        for i in range(num_samples):
            t = i / max(num_samples - 1, 1)
            x = max(0, min(w - 1, int(x1 + t * (x2 - x1))))
            y = max(0, min(h - 1, int(y1 + t * (y2 - y1))))
            region = mask[max(0,y-2):min(h,y+3), max(0,x-2):min(w,x+3)]
            if region.size > 0 and np.mean(region) > 127:
                water_count += 1
        return water_count / num_samples

    def update_baseline(self, frame: np.ndarray):
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        self._baseline_frames.append(gray.astype(np.float32))
        if len(self._baseline_frames) >= self._baseline_count:
            self._baseline = np.mean(self._baseline_frames, axis=0).astype(np.uint8)
            self._baseline_frames = []
            print(f"[Wave] Baseline ready")

    def process_frame(self, frame: np.ndarray) -> dict:
        h, w = frame.shape[:2]
        if not self._setup_done:
            self._setup(w, h)

        self._frame_tick += 1
        now = time.time()
        water_mask = self._detect_water(frame)
        results = {}
        any_crossed = False

        for i, ((start, end), line_cfg) in enumerate(zip(self.pixel_lines, self.raw_lines)):
            label = line_cfg.get("label", f"zone{i+1}")
            water_frac = self._sample_line(water_mask, start, end)
            crossed = water_frac > self.water_threshold

            results[label] = {
                "crossed": crossed,
                "water_pct": round(water_frac * 100, 1),
                "index": i,
            }

            # Track pct history for momentum
            if label not in self._pct_history:
                self._pct_history[label] = []
            self._pct_history[label].append(water_frac * 100)
            if len(self._pct_history[label]) > 30:
                self._pct_history[label].pop(0)

            # Breach detection
            was_crossed = self.line_states.get(label, False)
            if crossed and not was_crossed:
                self.crossing_count += 1
                self._breach_times[label] = now
                self._streak += 1
                self.crossings.append({
                    "label": label, "line_index": i, "time": now,
                    "water_pct": round(water_frac * 100, 1), "count": self.crossing_count,
                })
                self.pending_events.append({"type": "breach", "label": label, "count": self.crossing_count})

            if crossed:
                any_crossed = True
                if (i + 1) > self.max_reached:
                    self.max_reached = i + 1

            self.line_states[label] = crossed

        # ── Momentum calculation ──
        total_delta = 0
        n_deltas = 0
        for label, hist in self._pct_history.items():
            if len(hist) >= 5:
                recent = np.mean(hist[-5:])
                older = np.mean(hist[-15:-10]) if len(hist) >= 15 else np.mean(hist[:5])
                total_delta += recent - older
                n_deltas += 1
        avg_delta = total_delta / max(n_deltas, 1)
        if avg_delta > 1.5:
            self._momentum = "ADVANCING"
        elif avg_delta < -1.5:
            self._momentum = "RETREATING"
        else:
            self._momentum = "STABLE"

        # ── Wave state machine ──
        recent_breaches = sum(1 for c in self.crossings if now - c["time"] < 10)
        if recent_breaches >= 3:
            new_state = "SURGE"
        elif recent_breaches >= 1:
            new_state = "RISING"
        else:
            new_state = "CALM"
        if new_state != self._wave_state:
            if new_state == "SURGE":
                self.pending_events.append({"type": "surge"})
            self._wave_state = new_state

        # ── Streak reset ──
        if not any_crossed:
            if self._last_all_off_time == 0:
                self._last_all_off_time = now
            elif now - self._last_all_off_time > 3:
                self._streak = 0
        else:
            self._last_all_off_time = 0

        # ── Pressure (proximity to next uncrossed line) ──
        self._pressure = 0
        for i, line_cfg in enumerate(self.raw_lines):
            label = line_cfg.get("label", f"zone{i+1}")
            info = results.get(label, {})
            if not info.get("crossed", False):
                pct = info.get("water_pct", 0)
                self._pressure = min(100, (pct / (self.water_threshold * 100)) * 100)
                # Proximity warning event
                if 10 <= pct < self.water_threshold * 100 and self._frame_tick % 15 == 0:
                    self.pending_events.append({"type": "warning", "label": label, "pct": pct})
                break

        return {
            "lines": results,
            "max_reached": self.max_reached,
            "crossing_count": self.crossing_count,
            "momentum": self._momentum,
            "wave_state": self._wave_state,
            "pressure": self._pressure,
            "streak": self._streak,
        }

    # ══════════════════════════════════════════════════════════════════════
    #  GAMIFIED OVERLAY — Ocean palette
    # ══════════════════════════════════════════════════════════════════════

    # BGR color palette (ocean theme, harmonious)
    # BGR — pool/ocean turquoise palette
    C_POOL      = (212, 200, 40)    # turquoise pool blue (primary)
    C_POOL_BRT  = (230, 220, 80)    # bright pool blue (celebrations)
    C_POOL_DIM  = (150, 140, 30)    # dim pool blue
    C_TEAL      = (212, 200, 40)    # alias
    C_TEAL_DIM  = (150, 140, 30)    # alias
    C_AQUA      = (210, 190, 50)    # zone fill
    C_AMBER     = (180, 200, 0)      # green-blue (was orange)
    C_CORAL     = (100, 100, 255)   # danger
    C_CORAL_BRT = (140, 160, 255)   # breach flash
    C_GRAY      = (140, 140, 140)   # idle
    C_GRAY_DIM  = (70, 70, 70)      # very dim
    C_WHITE     = (240, 240, 240)   # text
    C_BG        = (20, 20, 20)      # pill bg

    def draw_overlay(self, frame: np.ndarray, state: dict) -> np.ndarray:
        h, w = frame.shape[:2]
        out = frame.copy()
        now = time.time()
        sin_pulse = (math.sin(now * 6) + 1) / 2

        # ── 1. Territory zone fills ──
        for i in range(len(self.pixel_lines)):
            label = self.raw_lines[i].get("label", f"zone{i+1}")
            info = state["lines"].get(label, {})
            pct = info.get("water_pct", 0)
            crossed = info.get("crossed", False)

            if pct > 3 and i < len(self.pixel_lines) - 1:
                s1, e1 = self.pixel_lines[i]
                s2, e2 = self.pixel_lines[i + 1]
                zone_pts = np.array([s1, e1, e2, s2], dtype=np.int32)
                overlay = out.copy()
                intensity = min(pct / 100, 1.0)
                if crossed:
                    color = self.C_AQUA
                    alpha = 0.08 + 0.06 * sin_pulse
                else:
                    color = self.C_TEAL_DIM
                    alpha = 0.04 + 0.08 * intensity
                cv2.fillPoly(overlay, [zone_pts], color)
                out = cv2.addWeighted(overlay, alpha, out, 1 - alpha, 0)

        # ── 2. Spawn particles on active/breached lines ──
        import random
        for i, ((start, end), line_cfg) in enumerate(zip(self.pixel_lines, self.raw_lines)):
            label = line_cfg.get("label", f"zone{i+1}")
            info = state["lines"].get(label, {})
            crossed = info.get("crossed", False)
            pct = info.get("water_pct", 0)
            breach_time = self._breach_times.get(label, 0)
            flash_age = now - breach_time

            # Spawn sparks on breach (burst — sea spray feel)
            if 0 < flash_age < 0.1:
                for _ in range(20):
                    t = random.random()
                    px = int(start[0] + t * (end[0] - start[0]))
                    py = int(start[1] + t * (end[1] - start[1]))
                    vx = random.uniform(-3, 3)
                    vy = random.uniform(-5, -1)
                    self._particles.append([float(px), float(py), vx, vy, 1.0, self.C_POOL_BRT])

            # Ambient sparks on active lines
            if crossed and random.random() < 0.25:
                t = random.random()
                px = int(start[0] + t * (end[0] - start[0]))
                py = int(start[1] + t * (end[1] - start[1]))
                vx = random.uniform(-0.8, 0.8)
                vy = random.uniform(-2.5, -0.3)
                self._particles.append([float(px), float(py), vx, vy, 0.5, self.C_POOL_BRT])

            # Warning sparks
            if not crossed and pct >= 10 and random.random() < 0.12:
                t = random.random()
                px = int(start[0] + t * (end[0] - start[0]))
                py = int(start[1] + t * (end[1] - start[1]))
                self._particles.append([float(px), float(py), random.uniform(-0.8,0.8), random.uniform(-1.5,-0.3), 0.35, self.C_POOL_BRT])

        # ── Update & draw particles ──
        alive = []
        for p in self._particles:
            p[0] += p[2]  # x += vx
            p[1] += p[3]  # y += vy
            p[3] += 0.15  # gravity
            p[4] -= 0.03  # decay
            if p[4] > 0 and 0 <= p[0] < w and 0 <= p[1] < h:
                alpha = min(p[4], 1.0)
                size = max(1, int(3 * alpha))
                color = tuple(int(c * alpha) for c in p[5])
                cv2.circle(out, (int(p[0]), int(p[1])), size, color, -1, cv2.LINE_AA)
                alive.append(p)
        self._particles = alive[-200:]  # cap particles

        # ── 3. Lines with state-based rendering ──
        for i, ((start, end), line_cfg) in enumerate(zip(self.pixel_lines, self.raw_lines)):
            label = line_cfg.get("label", f"zone{i+1}")
            info = state["lines"].get(label, {})
            crossed = info.get("crossed", False)
            pct = info.get("water_pct", 0)

            breach_time = self._breach_times.get(label, 0)
            flash_age = now - breach_time
            is_flashing = flash_age < 0.8 and breach_time > 0

            # ── BREACH FLASH ──
            if is_flashing:
                pulse = 1.0 - (flash_age / 0.8)
                if flash_age < 0.12:
                    flash_overlay = np.zeros_like(out)
                    flash_overlay[:,:] = self.C_POOL_BRT
                    out = cv2.addWeighted(out, 0.88, flash_overlay, 0.12 * pulse, 0)
                glow_t = int(3 + 10 * pulse)
                cv2.line(out, start, end, self.C_POOL_BRT, glow_t, cv2.LINE_AA)
                cv2.line(out, start, end, self.C_WHITE, 2, cv2.LINE_AA)

            # ── WARNING (proximity) ──
            elif not crossed and pct >= 10:
                warn_t = int(1 + 2 * sin_pulse)
                cv2.line(out, start, end, self.C_AMBER, warn_t, cv2.LINE_AA)

            # ── ACTIVE (crossed) ──
            elif crossed:
                shimmer = 0.7 + 0.3 * math.sin(now * 3 + i)
                color = tuple(int(c * shimmer) for c in self.C_TEAL)
                cv2.line(out, start, end, color, 2, cv2.LINE_AA)

            # ── IDLE ──
            else:
                cv2.line(out, start, end, self.C_GRAY_DIM, 1, cv2.LINE_AA)

        # ── 4. Labels — RIGHT EDGE, stacked vertically ──
        label_x = w - 10  # right align
        label_y_start = 50
        for i, line_cfg in enumerate(self.raw_lines):
            label = line_cfg.get("label", f"zone{i+1}")
            info = state["lines"].get(label, {})
            crossed = info.get("crossed", False)
            pct = info.get("water_pct", 0)

            zone_name = label.upper().replace("LINE ", "ZONE ").replace("SHORE", "SHORE")
            display = f"{zone_name} {pct:.0f}%"

            if crossed:
                text_color = self.C_TEAL
                pill_color = (60, 80, 0)
            elif pct >= 10:
                text_color = self.C_AMBER
                pill_color = (20, 60, 80)
            else:
                text_color = self.C_GRAY
                pill_color = self.C_BG

            ly = label_y_start + i * 28
            (tw, th), _ = cv2.getTextSize(display, cv2.FONT_HERSHEY_SIMPLEX, 0.4, 1)
            px = label_x - tw - 12
            py = ly

            # Pill
            cv2.rectangle(out, (px, py), (px + tw + 10, py + th + 8), pill_color, -1, cv2.LINE_AA)
            cv2.rectangle(out, (px, py), (px + tw + 10, py + th + 8), text_color, 1, cv2.LINE_AA)
            cv2.putText(out, display, (px + 5, py + th + 3),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.4, text_color, 1, cv2.LINE_AA)

            dot_color = self.C_TEAL if crossed else self.C_GRAY_DIM if pct < 10 else self.C_AMBER
            cv2.circle(out, (px - 8, py + th // 2 + 4), 4, dot_color, -1, cv2.LINE_AA)

        # ── BREACHED text (center, on breach) ──
        for i, line_cfg in enumerate(self.raw_lines):
            label = line_cfg.get("label", f"zone{i+1}")
            breach_time = self._breach_times.get(label, 0)
            flash_age = now - breach_time
            if 0 < flash_age < 0.6:
                pulse = 1.0 - (flash_age / 0.6)
                font_scale = 0.9 + 0.4 * pulse
                txt = "BREACHED!"
                (tw, th), _ = cv2.getTextSize(txt, cv2.FONT_HERSHEY_SIMPLEX, font_scale, 3)
                tx = w // 2 - tw // 2
                ty = h // 2
                cv2.putText(out, txt, (tx + 2, ty + 2), cv2.FONT_HERSHEY_SIMPLEX,
                            font_scale, (0, 0, 0), 4, cv2.LINE_AA)
                cv2.putText(out, txt, (tx, ty), cv2.FONT_HERSHEY_SIMPLEX,
                            font_scale, self.C_POOL_BRT, 2, cv2.LINE_AA)

        # ── 3. HUD top bar ──
        bar_h = 36
        overlay = out.copy()
        cv2.rectangle(overlay, (0, 0), (w, bar_h), (0, 0, 0), -1)
        out = cv2.addWeighted(overlay, 0.7, out, 0.3, 0)

        # Wave state (left)
        ws = state.get("wave_state", "CALM")
        ws_colors = {"CALM": self.C_GRAY, "RISING": self.C_AMBER, "SURGE": self.C_CORAL}
        ws_color = ws_colors.get(ws, self.C_GRAY)
        if ws == "SURGE":
            brightness = 0.7 + 0.3 * sin_pulse
            ws_color = tuple(int(c * brightness) for c in self.C_CORAL)
        cv2.putText(out, ws, (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.55, ws_color, 2, cv2.LINE_AA)

        # Momentum (center)
        mom = state.get("momentum", "STABLE")
        if mom == "ADVANCING":
            mom_text, mom_color = "ADVANCING", self.C_TEAL
        elif mom == "RETREATING":
            mom_text, mom_color = "RETREATING", self.C_AMBER
        else:
            mom_text, mom_color = "STABLE", self.C_GRAY
        (mtw, _), _ = cv2.getTextSize(mom_text, cv2.FONT_HERSHEY_SIMPLEX, 0.42, 1)
        cv2.putText(out, mom_text, (w // 2 - mtw // 2, 25),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.42, mom_color, 1, cv2.LINE_AA)

        # Stats (right, before pressure meter)
        streak = state.get("streak", 0)
        xings = state.get("crossing_count", 0)
        max_r = state.get("max_reached", 0)
        stats = f"X:{xings}  MAX:{max_r}  STR:{streak}"
        (stw, _), _ = cv2.getTextSize(stats, cv2.FONT_HERSHEY_SIMPLEX, 0.38, 1)
        cv2.putText(out, stats, (w - stw - 50, 25),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.38, self.C_TEAL, 1, cv2.LINE_AA)

        # ── 4. Pressure meter (right side vertical bar) ──
        pressure = state.get("pressure", 0)
        meter_x = w - 30
        meter_y_top = 50
        meter_h = 180
        meter_w = 16

        # Background
        cv2.rectangle(out, (meter_x - 1, meter_y_top - 1),
                      (meter_x + meter_w + 1, meter_y_top + meter_h + 1), (40, 40, 40), -1)

        # Fill
        fill_h = int(meter_h * pressure / 100)
        if fill_h > 0:
            fill_y = meter_y_top + meter_h - fill_h
            if pressure > 80:
                brightness = 0.7 + 0.3 * sin_pulse
                fill_color = tuple(int(c * brightness) for c in self.C_CORAL)
            elif pressure > 50:
                fill_color = self.C_AMBER
            else:
                fill_color = self.C_TEAL_DIM
            cv2.rectangle(out, (meter_x, fill_y), (meter_x + meter_w, meter_y_top + meter_h), fill_color, -1)

        # Border
        if pressure > 80:
            brightness = 0.6 + 0.4 * sin_pulse
            border_color = tuple(int(c * brightness) for c in self.C_CORAL)
            cv2.rectangle(out, (meter_x - 2, meter_y_top - 2),
                          (meter_x + meter_w + 2, meter_y_top + meter_h + 2), border_color, 2)
        else:
            cv2.rectangle(out, (meter_x - 1, meter_y_top - 1),
                          (meter_x + meter_w + 1, meter_y_top + meter_h + 1), self.C_GRAY_DIM, 1)

        cv2.putText(out, "P", (meter_x + 2, meter_y_top - 5),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.35, self.C_GRAY, 1, cv2.LINE_AA)
        cv2.putText(out, f"{pressure:.0f}", (meter_x - 2, meter_y_top + meter_h + 14),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.35, self.C_WHITE, 1, cv2.LINE_AA)

        return out

    def reset(self):
        self.max_reached = 0
        self.crossing_count = 0
        self.crossings.clear()
        self.line_states.clear()
        self._pct_history.clear()
        self._breach_times.clear()
        self._streak = 0
        self._pressure = 0
        self._momentum = "STABLE"
        self._wave_state = "CALM"
        self.pending_events.clear()


# ── Main ──

def main():
    parser = argparse.ArgumentParser(description="Wave Engine — Beach wave detection")
    parser.add_argument("--stream", type=str, help="YouTube or HLS stream URL")
    parser.add_argument("--config", type=str, help="Config JSON file")
    parser.add_argument("--preview", action="store_true", help="Show preview window")
    parser.add_argument("--save-frames", type=str, help="Save annotated frames to directory")
    parser.add_argument("--duration", type=int, default=0, help="Run for N seconds (0=infinite)")
    args = parser.parse_args()

    config = {}
    if args.config and os.path.exists(args.config):
        with open(args.config) as f:
            config = json.load(f)

    stream_url = args.stream or config.get("streamUrl", "")
    if not stream_url:
        print("ERROR: provide --stream URL or --config with streamUrl")
        sys.exit(1)

    lines = config.get("lines", [
        {"points": "0.05,0.85,0.70,0.60", "label": "Shore"},
        {"points": "0.08,0.78,0.65,0.53", "label": "Line 1"},
        {"points": "0.12,0.70,0.60,0.46", "label": "Line 2"},
    ])
    roi = config.get("roi")
    threshold = config.get("waterThreshold", 0.20)

    print(f"[Wave] Resolving stream...")
    hls_url = resolve_youtube(stream_url)
    container = av.open(hls_url, timeout=(10, 15),
                        options={"analyzeduration": "3000000", "probesize": "1000000"})
    detector = WaveDetector(lines, roi=roi, water_threshold=threshold)

    if args.save_frames:
        os.makedirs(args.save_frames, exist_ok=True)

    start_time = time.time()
    frame_count = 0
    print(f"[Wave] Running — {len(lines)} zones, threshold={threshold}")

    try:
        for frame in container.decode(video=0):
            img = frame.to_ndarray(format="bgr24")
            img = cv2.resize(img, (1280, 720))
            frame_count += 1

            if detector._baseline is None:
                detector.update_baseline(img)
                continue

            state = detector.process_frame(img)

            if frame_count % 30 == 0:
                print(f"[Wave] f={frame_count} {state['wave_state']} {state['momentum']} "
                      f"pressure={state['pressure']:.0f} xings={state['crossing_count']} "
                      f"streak={state['streak']}")

            if args.preview or args.save_frames:
                annotated = detector.draw_overlay(img, state)
                if args.save_frames and frame_count % 15 == 0:
                    cv2.imwrite(os.path.join(args.save_frames, f"wave_{frame_count:06d}.jpg"), annotated)
                if args.preview:
                    cv2.imshow("Wave Engine", annotated)
                    if cv2.waitKey(1) & 0xFF == ord("q"):
                        break

            if args.duration > 0 and time.time() - start_time > args.duration:
                break
            time.sleep(0.033)

    except KeyboardInterrupt:
        pass

    elapsed = time.time() - start_time
    print(f"\n[Wave] Done. {frame_count} frames, {elapsed:.0f}s")
    print(f"[Wave] Max: Zone {detector.max_reached} | Crossings: {detector.crossing_count}")
    container.close()
    if args.preview:
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
