"""
SinalBet Oracle — Live YOLO Streaming Server (v3 — Supervision SOTA)

State-of-the-art vehicle counting using:
  - YOLOv8x/YOLO11x for detection
  - BoT-SORT for multi-object tracking (persistent IDs)
  - Supervision LineZone with minimum_crossing_threshold (no jitter double-counts)
  - DetectionsSmoother for temporal stability
  - Per-class counting (car, motorcycle, bus, truck)

Usage:
    python stream_server.py --stream "https://...m3u8" --duration 300
    python stream_server.py --camera caltrans-100 --duration 300

Frontend connects to ws://localhost:8765
"""

import argparse
import asyncio
import hashlib
import json
import os
import sys
import time
import subprocess

import faulthandler
faulthandler.enable()

try:
    import cv2
    import numpy as np
    from ultralytics import YOLO
    import supervision as sv
    import websockets
except ImportError as e:
    print(f"ERROR: Missing dependency: {e}")
    print("Run: pip install ultralytics supervision websockets opencv-python")
    sys.exit(1)


# Default COCO classes (vehicles). Per-camera override via cameras.json `classes`.
VEHICLE_CLASSES = [2, 3, 5, 7]  # car, motorcycle, bus, truck
VEHICLE_NAMES = {2: 'car', 3: 'moto', 5: 'bus', 7: 'truck'}
# Full COCO labels for non-vehicle cameras (skiers, pedestrians, etc.)
COCO_NAMES = {
    0: 'person', 1: 'bicycle', 2: 'car', 3: 'moto', 4: 'airplane',
    5: 'bus', 6: 'train', 7: 'truck', 8: 'boat',
}

# Colors
NEON_GREEN = (136, 255, 0)
NEON_YELLOW = (0, 204, 255)

# Output frame width — higher = better detection but larger JPEG
OUTPUT_WIDTH = 1920


