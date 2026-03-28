"""
SinalBet Oracle — Round Manager
Automates the full prediction market lifecycle:
  count vehicles -> prepare attestation -> commit -> wait -> reveal -> repeat

Each round runs counter.py as a subprocess for the configured duration, reads
the resulting result.json, builds a cryptographic attestation via signer.py,
and delegates all on-chain transactions to publisher_v2.js over the ACTION /
ATTESTATION_DATA environment variables.

Usage:
    python round_manager.py --rounds 5
    python round_manager.py                 # infinite loop

Config (environment variables):
    PRIVATE_KEY          Oracle private key (required)
    RPC_URL              Base RPC endpoint (default: https://mainnet.base.org)
    FACTORY_ADDRESS      MarketFactory contract address
    ATTESTATION_ADDRESS  DataAttestation contract address
    STREAM_URL           YouTube / video stream URL
    ROUND_DURATION       Round duration in seconds (default: 300)
    MODEL                YOLO model filename (default: yolov8x.pt)
    CONFIDENCE           Detection confidence threshold (default: 0.15)
    LINE_POSITION        Counting line vertical position 0-1 (default: 0.6)
"""

import asyncio
import json
import os
import sys
import time
import logging
import argparse
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("round_manager")

# Directory that contains this file — used to locate sibling scripts.
_HERE = Path(__file__).parent


