"""
SinalBet Oracle — YOLO Car Counter
Counts vehicles passing through a region of interest in a live video stream.

Supports:
  - HLS streams (.m3u8) — Caltrans, etc.
  - JPEG polling — DER-SP cameras (refreshes every N seconds)
  - YouTube Live — via yt-dlp
  - Camera ID from cameras.json

Usage:
    python counter.py --stream "https://wzmedia.dot.ca.gov/D7/CCTV-100.stream/playlist.m3u8" --duration 300
    python counter.py --camera caltrans-100 --duration 300
    python counter.py --stream "https://youtube.com/watch?v=xxx" --duration 300

Requirements (install via pip):
    pip install -r requirements.txt
"""

import argparse
import sys
import time
import json
import subprocess
import threading
from pathlib import Path

try:
    import cv2
    import numpy as np
    from ultralytics import YOLO
except ImportError:
    print("ERROR: Missing dependencies. Run: pip install -r requirements.txt")
    sys.exit(1)


# Vehicle classes in COCO dataset
VEHICLE_CLASSES = {2: 'car', 3: 'motorcycle', 5: 'bus', 7: 'truck'}

# Colors for visualization
COLORS = {
    2: (0, 255, 136),   # car - green
    3: (255, 170, 0),   # motorcycle - orange
    5: (0, 170, 255),   # bus - blue
    7: (170, 85, 255),  # truck - purple
}


