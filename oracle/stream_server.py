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


# Vehicle classes in COCO dataset
VEHICLE_CLASSES = [2, 3, 5, 7]  # car, motorcycle, bus, truck
VEHICLE_NAMES = {2: 'car', 3: 'moto', 5: 'bus', 7: 'truck'}

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
                 count_mode='line', min_frames=5, lanes=None, **_kwargs):
        self.count_mode = count_mode
        self.min_frames = min_frames
        self.seen_frames = {}
        self.lanes_config = lanes  # list of lane dicts from cameras.json
        self.lanes = []            # processed lanes (set on first frame)
        self.lanes_ready = False
        self.model = YOLO(model_name)
        self.confidence = confidence
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

        # Anti-double-count: recent crossing positions with timestamps
        # If a new ID crosses within DEDUP_RADIUS pixels of a recent crossing, skip it
        self._recent_crossings: list[tuple[int, int, float]] = []  # (cx, cy, time)
        self.DEDUP_RADIUS = 60     # pixels — must be far enough from recent crossing
        self.DEDUP_WINDOW = 3.0    # seconds — how long to remember a crossing

        # Per-class counts
        self.class_counts = {2: 0, 3: 0, 5: 0, 7: 0}

        # Line endpoints (set on first frame)
        self.line_start = None    # (x, y) top point
        self.line_end = None      # (x, y) bottom point

        # Annotators
        self.trace_annotator = sv.TraceAnnotator(
            thickness=1, trace_length=20,
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
            classes=VEHICLE_CLASSES, persist=True,
            tracker="botsort_custom.yaml", imgsz=1280, device=0
        )[0]

        detections = sv.Detections.from_ultralytics(results)

        if detections.class_id is not None and len(detections) > 0:
            mask = np.isin(detections.class_id, VEHICLE_CLASSES)
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

                    self.seen_frames[tid] = self.seen_frames.get(tid, 0) + 1

                    # Track position history for direction validation
                    if tid not in self.prev_pos:
                        self.prev_pos[tid] = (anchor_x, anchor_y)

                    if tid not in self.counted_ids and self.seen_frames[tid] >= self.min_frames:
                        # Check that the vehicle actually moved (not a parked/phantom detection)
                        first_pos = self.prev_pos[tid]
                        dx = abs(anchor_x - first_pos[0])
                        dy = abs(anchor_y - first_pos[1])
                        if dx + dy >= 15 and not self._is_duplicate_crossing(anchor_x, anchor_y):
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
    STATE_COUNTING = "counting"

    def __init__(self, stream_url, host='0.0.0.0', port=8765,
                 model='yolov8x.pt', confidence=0.10, line_pos=0.5,
                 line_angle=10, line_points=None, line_points2=None,
                 count_mode='uid', lanes=None, target_fps=8, camera_id='',
                 roi=None, **kwargs):
        self.stream_url = stream_url
        self.host = host
        self.port = port
        self.target_fps = target_fps
        self.camera_id = camera_id
        self._roi_polygons = roi  # list of polygons (fractions 0-1), applied on first frame
        self._roi_mask = None     # numpy mask, created once per resolution

        # YOLO config — stored for creating fresh counters per round
        self._model_name = model
        self._confidence = confidence
        self._line_pos = line_pos
        self._line_angle = line_angle
        self._line_points = line_points
        self._line_points2 = line_points2
        self._count_mode = count_mode
        self._lanes = lanes

        # Create initial counter (for YOLO model loading + visual annotations in IDLE)
        self.counter = VehicleCounter(model_name=model, confidence=confidence,
                                       line_position=line_pos, line_angle=line_angle,
                                       line_points=line_points,
                                       line_points2=line_points2,
                                       count_mode=count_mode, lanes=lanes,
                                       min_frames=3)
        self.clients = set()
        self.running = False

        # Round state — controlled by WS messages
        self._state = self.STATE_IDLE
        self._round_active = False
        self._round_start_time = 0.0
        self._round_duration = 300
        self._round_market = ''
        self._round_id = 0

        # Evidence
        self._init_evidence()

    def _build_roi_mask(self, h, w):
        """Create binary mask from ROI polygons. Called once on first frame."""
        if not self._roi_polygons:
            return None
        mask = np.zeros((h, w), dtype=np.uint8)
        # Detect format: [[x,y],...] (single polygon) vs [[[x,y],...]] (multiple)
        roi = self._roi_polygons
        if roi and isinstance(roi[0], (int, float)):
            # Flat list — shouldn't happen but handle it
            roi = [roi]
        elif roi and isinstance(roi[0], list) and isinstance(roi[0][0], (int, float)):
            # Single polygon: [[x,y],[x,y],...] — wrap in list
            roi = [roi]
        # Now roi is [[[x,y],...], ...] — list of polygons
        for poly in roi:
            pts = np.array([[int(p[0] * w), int(p[1] * h)] for p in poly], dtype=np.int32)
            cv2.fillPoly(mask, [pts], 255)
        # Convert to 3-channel mask for bitwise_and
        self._roi_mask = cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR)
        print(f"[ROI] Mask created: {w}x{h}, {len(self._roi_polygons)} polygon(s)")
        return self._roi_mask

    def apply_roi(self, frame):
        """Mask frame to ROI — pixels outside become black (YOLO ignores them)."""
        if self._roi_polygons is None:
            return frame
        if self._roi_mask is None or self._roi_mask.shape[:2] != frame.shape[:2]:
            self._build_roi_mask(frame.shape[0], frame.shape[1])
        if self._roi_mask is not None:
            return cv2.bitwise_and(frame, self._roi_mask)
        return frame

    def _init_evidence(self):
        """Called from __init__ — separated to avoid dead code after return."""
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
                           count_mode=self._count_mode, lanes=self._lanes, min_frames=3)
        c.model = self.counter.model  # reuse loaded model — no GPU reload
        return c

    def _start_round(self, data):
        """Begin a new counting round. All state is clean."""
        self._round_market = data.get("marketAddress", "")
        self._round_duration = data.get("duration", 300)
        self._round_id = data.get("roundId", 0)
        self._round_start_time = time.time()
        self._round_active = True
        self._state = self.STATE_COUNTING
        # Fresh counter — zero carryover
        self.counter = self._new_counter()
        # Fresh evidence
        self._evidence_frames = []
        self._evidence_hashes = []
        self._evidence_final = None
        self._last_evidence_time = 0.0
        self._ensure_evidence_dir()
        print(f"[STATE] counting — market={self._round_market[:10]}... duration={self._round_duration}s round={self._round_id}")

    def _stop_round(self):
        """End current round. Write result, broadcast final, go IDLE."""
        if not self._round_active:
            return None
        count = self.counter.total_count
        result = {
            "count": count,
            "in_count": self.counter.class_counts.get(2, 0),
            "out_count": self.counter.class_counts.get(7, 0),
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
        """Send JSON + binary frame to all connected clients. Timeout per client."""
        if not self.clients:
            return
        dead = set()
        async def send_to(ws):
            try:
                await asyncio.wait_for(ws.send(json_msg), timeout=2)
                await asyncio.wait_for(ws.send(jpeg_bytes), timeout=2)
            except (websockets.exceptions.ConnectionClosed, asyncio.TimeoutError):
                dead.add(ws)
        await asyncio.gather(*(send_to(ws) for ws in self.clients))
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

        Streams video continuously. Counting controlled by _round_active flag
        which is set by start_round/stop_round WS messages from round_manager.
        """
        direct_url = get_stream_url(self.stream_url)

        print(f"\n[Stream] Opening video...")
        cap = cv2.VideoCapture(direct_url)

        if not cap.isOpened():
            print("[ERROR] Could not open video stream!")
            return

        fps = cap.get(cv2.CAP_PROP_FPS) or 30

        print(f"[Stream] Opened. FPS: {fps:.0f}")
        print(f"[Stream] Output width: {OUTPUT_WIDTH}px")
        print(f"[STATE] idle — waiting for round")

        self.running = True
        frame_idx = 0
        frame_interval = 1.0 / self.target_fps
        server_start = time.time()

        # Reader thread — prevents cap.read() from blocking event loop
        import threading
        import queue as _queue
        _frame_q = _queue.Queue(maxsize=60)
        _reader_alive = [True]
        _cap_holder = [cap]
        _last_frame_time = [time.time()]

        def _reader():
            while _reader_alive[0]:
                c = _cap_holder[0]
                if c is None or not c.isOpened():
                    print("[Reader] Reconnecting...")
                    try:
                        if c is not None:
                            c.release()
                        new_url = get_stream_url(self.stream_url)
                        _cap_holder[0] = cv2.VideoCapture(new_url)
                        _last_frame_time[0] = time.time()
                        print("[Reader] Reconnected")
                    except Exception as e:
                        print(f"[Reader] Error: {e}")
                        time.sleep(2)
                    continue

                ret, f = c.read()
                if ret and f is not None:
                    _last_frame_time[0] = time.time()
                    try:
                        _frame_q.put(f, timeout=1)
                    except _queue.Full:
                        pass
                else:
                    if time.time() - _last_frame_time[0] > 10:
                        print("[Reader] No frames 10s — forcing reconnect")
                        try:
                            c.release()
                        except Exception:
                            pass
                        _cap_holder[0] = None
                    else:
                        time.sleep(0.02)

        threading.Thread(target=_reader, daemon=True).start()

        try:
            while self.running:
                frame_start = time.time()

                # ── Check round duration expiry ──────────────────────
                if self._round_active:
                    round_elapsed = frame_start - self._round_start_time
                    if round_elapsed >= self._round_duration:
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

                # ── Get LATEST frame (drain queue, skip old) ────────
                frame = None
                try:
                    while not _frame_q.empty():
                        frame = _frame_q.get_nowait()
                except _queue.Empty:
                    pass
                if frame is None:
                    await asyncio.sleep(0.02)
                    continue

                frame_idx += 1

                # Resize
                h, w = frame.shape[:2]
                if w > OUTPUT_WIDTH:
                    scale = OUTPUT_WIDTH / w
                    frame = cv2.resize(frame, (OUTPUT_WIDTH, int(h * scale)),
                                      interpolation=cv2.INTER_LINEAR)

                # ── Apply ROI mask (black out non-detection areas) ──
                yolo_frame = self.apply_roi(frame)

                # ── Process with YOLO (always — for visual annotations) ──
                annotated, count = self.counter.process_frame(yolo_frame)

                # Debug overlay
                uptime = frame_start - server_start
                fps_actual = frame_idx / max(uptime, 0.1)
                state_tag = self._state.upper()
                if self._round_active:
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
                if self._round_active:
                    round_elapsed = time.time() - self._round_start_time
                    msg = json.dumps({
                        "type": "count",
                        "state": "counting",
                        "count": count,
                        "count_in": self.counter.count_in,
                        "count_out": self.counter.count_out,
                        "elapsed": round(round_elapsed, 1),
                        "remaining": max(0, round(self._round_duration - round_elapsed, 1)),
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

                # ── Evidence capture (only during round) ─────────────
                if self._round_active:
                    round_elapsed = time.time() - self._round_start_time
                    round_ts = int(self._round_start_time)
                    if round_elapsed - self._last_evidence_time >= self.EVIDENCE_INTERVAL:
                        self._save_evidence_frame(annotated, round_ts, round_elapsed)
                        self._last_evidence_time = round_elapsed
                    if self._round_duration - round_elapsed < frame_interval * 2:
                        self._save_evidence_frame(annotated, round_ts, round_elapsed, is_final=True)

                # Yield to event loop
                await asyncio.sleep(0)

        except Exception as e:
            print(f"\n[ERROR] {e}")
            import traceback
            traceback.print_exc()
        finally:
            _reader_alive[0] = False
            if _cap_holder[0] is not None:
                _cap_holder[0].release()
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
    parser.add_argument('--model', '-m', default='yolov8x.pt',
                       help='YOLO model (yolov8n=fast, yolov8s=balanced, yolov8x=best)')
    parser.add_argument('--confidence', '-c', type=float, default=0.15, help='Detection confidence')
    parser.add_argument('--line', '-l', type=float, default=0.5, help='Counting line position (0-1)')
    parser.add_argument('--angle', '-a', type=float, default=10, help='Line tilt in degrees')
    parser.add_argument('--line-points', type=str, default=None,
                       help='Line 1 as "x1,y1,x2,y2" fractions')
    parser.add_argument('--line-points2', type=str, default=None,
                       help='Line 2 (optional) as "x1,y1,x2,y2" fractions')
    parser.add_argument('--mode', choices=['line', 'uid'], default='uid',
                       help='Counting mode: line=crossing, uid=unique IDs (default: uid)')
    parser.add_argument('--fps', type=int, default=8, help='Target output FPS')

    args = parser.parse_args()

    stream_url = args.stream
    cam_lanes = None
    cam_id = ''
    if args.camera:
        cam = load_camera(args.camera)
        stream_url = cam.get("streamUrl", cam.get("imageUrl"))
        cam_id = cam["id"]
        cam_lanes = cam.get("lanes")
        if not args.line_points and cam.get("linePoints"):
            args.line_points = cam["linePoints"]
            args.mode = "line"
            print(f"[Camera] Line from config: {args.line_points}")
        if not args.line_points2 and cam.get("linePoints2"):
            args.line_points2 = cam["linePoints2"]
            print(f"[Camera] Line 2 from config: {args.line_points2}")
        cam_roi = cam.get("roi")
        if cam_roi:
            print(f"[Camera] ROI mask: {len(cam_roi)} polygon(s)")
        print(f"[Camera] {cam['name']} ({cam.get('source','')}) — {cam['type'].upper()}")
        if cam_lanes:
            print(f"[Camera] {len(cam_lanes)} lanes configured")

    _kill_port(args.port)

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
        roi=cam_roi if args.camera else None,
    )

    try:
        asyncio.run(server.start())
    except KeyboardInterrupt:
        print("\n[Server] Shutting down...")


if __name__ == '__main__':
    main()
