#!/usr/bin/env python3
"""
Timing Validator — measures end-to-end latency:
  backend detection ts → WS delivery → frontend receive → beep schedule

Approach:
  1. Connect to backend WS (port 9000) — capture vehicle_counted with ts
  2. Simultaneously, run puppeteer to capture frontend console.log [TIMING] lines
  3. Cross-reference by count number to compute latencies
"""

import asyncio
import json
import subprocess
import sys
import time

try:
    import websockets
except ImportError:
    print("pip install websockets")
    sys.exit(1)


async def capture_backend(duration=60):
    """Capture vehicle_counted events from backend WS."""
    events = []
    uri = "ws://localhost:9000"

    try:
        async with websockets.connect(uri, open_timeout=10) as ws:
            deadline = time.time() + duration
            while time.time() < deadline:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=2)
                    if isinstance(raw, bytes):
                        continue
                    msg = json.loads(raw)
                    if msg.get("type") == "vehicle_counted":
                        events.append({
                            "count": msg.get("count"),
                            "backend_ts": msg.get("ts", 0),
                            "recv_ts": time.time(),
                        })
                except asyncio.TimeoutError:
                    continue
    except Exception as e:
        print(f"Backend WS error: {e}")

    return events


def capture_frontend_console(duration=60):
    """Use puppeteer to open frontend and capture [TIMING] console logs."""
    script = f"""
    const puppeteer = require('puppeteer');
    (async () => {{
      const browser = await puppeteer.launch({{
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      }});
      const page = await browser.newPage();

      const logs = [];
      page.on('console', msg => {{
        const text = msg.text();
        if (text.includes('[TIMING]')) {{
          logs.push({{
            text: text,
            browser_ts: Date.now() / 1000,
          }});
        }}
      }});

      // Click page to unlock AudioContext
      await page.goto('http://localhost:3002', {{ waitUntil: 'networkidle2', timeout: 30000 }});
      await page.click('body').catch(() => {{}});

      // Wait for duration
      await new Promise(r => setTimeout(r, {duration * 1000}));

      // Output logs
      console.log(JSON.stringify(logs));

      await browser.close();
    }})();
    """

    try:
        result = subprocess.run(
            ['node', '-e', script],
            capture_output=True, text=True,
            timeout=duration + 30,
            cwd='/home/lumen/.gemini/antigravity/scratch/rush/frontend',
        )
        if result.returncode != 0:
            print(f"Puppeteer stderr: {result.stderr[:500]}")
            return []

        # Parse output — last line should be JSON array
        lines = result.stdout.strip().split('\n')
        for line in reversed(lines):
            line = line.strip()
            if line.startswith('['):
                return json.loads(line)
        return []
    except subprocess.TimeoutExpired:
        print("Puppeteer timed out")
        return []
    except Exception as e:
        print(f"Puppeteer error: {e}")
        return []


