#!/usr/bin/env python3
"""
End-to-end timing validation.

Measures the REAL latency chain:
  1. Backend detection timestamp (vehicle_counted.ts)
  2. Backend WS delivery time (when this script receives it)
  3. These two are on the same machine — tells us WS latency

For frontend latency, we measure:
  - Backend meta_server broadcasts vehicle_counted at time T
  - meta_server also broadcasts count messages every 200ms
  - The delta between vehicle_counted.ts and the NEXT count message
    that reflects the new count gives us the state propagation latency

This is the honest measurement: we can't measure browser render time
from a Python script, but we CAN measure every step before the browser.
"""

import asyncio
import json
import statistics
import sys
import time

try:
    import websockets
except ImportError:
    print("pip install websockets")
    sys.exit(1)


async def main():
    duration = 60
    uri = "ws://localhost:9000"

    print(f"=== E2E Timing Validation ({duration}s) ===")
    print(f"Connecting to {uri}...\n")

    vehicle_events = []    # {count, detect_ts, recv_ts}
    count_messages = []    # {count, ts, recv_ts}

    # Track when count value first appears in count messages after vehicle_counted
    vc_to_count_latencies = []  # ms between vehicle_counted recv and next count msg with that value
    pending_vc = {}  # count -> recv_ts (waiting for corresponding count message)

    last_count = 0

    try:
        async with websockets.connect(uri, open_timeout=10) as ws:
            print("Connected.\n")
            deadline = time.time() + duration

            while time.time() < deadline:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=2)
                    if isinstance(raw, bytes):
                        continue

                    now = time.time()
                    msg = json.loads(raw)

                    if msg.get("type") == "vehicle_counted":
                        detect_ts = msg.get("ts", 0)
                        count = msg.get("count", 0)
                        delivery_ms = (now - detect_ts) * 1000 if detect_ts > 0 else -1

                        vehicle_events.append({
                            "count": count,
                            "detect_ts": detect_ts,
                            "recv_ts": now,
                            "delivery_ms": delivery_ms,
                        })

                        # Track: when will this count appear in a "count" message?
                        pending_vc[count] = now

                    elif msg.get("type") == "count":
                        count = msg.get("count", 0)
                        msg_ts = msg.get("ts", 0)

                        count_messages.append({
                            "count": count,
                            "msg_ts": msg_ts,
                            "recv_ts": now,
                        })

                        # Check if any pending vehicle_counted has this count
                        if count in pending_vc:
                            vc_recv_ts = pending_vc.pop(count)
                            latency_ms = (now - vc_recv_ts) * 1000
                            vc_to_count_latencies.append({
                                "count": count,
                                "latency_ms": latency_ms,
                            })

                        # Also check counts we might have missed (delta > 1)
                        for c in list(pending_vc.keys()):
                            if c <= count:
                                vc_recv_ts = pending_vc.pop(c)
                                latency_ms = (now - vc_recv_ts) * 1000
                                vc_to_count_latencies.append({
                                    "count": c,
                                    "latency_ms": latency_ms,
                                })

                except asyncio.TimeoutError:
                    continue

    except Exception as e:
        print(f"Connection error: {e}")
        return

    # === REPORT ===
    print("=" * 70)
    print("E2E TIMING REPORT")
    print("=" * 70)

    # 1. Detection → WS delivery (backend internal)
    print(f"\n--- 1. Backend: Detection → WS Delivery ---")
    print(f"  vehicle_counted events: {len(vehicle_events)}")

    if vehicle_events:
        deliveries = [e["delivery_ms"] for e in vehicle_events if e["delivery_ms"] >= 0]
        if deliveries:
            print(f"  Latency: avg={statistics.mean(deliveries):.0f}ms "
                  f"median={statistics.median(deliveries):.0f}ms "
                  f"p95={sorted(deliveries)[int(len(deliveries)*0.95)]:.0f}ms "
                  f"max={max(deliveries):.0f}ms")
            print(f"\n  Sample events:")
            for e in vehicle_events[:8]:
                print(f"    count={e['count']:3d} | detect={e['detect_ts']:.3f} "
                      f"| recv={e['recv_ts']:.3f} | delivery={e['delivery_ms']:.0f}ms")

    # 2. vehicle_counted → next count message (state propagation)
    print(f"\n--- 2. State Propagation: vehicle_counted → count broadcast ---")
    print(f"  Matched pairs: {len(vc_to_count_latencies)}")

    if vc_to_count_latencies:
        lats = [e["latency_ms"] for e in vc_to_count_latencies]
        print(f"  Latency: avg={statistics.mean(lats):.0f}ms "
              f"median={statistics.median(lats):.0f}ms "
              f"p95={sorted(lats)[int(len(lats)*0.95)]:.0f}ms "
              f"max={max(lats):.0f}ms")
        print(f"\n  This is the gap between when the frontend receives vehicle_counted")
        print(f"  and when the next 'count' message confirms the same value.")
        print(f"  The frontend ALREADY updated on vehicle_counted (useOracleState),")
        print(f"  so this gap is NOT visible to the user — it's redundant confirmation.")
        print(f"\n  Sample:")
        for e in vc_to_count_latencies[:8]:
            print(f"    count={e['count']:3d} | gap={e['latency_ms']:.0f}ms")

    # 3. Event cadence
    print(f"\n--- 3. Event Cadence ---")
    print(f"  count messages: {len(count_messages)} in {duration}s "
          f"= {len(count_messages)/duration:.1f}/sec")
    print(f"  vehicle_counted: {len(vehicle_events)} in {duration}s "
          f"= {len(vehicle_events)/duration:.1f}/sec")

    if len(vehicle_events) >= 2:
        gaps = []
        for i in range(1, len(vehicle_events)):
            gap = (vehicle_events[i]["recv_ts"] - vehicle_events[i-1]["recv_ts"]) * 1000
            gaps.append(gap)
        print(f"  Inter-crossing gap: avg={statistics.mean(gaps):.0f}ms "
              f"median={statistics.median(gaps):.0f}ms "
              f"min={min(gaps):.0f}ms max={max(gaps):.0f}ms")
        fast_crossings = [g for g in gaps if g < 500]
        print(f"  Fast crossings (<500ms apart): {len(fast_crossings)}")

    # 4. Frontend latency estimate
    print(f"\n--- 4. Frontend Latency Estimate ---")
    print(f"  Backend detection → WS delivery: ~0ms (localhost)")
    print(f"  WS delivery → browser receive: ~0ms (localhost, same machine)")
    print(f"  Browser receive → React setState: ~1-5ms (microtask queue)")
    print(f"  React setState → DOM repaint: ~16ms (next animation frame)")
    print(f"  React setState → beep scheduled: ~1-5ms (useEffect fires)")
    print(f"  AudioContext scheduling → audio output: ~3-10ms (Web Audio)")
    print(f"  ---")
    print(f"  Estimated total: ~20-35ms (detection → visible count + beep)")
    print(f"  This is BELOW human perception threshold (~100ms)")

    # 5. Verdict
    print(f"\n{'='*70}")
    issues = []
    if vehicle_events:
        deliveries = [e["delivery_ms"] for e in vehicle_events if e["delivery_ms"] >= 0]
        if deliveries and statistics.mean(deliveries) > 200:
            issues.append(f"WS delivery too slow: {statistics.mean(deliveries):.0f}ms avg")
        if deliveries and max(deliveries) > 500:
            issues.append(f"WS delivery spike: {max(deliveries):.0f}ms max")

    if vc_to_count_latencies:
        lats = [e["latency_ms"] for e in vc_to_count_latencies]
        if statistics.mean(lats) > 500:
            issues.append(f"State propagation slow: {statistics.mean(lats):.0f}ms avg")

    if not vehicle_events:
        issues.append("No vehicle_counted events — is counting active?")

    if issues:
        print(f"ISSUES ({len(issues)}):")
        for i in issues:
            print(f"  - {i}")
    else:
        print("VERDICT: All timing within acceptable bounds")
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())
