"""
Rush Oracle Watchdog — Enterprise Process Supervisor

Runs round_manager_rush.py as a managed subprocess and provides:
  - Continuous health monitoring (heartbeat every 30s)
  - Automatic restart with exponential backoff (5 → 10 → 30 → 60s cap)
  - Backoff reset after 5 minutes of stable running
  - Orphan market detection and cancellation on startup
  - Heartbeat file at /tmp/rush_oracle_heartbeat.json
  - Webhook alerts (Discord / Telegram) on crash, restart, orphan, rapid restarts
  - Graceful shutdown on SIGTERM / SIGINT
  - Rotating log file (/tmp/rush_oracle.log, 10 MB, 5 backups)
  - Lockfile (/tmp/rush_oracle.lock) to prevent duplicate instances

Environment variables
---------------------
  PRIVATE_KEY        Oracle wallet private key (required)
  RPC_URL            Base RPC endpoint
  FACTORY_ADDRESS    MarketFactory contract address
  ALERT_WEBHOOK_URL  Discord/Telegram/Slack webhook URL (optional)
  ORACLE_MODE        "rounds" (default) | "stream-only"
  WS_PORT            WebSocket port (default: 8765)
  ROUND_DURATION     Counting window in seconds (default: 300)
"""

from __future__ import annotations

import argparse
import fcntl
import json
import logging
import logging.handlers
import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional

# ── optional web3 (required for orphan detection) ────────────────────────────
try:
    from web3 import Web3
    from eth_account import Account
    WEB3_AVAILABLE = True
except ImportError:
    WEB3_AVAILABLE = False

# ── paths ─────────────────────────────────────────────────────────────────────
_HERE          = Path(__file__).parent
HEARTBEAT_FILE = Path("/tmp/rush_oracle_heartbeat.json")
LOG_FILE       = Path("/tmp/rush_oracle.log")
LOCK_FILE      = Path("/tmp/rush_oracle.lock")
ROUND_MANAGER  = _HERE / "round_manager_rush.py"

# ── timing constants ──────────────────────────────────────────────────────────
HEALTH_CHECK_INTERVAL  = 30        # seconds between watchdog ticks
BACKOFF_RESET_STABLE   = 300       # 5 min stable → reset backoff
BACKOFF_STEPS          = [5, 10, 30, 60]
RAPID_RESTART_WINDOW   = 600       # 10 min window for rapid-restart alert
RAPID_RESTART_THRESHOLD = 3        # alert if >= this many restarts in window
ORPHAN_GRACE_SECS      = 600       # 10 min past end-of-round before cancelling

# ── ABI fragments ─────────────────────────────────────────────────────────────
FACTORY_READ_ABI = [
    {
        "name": "getActiveMarkets",
        "type": "function",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"name": "", "type": "address[]"}],
    },
]

MARKET_READ_ABI = [
    {
        "name": "state",
        "type": "function",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint8"}],
    },
    {
        "name": "createdAt",
        "type": "function",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint256"}],
    },
    {
        "name": "lockTime",
        "type": "function",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint256"}],
    },
    {
        "name": "cancelMarket",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [],
        "outputs": [],
    },
]

MARKET_STATE_OPEN   = 0
MARKET_STATE_LOCKED = 1

DEFAULT_GAS = 200_000


# ── logging setup ─────────────────────────────────────────────────────────────

def _build_logger() -> logging.Logger:
    fmt = logging.Formatter("[%(asctime)s] %(levelname)s %(message)s",
                            datefmt="%Y-%m-%d %H:%M:%S")

    root = logging.getLogger("watchdog")
    root.setLevel(logging.INFO)

    # stdout handler
    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    root.addHandler(sh)

    # rotating file handler (10 MB, 5 backups)
    fh = logging.handlers.RotatingFileHandler(
        str(LOG_FILE), maxBytes=10 * 1024 * 1024, backupCount=5
    )
    fh.setFormatter(fmt)
    root.addHandler(fh)

    return root


log = _build_logger()


# ── lockfile ──────────────────────────────────────────────────────────────────