class RoundManager:
    """Orchestrates continuous SinalBet prediction market rounds."""

    def __init__(self):
        """
        Read configuration from environment variables.

        Raises:
            KeyError: if PRIVATE_KEY is not set.
        """
        self.private_key = os.environ["PRIVATE_KEY"]
        self.rpc_url = os.environ.get("RPC_URL", "https://mainnet.base.org")
        self.factory_address = os.environ.get("FACTORY_ADDRESS", "")
        self.attestation_address = os.environ.get("ATTESTATION_ADDRESS", "")
        self.stream_url = os.environ.get("STREAM_URL", "")
        self.round_duration = int(os.environ.get("ROUND_DURATION", "300"))
        self.model = os.environ.get("MODEL", "yolov8x.pt")
        self.confidence = float(os.environ.get("CONFIDENCE", "0.15"))
        self.line_position = float(os.environ.get("LINE_POSITION", "0.6"))
        self.round_count = 0

    # ------------------------------------------------------------------
    # Top-level round lifecycle
    # ------------------------------------------------------------------

    async def run_round(self) -> None:
        """Execute a single prediction market round end-to-end."""
        self.round_count += 1
        log.info("=== Round %d starting ===", self.round_count)

        # Step 1: Count vehicles via counter.py subprocess
        log.info("Step 1: Counting vehicles...")
        count = await self.count_cars()
        if count < 0:
            log.error("Car counting failed, skipping round")
            return
        log.info("Step 1 complete: %d vehicles counted", count)

        # Step 2: Build cryptographic attestation from the count + frame hashes
        log.info("Step 2: Preparing attestation...")
        attestation = self.prepare_attestation(count)
        log.info("Step 2 complete: commitHash=%s...", attestation["commitHash"][:18])

        # Step 3: Publish commit hash on-chain
        log.info("Step 3: Committing result on-chain...")
        await self.commit_result(attestation)
        log.info("Step 3 complete: committed")

        # Step 4: Give other oracles time to commit
        log.info("Step 4: Waiting for other oracles to commit...")
        await self.wait_for_commits()

        # Step 5: Reveal count + salt on-chain
        log.info("Step 5: Revealing result on-chain...")
        await self.reveal_result(attestation)
        log.info("Step 5 complete: revealed")

        # Step 6: Trigger on-chain consensus resolution
        log.info("Step 6: Checking consensus...")
        await self.check_consensus()

        log.info("=== Round %d complete ===\n", self.round_count)

    # ------------------------------------------------------------------
    # Step implementations
    # ------------------------------------------------------------------

    async def count_cars(self) -> int:
        """
        Run counter.py as a subprocess and return the final vehicle count.

        The counter writes its result to result.json in the same directory;
        this method reads that file after the subprocess exits.

        Returns:
            Vehicle count on success, -1 on any failure.
        """
        counter_path = _HERE / "counter.py"
        cmd = [
            sys.executable,
            str(counter_path),
            "--stream", self.stream_url,
            "--duration", str(self.round_duration),
            "--model", self.model,
            "--confidence", str(self.confidence),
            "--line", str(self.line_position),
            "--no-preview",
        ]

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()

            if stdout:
                # Forward counter output at DEBUG level to avoid log clutter.
                for line in stdout.decode().splitlines():
                    log.debug("[counter] %s", line)

            if proc.returncode != 0:
                log.error("Counter process exited %d: %s", proc.returncode, stderr.decode().strip())
                return -1

            result_path = _HERE / "result.json"
            with open(result_path) as f:
                result = json.load(f)
            return int(result["count"])

        except FileNotFoundError as exc:
            log.error("result.json not found after counter run: %s", exc)
            return -1
        except Exception as exc:
            log.error("Unexpected error in count_cars: %s", exc)
            return -1

    def prepare_attestation(self, count: int) -> dict:
        """
        Build a full attestation dict using OracleSigner.

        Reads frame hashes and timestamps from result.json when present so the
        attestation reflects the actual frames observed during counting.

        Args:
            count: Vehicle count returned by count_cars().

        Returns:
            Attestation dict as produced by OracleSigner.prepare_attestation().
        """
        from signer import OracleSigner

        signer = OracleSigner(self.private_key)

        frame_hashes: list[bytes] = []
        start_ts = int(time.time()) - self.round_duration
        end_ts = int(time.time())

        result_path = _HERE / "result.json"
        if result_path.exists():
            with open(result_path) as f:
                result = json.load(f)

            if "sampledFrameHashes" in result:
                frame_hashes = [
                    bytes.fromhex(h.replace("0x", ""))
                    for h in result["sampledFrameHashes"]
                ]

            start_ts = result.get("startTimestamp", start_ts)
            end_ts = result.get("endTimestamp", end_ts)

        return signer.prepare_attestation(
            count=count,
            stream_url=self.stream_url,
            frame_hashes=frame_hashes,
            start_timestamp=start_ts,
            end_timestamp=end_ts,
            model_version=self.model,
        )

    async def commit_result(self, attestation: dict) -> None:
        """
        Call DataAttestation.commitResult() on-chain via publisher_v2.js.

        Args:
            attestation: Attestation dict from prepare_attestation().
        """
        await self._call_publisher("commit", attestation)

    async def reveal_result(self, attestation: dict) -> None:
        """
        Call DataAttestation.revealResult() on-chain via publisher_v2.js.

        Args:
            attestation: The same attestation dict used in commit_result().
        """
        await self._call_publisher("reveal", attestation)

    async def wait_for_commits(self, timeout: int = 120) -> None:
        """
        Wait for other oracles to commit before the reveal phase.

        Currently implemented as a fixed sleep; a future version should poll
        DataAttestation.getCommitCount() and return early once a quorum is met.

        Args:
            timeout: Maximum seconds to wait (default 120).
        """
        wait_secs = min(timeout, 60)
        log.info("Waiting %ds for other oracles to commit...", wait_secs)
        await asyncio.sleep(wait_secs)

    async def check_consensus(self) -> None:
        """Invoke ConsensusEngine.checkAndResolve() via publisher_v2.js."""
        await self._call_publisher("consensus", {})

    # ------------------------------------------------------------------
    # Publisher bridge
    # ------------------------------------------------------------------

    async def _call_publisher(self, action: str, data: dict) -> None:
        """
        Invoke publisher_v2.js with an action and JSON-serialised payload.

        The publisher script reads ACTION and ATTESTATION_DATA from the
        environment, signs and submits the appropriate on-chain transaction,
        then exits. stdout is forwarded to the log; non-zero exit codes are
        logged as errors.

        Args:
            action: One of "commit", "reveal", "consensus".
            data:   Dict to serialise as JSON into ATTESTATION_DATA.
        """
        publisher_path = _HERE / "publisher_v2.js"

        env = os.environ.copy()
        env["ACTION"] = action
        env["ATTESTATION_DATA"] = json.dumps(data)

        try:
            proc = await asyncio.create_subprocess_exec(
                "node", str(publisher_path),
                env=env,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()

            if stdout:
                for line in stdout.decode().splitlines():
                    log.info("[publisher] %s", line)

            if proc.returncode != 0:
                log.error(
                    "publisher_v2.js exited %d for action '%s': %s",
                    proc.returncode,
                    action,
                    stderr.decode().strip(),
                )

        except FileNotFoundError:
            log.error("publisher_v2.js not found at %s", publisher_path)
        except Exception as exc:
            log.error("Unexpected error calling publisher (%s): %s", action, exc)

    # ------------------------------------------------------------------
    # Main loop
    # ------------------------------------------------------------------

    async def run_loop(self, rounds: int = 0) -> None:
        """
        Run prediction market rounds in a continuous loop.

        Args:
            rounds: Total rounds to execute. 0 means run indefinitely until
                    a KeyboardInterrupt is received.
        """
        log.info("SinalBet Round Manager starting")
        log.info("  Stream:   %s", self.stream_url or "(not set)")
        log.info("  Duration: %ds per round", self.round_duration)
        log.info("  Model:    %s  confidence=%.2f", self.model, self.confidence)
        log.info("  RPC:      %s", self.rpc_url)

        iteration = 0
        while rounds == 0 or iteration < rounds:
            try:
                await self.run_round()
                iteration += 1

                if rounds == 0 or iteration < rounds:
                    log.info("Waiting 30s before next round...")
                    await asyncio.sleep(30)

            except KeyboardInterrupt:
                log.info("Shutting down (KeyboardInterrupt).")
                break
            except Exception as exc:
                log.error("Round %d failed: %s", self.round_count, exc)
                log.info("Retrying in 60s...")
                await asyncio.sleep(60)

        log.info("Round Manager finished after %d round(s).", iteration)


# ------------------------------------------------------------------
# Entry point
# ------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="SinalBet Round Manager")
    parser.add_argument(
        "--rounds", "-r",
        type=int,
        default=0,
        help="Number of rounds to run (0 = infinite, default: 0)",
    )
    args = parser.parse_args()

    manager = RoundManager()
    asyncio.run(manager.run_loop(rounds=args.rounds))


if __name__ == "__main__":
    main()
