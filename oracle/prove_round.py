#!/usr/bin/env python3
"""
Full round proof — observes WS from start to finish and prints everything live.
Run this and watch. Ctrl+C to stop.
"""

import asyncio
import json
import sys
import time

try:
    import websockets
except ImportError:
    print("pip install websockets")
    sys.exit(1)

URI = "ws://localhost:9000"

PHASE_COLORS = {
    "idle": "\033[90m",       # gray
    "betting_open": "\033[33m", # yellow
    "counting": "\033[32m",   # green
    "resolved": "\033[36m",   # cyan
    "cleanup": "\033[90m",    # gray
}
RESET = "\033[0m"
BOLD = "\033[1m"


async def main():
    print(f"{BOLD}=== FULL ROUND PROOF — ws://localhost:9000 ==={RESET}")
    print(f"Watching live. Ctrl+C to stop.\n")

    async with websockets.connect(URI, open_timeout=10) as ws:
        last_phase = None
        last_count = -1
        round_id = None
        market = None
        round_start = None
        vc_count = 0
        phase_log = []

        while True:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=5)
            except asyncio.TimeoutError:
                continue

            if isinstance(raw, bytes):
                continue

            msg = json.loads(raw)
            t = msg.get("type", "")
            now = time.time()
            ts = f"{time.strftime('%H:%M:%S')}"

            if t == "init":
                phase = msg.get("state", "?")
                count = msg.get("count", 0)
                round_id = msg.get("roundId", 0)
                market = str(msg.get("marketAddress", ""))[:16]
                remaining = msg.get("remaining", 0)
                color = PHASE_COLORS.get(phase, "")
                print(f"{ts} {BOLD}INIT{RESET} phase={color}{phase}{RESET} count={count} round={round_id} market={market} remaining={remaining:.0f}s")
                last_phase = phase
                last_count = count

            elif t == "count":
                phase = msg.get("state", "?")
                count = msg.get("count", 0)
                rid = msg.get("roundId", 0)
                remaining = msg.get("remaining", 0)
                elapsed = msg.get("elapsed", 0)
                mkt = str(msg.get("marketAddress", ""))[:16]

                # Phase change
                if phase != last_phase:
                    color = PHASE_COLORS.get(phase, "")
                    print(f"\n{ts} {BOLD}PHASE{RESET} {color}{last_phase} → {phase}{RESET} round={rid} market={mkt}")
                    phase_log.append({"phase": phase, "ts": now, "count": count, "roundId": rid})
                    last_phase = phase

                    if phase == "counting" and round_start is None:
                        round_start = now
                        vc_count = 0

                # Count change (only print on change, not every 200ms)
                if count != last_count:
                    color = PHASE_COLORS.get(phase, "")
                    bar = "█" * min(count, 50)
                    print(f"{ts} {color}COUNT{RESET} {count:3d} {bar} remaining={remaining:.0f}s round={rid}", end="\r\n" if count % 10 == 0 else "\r")
                    last_count = count

                # Round change
                if rid != round_id:
                    print(f"\n{ts} {BOLD}ROUND CHANGE{RESET} {round_id} → {rid}")
                    round_id = rid
                    market = mkt

            elif t == "vehicle_counted":
                vc_count += 1
                count = msg.get("count", "?")
                tid = msg.get("trackId", "?")
                line = msg.get("lineId", "?")
                seq = msg.get("seq", "?")
                cls = msg.get("classId", "?")
                direction = msg.get("direction", "?")
                detect_ts = msg.get("ts", 0)
                latency = (now - detect_ts) * 1000 if detect_ts > 0 else -1
                print(f"{ts} \033[33m⚡VC{RESET} #{count} track={tid} line={line} cls={cls} dir={direction} seq={seq} lat={latency:.0f}ms")

            elif t == "round_complete":
                count = msg.get("count", 0)
                rid = msg.get("roundId", 0)
                mkt = str(msg.get("marketAddress", ""))[:16]
                duration = now - round_start if round_start else 0
                print(f"\n{ts} {BOLD}\033[36m═══ ROUND COMPLETE ═══{RESET}")
                print(f"  roundId:    {rid}")
                print(f"  market:     {mkt}")
                print(f"  finalCount: {count}")
                print(f"  crossings:  {vc_count} vehicle_counted events")
                print(f"  duration:   {duration:.1f}s")
                print(f"  phases:     {' → '.join(p['phase'] for p in phase_log)}")
                print()
                # Reset for next round
                round_start = None
                vc_count = 0
                phase_log = []

            elif t == "heartbeat":
                phase = msg.get("phase", "?")
                count = msg.get("count", 0)
                clients = msg.get("clients", 0)
                # Only print heartbeat on phase change or every 30s
                pass  # silent

            elif t == "idle":
                if last_phase != "idle":
                    print(f"\n{ts} {BOLD}IDLE{RESET} — waiting for next round")
                    last_phase = "idle"


try:
    asyncio.run(main())
except KeyboardInterrupt:
    print(f"\n{BOLD}Stopped.{RESET}")