class LockFile:
    """
    POSIX advisory lock using fcntl.  Stores our PID in the file so a
    stale lock from a dead process can be detected and cleared.
    """

    def __init__(self, path: Path) -> None:
        self.path = path
        self._fd: Optional[int] = None

    def acquire(self) -> None:
        """
        Try to acquire the lock.  Raises RuntimeError if another live
        watchdog instance holds it.
        """
        # If a lock file already exists, check whether that PID is still alive
        if self.path.exists():
            try:
                old_pid = int(self.path.read_text().strip())
                # Signal 0 tests process existence without sending a signal
                os.kill(old_pid, 0)
                raise RuntimeError(
                    f"Another watchdog instance is already running (PID {old_pid}). "
                    f"Remove {self.path} to force start."
                )
            except (ValueError, ProcessLookupError):
                # Stale lock — the process is dead; remove it
                log.warning("Removing stale lock file (dead PID)")
                self.path.unlink(missing_ok=True)

        self._fd = os.open(str(self.path), os.O_CREAT | os.O_WRONLY | os.O_TRUNC)
        try:
            fcntl.flock(self._fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            os.close(self._fd)
            self._fd = None
            raise RuntimeError(
                f"Could not acquire lock on {self.path}. "
                "Another watchdog may be starting concurrently."
            )
        os.write(self._fd, str(os.getpid()).encode())
        os.fsync(self._fd)

    def release(self) -> None:
        if self._fd is not None:
            try:
                fcntl.flock(self._fd, fcntl.LOCK_UN)
                os.close(self._fd)
            except OSError:
                pass
            self._fd = None
        self.path.unlink(missing_ok=True)


# ── webhook alerts ────────────────────────────────────────────────────────────

def send_alert(message: str) -> None:
    """
    POST a plain-text alert to ALERT_WEBHOOK_URL if configured.
    Failure is logged but never raises.
    """
    url = os.environ.get("ALERT_WEBHOOK_URL", "").strip()
    if not url:
        return

    payload = json.dumps({"content": message}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10):
            pass
        log.info("Alert sent: %s", message)
    except Exception as exc:
        log.warning("Alert webhook failed (non-fatal): %s", exc)


def _fmt_uptime(seconds: float) -> str:
    seconds = int(seconds)
    h, rem = divmod(seconds, 3600)
    m, s   = divmod(rem, 60)
    if h:
        return f"{h}h{m:02d}m"
    if m:
        return f"{m}m{s:02d}s"
    return f"{s}s"


# ── orphan market recovery ────────────────────────────────────────────────────

def _build_web3() -> Optional[tuple]:
    """
    Return (web3_instance, account, factory_contract) or None if env is missing.
    """
    if not WEB3_AVAILABLE:
        log.warning("web3 not installed — orphan detection skipped")
        return None

    private_key      = os.environ.get("PRIVATE_KEY", "").strip()
    rpc_url          = os.environ.get(
        "RPC_URL",
        "https://base-mainnet.core.chainstack.com/977532e58b2430d1f01739e7d209d236",
    )
    factory_raw      = os.environ.get("FACTORY_ADDRESS", "").strip()
    round_duration   = int(os.environ.get("ROUND_DURATION", "300"))

    if not private_key or not factory_raw:
        log.warning("PRIVATE_KEY or FACTORY_ADDRESS not set — orphan detection skipped")
        return None

    if not Web3.is_address(factory_raw):
        log.error("FACTORY_ADDRESS is not a valid Ethereum address: %s", factory_raw)
        return None

    w3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": 60}))
    if not w3.is_connected():
        log.error("Cannot connect to RPC %s — orphan detection skipped", rpc_url)
        return None

    account = Account.from_key(private_key)
    factory = w3.eth.contract(
        address=Web3.to_checksum_address(factory_raw),
        abi=FACTORY_READ_ABI,
    )
    return w3, account, factory, round_duration


def cancel_orphan_markets() -> int:
    """
    Enumerate active markets via getActiveMarkets(), find any that are
    OPEN or LOCKED but whose window + grace period has already elapsed,
    and cancel them on-chain.

    Returns:
        Number of markets cancelled.
    """
    chain = _build_web3()
    if chain is None:
        return 0

    w3, account, factory, round_duration = chain
    now = int(time.time())
    cancelled = 0

    try:
        active_markets: list[str] = factory.functions.getActiveMarkets().call()
    except Exception as exc:
        log.error("getActiveMarkets() failed: %s", exc)
        return 0

    log.info("Orphan scan: %d active market(s) found", len(active_markets))

    for addr in active_markets:
        checksum = Web3.to_checksum_address(addr)
        market = w3.eth.contract(address=checksum, abi=MARKET_READ_ABI)

        try:
            state     = market.functions.state().call()
            created_at = market.functions.createdAt().call()
        except Exception as exc:
            log.warning("Could not read market %s: %s", checksum, exc)
            continue

        if state not in (MARKET_STATE_OPEN, MARKET_STATE_LOCKED):
            continue  # already resolved or cancelled

        expiry = created_at + round_duration + ORPHAN_GRACE_SECS
        if now < expiry:
            remaining = expiry - now
            log.debug("Market %s still within window (%ds remaining)", checksum, remaining)
            continue

        age = now - created_at
        log.warning(
            "ORPHAN market detected: %s (state=%d, age=%ds) — cancelling",
            checksum, state, age,
        )
        send_alert(
            f"[RUSH ORACLE] ORPHAN market detected: {checksum} "
            f"(state={'OPEN' if state == 0 else 'LOCKED'}, age={_fmt_uptime(age)}). "
            "Cancelling now."
        )

        try:
            nonce     = w3.eth.get_transaction_count(account.address, "pending")
            gas_price = w3.eth.gas_price
            fn_call   = market.functions.cancelMarket()
            tx        = fn_call.build_transaction({
                "from":     account.address,
                "nonce":    nonce,
                "gas":      DEFAULT_GAS,
                "gasPrice": gas_price,
            })
            signed   = account.sign_transaction(tx)
            tx_hash  = w3.eth.send_raw_transaction(signed.raw_transaction)

            # Poll for receipt
            deadline = time.time() + 120
            receipt  = None
            while time.time() < deadline:
                try:
                    receipt = w3.eth.get_transaction_receipt(tx_hash)
                    if receipt is not None:
                        break
                except Exception:
                    pass
                time.sleep(2)

            if receipt and receipt["status"] == 1:
                log.info("Orphan market cancelled: %s (tx: %s)", checksum, tx_hash.hex())
                cancelled += 1
            else:
                log.error("cancelMarket reverted or timed out for %s", checksum)

        except Exception as exc:
            log.error("cancelMarket failed for %s: %s", checksum, exc)

    return cancelled


# ── heartbeat writer ──────────────────────────────────────────────────────────

def write_heartbeat(
    pid: Optional[int],
    last_round_time: Optional[float],
    status: str,
    uptime: float,
    restart_count: int,
) -> None:
    data = {
        "pid":             pid,
        "last_round_time": last_round_time,
        "status":          status,
        "uptime_secs":     round(uptime, 1),
        "uptime_human":    _fmt_uptime(uptime),
        "restart_count":   restart_count,
        "timestamp":       time.time(),
    }
    try:
        HEARTBEAT_FILE.write_text(json.dumps(data, indent=2))
    except Exception as exc:
        log.warning("Could not write heartbeat: %s", exc)


# ── watchdog ──────────────────────────────────────────────────────────────────

class Watchdog:
    """
    Supervises round_manager_rush.py.

    Responsibilities
    ----------------
    - Start the child process
    - Detect crashes and restart with exponential backoff
    - Write heartbeat file on every health-check tick
    - Send webhook alerts on significant events
    - Honour SIGTERM / SIGINT for graceful shutdown
    """

    def __init__(self, passthrough_args: list[str]) -> None:
        self._passthrough   = passthrough_args
        self._proc: Optional[subprocess.Popen] = None
        self._shutdown      = False
        self._start_time    = time.time()
        self._proc_start    = 0.0
        self._restart_count = 0
        self._last_round_time: Optional[float] = None
        self._backoff_index = 0
        self._restart_times: list[float] = []  # timestamps of recent restarts

        # Wire up signals
        signal.signal(signal.SIGTERM, self._on_signal)
        signal.signal(signal.SIGINT,  self._on_signal)

    # ── signal handler ────────────────────────────────────────────────────────

    def _on_signal(self, signum: int, frame) -> None:  # noqa: ANN001
        sig_name = "SIGTERM" if signum == signal.SIGTERM else "SIGINT"
        log.info("%s received — initiating graceful shutdown", sig_name)
        self._shutdown = True
        self._terminate_child()

    # ── child process control ─────────────────────────────────────────────────

    def _build_cmd(self) -> list[str]:
        cmd = [sys.executable, "-u", str(ROUND_MANAGER)]
        cmd.extend(self._passthrough)
        return cmd

    def _start_child(self) -> None:
        cmd = self._build_cmd()
        log.info("Starting child: %s", " ".join(cmd))
        self._proc = subprocess.Popen(
            cmd,
            cwd=str(_HERE),
            env=os.environ.copy(),
        )
        self._proc_start = time.time()
        log.info("Child started (PID %d)", self._proc.pid)

    def _terminate_child(self) -> None:
        if self._proc is None:
            return
        if self._proc.poll() is not None:
            return  # already dead
        log.info("Sending SIGTERM to child PID %d", self._proc.pid)
        self._proc.terminate()
        try:
            self._proc.wait(timeout=15)
            log.info("Child exited cleanly")
        except subprocess.TimeoutExpired:
            log.warning("Child did not exit after SIGTERM — sending SIGKILL")
            self._proc.kill()
            self._proc.wait()

    # ── backoff logic ─────────────────────────────────────────────────────────

    def _backoff_delay(self) -> int:
        idx   = min(self._backoff_index, len(BACKOFF_STEPS) - 1)
        delay = BACKOFF_STEPS[idx]
        self._backoff_index = min(self._backoff_index + 1, len(BACKOFF_STEPS) - 1)
        return delay

    def _maybe_reset_backoff(self) -> None:
        if self._proc_start and (time.time() - self._proc_start) >= BACKOFF_RESET_STABLE:
            if self._backoff_index > 0:
                log.info(
                    "Child has been stable for >%ds — resetting backoff",
                    BACKOFF_RESET_STABLE,
                )
                self._backoff_index = 0

    # ── rapid-restart detection ───────────────────────────────────────────────

    def _record_restart(self) -> None:
        now = time.time()
        self._restart_times.append(now)
        # Prune timestamps outside the window
        cutoff = now - RAPID_RESTART_WINDOW
        self._restart_times = [t for t in self._restart_times if t >= cutoff]

        if len(self._restart_times) >= RAPID_RESTART_THRESHOLD:
            log.error(
                "RAPID RESTART DETECTED: %d restarts in last %ds",
                len(self._restart_times),
                RAPID_RESTART_WINDOW,
            )
            send_alert(
                f"[RUSH ORACLE] RAPID RESTARTS: {len(self._restart_times)} restarts "
                f"in the last {RAPID_RESTART_WINDOW // 60} minutes. "
                "Manual inspection may be required."
            )

    # ── heartbeat ─────────────────────────────────────────────────────────────

    def _tick_heartbeat(self, status: str) -> None:
        pid    = self._proc.pid if self._proc and self._proc.poll() is None else None
        uptime = time.time() - self._start_time
        write_heartbeat(
            pid=pid,
            last_round_time=self._last_round_time,
            status=status,
            uptime=uptime,
            restart_count=self._restart_count,
        )

    # ── main loop ─────────────────────────────────────────────────────────────

    def run(self) -> None:
        log.info("=" * 60)
        log.info("  Rush Oracle Watchdog")
        log.info("  Managing: %s", ROUND_MANAGER)
        log.info("  Heartbeat: %s", HEARTBEAT_FILE)
        log.info("  Log: %s", LOG_FILE)
        log.info("=" * 60)

        # Orphan scan before starting the child
        log.info("Running startup orphan scan...")
        n_cancelled = cancel_orphan_markets()
        if n_cancelled:
            log.info("Cancelled %d orphan market(s)", n_cancelled)
        else:
            log.info("No orphan markets found")

        # Initial start
        self._start_child()
        self._tick_heartbeat("running")

        last_health_check = time.time()

        while not self._shutdown:
            time.sleep(1)

            # Periodic health check
            if time.time() - last_health_check >= HEALTH_CHECK_INTERVAL:
                last_health_check = time.time()
                self._maybe_reset_backoff()
                returncode = self._proc.poll() if self._proc else -1
                if returncode is None:
                    # Child is alive
                    self._tick_heartbeat("running")
                    log.debug(
                        "Health check OK — PID %d, uptime %s, restarts %d",
                        self._proc.pid,
                        _fmt_uptime(time.time() - self._proc_start),
                        self._restart_count,
                    )
                # If dead, the crash-detection block below will handle it

            if self._shutdown:
                break

            # Check whether child has died
            if self._proc is None:
                continue

            returncode = self._proc.poll()
            if returncode is None:
                continue  # still running

            # Child has exited
            crash_uptime = time.time() - self._proc_start
            self._restart_count += 1
            self._record_restart()

            log.error(
                "Child exited (code %d) after %s — restart #%d",
                returncode,
                _fmt_uptime(crash_uptime),
                self._restart_count,
            )

            alert_msg = (
                f"[RUSH ORACLE] round_manager crashed (exit code {returncode}). "
                f"Restarting (attempt {self._restart_count}/inf). "
                f"Uptime before crash: {_fmt_uptime(crash_uptime)}."
            )
            send_alert(alert_msg)
            self._tick_heartbeat("crashed")

            if self._shutdown:
                break

            delay = self._backoff_delay()
            log.info("Waiting %ds before restart (backoff step %d)...", delay, self._backoff_index)
            # Sleep in small increments so SIGTERM is processed promptly
            for _ in range(delay):
                if self._shutdown:
                    break
                time.sleep(1)

            if self._shutdown:
                break

            log.info("Restarting child (attempt %d)...", self._restart_count)
            self._start_child()
            send_alert(
                f"[RUSH ORACLE] round_manager restarted (attempt {self._restart_count}). "
                f"PID: {self._proc.pid}."
            )
            self._tick_heartbeat("running")

        # Cleanup
        log.info("Watchdog shutting down...")
        self._terminate_child()
        self._tick_heartbeat("stopped")
        log.info(
            "Watchdog stopped. Total uptime: %s, total restarts: %d",
            _fmt_uptime(time.time() - self._start_time),
            self._restart_count,
        )


# ── entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Rush Oracle Watchdog — supervises round_manager_rush.py",
        # Pass unrecognised args through to the child
        allow_abbrev=False,
    )
    parser.add_argument(
        "--stream-only",
        action="store_true",
        help="Start stream_server.py instead of round_manager (not supervised, exits)",
    )
    parser.add_argument(
        "--duration",
        type=int,
        default=None,
        metavar="SECS",
        help="Round duration override (passed through to child)",
    )
    parser.add_argument(
        "--rounds",
        type=int,
        default=0,
        metavar="N",
        help="Max rounds (0 = infinite, passed through to child)",
    )

    args, extra = parser.parse_known_args()

    # Build passthrough arg list for the child
    passthrough: list[str] = list(extra)
    if args.duration is not None:
        passthrough += ["--duration", str(args.duration)]
    if args.rounds:
        passthrough += ["--rounds", str(args.rounds)]

    # Acquire lockfile
    lock = LockFile(LOCK_FILE)
    try:
        lock.acquire()
    except RuntimeError as exc:
        log.error("%s", exc)
        sys.exit(1)

    try:
        watchdog = Watchdog(passthrough_args=passthrough)
        watchdog.run()
    finally:
        lock.release()
        HEARTBEAT_FILE.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