class VehicleCounter:
    """Vehicle counter: ID tracking + line crossing confirmation.

    - Red box = detected, tracking, hasn't crossed line yet
    - Green box = crossed the line, counted
    - Green line on the road = counting trigger
    - Counts both directions (in + out)
    - Never recounts same ID
    """

    def __init__(self, model_name='yolov8x.pt', confidence=0.20,
                 line_position=0.45, line_angle=10, line_points=None,
                 count_mode='line', min_frames=5, lanes=None,
                 classes=None, roi=None, dedup_radius=120, dedup_window=10.0,
                 line_zones=None, crossing_threshold=2, **_kwargs):
        self.count_mode = count_mode
        self.min_frames = min_frames
        self.seen_frames = {}
        self.lanes_config = lanes  # list of lane dicts from cameras.json
        self.lanes = []            # processed lanes (set on first frame)
        self.lanes_ready = False
        # ROI mask — list of polygons (in fractions) that define where YOLO counts
        # Detections whose bottom-center falls OUTSIDE all polygons are ignored.
        # Supports: None | [[x1,y1],...] (single polygon) | [[[x1,y1],...],...] (multi)
        self.roi_config = roi
        self.roi = []            # list of np.array polygons (absolute coords)
        self.roi_ready = False
        # Line zones (sv.LineZone) — canonical line counting via supervision.
        # count_mode='zones' activates this. Each zone triggers on BOTTOM_CENTER
        # (feet), requires minimum_crossing_threshold=2 frames of confirmation.
        self.line_zones_config = line_zones  # list of "x1,y1,x2,y2" strings (fractions)
        self.line_zones = []                  # list of sv.LineZone objects
        self.line_zones_ready = False
        self.crossing_threshold = max(1, int(crossing_threshold))
        self.model = YOLO(model_name)
        self.confidence = confidence
        # COCO classes to detect. Default = vehicles. Override via cameras.json
        # for person-based cameras (ski slopes, crosswalks, etc.)
        self.classes = list(classes) if classes else list(VEHICLE_CLASSES)
        self.line_position = line_position  # 0-1, where on x-axis the line center is
        self.line_angle = line_angle
        self.custom_line_points = line_points    # "x1,y1,x2,y2" for line 1
        self.custom_line_points2 = _kwargs.get('line_points2')  # optional line 2
        self.line2_start = None
        self.line2_end = None

        # Tracking state
        self.prev_pos = {}        # tid -> last (cx, cy)
        self.counted_ids = set()  # IDs that crossed the line
        self.counted_number = {}  # tid -> sequential count number (#1, #2, #3...)
        self._last_seen = {}      # tid -> frame_index when last observed
        self._frame_count = 0
        self._PRUNE_INTERVAL = 100  # prune every ~8s at 13fps
        self._PRUNE_AGE = 90        # remove IDs not seen for ~7s
        self.total_count = 0
        self.count_in = 0         # crossed left-to-right
        self.count_out = 0        # crossed right-to-left

        # Anti-double-count: recent crossing positions with timestamps.
        # Configurable per camera via cameras.json `dedup.radius` / `dedup.window`.
        self._recent_crossings: list[tuple[int, int, float]] = []  # (cx, cy, time)
        self.DEDUP_RADIUS = int(dedup_radius)    # pixels — min distance from recent crossing
        self.DEDUP_WINDOW = float(dedup_window)  # seconds — how long to remember a crossing

        # Per-class counts — dynamic based on configured classes
        self.class_counts = {c: 0 for c in self.classes}

        # Line endpoints (set on first frame)
        self.line_start = None    # (x, y) top point
        self.line_end = None      # (x, y) bottom point

        # Annotators — trace length 2 = effectively no visible trail.
        self.trace_annotator = sv.TraceAnnotator(
            thickness=1, trace_length=2,
            color=sv.Color.from_hex("#00ff88")
        )
        self.smoother = sv.DetectionsSmoother(length=3)

    def _is_duplicate_crossing(self, cx: int, cy: int) -> bool:
        """Check if a crossing at (cx, cy) is too close to a recent crossing."""
        import time as _time
        now = _time.time()
        # Clean old entries
        self._recent_crossings = [
            (x, y, t) for x, y, t in self._recent_crossings
            if now - t < self.DEDUP_WINDOW
        ]
        # Check distance to all recent crossings
        for rx, ry, _ in self._recent_crossings:
            dist = ((cx - rx) ** 2 + (cy - ry) ** 2) ** 0.5
            if dist < self.DEDUP_RADIUS:
                return True  # Too close — likely same vehicle with new ID
        # Not a duplicate — record this crossing
        self._recent_crossings.append((cx, cy, now))
        return False

    def _prune_stale_tracks(self):
        """Remove tracker IDs not seen recently from tracking dicts.
        Prevents unbounded memory growth that leads to SIGSEGV in C++ tracker."""
        cutoff = self._frame_count - self._PRUNE_AGE
        stale = [tid for tid, last in self._last_seen.items() if last < cutoff]
        for tid in stale:
            self.seen_frames.pop(tid, None)
            self.prev_pos.pop(tid, None)
            self.counted_number.pop(tid, None)
            del self._last_seen[tid]
        # NEVER prune counted_ids — must persist for recount prevention
        if stale:
            print(f"[Prune] Removed {len(stale)} stale IDs (frame {self._frame_count})")

    def _merge_overlapping(self, detections):
        """Remove smaller detections contained inside larger ones.
        Handles: truck cab+trailer overlap, AND cars on car carriers (cegonhas).
        If a small box is mostly inside a big box, it's cargo, not a vehicle."""
        if len(detections) < 2 or detections.tracker_id is None:
            return detections

        keep = [True] * len(detections)
        areas = []
        for i in range(len(detections)):
            a = (detections.xyxy[i][2] - detections.xyxy[i][0]) * (detections.xyxy[i][3] - detections.xyxy[i][1])
            areas.append(a)

        for i in range(len(detections)):
            if not keep[i]:
                continue
            for j in range(len(detections)):
                if i == j or not keep[j]:
                    continue

                # Check if j is inside i (smaller inside larger)
                if areas[j] >= areas[i]:
                    continue

                # Calculate how much of j is inside i
                xi1 = max(detections.xyxy[i][0], detections.xyxy[j][0])
                yi1 = max(detections.xyxy[i][1], detections.xyxy[j][1])
                xi2 = min(detections.xyxy[i][2], detections.xyxy[j][2])
                yi2 = min(detections.xyxy[i][3], detections.xyxy[j][3])
                inter = max(0, xi2 - xi1) * max(0, yi2 - yi1)

                # If 50%+ of the smaller box is inside the larger = cargo, not vehicle
                containment = inter / areas[j] if areas[j] > 0 else 0
                if containment > 0.5:
                    keep[j] = False

        mask = np.array(keep)
        return detections[mask]

    def _setup_lanes(self, w, h):
        """Initialize lane zones and lines from config."""
        if not self.lanes_config:
            return
        for lc in self.lanes_config:
            # Parse zone polygon (x1,y1,x2,y2,...) as fractions
            zone_pts = lc["zone"]
            polygon = []
            for i in range(0, len(zone_pts), 2):
                polygon.append([int(zone_pts[i] * w), int(zone_pts[i+1] * h)])
            polygon = np.array(polygon)

            # Parse line
            lp = [float(p) for p in lc["line"].split(",")]
            line_start = (int(lp[0] * w), int(lp[1] * h))
            line_end = (int(lp[2] * w), int(lp[3] * h))

            self.lanes.append({
                "name": lc["name"],
                "direction": lc["direction"],
                "polygon": polygon,
                "line_start": line_start,
                "line_end": line_end,
                "count": 0,
            })
            print(f"[Lane] {lc['name']}: zone={polygon.tolist()}, line={line_start}->{line_end}")
        self.lanes_ready = True

    def _setup_line_zones(self, w, h):
        """Build sv.LineZone objects from fractional coord strings."""
        if not self.line_zones_config:
            return
        self._line_zone_pts = []  # list of ((x1,y1),(x2,y2)) for drawing
        for line_str in self.line_zones_config:
            parts = [float(p) for p in line_str.split(",")]
            sx, sy = int(parts[0] * w), int(parts[1] * h)
            ex, ey = int(parts[2] * w), int(parts[3] * h)
            start = sv.Point(sx, sy)
            end = sv.Point(ex, ey)
            zone = sv.LineZone(
                start=start,
                end=end,
                triggering_anchors=[sv.Position.BOTTOM_CENTER],
                minimum_crossing_threshold=self.crossing_threshold,
            )
            self.line_zones.append(zone)
            self._line_zone_pts.append(((sx, sy), (ex, ey)))
            print(f"[LineZone] ({sx},{sy}) -> ({ex},{ey})")
        self.line_zones_ready = True

    def _setup_roi(self, w, h):
        """Convert ROI config (fractions) to absolute polygons."""
        if not self.roi_config:
            return
        # Detect format: single polygon [[x,y],...] vs multi [[[x,y],...],...]
        cfg = self.roi_config
        if cfg and isinstance(cfg[0], (list, tuple)) and len(cfg[0]) > 0 and isinstance(cfg[0][0], (list, tuple)):
            polys = cfg  # already multi-polygon
        else:
            polys = [cfg]  # wrap single polygon
        for poly_frac in polys:
            poly_abs = np.array([[int(p[0] * w), int(p[1] * h)] for p in poly_frac])
            self.roi.append(poly_abs)
        self.roi_ready = True
        total_v = sum(len(p) for p in self.roi)
        print(f"[ROI] {len(self.roi)} polygon(s) loaded, {total_v} total vertices")

    def _in_any_roi(self, px, py):
        """True if point is inside any ROI polygon. If no ROI set, always True."""
        if not self.roi_ready:
            return True
        for poly in self.roi:
            if self._point_in_polygon(px, py, poly):
                return True
        return False

    def _point_in_polygon(self, px, py, polygon):
        """Ray-casting point-in-polygon test."""
        n = len(polygon)
        inside = False
        j = n - 1
        for i in range(n):
            xi, yi = polygon[i]
            xj, yj = polygon[j]
            if ((yi > py) != (yj > py)) and (px < (xj - xi) * (py - yi) / (yj - yi) + xi):
                inside = not inside
            j = i
        return inside

    def _cross_product_sign(self, px, py, ax, ay, bx, by):
        """Which side of line AB is point P? Positive = left, Negative = right."""
        return (bx - ax) * (py - ay) - (by - ay) * (px - ax)

    def process_frame(self, frame):
        """Detect, track, count on angled line crossing, annotate."""
        h, w = frame.shape[:2]
        self._frame_count += 1
        import math

        # Setup lanes on first frame
        if not self.lanes_ready and self.lanes_config:
            self._setup_lanes(w, h)

        # Setup ROI mask on first frame
        if not self.roi_ready and self.roi_config:
            self._setup_roi(w, h)

        # Setup LineZones on first frame
        if not self.line_zones_ready and self.line_zones_config:
            self._setup_line_zones(w, h)

        # Set line endpoints on first frame
        if self.line_start is None:
            if self.custom_line_points:
                # Custom line: "x1,y1,x2,y2" as fractions of w,h
                parts = [float(p) for p in self.custom_line_points.split(",")]
                self.line_start = (int(parts[0] * w), int(parts[1] * h))
                self.line_end = (int(parts[2] * w), int(parts[3] * h))
            else:
                cx = int(w * self.line_position)
                angle_rad = math.radians(self.line_angle)
                top_y = 10
                bot_y = h - 10
                span = bot_y - top_y
                dx = int(span * math.tan(angle_rad))
                self.line_start = (cx - dx // 2, top_y)
                self.line_end = (cx + dx // 2, bot_y)
            # Second line (optional)
            if self.custom_line_points2:
                p2 = [float(p) for p in self.custom_line_points2.split(",")]
                self.line2_start = (int(p2[0] * w), int(p2[1] * h))
                self.line2_end = (int(p2[2] * w), int(p2[3] * h))
                print(f"[Counter] Line 1: {self.line_start} -> {self.line_end}")
                print(f"[Counter] Line 2: {self.line2_start} -> {self.line2_end}")
            else:
                print(f"[Counter] Line: {self.line_start} -> {self.line_end}")

        lx1, ly1 = self.line_start
        lx2, ly2 = self.line_end

        # Detect + track with BoT-SORT on GPU
        results = self.model.track(
            frame, verbose=False, conf=self.confidence,
            classes=self.classes, persist=True,
            tracker="botsort_custom.yaml", imgsz=1280, device=0
        )[0]

        detections = sv.Detections.from_ultralytics(results)

        if detections.class_id is not None and len(detections) > 0:
            mask = np.isin(detections.class_id, self.classes)
            detections = detections[mask]

        has_tracker = (detections.tracker_id is not None and
                       len(detections) > 0 and
                       any(t is not None for t in detections.tracker_id))

        if has_tracker:
            detections = self.smoother.update_with_detections(detections)
            detections = self._merge_overlapping(detections)

            if self.lanes_ready and self.lanes:
                # ─── Lane-based counting with bottom-center anchor ───
                for i in range(len(detections)):
                    tid = detections.tracker_id[i]
                    if tid is None or tid in self.counted_ids:
                        continue
                    x1, y1, x2, y2 = detections.xyxy[i]
                    # Bottom-center anchor = better ground-plane position
                    cx = int((x1 + x2) / 2)
                    cy = int(y2)
                    cls = detections.class_id[i] if detections.class_id is not None else 2

                    # Track must persist min_frames before counting
                    self.seen_frames[tid] = self.seen_frames.get(tid, 0) + 1
                    if self.seen_frames[tid] < self.min_frames:
                        # Still store position for line-crossing detection
                        for lane in self.lanes:
                            ls, le = lane["line_start"], lane["line_end"]
                            side = self._cross_product_sign(cx, cy, ls[0], ls[1], le[0], le[1])
                            self.prev_pos[tid] = (cx, cy, side)
                        continue

                    for lane in self.lanes:
                        # Check if vehicle anchor is in this lane's zone
                        if not self._point_in_polygon(cx, cy, lane["polygon"]):
                            continue

                        # Check if crosses this lane's line
                        ls = lane["line_start"]
                        le = lane["line_end"]
                        side = self._cross_product_sign(cx, cy, ls[0], ls[1], le[0], le[1])

                        if tid in self.prev_pos and len(self.prev_pos[tid]) > 2:
                            prev_side = self.prev_pos[tid][2]
                            if prev_side is not None and prev_side * side < 0:
                                if not self._is_duplicate_crossing(cx, cy):
                                    self.counted_ids.add(tid)
                                    self.total_count += 1
                                    self.counted_number[tid] = self.total_count
                                    lane["count"] += 1
                                    if lane["direction"] == "toward":
                                        self.count_in += 1
                                    else:
                                        self.count_out += 1
                                self.class_counts[cls] = self.class_counts.get(cls, 0) + 1
                                break  # counted, don't check other lanes

                    # Store per-lane side for the first lane the vehicle is in
                    for lane in self.lanes:
                        ls, le = lane["line_start"], lane["line_end"]
                        if self._point_in_polygon(cx, cy, lane["polygon"]):
                            side = self._cross_product_sign(cx, cy, ls[0], ls[1], le[0], le[1])
                            self.prev_pos[tid] = (cx, cy, side)
                            break
                    else:
                        # Not in any lane — still track position with first lane's line
                        ls, le = self.lanes[0]["line_start"], self.lanes[0]["line_end"]
                        side = self._cross_product_sign(cx, cy, ls[0], ls[1], le[0], le[1])
                        self.prev_pos[tid] = (cx, cy, side)

            elif self.count_mode == 'zones' and self.line_zones_ready:
                # ─── Canonical line counting via supervision LineZone ───
                # Each zone triggers on BOTTOM_CENTER anchor, with
                # minimum_crossing_threshold=2 (anti-flicker). A tracker_id
                # that crosses is tracked internally by the zone, so we
                # only count the first crossing per id (across all zones
                # combined — counted_ids set protects against double-count
                # when the person crosses multiple parallel lines).
                for zone_idx, zone in enumerate(self.line_zones):
                    # supervision trigger returns boolean arrays of shape (N,)
                    crossed_in, crossed_out = zone.trigger(detections)
                    for i in range(len(detections)):
                        if not (crossed_in[i] or crossed_out[i]):
                            continue
                        tid = detections.tracker_id[i]
                        if tid is None or tid in self.counted_ids:
                            continue
                        cls = detections.class_id[i] if detections.class_id is not None else 2
                        self.counted_ids.add(tid)
                        self.total_count += 1
                        self.counted_number[tid] = self.total_count
                        self.class_counts[cls] = self.class_counts.get(cls, 0) + 1
                        if crossed_in[i]:
                            self.count_in += 1
                        else:
                            self.count_out += 1

            elif self.count_mode == 'uid':
                # ─── Unique ID mode: count every vehicle seen min_frames+ ───
                # Uses bottom-center anchor and tracks movement direction
                # to filter out stationary/phantom detections.
                for i in range(len(detections)):
                    tid = detections.tracker_id[i]
                    if tid is None:
                        continue
                    x1, y1, x2, y2 = detections.xyxy[i]
                    # Bottom-center = better ground-plane anchor than centroid
                    anchor_x = int((x1 + x2) / 2)
                    anchor_y = int(y2)
                    cls = detections.class_id[i] if detections.class_id is not None else 2

                    # ROI filter: skip detections outside the painted mask
                    if self.roi_ready and not self._in_any_roi(anchor_x, anchor_y):
                        continue

                    self.seen_frames[tid] = self.seen_frames.get(tid, 0) + 1

                    # Track position history for direction validation
                    if tid not in self.prev_pos:
                        self.prev_pos[tid] = (anchor_x, anchor_y)

                    if tid not in self.counted_ids and self.seen_frames[tid] >= self.min_frames:
                        # Check that the vehicle actually moved (not a parked/phantom detection)
                        first_pos = self.prev_pos[tid]
                        dx = abs(anchor_x - first_pos[0])
                        dy = abs(anchor_y - first_pos[1])
                        # Adaptive threshold: proportional to bbox height so
                        # distant/small targets (few px/frame movement) still count.
                        # Floor 8 prevents bbox jitter from triggering false
                        # "moved" events on stationary ghosts.
                        bbox_h = max(1, int(y2 - y1))
                        move_thresh = max(8, int(bbox_h * 0.2))
                        # NOTE: dedup_radius check intentionally omitted in uid mode.
                        # counted_ids set already guarantees each tracker_id counts
                        # at most once. Running dedup on top caused legit new IDs
                        # to be suppressed when the tracker flickered an ID in
                        # dense scenes (scramble crossings, ski pistes). Trust
                        # the tracker; ReID/Kalman inside BoT-SORT handle re-ID.
                        if dx + dy >= move_thresh:
                            self.counted_ids.add(tid)
                            self.total_count += 1
                            self.counted_number[tid] = self.total_count
                            self.class_counts[cls] = self.class_counts.get(cls, 0) + 1
            else:
                # ─── Line crossing mode ───
                for i in range(len(detections)):
                    tid = detections.tracker_id[i]
                    if tid is None:
                        continue
                    x1, y1, x2, y2 = detections.xyxy[i]
                    cx = int((x1 + x2) / 2)
                    cy = int((y1 + y2) / 2)
                    cls = detections.class_id[i] if detections.class_id is not None else 2

                    side1 = self._cross_product_sign(cx, cy, lx1, ly1, lx2, ly2)
                    side2 = None
                    if self.line2_start:
                        side2 = self._cross_product_sign(cx, cy,
                            self.line2_start[0], self.line2_start[1],
                            self.line2_end[0], self.line2_end[1])

                    if tid not in self.counted_ids and tid in self.prev_pos:
                        ps1 = self.prev_pos[tid][2]
                        ps2 = self.prev_pos[tid][3] if len(self.prev_pos[tid]) > 3 else None
                        crossed = False
                        # Check line 1
                        if ps1 is not None and ps1 * side1 < 0:
                            crossed = True
                        # Check line 2
                        if not crossed and side2 is not None and ps2 is not None and ps2 * side2 < 0:
                            crossed = True

                        if crossed and not self._is_duplicate_crossing(cx, cy):
                            self.counted_ids.add(tid)
                            self.total_count += 1
                            self.counted_number[tid] = self.total_count
                            if side1 > 0:
                                self.count_in += 1
                            else:
                                self.count_out += 1
                            self.class_counts[cls] = self.class_counts.get(cls, 0) + 1

                    self.prev_pos[tid] = (cx, cy, side1, side2)

            # Update last-seen timestamps for active tracker IDs
            for i in range(len(detections)):
                tid = detections.tracker_id[i]
                if tid is not None:
                    self._last_seen[tid] = self._frame_count

        # Periodic pruning of stale tracker IDs to prevent memory bloat
        if self._frame_count % self._PRUNE_INTERVAL == 0:
            self._prune_stale_tracks()

        if has_tracker:
            # Draw traces
            frame = self.trace_annotator.annotate(frame, detections)

            # Draw boxes: RED = tracking, GREEN = counted (with number)
            for i in range(len(detections)):
                tid = detections.tracker_id[i]
                if tid is None:
                    continue
                bx1, by1, bx2, by2 = detections.xyxy[i].astype(int)
                counted = tid in self.counted_ids
                color = (0, 255, 0) if counted else (0, 0, 255)
                cv2.rectangle(frame, (bx1, by1), (bx2, by2), color, 2)

                # Count numbers removed — frontend handles display

        # ─── Draw counting line (only in line mode) ──────────
        # ROI outline NOT drawn — stream stays clean.
        # Uncomment the 4 lines below if you ever need to debug a polygon.
        # if self.roi_ready and self.roi:
        #     for poly in self.roi:
        #         pts = poly.reshape((-1, 1, 2))
        #         cv2.polylines(frame, [pts], True, (0, 200, 100), 1, cv2.LINE_AA)

        # Draw line zones (canonical sv.LineZone visualization)
        if self.line_zones_ready and hasattr(self, '_line_zone_pts'):
            for (p1, p2) in self._line_zone_pts:
                cv2.line(frame, p1, p2, NEON_GREEN, 2, cv2.LINE_AA)

        # Draw lanes
        if self.lanes_ready and self.lanes:
            for lane in self.lanes:
                # Draw zone polygon (subtle)
                pts = lane["polygon"].reshape((-1, 1, 2))
                cv2.polylines(frame, [pts], True, (100, 100, 100), 1)
                # Draw counting line (green)
                cv2.line(frame, lane["line_start"], lane["line_end"], NEON_GREEN, 2)
                # Lane label
                lx, ly = lane["line_start"]
                cv2.putText(frame, f'{lane["name"]}: {lane["count"]}', (lx + 5, ly - 8),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.35, NEON_GREEN, 1, cv2.LINE_AA)
        elif self.count_mode == 'line' and self.line_start:
            cv2.line(frame, self.line_start, self.line_end, NEON_GREEN, 2)
            if self.line2_start:
                cv2.line(frame, self.line2_start, self.line2_end, NEON_GREEN, 2)

        # HUD removed — frontend handles count/timer display

        return frame, self.total_count


_URL_CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".url_cache.json")
_URL_CACHE_TTL = 18000  # 5 hours — HLS URLs last ~6h

def _load_url_cache():
    try:
        with open(_URL_CACHE_FILE) as f:
            return json.load(f)
    except Exception:
        return {}

def _save_url_cache(cache):
    try:
        with open(_URL_CACHE_FILE, 'w') as f:
            json.dump(cache, f)
    except Exception:
        pass

def get_stream_url(youtube_url):
    """Extract direct stream URL using yt-dlp. Cached on disk to avoid rate limits."""
    import os

    if 'youtube.com' not in youtube_url and 'youtu.be' not in youtube_url:
        return youtube_url

    # Return cached URL if fresh
    cache = _load_url_cache()
    if youtube_url in cache:
        cached_url, cached_ts = cache[youtube_url]
        age = time.time() - cached_ts
        if age < _URL_CACHE_TTL:
            print(f"[yt-dlp] Using cached URL (age {int(age)}s)")
            return cached_url

    deno_path = os.path.expanduser("~/.deno/bin")
    env = os.environ.copy()
    if deno_path not in env.get("PATH", ""):
        env["PATH"] = f"{deno_path}:{env.get('PATH', '')}"

    commands = [
        ['yt-dlp', '--remote-components', 'ejs:github', '-f', 'best[height<=720]', '-g', youtube_url],
        ['yt-dlp', '-f', 'best[height<=720]', '-g', youtube_url],
        ['yt-dlp', '-f', 'best', '-g', youtube_url],
    ]

    for cmd in commands:
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=60, env=env)
            if result.returncode == 0:
                url = result.stdout.strip()
                print(f"[yt-dlp] OK: {url[:80]}...")
                cache[youtube_url] = [url, time.time()]
                _save_url_cache(cache)
                return url
        except FileNotFoundError:
            return youtube_url
        except subprocess.TimeoutExpired:
            continue

    # yt-dlp failed — return cached even if stale, better than nothing
    if youtube_url in cache:
        print("[yt-dlp] FAILED — using stale cached URL")
        return cache[youtube_url][0]

    return youtube_url