async def main():
    duration = 60
    print(f"=== Timing Validation ({duration}s) ===\n")

    # Run backend capture and frontend capture in parallel
    print("Starting backend WS capture...")
    backend_task = asyncio.create_task(capture_backend(duration))

    print("Starting frontend puppeteer capture...")
    # Run puppeteer in thread (it's blocking)
    loop = asyncio.get_event_loop()
    frontend_logs = await loop.run_in_executor(None, capture_frontend_console, duration)

    backend_events = await backend_task

    print(f"\nBackend: {len(backend_events)} vehicle_counted events")
    print(f"Frontend: {len(frontend_logs)} [TIMING] console logs\n")

    if not backend_events:
        print("ERROR: No backend events captured. Is counting active?")
        return

    if not frontend_logs:
        print("WARNING: No frontend logs captured. Falling back to backend-only analysis.\n")

    # Parse frontend logs
    frontend_vc = []  # vehicle_counted receive times
    frontend_beeps = []  # beep schedule times

    for log_entry in frontend_logs:
        text = log_entry["text"]
        browser_ts = log_entry["browser_ts"]

        if "vehicle_counted #" in text:
            # Extract count and latency
            try:
                parts = text.split("|")
                count_part = [p for p in parts if "#" in p][0]
                count = int(count_part.split("#")[1].strip())
                latency_part = [p for p in parts if "latency=" in p][0]
                latency = float(latency_part.split("=")[1].replace("ms", "").strip())
                frontend_vc.append({"count": count, "latency_ms": latency, "browser_ts": browser_ts})
            except Exception:
                pass

        elif "BEEP delta=" in text:
            try:
                parts = text.split("|")
                count_part = [p for p in parts if "count=" in p][0]
                count = int(count_part.split("=")[1].strip())
                frontend_beeps.append({"count": count, "browser_ts": browser_ts})
            except Exception:
                pass

    # === REPORT ===
    print("=" * 70)
    print("TIMING VALIDATION REPORT")
    print("=" * 70)

    # 1. Backend detection → WS delivery latency
    print("\n--- Backend: vehicle_counted event timing ---")
    for evt in backend_events[:10]:
        detect_ts = evt["backend_ts"]
        recv_ts = evt["recv_ts"]
        delivery_ms = (recv_ts - detect_ts) * 1000
        print(f"  count={evt['count']:3d} | detect={detect_ts:.3f} | ws_recv={recv_ts:.3f} | delivery={delivery_ms:.0f}ms")

    if backend_events:
        deliveries = [(e["recv_ts"] - e["backend_ts"]) * 1000 for e in backend_events]
        avg_delivery = sum(deliveries) / len(deliveries)
        max_delivery = max(deliveries)
        min_delivery = min(deliveries)
        print(f"\n  Delivery latency: avg={avg_delivery:.0f}ms min={min_delivery:.0f}ms max={max_delivery:.0f}ms")

    # 2. Frontend receive latency (from console logs)
    print("\n--- Frontend: WS receive → state update latency ---")
    if frontend_vc:
        latencies = [e["latency_ms"] for e in frontend_vc]
        avg_lat = sum(latencies) / len(latencies)
        max_lat = max(latencies)
        min_lat = min(latencies)
        print(f"  Events: {len(frontend_vc)}")
        print(f"  Detection→Receive: avg={avg_lat:.0f}ms min={min_lat:.0f}ms max={max_lat:.0f}ms")
        for e in frontend_vc[:5]:
            print(f"    count={e['count']:3d} latency={e['latency_ms']:.0f}ms")
    else:
        print("  No frontend timing data (puppeteer may not have captured)")

    # 3. Beep timing
    print("\n--- Frontend: beep scheduling ---")
    if frontend_beeps:
        print(f"  Beep events: {len(frontend_beeps)}")
        for b in frontend_beeps[:5]:
            print(f"    count={b['count']:3d} scheduled_at={b['browser_ts']:.3f}")
    else:
        print("  No beep timing data")

    # 4. Cross-reference: detection → beep total latency
    print("\n--- End-to-end: detection → beep ---")
    if frontend_vc and frontend_beeps:
        vc_by_count = {e["count"]: e for e in frontend_vc}
        beep_by_count = {e["count"]: e for e in frontend_beeps}
        matched = 0
        total_e2e = 0
        for count in sorted(vc_by_count.keys()):
            if count in beep_by_count:
                vc_ts = vc_by_count[count]["browser_ts"]
                beep_ts = beep_by_count[count]["browser_ts"]
                e2e = (beep_ts - vc_ts) * 1000
                total_e2e += e2e
                matched += 1
                if matched <= 5:
                    print(f"  count={count:3d} | recv→beep={e2e:.0f}ms")
        if matched > 0:
            avg_e2e = total_e2e / matched
            print(f"\n  Matched: {matched} events")
            print(f"  Receive→Beep: avg={avg_e2e:.0f}ms (React state + useEffect + AudioContext)")
    elif frontend_vc:
        # Can compute detection→receive only
        print("  (beep timing not captured, showing detection→receive only)")
        for e in frontend_vc[:5]:
            print(f"  count={e['count']:3d} | detect→receive={e['latency_ms']:.0f}ms")
    else:
        print("  No frontend data — computing backend delivery only")
        if backend_events:
            print(f"  Backend WS delivery: avg={avg_delivery:.0f}ms (detection→WS recv)")
            print("  NOTE: this does NOT include frontend processing time")

    print("\n" + "=" * 70)

    # Verdict
    issues = []
    if backend_events:
        if avg_delivery > 500:
            issues.append(f"Backend delivery too slow: {avg_delivery:.0f}ms avg")
        if max_delivery > 1000:
            issues.append(f"Backend delivery spike: {max_delivery:.0f}ms max")
    if frontend_vc:
        if avg_lat > 500:
            issues.append(f"Frontend receive latency too slow: {avg_lat:.0f}ms avg")

    if issues:
        print(f"ISSUES ({len(issues)}):")
        for i in issues:
            print(f"  - {i}")
    else:
        print("VERDICT: Timing within acceptable bounds")

    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())