class CarCounter:
    def __init__(self, stream_url, duration_secs=300, model_name='yolov8n.pt',
                 line_position=0.6, confidence=0.4, show_preview=True):
        """
        Initialize the car counter.
        
        Args:
            stream_url: YouTube or direct video URL
            duration_secs: How long to count (seconds)
            model_name: YOLO model to use
            line_position: Vertical position of counting line (0.0-1.0)
            confidence: Minimum detection confidence
            show_preview: Whether to show a CV2 window preview
        """
        self.stream_url = stream_url
        self.duration = duration_secs
        self.model_name = model_name
        self.line_position = line_position
        self.confidence = confidence
        self.show_preview = show_preview
        
        self.total_count = 0
        self.counted_ids = set()
        self.tracker = {}  # id -> last_y
        self.next_id = 0
        
        print(f"[SinalBet Oracle] Initializing car counter...")
        print(f"  Stream: {stream_url}")
        print(f"  Duration: {duration_secs}s")
        print(f"  Model: {model_name}")
        print(f"  Confidence: {confidence}")
    
    def get_stream_url(self):
        """Extract direct stream URL from YouTube using yt-dlp."""
        print("[yt-dlp] Extracting stream URL...")
        try:
            result = subprocess.run(
                ['yt-dlp', '-f', 'best[height<=720]', '-g', self.stream_url],
                capture_output=True, text=True, timeout=30
            )
            if result.returncode == 0:
                url = result.stdout.strip()
                print(f"[yt-dlp] Got direct URL: {url[:80]}...")
                return url
            else:
                print(f"[yt-dlp] Error: {result.stderr}")
                return self.stream_url
        except Exception as e:
            print(f"[yt-dlp] Failed: {e}")
            return self.stream_url
    
    def simple_track(self, detections, frame_h):
        """Simple centroid-based tracker to avoid double-counting."""
        line_y = int(frame_h * self.line_position)
        new_crossed = 0
        
        current_centroids = []
        for (x1, y1, x2, y2, cls, conf) in detections:
            cx = (x1 + x2) / 2
            cy = (y1 + y2) / 2
            current_centroids.append((cx, cy, cls))
        
        # Match with existing tracks (nearest centroid)
        matched = set()
        for cx, cy, cls in current_centroids:
            best_id = None
            best_dist = 100  # max pixel distance threshold
            
            for tid, (tx, ty, _) in self.tracker.items():
                dist = ((cx - tx)**2 + (cy - ty)**2) ** 0.5
                if dist < best_dist and tid not in matched:
                    best_dist = dist
                    best_id = tid
            
            if best_id is not None:
                # Update existing track
                prev_y = self.tracker[best_id][1]
                self.tracker[best_id] = (cx, cy, cls)
                matched.add(best_id)
                
                # Check line crossing
                if best_id not in self.counted_ids:
                    if (prev_y < line_y and cy >= line_y) or (prev_y > line_y and cy <= line_y):
                        self.counted_ids.add(best_id)
                        self.total_count += 1
                        new_crossed += 1
            else:
                # New track
                self.tracker[self.next_id] = (cx, cy, cls)
                self.next_id += 1
        
        # Remove stale tracks
        stale = [tid for tid in self.tracker if tid not in matched]
        for tid in stale:
            if tid not in self.counted_ids:
                del self.tracker[tid]
        
        return new_crossed
    
    def run(self):
        """Run the car counting pipeline. Returns final count."""
        # Load YOLO
        print(f"[YOLO] Loading model {self.model_name}...")
        model = YOLO(self.model_name)
        
        # Get stream
        direct_url = self.get_stream_url()
        
        print("[OpenCV] Opening video stream...")
        cap = cv2.VideoCapture(direct_url)
        
        if not cap.isOpened():
            print("[ERROR] Could not open video stream!")
            return -1
        
        fps = cap.get(cv2.CAP_PROP_FPS) or 30
        frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        line_y = int(frame_h * self.line_position)
        
        print(f"[OpenCV] Stream opened: {frame_w}x{frame_h} @ {fps:.0f}fps")
        print(f"[Counter] Counting line at y={line_y}")
        print(f"[Counter] Starting {self.duration}s count...\n")
        
        start_time = time.time()
        frame_count = 0
        process_every = max(1, int(fps / 5))  # Process ~5 frames/sec
        
        try:
            while True:
                elapsed = time.time() - start_time
                if elapsed >= self.duration:
                    break
                
                ret, frame = cap.read()
                if not ret:
                    print("[WARN] Frame read failed, retrying...")
                    time.sleep(0.1)
                    continue
                
                frame_count += 1
                
                # Skip frames for performance
                if frame_count % process_every != 0:
                    continue
                
                # Detect vehicles
                results = model(frame, verbose=False, conf=self.confidence,
                              classes=list(VEHICLE_CLASSES.keys()))
                
                detections = []
                for r in results:
                    for box in r.boxes:
                        x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
                        cls = int(box.cls[0])
                        conf = float(box.conf[0])
                        detections.append((x1, y1, x2, y2, cls, conf))
                
                # Track and count
                new_crossed = self.simple_track(detections, frame_h)
                
                # Progress
                remaining = self.duration - elapsed
                progress = f"[{elapsed:.0f}s/{self.duration}s]"
                print(f"\r{progress} 🚗 Total: {self.total_count} | "
                      f"Active tracks: {len(self.tracker)} | "
                      f"Remaining: {remaining:.0f}s   ", end='', flush=True)
                
                # Optional preview
                if self.show_preview:
                    # Draw counting line
                    cv2.line(frame, (0, line_y), (frame_w, line_y), (0, 255, 136), 2)
                    
                    # Draw detections
                    for (x1, y1, x2, y2, cls, conf) in detections:
                        color = COLORS.get(cls, (255, 255, 255))
                        cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), color, 2)
                        label = f"{VEHICLE_CLASSES.get(cls, '?')} {conf:.2f}"
                        cv2.putText(frame, label, (int(x1), int(y1) - 8),
                                  cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
                    
                    # Draw count
                    cv2.putText(frame, f"Count: {self.total_count}", (20, 50),
                              cv2.FONT_HERSHEY_SIMPLEX, 1.5, (0, 255, 136), 3)
                    cv2.putText(frame, f"Time: {elapsed:.0f}s / {self.duration}s", (20, 100),
                              cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
                    
                    cv2.imshow('SinalBet Oracle - Car Counter', frame)
                    if cv2.waitKey(1) & 0xFF == ord('q'):
                        print("\n[USER] Quit requested.")
                        break
        
        except KeyboardInterrupt:
            print("\n[USER] Interrupted.")
        finally:
            cap.release()
            if self.show_preview:
                cv2.destroyAllWindows()
        
        print(f"\n\n{'='*50}")
        print(f"  FINAL COUNT: {self.total_count} vehicles")
        print(f"  Duration: {time.time() - start_time:.1f}s")
        print(f"  Frames processed: {frame_count}")
        print(f"{'='*50}\n")
        
        # Output JSON result
        result = {
            "count": self.total_count,
            "duration": self.duration,
            "stream": self.stream_url,
            "timestamp": int(time.time())
        }
        
        result_path = Path(__file__).parent / "result.json"
        with open(result_path, 'w') as f:
            json.dump(result, f, indent=2)
        print(f"[Oracle] Result saved to {result_path}")
        
        return self.total_count


def load_camera(camera_id):
    """Load camera config from cameras.json by ID."""
    cameras_path = Path(__file__).parent / "cameras.json"
    if not cameras_path.exists():
        print(f"[ERROR] cameras.json not found at {cameras_path}")
        sys.exit(1)

    with open(cameras_path) as f:
        data = json.load(f)

    for cam in data["cameras"]:
        if cam["id"] == camera_id:
            return cam

    print(f"[ERROR] Camera '{camera_id}' not found. Available:")
    for cam in data["cameras"]:
        print(f"  {cam['id']:25s} | {cam['name']} ({cam['source']})")
    sys.exit(1)


def list_cameras():
    """Print all available cameras."""
    cameras_path = Path(__file__).parent / "cameras.json"
    with open(cameras_path) as f:
        data = json.load(f)

    print("\nAvailable cameras:\n")
    for cam in data["cameras"]:
        stream_type = cam["type"].upper()
        url = cam.get("streamUrl", cam.get("imageUrl", ""))
        print(f"  {cam['id']:25s} | {stream_type:4s} | {cam['name']}")
        print(f"  {'':25s} | {cam['region']} — {cam['source']}")
        print(f"  {'':25s} | {url}")
        print()


def main():
    parser = argparse.ArgumentParser(description='SinalBet Oracle — YOLO Car Counter')
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--stream', '-s', help='Direct stream URL (HLS m3u8, RTSP, YouTube)')
    group.add_argument('--camera', help='Camera ID from cameras.json')
    group.add_argument('--list-cameras', action='store_true', help='List available cameras')
    parser.add_argument('--duration', '-d', type=int, default=300, help='Count duration (seconds)')
    parser.add_argument('--model', '-m', default='yolov8s.pt', help='YOLO model (n=fast, s=balanced, x=best)')
    parser.add_argument('--confidence', '-c', type=float, default=0.25, help='Detection confidence')
    parser.add_argument('--line', '-l', type=float, default=0.6, help='Counting line position (0-1)')
    parser.add_argument('--no-preview', action='store_true', help='Disable CV2 preview window')

    args = parser.parse_args()

    if args.list_cameras:
        list_cameras()
        return 0

    stream_url = args.stream
    if args.camera:
        cam = load_camera(args.camera)
        if cam["type"] == "hls":
            stream_url = cam["streamUrl"]
            print(f"[Camera] {cam['name']} ({cam['source']})")
            print(f"[Camera] HLS: {stream_url}")
        elif cam["type"] == "jpeg":
            # For JPEG cameras, OpenCV can still open the URL
            # It will get a single frame — we poll in the run loop
            stream_url = cam["imageUrl"]
            print(f"[Camera] {cam['name']} ({cam['source']})")
            print(f"[Camera] JPEG polling every {cam.get('refreshInterval', 20)}s")

    counter = CarCounter(
        stream_url=stream_url,
        duration_secs=args.duration,
        model_name=args.model,
        line_position=args.line,
        confidence=args.confidence,
        show_preview=not args.no_preview
    )

    count = counter.run()
    print(f"\nFinal count to publish on-chain: {count}")
    return count


if __name__ == '__main__':
    main()