class StreamServer:
    """Persistent WebSocket server that streams processed video frames.

    Runs continuously — never exits on round end.
    Round lifecycle controlled via WS messages (start_round / stop_round).

    States:
      IDLE      → streaming video, no counting
      COUNTING  → streaming video + counting vehicles
    """

    # Maximum number of evidence frame sets to keep on disk
    MAX_EVIDENCE_DIRS = 100
    # Interval (seconds) between evidence frame captures
    EVIDENCE_INTERVAL = 30
    # JPEG quality for evidence frames
    EVIDENCE_JPEG_QUALITY = 80

    # States
    STATE_IDLE = "idle"
    STATE_BETTING = "betting_open"
    STATE_COUNTING = "counting"

    def __init__(self, stream_url, host='0.0.0.0', port=8765,
                 model='yolov8x.pt', confidence=0.10, line_pos=0.5,
                 line_angle=10, line_points=None, line_points2=None,
                 count_mode='uid', lanes=None, target_fps=8, camera_id='',
                 referer=None, classes=None, roi=None,
                 dedup_radius=120, dedup_window=10.0,
                 line_zones=None, crossing_threshold=2, **kwargs):
        self.stream_url = stream_url
        self._referer = referer
        self.host = host
        self.port = port
        self.target_fps = target_fps
        self.camera_id = camera_id

        # YOLO config — stored for creating fresh counters per round
        self._model_name = model
        self._confidence = confidence
        self._line_pos = line_pos
        self._line_angle = line_angle
        self._line_points = line_points
        self._line_points2 = line_points2
        self._count_mode = count_mode
        self._lanes = lanes
        self._classes = classes
        self._roi = roi
        self._dedup_radius = dedup_radius
        self._dedup_window = dedup_window
        self._line_zones = line_zones
        self._crossing_threshold = crossing_threshold

        # Create initial counter (for YOLO model loading + visual annotations in IDLE)
        self.counter = VehicleCounter(model_name=model, confidence=confidence,
                                       line_position=line_pos, line_angle=line_angle,
                                       line_points=line_points,
                                       line_points2=line_points2,
                                       count_mode=count_mode, lanes=lanes,
                                       classes=classes, roi=roi,
                                       dedup_radius=dedup_radius,
                                       dedup_window=dedup_window,
                                       line_zones=line_zones,
                                       crossing_threshold=crossing_threshold,
                                       min_frames=2)
        self.clients = set()
        self.running = False

        # Round state — controlled by WS messages
        self._state = self.STATE_IDLE
        self._round_active = False
        self._round_start_time = 0.0
        self._round_duration = 300
        self._round_market = ''
        self._round_id = 0

        # Evidence frame tracking
        self._evidence_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "evidence")
        self._evidence_frames: list[str] = []
        self._evidence_hashes: list[str] = []
        self._evidence_final: str | None = None
        self._last_evidence_time: float = 0.0

    def _new_counter(self):
        """Create a fresh VehicleCounter — reuses the already-loaded YOLO model."""
        c = VehicleCounter(model_name=self._model_name, confidence=self._confidence,
                           line_position=self._line_pos, line_angle=self._line_angle,
                           line_points=self._line_points, line_points2=self._line_points2,
                           count_mode=self._count_mode, lanes=self._lanes,
                           classes=self._classes, roi=self._roi,
                           dedup_radius=self._dedup_radius,
                           dedup_window=self._dedup_window,
                           line_zones=self._line_zones,
                           crossing_threshold=self._crossing_threshold,
                           min_frames=2)
        c.model = self.counter.model  # reuse loaded model — no GPU reload
        return c

    def _start_round(self, data):
        """Begin a new round. Phase 1: betting (off-chain countdown matching
        on-chain lockTime). Phase 2: counting (authoritative vehicle tally)."""
        self._round_market = data.get("marketAddress", "")
        self._round_duration = data.get("duration", 300)          # counting window
        # round_manager sends camelCase "bettingDuration"; accept snake_case too
        self._betting_duration = data.get("bettingDuration", data.get("betting_duration", 0))
        self._round_id = data.get("roundId", 0)
        self._round_active = True
        # Fresh counter + evidence up front (count result only collected during counting)
        self.counter = self._new_counter()
        self._evidence_frames = []
        self._evidence_hashes = []
        self._evidence_final = None
        self._last_evidence_time = 0.0
        self._ensure_evidence_dir()
        # _round_start_time is the wall-clock start of the ROUND (covers
        # betting + counting). Counter runs continuously from here.
        self._round_start_time = time.time()
        if self._betting_duration > 0:
            self._state = self.STATE_BETTING
            self._betting_start_time = time.time()
            self._counting_start_time = 0.0  # set at betting→counting transition
            print(f"[STATE] betting — market={self._round_market[:10]}... bet={self._betting_duration}s count={self._round_duration}s round={self._round_id}")
        else:
            self._state = self.STATE_COUNTING
            self._betting_start_time = 0.0
            self._counting_start_time = time.time()
            print(f"[STATE] counting — market={self._round_market[:10]}... duration={self._round_duration}s round={self._round_id}")

    def _stop_round(self):
        """End current round. Write result, broadcast final, go IDLE."""
        if not self._round_active:
            return None
        count = self.counter.total_count
        result = {
            "count": count,
            "in_count": self.counter.count_in,
            "out_count": self.counter.count_out,
            "duration": self._round_duration,
            "stream": self.stream_url,
            "timestamp": int(time.time()),
            "marketAddress": self._round_market,
            "roundId": self._round_id,
            "evidence": {
                "frames": list(self._evidence_frames),
                "final_frame": self._evidence_final,
                "frame_hashes": list(self._evidence_hashes),
            },
        }
        # Write result file (unique per round to avoid stale reads)
        result_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "result.json")
        with open(result_path, "w") as f:
            json.dump(result, f, indent=2)
        self._round_active = False
        self._state = self.STATE_IDLE
        print(f"[STATE] idle — round {self._round_id} complete: {count} vehicles")
        return result

    MAX_CLIENTS = 20  # hard limit — prevents resource exhaustion

    async def register(self, ws):
        # Reject if too many clients
        if len(self.clients) >= self.MAX_CLIENTS:
            print(f"[WS] Rejected — max clients ({self.MAX_CLIENTS}) reached")
            await ws.close(1013, "max clients reached")
            return False
        self.clients.add(ws)
        print(f"[WS] Client connected ({len(self.clients)} total)")
        # Send current state
        init_msg = {
            "type": "init",
            "stream": self.stream_url,
            "state": self._state,
            "count": self.counter.total_count,
            "cameraId": self.camera_id,
        }
        if self._round_active:
            init_msg["marketAddress"] = self._round_market
            init_msg["roundId"] = self._round_id
            init_msg["duration"] = self._round_duration
            elapsed = time.time() - self._round_start_time
            init_msg["elapsed"] = round(elapsed, 1)
            init_msg["remaining"] = max(0, round(self._round_duration - elapsed, 1))
        await ws.send(json.dumps(init_msg))
        return True

    async def unregister(self, ws):
        self.clients.discard(ws)
        print(f"[WS] Client disconnected ({len(self.clients)} total)")

    async def _broadcast(self, json_msg, jpeg_bytes):
        """Send JSON + binary frame to all connected clients.

        Per-client AND global timeout: prevents a zombie socket from hanging
        the whole main loop (seen in production after hours of runtime — the
        gather would stall forever because wait_for cancel didn't interrupt
        the underlying send()). Global cap = 1.5s regardless of client count.
        """
        if not self.clients:
            return
        dead = set()
        async def send_to(ws):
            try:
                await asyncio.wait_for(ws.send(json_msg), timeout=1)
                await asyncio.wait_for(ws.send(jpeg_bytes), timeout=1)
            except BaseException:
                dead.add(ws)
        try:
            await asyncio.wait_for(
                asyncio.gather(
                    *(send_to(ws) for ws in list(self.clients)),
                    return_exceptions=True,
                ),
                timeout=1.5,
            )
        except asyncio.TimeoutError:
            # Any client that didn't finish in 1.5s is zombie — mark all as dead
            # on next iteration they get re-reaped by their own send_to
            pass
        self.clients -= dead

    async def _broadcast_json(self, msg):
        """Send JSON-only message to all clients."""
        if not self.clients:
            return
        raw = json.dumps(msg)
        dead = set()
        async def send_to(ws):
            try:
                await asyncio.wait_for(ws.send(raw), timeout=2)
            except (websockets.exceptions.ConnectionClosed, asyncio.TimeoutError):
                dead.add(ws)
        await asyncio.gather(*(send_to(ws) for ws in self.clients))
        self.clients -= dead

    def _ensure_evidence_dir(self) -> None:
        """Create evidence/ directory and clean up old evidence if needed."""
        os.makedirs(self._evidence_dir, exist_ok=True)
        # Clean up oldest evidence files if we exceed MAX_EVIDENCE_DIRS sets.
        # Evidence files are named {timestamp}_{elapsed}s.jpg or {timestamp}_final.jpg
        # Group by timestamp prefix and remove oldest groups.
        try:
            files = sorted(os.listdir(self._evidence_dir))
            if not files:
                return
            # Extract unique timestamp prefixes
            prefixes: list[str] = []
            seen: set[str] = set()
            for f in files:
                prefix = f.split("_")[0]
                if prefix not in seen:
                    seen.add(prefix)
                    prefixes.append(prefix)
            # Remove oldest groups if over limit
            while len(prefixes) > self.MAX_EVIDENCE_DIRS:
                old_prefix = prefixes.pop(0)
                for f in files:
                    if f.startswith(old_prefix):
                        try:
                            os.remove(os.path.join(self._evidence_dir, f))
                        except OSError:
                            pass
        except OSError:
            pass

    def _save_evidence_frame(self, annotated_frame, timestamp: int, elapsed: float, is_final: bool = False) -> None:
        """Save an annotated frame as JPEG evidence and record its SHA-256 hash."""
        if is_final:
            filename = f"{timestamp}_final.jpg"
        else:
            filename = f"{timestamp}_{int(elapsed)}s.jpg"

        filepath = os.path.join(self._evidence_dir, filename)
        rel_path = f"evidence/{filename}"

        success, jpeg_buf = cv2.imencode(
            '.jpg', annotated_frame,
            [cv2.IMWRITE_JPEG_QUALITY, self.EVIDENCE_JPEG_QUALITY]
        )
        if not success:
            print(f"[Evidence] Failed to encode frame: {rel_path}")
            return

        jpeg_bytes = jpeg_buf.tobytes()

        # Write file
        with open(filepath, 'wb') as f:
            f.write(jpeg_bytes)

        # Compute SHA-256
        sha = hashlib.sha256(jpeg_bytes).hexdigest()
        frame_hash = f"sha256:{sha}"

        if is_final:
            self._evidence_final = rel_path
        else:
            self._evidence_frames.append(rel_path)

        self._evidence_hashes.append(frame_hash)
        print(f"[Evidence] Saved {rel_path} ({len(jpeg_bytes)} bytes, {frame_hash[:20]}...)")

    async def process_video(self):
        """Main video processing loop — runs FOREVER.

        Streams video continuously via ffmpeg subprocess pipe (rawvideo BGR24).
        Counting controlled by _round_active flag via WS messages.
        """
        direct_url = get_stream_url(self.stream_url)

        # ── Probe stream dimensions + fps via ffprobe ─────────────────
        probe_headers = []
        if self._referer:
            probe_headers = ["-headers", f"Referer: {self._referer}\r\n"]
            print(f"[Stream] Referer: {self._referer}")

        print(f"\n[Stream] Probing stream...")
        try:
            probe_cmd = [
                "ffprobe", "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=width,height,r_frame_rate",
                "-of", "csv=p=0",
                *probe_headers,
                direct_url,
            ]
            probe_out = subprocess.check_output(probe_cmd, timeout=60).decode().strip()
            # Multiple video streams possible — take the first non-empty line
            first_line = next((ln.strip() for ln in probe_out.splitlines() if ln.strip()), "")
            parts = first_line.split(",")
            frame_w, frame_h = int(parts[0]), int(parts[1])
            # r_frame_rate is e.g. "30000/1001" or "30/1"
            num, den = parts[2].split("/")
            native_fps = float(num) / float(den) if float(den) > 0 else 30.0
        except Exception as e:
            print(f"[ERROR] ffprobe failed: {e}")
            return

        print(f"[Stream] {frame_w}x{frame_h} @ {native_fps:.1f}fps")

        frame_bytes = frame_w * frame_h * 3  # BGR24

        # ── Spawn ffmpeg subprocess (rawvideo pipe) ────────────────────
        # No low-latency flags — they cause H.264 decode artifacts (discardcorrupt
        # drops ref frames, nobuffer/low_delay forces partial decode).
        # ffmpeg internal buffer already keeps latency reasonable.
        ffmpeg_cmd = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel", "warning",
            "-reconnect", "1",
            "-reconnect_streamed", "1",
            "-reconnect_delay_max", "5",
            *probe_headers,
            "-i", direct_url,
            "-f", "rawvideo",
            "-pix_fmt", "bgr24",
            "-an", "-sn",
            "pipe:1",
        ]
        ff_proc = subprocess.Popen(
            ffmpeg_cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=frame_bytes * 8,
        )
        print(f"[Stream] ffmpeg spawned (PID {ff_proc.pid})")
        print(f"[STATE] idle — waiting for round")

        self.running = True
        frame_idx = 0
        # Throttle target = native HLS fps (prevents fast-forward with fast models)
        frame_interval = 1.0 / native_fps
        print(f"[Stream] Throttle target: {native_fps:.1f} fps")
        server_start = time.time()

        # Reader thread — reads raw bytes from ffmpeg stdout, pushes numpy frames
        import threading
        import queue as _queue
        _frame_q = _queue.Queue(maxsize=2)
        _reader_alive = [True]
        _proc_holder = [ff_proc]
        _last_frame_time = [time.time()]

        def _reader():
            while _reader_alive[0]:
                p = _proc_holder[0]
                if p is None or p.poll() is not None:
                    print("[Reader] ffmpeg process dead, stopping reader")
                    break
                try:
                    raw = p.stdout.read(frame_bytes)
                except Exception as e:
                    print(f"[Reader] read error: {e}")
                    time.sleep(0.5)
                    continue
                if not raw or len(raw) != frame_bytes:
                    if _reader_alive[0]:
                        print(f"[Reader] short read ({len(raw) if raw else 0}/{frame_bytes}) — ffmpeg stopped")
                    break
                # Copy because np.frombuffer returns readonly, and OpenCV draw ops need writable
                f = np.frombuffer(raw, dtype=np.uint8).reshape(frame_h, frame_w, 3).copy()
                _last_frame_time[0] = time.time()
                try:
                    _frame_q.put(f, timeout=1)
                except _queue.Full:
                    pass

        def _stderr_drain():
            """Consume ffmpeg stderr to prevent pipe buffer blocking."""
            p = _proc_holder[0]
            if p is None or p.stderr is None:
                return
            try:
                for line in iter(p.stderr.readline, b""):
                    if not _reader_alive[0]:
                        break
                    msg = line.decode(errors="replace").rstrip()
                    if msg:
                        print(f"[ffmpeg] {msg}")
            except Exception:
                pass

        threading.Thread(target=_reader, daemon=True).start()
        threading.Thread(target=_stderr_drain, daemon=True).start()

        try:
            while self.running:
                frame_start = time.time()

                # ── Reader healthcheck: detect dead ffmpeg / stalled reader ──
                # If the reader hasn't produced a frame in STALL_LIMIT seconds,
                # something is wedged (ffmpeg died, broadcast deadlock, GPU
                # hang). Exit cleanly — start.sh auto-respawns in 3s.
                STALL_LIMIT = 8.0
                since_frame = frame_start - _last_frame_time[0]
                if since_frame > STALL_LIMIT:
                    print(f"[HEALTHCHECK] No frame for {since_frame:.1f}s — exiting for auto-respawn", flush=True)
                    sys.exit(1)

                # ── Betting → Counting transition ────────────────────
                # Betting window closes but counter KEEPS its cumulative count.
                # The count players saw climbing during betting continues into
                # the counting phase — no reset, no discontinuity.
                if self._round_active and self._state == self.STATE_BETTING:
                    betting_elapsed = frame_start - self._betting_start_time
                    if betting_elapsed >= self._betting_duration:
                        self._state = self.STATE_COUNTING
                        self._counting_start_time = time.time()
                        # counter preserved — running count continues into counting phase
                        print(f"[STATE] counting — market={self._round_market[:10]}... duration={self._round_duration}s round={self._round_id}")

                # ── Check counting window expiry ─────────────────────
                if self._round_active and self._state == self.STATE_COUNTING:
                    counting_elapsed = frame_start - self._counting_start_time
                    if counting_elapsed >= self._round_duration:
                        # Round complete — stop counting, write result
                        result = self._stop_round()
                        # Broadcast final + round_complete to all clients
                        if result:
                            await self._broadcast_json({
                                "type": "final",
                                "count": result["count"],
                                "in_count": result.get("in_count", 0),
                                "out_count": result.get("out_count", 0),
                                "duration": result["duration"],
                                "marketAddress": result.get("marketAddress", ""),
                            })
                            await self._broadcast_json({
                                "type": "round_complete",
                                **result,
                            })

                # ── Get frame ────────────────────────────────────────
                try:
                    frame = _frame_q.get_nowait()
                except _queue.Empty:
                    await asyncio.sleep(0.02)
                    continue

                frame_idx += 1

                # Resize
                h, w = frame.shape[:2]
                if w > OUTPUT_WIDTH:
                    scale = OUTPUT_WIDTH / w
                    frame = cv2.resize(frame, (OUTPUT_WIDTH, int(h * scale)),
                                      interpolation=cv2.INTER_LINEAR)

                # ── Process with YOLO (always during round) ──────────────
                # Counter runs continuously through betting + counting phases.
                # Players watch the count climb live while placing bets — the
                # final on-chain count is cumulative over the whole round.
                annotated, count = self.counter.process_frame(frame)

                # Debug overlay
                uptime = frame_start - server_start
                fps_actual = frame_idx / max(uptime, 0.1)
                state_tag = self._state.upper()
                if self._round_active and self._state == self.STATE_BETTING:
                    re = round(time.time() - self._betting_start_time, 1)
                    dbg = f"{state_tag} seq:{frame_idx} fps:{fps_actual:.1f} round:{self._round_id} {re}s"
                elif self._round_active:
                    re = round(time.time() - self._round_start_time, 1)
                    dbg = f"{state_tag} seq:{frame_idx} fps:{fps_actual:.1f} round:{self._round_id} {re}s"
                else:
                    dbg = f"{state_tag} seq:{frame_idx} fps:{fps_actual:.1f}"
                h_ann, w_ann = annotated.shape[:2]
                cv2.putText(annotated, dbg, (w_ann - 420, h_ann - 8),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 255, 136), 1)

                # Encode JPEG
                _, jpeg = cv2.imencode('.jpg', annotated, [cv2.IMWRITE_JPEG_QUALITY, 65])
                jpeg_bytes = jpeg.tobytes()

                # ── Broadcast based on state ─────────────────────────
                if self._round_active and self._state == self.STATE_BETTING:
                    betting_elapsed = time.time() - self._betting_start_time
                    msg = json.dumps({
                        "type": "count",
                        "state": "betting_open",
                        "count": count,  # live running count — visible to bettors
                        "count_in": self.counter.count_in,
                        "count_out": self.counter.count_out,
                        "elapsed": round(betting_elapsed, 1),
                        "remaining": max(0, round(self._betting_duration - betting_elapsed, 1)),
                        "marketAddress": self._round_market,
                        "cameraId": self.camera_id,
                        "roundId": self._round_id,
                    })
                elif self._round_active and self._state == self.STATE_COUNTING:
                    counting_elapsed = time.time() - self._counting_start_time
                    msg = json.dumps({
                        "type": "count",
                        "state": "counting",
                        "count": count,
                        "count_in": self.counter.count_in,
                        "count_out": self.counter.count_out,
                        "elapsed": round(counting_elapsed, 1),
                        "remaining": max(0, round(self._round_duration - counting_elapsed, 1)),
                        "marketAddress": self._round_market,
                        "cameraId": self.camera_id,
                        "roundId": self._round_id,
                    })
                else:
                    msg = json.dumps({
                        "type": "idle",
                        "state": "waiting",
                        "cameraId": self.camera_id,
                    })

                await self._broadcast(msg, jpeg_bytes)

                # Throttle to target_fps — yolo12s is fast enough to outrun HLS source
                _frame_elapsed = time.time() - frame_start
                if _frame_elapsed < frame_interval:
                    await asyncio.sleep(frame_interval - _frame_elapsed)

                # ── Evidence capture (during full active round) ──────
                if self._round_active:
                    round_elapsed = time.time() - self._round_start_time
                    round_ts = int(self._round_start_time)
                    total_round_len = self._betting_duration + self._round_duration
                    if round_elapsed - self._last_evidence_time >= self.EVIDENCE_INTERVAL:
                        self._save_evidence_frame(annotated, round_ts, round_elapsed)
                        self._last_evidence_time = round_elapsed
                    if total_round_len - round_elapsed < frame_interval * 2:
                        self._save_evidence_frame(annotated, round_ts, round_elapsed, is_final=True)

                # Yield to event loop
                await asyncio.sleep(0)

        except Exception as e:
            print(f"\n[ERROR] {e}")
            import traceback
            traceback.print_exc()
        finally:
            _reader_alive[0] = False
            if _proc_holder[0] is not None:
                try:
                    _proc_holder[0].terminate()
                    _proc_holder[0].wait(timeout=3)
                except subprocess.TimeoutExpired:
                    _proc_holder[0].kill()
                except Exception:
                    pass
            self.running = False

    async def handler(self, ws):
        accepted = await self.register(ws)
        if accepted is False:
            return
        try:
            async for msg in ws:
                try:
                    data = json.loads(msg)
                    msg_type = data.get("type")

                    if msg_type == "ping":
                        await ws.send(json.dumps({"type": "pong"}))

                    elif msg_type == "start_round":
                        self._start_round(data)
                        await ws.send(json.dumps({"type": "round_started", "roundId": self._round_id}))

                    elif msg_type == "stop_round":
                        result = self._stop_round()
                        if result:
                            await ws.send(json.dumps({"type": "round_complete", **result}))
                            await self._broadcast_json({
                                "type": "final",
                                "count": result["count"],
                                "in_count": result.get("in_count", 0),
                                "out_count": result.get("out_count", 0),
                                "duration": result["duration"],
                                "marketAddress": result.get("marketAddress", ""),
                            })
                        else:
                            await ws.send(json.dumps({"type": "error", "message": "no active round"}))

                    elif msg_type == "get_state":
                        await ws.send(json.dumps({
                            "type": "state",
                            "state": self._state,
                            "roundActive": self._round_active,
                            "roundId": self._round_id,
                            "marketAddress": self._round_market,
                            "count": self.counter.total_count,
                        }))

                except Exception:
                    pass
        finally:
            await self.unregister(ws)

    async def start(self):
        print(f"\n{'='*55}")
        print(f"  SinalBet Live Oracle Server (v4 — Persistent)")
        print(f"  WebSocket: ws://{self.host}:{self.port}")
        print(f"  Stream: {self.stream_url}")
        print(f"  Camera: {self.camera_id}")
        print(f"  Model: {self.counter.model.model_name}")
        print(f"  Mode: persistent (rounds via WS control)")
        print(f"  Target FPS: {self.target_fps}")
        print(f"{'='*55}\n")

        async with websockets.serve(self.handler, self.host, self.port):
            await self.process_video()


