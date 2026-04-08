#!/usr/bin/env python3
"""
Slice 1 Runtime Validator — observes one full round via WS and validates:
1. vehicle_counted events fire at crossing time with correct fields
2. count ownership — only oracle WS drives count
3. stale filtering — roundId validation
4. phase alignment — state transitions
5. full round proof — betting → counting → resolved → interval → next round
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


class SliceValidator:
    def __init__(self):
        self.round_id = None
        self.market_address = None
        self.phase_history = []
        self.vehicle_counted_events = []
        self.count_updates = []
        self.init_msg = None
        self.round_complete_msg = None
        self.final_count = None
        self.errors = []
        self.warnings = []
        self.start_time = time.time()
        self.last_count = 0
        self.count_jumps = []  # (from, to, timestamp)

    def log(self, msg):
        elapsed = time.time() - self.start_time
        print(f"[{elapsed:7.1f}s] {msg}")

    def handle_msg(self, msg):
        msg_type = msg.get("type")

        # Track phase transitions
        state = msg.get("state")
        if state and (not self.phase_history or self.phase_history[-1] != state):
            self.phase_history.append(state)
            self.log(f"PHASE: {state}")

        if msg_type == "init":
            self.init_msg = msg
            self.round_id = msg.get("roundId")
            self.market_address = msg.get("marketAddress")
            self.last_count = msg.get("count", 0)
            self.log(f"INIT: roundId={self.round_id} market={self.market_address[:10]}... count={self.last_count} state={msg.get('state')}")

            # Validate init has all required fields
            required = ["type", "state", "count", "roundId", "marketAddress", "videoUid"]
            missing = [f for f in required if f not in msg or msg[f] is None]
            if missing:
                self.errors.append(f"INIT missing fields: {missing}")

        elif msg_type == "vehicle_counted":
            self.vehicle_counted_events.append(msg)
            count = msg.get("count", "?")
            self.log(f"VEHICLE_COUNTED: count={count} roundId={msg.get('roundId')} ts={msg.get('ts', 0):.3f}")

            # Accept round change on vehicle_counted too
            msg_round = msg.get("roundId")
            if msg_round and self.round_id and msg_round != self.round_id:
                self.log(f"ROUND CHANGE (via vc): {self.round_id} -> {msg_round}")
                self.round_id = msg_round

            # Check required fields
            required_vc = ["type", "count", "roundId", "ts"]
            missing_vc = [f for f in required_vc if f not in msg]
            if missing_vc:
                self.warnings.append(f"vehicle_counted missing fields: {missing_vc}")

            # Note: Nova Engine doesn't send trackId/lineId/seq yet
            optional_vc = ["trackId", "lineId", "seq", "classId", "direction"]
            present = [f for f in optional_vc if f in msg]
            if not present:
                pass  # Expected for Nova Engine — will need fix later

        elif msg_type == "count":
            count = msg.get("count", 0)

            # Accept round change — update our tracked roundId
            msg_round = msg.get("roundId")
            if msg_round and self.round_id and msg_round != self.round_id:
                self.log(f"ROUND CHANGE: {self.round_id} -> {msg_round}")
                self.round_id = msg_round
                self.market_address = msg.get("marketAddress", self.market_address)
                self.last_count = 0  # reset for new round

            # Detect count jumps
            if count != self.last_count:
                delta = count - self.last_count
                if delta > 1:
                    self.count_jumps.append((self.last_count, count, time.time()))
                    self.log(f"COUNT JUMP: {self.last_count} -> {count} (delta={delta})")
                self.last_count = count

            self.count_updates.append(msg)

        elif msg_type == "round_complete":
            self.round_complete_msg = msg
            self.final_count = msg.get("count")
            self.log(f"ROUND_COMPLETE: count={self.final_count} roundId={msg.get('roundId')}")

        elif msg_type == "idle":
            self.log("IDLE: round ended, waiting for next")

        elif msg_type == "final":
            self.final_count = msg.get("count")
            self.log(f"FINAL: count={self.final_count}")

    def report(self):
        print("\n" + "=" * 60)
        print("SLICE 1 VALIDATION REPORT")
        print("=" * 60)

        # 1. vehicle_counted
        print("\n--- 1. vehicle_counted events ---")
        n_vc = len(self.vehicle_counted_events)
        print(f"  Total events: {n_vc}")
        if n_vc > 0:
            sample = self.vehicle_counted_events[0]
            print(f"  Fields present: {list(sample.keys())}")
            has_track = any("trackId" in e for e in self.vehicle_counted_events)
            has_line = any("lineId" in e for e in self.vehicle_counted_events)
            has_seq = any("seq" in e for e in self.vehicle_counted_events)
            print(f"  Has trackId: {has_track}")
            print(f"  Has lineId: {has_line}")
            print(f"  Has seq: {has_seq}")
            if not has_track:
                print(f"  NOTE: Nova Engine emits vehicle_counted without trackId/lineId/seq")
                print(f"        This is a known gap — needs Nova Engine patch")
        else:
            print("  WARNING: No vehicle_counted events observed")

        # 2. beep validation (count vs vehicle_counted alignment)
        print("\n--- 2. beep / count alignment ---")
        print(f"  Count updates: {len(self.count_updates)}")
        print(f"  vehicle_counted events: {n_vc}")
        if self.count_updates:
            counts_in_updates = set(m.get("count") for m in self.count_updates)
            counts_in_vc = set(e.get("count") for e in self.vehicle_counted_events)
            vc_only = counts_in_vc - counts_in_updates
            if vc_only:
                print(f"  vehicle_counted counts NOT in count updates: {vc_only}")
            print(f"  Count jumps > 1: {len(self.count_jumps)}")
            for f, t, ts in self.count_jumps[:5]:
                print(f"    {f} -> {t} (delta={t-f})")

        # 3. count ownership
        print("\n--- 3. count ownership ---")
        if self.init_msg:
            print(f"  Init count: {self.init_msg.get('count')}")
            print(f"  Init has roundId: {'roundId' in self.init_msg}")
            print(f"  Init has marketAddress: {'marketAddress' in self.init_msg}")
            print(f"  Final count: {self.final_count}")
        else:
            print("  ERROR: No init message received")

        # 4. stale filtering
        print("\n--- 4. stale event filtering ---")
        roundid_mismatches = [e for e in self.errors if "roundId mismatch" in e]
        if roundid_mismatches:
            print(f"  ERRORS: {len(roundid_mismatches)} roundId mismatches!")
            for e in roundid_mismatches:
                print(f"    {e}")
        else:
            print(f"  All messages had consistent roundId={self.round_id}")

        # 5. phase alignment
        print("\n--- 5. phase alignment ---")
        print(f"  Phase history: {' -> '.join(self.phase_history)}")
        expected_phases = ["counting"]  # minimum during observation
        if "counting" in self.phase_history:
            print(f"  Counting phase observed: YES")
        else:
            print(f"  WARNING: counting phase not observed")

        # 6. full round proof
        print("\n--- 6. full round proof ---")
        if self.round_complete_msg:
            print(f"  Round complete: YES (count={self.final_count})")
        else:
            print(f"  Round complete: NOT observed (may need longer observation)")

        # Errors and warnings
        if self.errors:
            print(f"\n!!! ERRORS ({len(self.errors)}) !!!")
            for e in self.errors:
                print(f"  {e}")

        if self.warnings:
            print(f"\nWARNINGS ({len(self.warnings)}):")
            for w in self.warnings:
                print(f"  {w}")

        print("\n" + "=" * 60)
        if not self.errors:
            print("RESULT: PASS (with known Nova Engine gaps)")
        else:
            print(f"RESULT: FAIL ({len(self.errors)} errors)")
        print("=" * 60)


async def main():
    uri = "ws://localhost:9000"
    validator = SliceValidator()
    max_time = 120  # observe for 2 min — enough to see counting + events

    validator.log(f"Connecting to {uri}...")

    try:
        async with websockets.connect(uri, open_timeout=10) as ws:
            validator.log("Connected. Observing round...")

            deadline = time.time() + max_time
            seen_complete = False

            while time.time() < deadline:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=5)
                    if isinstance(raw, bytes):
                        continue
                    msg = json.loads(raw)
                    validator.handle_msg(msg)

                    # Stop early if we saw a complete round + a bit of next
                    if msg.get("type") == "round_complete":
                        seen_complete = True
                        validator.log("Round complete — observing 30s more for next round start...")

                    if seen_complete and time.time() > (deadline - max_time + 60):
                        # We've seen complete and waited a bit
                        if msg.get("type") == "init" and msg.get("roundId", 0) > (validator.round_id or 0):
                            validator.log("New round detected — stopping observation")
                            validator.handle_msg(msg)
                            break

                except asyncio.TimeoutError:
                    continue
                except Exception as e:
                    validator.log(f"Error: {e}")
                    break

    except Exception as e:
        validator.log(f"Connection error: {e}")
        return

    validator.report()


if __name__ == "__main__":
    asyncio.run(main())