def load_camera(camera_id):
    from pathlib import Path
    cameras_path = Path(__file__).parent / "cameras.json"
    with open(cameras_path) as f:
        data = json.load(f)
    for cam in data["cameras"]:
        if cam["id"] == camera_id:
            # If camera has a _tokenApi (for signed URLs that expire), refresh
            # the streamUrl by hitting the token endpoint.
            token_api = cam.get("_tokenApi")
            if token_api:
                try:
                    import urllib.request
                    with urllib.request.urlopen(token_api, timeout=10) as r:
                        fresh_url = r.read().decode().strip()
                    if fresh_url.startswith("http"):
                        print(f"[Camera] Refreshed signed URL via _tokenApi")
                        cam["streamUrl"] = fresh_url
                    else:
                        print(f"[WARN] _tokenApi returned non-URL: {fresh_url[:80]}")
                except Exception as e:
                    print(f"[WARN] Could not refresh token: {e}")
            return cam
    print(f"[ERROR] Camera '{camera_id}' not found")
    sys.exit(1)


def _kill_port(port: int):
    """Kill any process holding the port so we never get 'address already in use'."""
    import signal as _sig
    try:
        result = subprocess.run(['lsof', '-ti', f':{port}'], capture_output=True, text=True)
        for pid in result.stdout.strip().split('\n'):
            if pid.strip():
                try:
                    os.kill(int(pid.strip()), _sig.SIGKILL)
                    print(f"[Startup] Killed stale process {pid.strip()} on port {port}")
                except (ProcessLookupError, ValueError):
                    pass
        if result.stdout.strip():
            time.sleep(1)
    except FileNotFoundError:
        pass  # lsof not available


def main():
    parser = argparse.ArgumentParser(description='SinalBet Live Oracle Server (v4 — Persistent)')
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--stream', '-s', help='Direct stream URL (HLS, RTSP, YouTube)')
    group.add_argument('--camera', help='Camera ID from cameras.json')
    parser.add_argument('--port', '-p', type=int, default=8765, help='WebSocket port')
    parser.add_argument('--model', '-m', default='yolo12s.pt',
                       help='YOLO model (yolo12s=default, yolov8n/s/x available)')
    parser.add_argument('--confidence', '-c', type=float, default=0.15, help='Detection confidence')
    parser.add_argument('--line', '-l', type=float, default=0.5, help='Counting line position (0-1)')
    parser.add_argument('--angle', '-a', type=float, default=10, help='Line tilt in degrees')
    parser.add_argument('--line-points', type=str, default=None,
                       help='Line 1 as "x1,y1,x2,y2" fractions')
    parser.add_argument('--line-points2', type=str, default=None,
                       help='Line 2 (optional) as "x1,y1,x2,y2" fractions')
    parser.add_argument('--mode', choices=['line', 'uid', 'zones'], default='uid',
                       help='Counting mode: line=crossing, uid=unique IDs (default: uid)')
    parser.add_argument('--fps', type=int, default=8, help='Target output FPS')

    args = parser.parse_args()

    stream_url = args.stream
    cam_lanes = None
    cam_id = ''
    cam_classes = None
    cam_roi = None
    cam_dedup_radius = 120
    cam_dedup_window = 10.0
    cam_line_zones = None
    cam_crossing_threshold = 2
    if args.camera:
        cam = load_camera(args.camera)
        stream_url = cam.get("streamUrl", cam.get("imageUrl"))
        cam_id = cam["id"]
        cam_lanes = cam.get("lanes")
        cam_classes = cam.get("classes")
        cam_roi = cam.get("roi")
        _dedup = cam.get("dedup") or {}
        cam_dedup_radius = int(_dedup.get("radius", 120))
        cam_dedup_window = float(_dedup.get("window", 10.0))
        cam_line_zones = cam.get("lines")  # list of "x1,y1,x2,y2" strings
        if cam_line_zones:
            args.mode = "zones"
        cam_crossing_threshold = int(cam.get("crossingThreshold", 2))
        # Per-camera confidence override
        if cam.get("confidence") is not None:
            args.confidence = float(cam["confidence"])
            print(f"[Camera] Confidence override: {args.confidence}")
        if not args.line_points and cam.get("linePoints"):
            args.line_points = cam["linePoints"]
            args.mode = "line"
            print(f"[Camera] Line from config: {args.line_points}")
        if not args.line_points2 and cam.get("linePoints2"):
            args.line_points2 = cam["linePoints2"]
            print(f"[Camera] Line 2 from config: {args.line_points2}")
        print(f"[Camera] {cam['name']} ({cam.get('source','')}) — {cam['type'].upper()}")
        if cam_lanes:
            print(f"[Camera] {len(cam_lanes)} lanes configured")
        if cam_classes:
            label = ','.join(COCO_NAMES.get(c, str(c)) for c in cam_classes)
            print(f"[Camera] Classes override: {cam_classes} ({label})")
        if cam_roi:
            # Count polygons (supports single or multi-polygon format)
            n_polys = len(cam_roi) if (cam_roi and isinstance(cam_roi[0], list) and cam_roi[0] and isinstance(cam_roi[0][0], list)) else 1
            print(f"[Camera] ROI mask: {n_polys} polygon(s)")
        if cam.get("dedup"):
            print(f"[Camera] Dedup override: radius={cam_dedup_radius}px window={cam_dedup_window}s")
        if cam_line_zones:
            print(f"[Camera] Line zones: {len(cam_line_zones)} (canonical sv.LineZone, threshold={cam_crossing_threshold})")

    _kill_port(args.port)

    cam_referer = cam.get("referer") if args.camera else None
    server = StreamServer(
        stream_url=stream_url,
        port=args.port,
        model=args.model,
        confidence=args.confidence,
        line_pos=args.line,
        line_angle=args.angle,
        line_points=args.line_points,
        line_points2=args.line_points2,
        count_mode=args.mode,
        lanes=cam_lanes,
        target_fps=args.fps,
        camera_id=cam_id,
        referer=cam_referer,
        classes=cam_classes,
        roi=cam_roi,
        dedup_radius=cam_dedup_radius,
        dedup_window=cam_dedup_window,
        line_zones=cam_line_zones,
        crossing_threshold=cam_crossing_threshold,
    )

    try:
        asyncio.run(server.start())
    except KeyboardInterrupt:
        print("\n[Server] Shutting down...")


if __name__ == '__main__':
    main()
