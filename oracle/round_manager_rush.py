"""
SinalBet Oracle — Rush Round Manager

Automated oracle that runs prediction market rounds in a tight loop:

  1. Create market on-chain   (MarketFactory.createMarket)
  2. Spawn stream_server.py   (YOLO vehicle counter + WebSocket server)
  3. Wait ROUND_DURATION secs (frontend watches the live stream)
  4. Read result.json         (vehicle count from the subprocess)
  5. Resolve market on-chain  (PredictionMarket.resolveMarket)
  6. Wait INTER_ROUND_SECS
  7. Alternate to next camera
  8. Repeat forever

Configuration (environment variables)
--------------------------------------
  PRIVATE_KEY      Oracle/admin private key (required)
  RPC_URL          Base RPC endpoint
  FACTORY_ADDRESS  MarketFactory contract address
  FEE_RECIPIENT    Fee recipient (for logging only)
  ROUND_DURATION   Counting window in seconds  (default: 300)
  BETTING_WINDOW   First N seconds bets are open (default: 150)
  WS_PORT          WebSocket port for the stream server (default: 8765)

Usage
-----
  python3 round_manager_rush.py
  python3 round_manager_rush.py --rounds 3   # finite run for testing
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import signal
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path
from typing import Optional

# ── web3 imports (fail fast if not installed) ─────────────────────────────────
try:
    from web3 import Web3
    from web3.exceptions import TransactionNotFound
    from eth_account import Account
except ImportError:
    print("ERROR: web3 not installed. Run: pip install web3")
    sys.exit(1)

# ── logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("round_manager_rush")

_HERE = Path(__file__).parent

# ── ABIs (minimal — only functions we call) ───────────────────────────────────

FACTORY_ABI = [
    {
        "name": "createMarket",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "_streamUrl",        "type": "string"},
            {"name": "_description",      "type": "string"},
            {"name": "_roundDurationSecs","type": "uint256"},
            {"name": "_minBet",           "type": "uint256"},
            {"name": "_maxBet",           "type": "uint256"},
            {"name": "_rangeLabels",      "type": "string[]"},
            {"name": "_rangeMins",        "type": "uint256[]"},
            {"name": "_rangeMaxs",        "type": "uint256[]"},
        ],
        "outputs": [{"name": "", "type": "address"}],
    },
]

FACTORY_MARKET_CREATED_ABI = {
    "name": "MarketCreated",
    "type": "event",
    "inputs": [
        {"name": "marketIndex",   "type": "uint256", "indexed": True},
        {"name": "marketAddress", "type": "address", "indexed": True},
        {"name": "description",   "type": "string",  "indexed": False},
        {"name": "roundDurationSecs", "type": "uint256", "indexed": False},
        {"name": "isTokenMode",   "type": "bool",    "indexed": False},
    ],
}

MARKET_ABI = [
    {
        "name": "resolveMarket",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "_actualCarCount", "type": "uint256"},
        ],
        "outputs": [],
    },
    {
        "name": "cancelMarket",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [],
        "outputs": [],
    },
    {
        "name": "totalPool",
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
        "name": "poolByRange",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "", "type": "uint256"}],
        "outputs": [{"name": "", "type": "uint256"}],
    },
    {
        "name": "lockMarket",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [],
        "outputs": [],
    },
    {
        "name": "distributeAll",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [],
        "outputs": [],
    },
]

FACTORY_READ_ABI = [
    {
        "name": "getActiveMarkets",
        "type": "function",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"name": "", "type": "address[]"}],
    },
]

MARKET_RESOLVED_ABI = {
    "name": "MarketResolved",
    "type": "event",
    "inputs": [
        {"name": "winningRangeIndex", "type": "uint256", "indexed": False},
        {"name": "actualCarCount",    "type": "uint256", "indexed": False},
    ],
}

# ── Constants ─────────────────────────────────────────────────────────────────

UINT256_MAX = 2 ** 256 - 1
MIN_BET_WEI = 10 ** 15               # 0.001 ETH
MAX_BET_WEI = 10 ** 18               # 1 ETH
DEFAULT_GAS  = 3_000_000
INTER_ROUND_SECS = 15
MAX_TX_RETRIES = 3
TX_WAIT_TIMEOUT = 120                 # seconds to wait for receipt


# ── Config ────────────────────────────────────────────────────────────────────

class Config:
    """Loads configuration from environment variables with sensible defaults."""

    def __init__(self) -> None:
        self.private_key: str = self._require("PRIVATE_KEY")
        self.rpc_url: str = os.environ.get(
            "RPC_URL",
            "https://base-mainnet.core.chainstack.com/977532e58b2430d1f01739e7d209d236",
        )
        self.factory_address: str = self._require_address("FACTORY_ADDRESS")
        self.fee_recipient: str = os.environ.get(
            "FEE_RECIPIENT",
            "0xdd12D83786C2BAc7be3D59869834C23E91449A2D",
        )
        self.round_duration: int = int(os.environ.get("ROUND_DURATION", "300"))
        self.betting_window: int = int(os.environ.get("BETTING_WINDOW", "150"))
        self.ws_port: int = int(os.environ.get("WS_PORT", "8765"))
        self.ledger_url: str = os.environ.get(
            "LEDGER_URL", "https://www.rushgame.vip/api/ledger"
        )
        self.ledger_api_key: str = os.environ.get("LEDGER_API_KEY", "")

    @staticmethod
    def _require(name: str) -> str:
        value = os.environ.get(name, "").strip()
        if not value:
            log.error("Missing required environment variable: %s", name)
            sys.exit(1)
        return value

    def _require_address(self, name: str) -> str:
        raw = self._require(name)
        if not Web3.is_address(raw):
            log.error("Invalid Ethereum address in %s: %s", name, raw)
            sys.exit(1)
        return Web3.to_checksum_address(raw)


# ── Camera loader ─────────────────────────────────────────────────────────────

def load_cameras() -> list[dict]:
    """Return the list of camera configs from cameras.json."""
    cameras_path = _HERE / "cameras.json"
    with open(cameras_path) as f:
        data = json.load(f)
    return data["cameras"]


def pick_round_cameras(cameras: list[dict]) -> list[dict]:
    """
    Return the two primary cameras used for alternating rounds.

    Preference order:
      1. peace-bridge
      2. peace-bridge-qew
    Falls back to the first two cameras in the file.
    """
    by_id = {c["id"]: c for c in cameras}
    primary_ids = ["peace-bridge"]
    result = [by_id[cid] for cid in primary_ids if cid in by_id]
    if not result:
        result = cameras[:1]
    return result


# ── Chain helpers ─────────────────────────────────────────────────────────────

class ChainClient:
    """Thin wrapper around web3.py for signing and sending transactions."""

    def __init__(self, cfg: Config) -> None:
        self.w3 = Web3(Web3.HTTPProvider(cfg.rpc_url, request_kwargs={"timeout": 60}))
        if not self.w3.is_connected():
            log.error("Cannot connect to RPC: %s", cfg.rpc_url)
            sys.exit(1)

        self.account = Account.from_key(cfg.private_key)
        self.factory = self.w3.eth.contract(
            address=Web3.to_checksum_address(cfg.factory_address),
            abi=FACTORY_ABI,
        )
        log.info("Chain: connected to %s (chain_id=%d)", cfg.rpc_url, self.w3.eth.chain_id)
        log.info("Oracle wallet: %s", self.account.address)

    # ── Low-level tx helper ───────────────────────────────────────────────────

    def _send_tx(self, fn_call, gas: int = DEFAULT_GAS) -> str:
        """
        Build, sign, and broadcast a contract call.

        Args:
            fn_call: A web3 contract function prepared with .build_transaction()
                     called by the caller — or the fn call object itself.
            gas:     Gas limit.

        Returns:
            Transaction hash hex string.

        Raises:
            Exception: on RPC error or signing failure.
        """
        nonce = self.w3.eth.get_transaction_count(self.account.address, "pending")
        gas_price = self.w3.eth.gas_price

        tx = fn_call.build_transaction({
            "from":     self.account.address,
            "nonce":    nonce,
            "gas":      gas,
            "gasPrice": gas_price,
        })

        signed = self.account.sign_transaction(tx)
        tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        return tx_hash.hex()

    def wait_for_receipt(self, tx_hash: str, timeout: int = TX_WAIT_TIMEOUT):
        """Poll until the transaction is mined, then return its receipt."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                receipt = self.w3.eth.get_transaction_receipt(tx_hash)
                if receipt is not None:
                    return receipt
            except TransactionNotFound:
                pass
            time.sleep(2)
        raise TimeoutError(f"Tx {tx_hash} not mined within {timeout}s")

    # ── createMarket ──────────────────────────────────────────────────────────

    def create_market(
        self,
        stream_url: str,
        description: str,
        duration_secs: int,
        threshold: int,
    ) -> tuple[str, str]:
        """
        Call MarketFactory.createMarket() and parse the MarketCreated event.

        Args:
            stream_url:    Camera stream URL (YouTube or HLS).
            description:   Human-readable market description.
            duration_secs: Betting/counting window in seconds.
            threshold:     Vehicle count threshold separating Under/Over.

        Returns:
            (market_address, tx_hash) on success.

        Raises:
            Exception on RPC or event-parsing failure.
        """
        labels = [f"Under {threshold}", f"Over {threshold}"]
        mins   = [0, threshold + 1]
        maxs   = [threshold, UINT256_MAX]

        fn_call = self.factory.functions.createMarket(
            stream_url,
            description,
            duration_secs,
            MIN_BET_WEI,
            MAX_BET_WEI,
            labels,
            mins,
            maxs,
        )

        tx_hash = self._send_tx(fn_call)
        log.info("createMarket tx sent: %s", tx_hash)

        receipt = self.wait_for_receipt(tx_hash)
        if receipt["status"] != 1:
            raise RuntimeError(f"createMarket reverted — tx: {tx_hash}")

        # Parse MarketCreated event to extract market address
        event_sig = self.w3.keccak(text="MarketCreated(uint256,address,string,uint256,bool)").hex()
        market_address: Optional[str] = None

        for log_entry in receipt.get("logs", []):
            topics = log_entry.get("topics", [])
            if topics and topics[0].hex() == event_sig:
                # marketAddress is the second indexed topic (topics[2])
                raw_addr = topics[2].hex()
                market_address = Web3.to_checksum_address("0x" + raw_addr[-40:])
                break

        if not market_address:
            raise RuntimeError("MarketCreated event not found in receipt")

        return market_address, tx_hash

    # ── resolveMarket ─────────────────────────────────────────────────────────

    def resolve_market(self, market_address: str, count: int) -> str:
        """
        Call PredictionMarket.resolveMarket(count).

        Args:
            market_address: Checksum address of the deployed market.
            count:          Observed vehicle count.

        Returns:
            Transaction hash hex string.

        Raises:
            RuntimeError if the transaction reverts.
        """
        market = self.w3.eth.contract(
            address=Web3.to_checksum_address(market_address),
            abi=MARKET_ABI,
        )
        fn_call = market.functions.resolveMarket(count)
        tx_hash = self._send_tx(fn_call)
        log.info("resolveMarket tx sent: %s", tx_hash)

        receipt = self.wait_for_receipt(tx_hash)
        if receipt["status"] != 1:
            raise RuntimeError(f"resolveMarket reverted — tx: {tx_hash}")

        return tx_hash

    # ── cancelMarket ─────────────────────────────────────────────────────────

    def cancel_market(self, market_address: str) -> Optional[str]:
        """
        Call PredictionMarket.cancelMarket() (best-effort; errors are logged,
        not re-raised so the main loop can continue to the next round).

        Returns:
            Transaction hash or None if the call failed.
        """
        try:
            market = self.w3.eth.contract(
                address=Web3.to_checksum_address(market_address),
                abi=MARKET_ABI,
            )
            fn_call = market.functions.cancelMarket()
            tx_hash = self._send_tx(fn_call, gas=200_000)
            receipt = self.wait_for_receipt(tx_hash)
            if receipt["status"] == 1:
                log.info("Market cancelled: %s (tx: %s)", market_address, tx_hash)
                return tx_hash
            else:
                log.warning("cancelMarket reverted for %s", market_address)
        except Exception as exc:
            log.warning("cancelMarket failed for %s: %s", market_address, exc)
        return None

    # ── lockMarket ────────────────────────────────────────────────────────────

    def lock_market(self, market_address: str) -> Optional[str]:
        """Call PredictionMarket.lockMarket() to close betting."""
        try:
            market = self.w3.eth.contract(
                address=Web3.to_checksum_address(market_address),
                abi=MARKET_ABI,
            )
            fn_call = market.functions.lockMarket()
            tx_hash = self._send_tx(fn_call, gas=100_000)
            receipt = self.wait_for_receipt(tx_hash)
            if receipt["status"] == 1:
                log.info("Market locked: %s (tx: %s)", market_address, tx_hash)
                return tx_hash
            else:
                log.warning("lockMarket reverted for %s", market_address)
        except Exception as exc:
            log.warning("lockMarket failed for %s: %s", market_address, exc)
        return None

    # ── distributeAll ─────────────────────────────────────────────────────────

    def distribute_all(self, market_address: str) -> Optional[str]:
        """Call PredictionMarket.distributeAll() to auto-pay all winners."""
        try:
            market = self.w3.eth.contract(
                address=Web3.to_checksum_address(market_address),
                abi=MARKET_ABI,
            )
            fn_call = market.functions.distributeAll()
            tx_hash = self._send_tx(fn_call, gas=3_000_000)
            receipt = self.wait_for_receipt(tx_hash)
            if receipt["status"] == 1:
                log.info("Winnings distributed: %s (tx: %s)", market_address, tx_hash)
                return tx_hash
            else:
                log.warning("distributeAll reverted for %s", market_address)
        except Exception as exc:
            log.warning("distributeAll failed for %s: %s", market_address, exc)
        return None


# ── Subprocess runner (stream_server.py) ──────────────────────────────────────

class StreamSubprocess:
    """
    Manages a single run of stream_server.py as a subprocess.

    stream_server.py writes result.json to its working directory
    when the duration expires.  We simply wait for the process to
    finish, then read that file.
    """

    def __init__(
        self,
        camera: dict,
        duration: int,
        ws_port: int,
    ) -> None:
        self.camera = camera
        self.duration = duration
        self.ws_port = ws_port
        self._proc: Optional[asyncio.subprocess.Process] = None

    async def start(self) -> None:
        """Launch stream_server.py; returns immediately (non-blocking)."""
        stream_server = _HERE / "stream_server.py"

        stream_url = self.camera.get("streamUrl") or self.camera.get("imageUrl", "")
        cam_id     = self.camera["id"]

        cmd = [
            sys.executable,
            str(stream_server),
            "--camera", cam_id,
            "--duration", str(self.duration),
            "--port", str(self.ws_port),
        ]

        log.info("Spawning stream_server.py: %s", " ".join(cmd))

        self._proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=str(_HERE),
        )

    async def wait(self) -> int:
        """
        Stream stdout while waiting for the process to exit.

        Returns:
            Process return code.
        """
        if self._proc is None:
            raise RuntimeError("start() has not been called")

        assert self._proc.stdout is not None  # set above

        async for raw_line in self._proc.stdout:
            line = raw_line.decode(errors="replace").rstrip()
            if line:
                log.debug("[stream_server] %s", line)

        await self._proc.wait()
        return self._proc.returncode or 0

    async def terminate(self) -> None:
        """Send SIGTERM to the subprocess and wait up to 10 s for it to exit."""
        if self._proc and self._proc.returncode is None:
            try:
                self._proc.terminate()
                try:
                    await asyncio.wait_for(self._proc.wait(), timeout=10)
                except asyncio.TimeoutError:
                    log.warning("stream_server did not exit after SIGTERM; sending SIGKILL")
                    self._proc.kill()
                    await self._proc.wait()
            except ProcessLookupError:
                pass  # already gone

    def read_result(self) -> Optional[dict]:
        """
        Read result.json written by stream_server.py.

        Returns:
            Parsed dict or None if the file is missing / corrupt.
        """
        result_path = _HERE / "result.json"
        try:
            with open(result_path) as f:
                data = json.load(f)
            return data
        except FileNotFoundError:
            log.error("result.json not found — stream may have crashed")
            return None
        except json.JSONDecodeError as exc:
            log.error("result.json is corrupt: %s", exc)
            return None


# ── Adaptive threshold ────────────────────────────────────────────────────────

class AdaptiveThreshold:
    """
    Tracks the rolling average of recent vehicle counts and
    derives the Under/Over threshold for the next round.
    """

    HISTORY_SIZE = 5
    MIN_THRESHOLD = 20
    MAX_THRESHOLD = 200

    def __init__(self, initial: int = 50) -> None:
        self._history: list[int] = []
        self._override = initial  # used until we have at least one real count

    @property
    def value(self) -> int:
        if not self._history:
            return self._override
        raw = int(sum(self._history) / len(self._history))
        return max(self.MIN_THRESHOLD, min(raw, self.MAX_THRESHOLD))

    def update(self, count: int) -> None:
        self._history.append(count)
        if len(self._history) > self.HISTORY_SIZE:
            self._history.pop(0)
        log.info(
            "New threshold: %d (avg of %s)",
            self.value,
            self._history,
        )


# ── Round Manager ─────────────────────────────────────────────────────────────

class RushRoundManager:
    """
    Orchestrates infinite prediction market rounds for the Rush project.

    Alternates between two cameras, creates a market before each counting
    window, resolves it afterward, and updates the threshold adaptively.
    """

    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self.chain = ChainClient(cfg)
        self.cameras = pick_round_cameras(load_cameras())
        self.threshold = AdaptiveThreshold(initial=50)
        self.round_number = 0
        self._shutdown = False

    def w3_factory_read(self):
        """Return a read-only factory contract instance for checking active markets."""
        return self.chain.w3.eth.contract(
            address=Web3.to_checksum_address(self.cfg.factory_address),
            abi=FACTORY_READ_ABI,
        )

    # ── Ledger POST ────────────────────────────────────────────────────────────

    def _post_ledger(self, record: dict) -> None:
        """POST market record to the ledger API (best-effort, never blocks the loop)."""
        try:
            data = json.dumps(record).encode("utf-8")
            req = urllib.request.Request(
                self.cfg.ledger_url,
                data=data,
                headers={
                    "Content-Type": "application/json",
                    "X-Api-Key": self.cfg.ledger_api_key,
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                body = resp.read().decode()
                log.info("Ledger POST OK: %s", body)
        except Exception as exc:
            log.warning("Ledger POST failed (non-fatal): %s", exc)

    # ── Ably publish ──────────────────────────────────────────────────────────

    def _publish_ably(self, event: str, data: dict) -> None:
        """Publish an event to Ably rush:market channel (best-effort, never blocks the loop)."""
        api_key = os.environ.get("ABLY_API_KEY", "")
        if not api_key:
            return
        try:
            import base64
            url = "https://rest.ably.io/channels/rush%3Amarket/messages"
            payload = json.dumps({"name": event, "data": json.dumps(data)}).encode("utf-8")
            req = urllib.request.Request(
                url,
                data=payload,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Basic {base64.b64encode(api_key.encode()).decode()}",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                resp.read()
            log.info("Ably publish OK: %s", event)
        except Exception as exc:
            log.warning("Ably publish failed (non-fatal): %s", exc)

    # ── Graceful shutdown ─────────────────────────────────────────────────────

    def request_shutdown(self) -> None:
        """Signal the main loop to exit after the current round completes."""
        self._shutdown = True
        log.info("Shutdown requested — will exit after this round.")

    # ── Single round ──────────────────────────────────────────────────────────

    async def _run_round(self) -> None:
        self.round_number += 1
        camera = self.cameras[(self.round_number - 1) % len(self.cameras)]
        stream_url = camera.get("streamUrl") or camera.get("imageUrl", "")
        cam_name   = camera["name"]
        threshold  = self.threshold.value

        log.info("Round #%d starting", self.round_number)
        log.info("Camera: %s (%s)", cam_name, stream_url)
        log.info("Threshold: %d  (Under %d / Over %d)", threshold, threshold, threshold)

        # ── Step 0: Check for active markets (cancel orphans or skip) ─────────
        try:
            factory_read = self.w3_factory_read()
            active = factory_read.functions.getActiveMarkets().call()
            if len(active) > 0:
                # Check if these are orphan markets (lock time passed)
                now = int(time.time())
                all_orphans = True
                for addr in active:
                    try:
                        orphan_market = self.chain.w3.eth.contract(
                            address=Web3.to_checksum_address(addr),
                            abi=MARKET_ABI,
                        )
                        market_lock = orphan_market.functions.lockTime().call()
                        if now < market_lock:
                            all_orphans = False  # Still within lock window
                            break
                    except Exception:
                        pass

                if all_orphans:
                    # Cancel all orphan markets
                    for addr in active:
                        log.info("Cancelling orphan market: %s", addr)
                        self.chain.cancel_market(addr)
                        self._publish_ably("market_cancelled", {
                            "marketAddress": addr,
                            "ts": int(time.time() * 1000),
                        })
                    log.info("Cancelled %d orphan market(s) — proceeding to create new one", len(active))
                else:
                    log.warning(
                        "Active market(s) still within lock window: %s — skipping round",
                        active,
                    )
                    return
        except Exception as exc:
            log.warning("Could not check active markets (proceeding anyway): %s", exc)

        # ── Step 1: Create market ─────────────────────────────────────────────
        description = f"{cam_name} — How many vehicles in 5 min?"
        market_address: Optional[str] = None

        for attempt in range(1, MAX_TX_RETRIES + 1):
            try:
                market_address, create_tx = self.chain.create_market(
                    stream_url=stream_url,
                    description=description,
                    duration_secs=self.cfg.betting_window,
                    threshold=threshold,
                )
                log.info(
                    "Market created: %s (tx: %s)",
                    market_address,
                    create_tx,
                )
                # Broadcast to all connected frontends via Ably
                lock_time_val = 0
                try:
                    mc = self.chain.w3.eth.contract(
                        address=Web3.to_checksum_address(market_address),
                        abi=MARKET_ABI,
                    )
                    lock_time_val = mc.functions.lockTime().call()
                except Exception:
                    pass
                self._publish_ably("market_created", {
                    "marketAddress": market_address,
                    "txHash": create_tx,
                    "threshold": threshold,
                    "lockTime": lock_time_val,
                    "description": description,
                    "ts": int(time.time() * 1000),
                })
                break
            except Exception as exc:
                log.error(
                    "createMarket attempt %d/%d failed: %s",
                    attempt,
                    MAX_TX_RETRIES,
                    exc,
                )
                if attempt < MAX_TX_RETRIES:
                    await asyncio.sleep(5 * attempt)
                else:
                    log.error("All createMarket attempts exhausted — skipping round")
                    return

        assert market_address is not None

        # ── Step 2: Run the YOLO counter ──────────────────────────────────────
        log.info("Counting vehicles for %ds...", self.cfg.round_duration)
        stream = StreamSubprocess(
            camera=camera,
            duration=self.cfg.round_duration,
            ws_port=self.cfg.ws_port,
        )

        count: Optional[int] = None
        try:
            await stream.start()

            # Lock betting after the betting window
            lock_delay = self.cfg.betting_window
            if 0 < lock_delay < self.cfg.round_duration:
                log.info("Locking bets after %ds...", lock_delay)
                await asyncio.sleep(lock_delay)
                self.chain.lock_market(market_address)
                self._publish_ably("market_locked", {
                    "marketAddress": market_address,
                    "ts": int(time.time() * 1000),
                })

            returncode = await stream.wait()
            if returncode != 0:
                log.warning("stream_server.py exited with code %d", returncode)

            result = stream.read_result()
            if result is None:
                raise RuntimeError("No result.json produced by stream_server.py")

            count = int(result["count"])
            log.info(
                "Count complete: %d vehicles (in=%d out=%d)",
                count,
                result.get("in_count", 0),
                result.get("out_count", 0),
            )

        except asyncio.CancelledError:
            log.warning("Round cancelled — terminating stream subprocess")
            await stream.terminate()
            self.chain.cancel_market(market_address)
            self._publish_ably("market_cancelled", {
                "marketAddress": market_address,
                "ts": int(time.time() * 1000),
            })
            raise

        except Exception as exc:
            log.error("Stream/counter error: %s — cancelling market", exc)
            await stream.terminate()
            self.chain.cancel_market(market_address)
            self._publish_ably("market_cancelled", {
                "marketAddress": market_address,
                "ts": int(time.time() * 1000),
            })
            return

        # ── Step 2.5: Check pool before resolving ─────────────────────────────
        # If no bets or only one side has bets, cancel instead of resolving
        # to avoid wasting gas or penalizing one-sided bettors with a 5% fee.
        try:
            market_contract = self.chain.w3.eth.contract(
                address=Web3.to_checksum_address(market_address),
                abi=MARKET_ABI,
            )
            total_pool = market_contract.functions.totalPool().call()
            pool_under = market_contract.functions.poolByRange(0).call()
            pool_over = market_contract.functions.poolByRange(1).call()

            if total_pool == 0:
                log.info("No bets placed — cancelling market (no gas wasted on resolve)")
                self.chain.cancel_market(market_address)
                self._publish_ably("market_cancelled", {
                    "marketAddress": market_address,
                    "ts": int(time.time() * 1000),
                })
                self._post_ledger({
                    "address": market_address,
                    "createdAt": int(time.time()) - self.cfg.round_duration,
                    "resolvedAt": int(time.time()),
                    "state": "cancelled",
                    "streamUrl": stream_url,
                    "description": description,
                    "cameraName": cam_name,
                    "threshold": threshold,
                    "actualCount": count,
                    "winningRange": None,
                    "winningRangeIndex": None,
                    "totalPool": "0",
                    "overPool": "0",
                    "underPool": "0",
                    "totalBettors": 0,
                    "feeCollected": "0",
                    "txHashCreate": create_tx,
                    "txHashResolve": None,
                    "roundNumber": self.round_number,
                    "bets": [],
                })
                self.threshold.update(count)
                return

            if pool_under == 0 or pool_over == 0:
                empty_side = "UNDER" if pool_under == 0 else "OVER"
                log.info(
                    "One-sided market (no %s bets) — cancelling to protect bettors from losing 5%% fee without adversary",
                    empty_side,
                )
                self.chain.cancel_market(market_address)
                self._publish_ably("market_cancelled", {
                    "marketAddress": market_address,
                    "ts": int(time.time() * 1000),
                })
                self._post_ledger({
                    "address": market_address,
                    "createdAt": int(time.time()) - self.cfg.round_duration,
                    "resolvedAt": int(time.time()),
                    "state": "cancelled",
                    "streamUrl": stream_url,
                    "description": description,
                    "cameraName": cam_name,
                    "threshold": threshold,
                    "actualCount": count,
                    "winningRange": None,
                    "winningRangeIndex": None,
                    "totalPool": str(total_pool / 10**18),
                    "overPool": str(pool_over / 10**18),
                    "underPool": str(pool_under / 10**18),
                    "totalBettors": 0,
                    "feeCollected": "0",
                    "txHashCreate": create_tx,
                    "txHashResolve": None,
                    "roundNumber": self.round_number,
                    "bets": [],
                })
                self.threshold.update(count)
                return

            log.info(
                "Pool check OK: total=%.4f ETH, under=%.4f, over=%.4f — proceeding to resolve",
                total_pool / 10**18,
                pool_under / 10**18,
                pool_over / 10**18,
            )
        except Exception as exc:
            log.warning("Could not check pool (proceeding to resolve anyway): %s", exc)

        # ── Step 3: Resolve market ────────────────────────────────────────────
        winning_label = f"Under {threshold}" if count <= threshold else f"Over {threshold}"
        log.info(
            "Market resolved: %d vehicles → %s wins",
            count,
            winning_label,
        )

        resolve_tx: Optional[str] = None
        for attempt in range(1, MAX_TX_RETRIES + 1):
            try:
                resolve_tx = self.chain.resolve_market(market_address, count)
                log.info(
                    "resolveMarket confirmed (tx: %s)",
                    resolve_tx,
                )
                self._publish_ably("market_resolved", {
                    "marketAddress": market_address,
                    "actualCount": count,
                    "winningRangeIndex": 0 if count <= threshold else 1,
                    "txHash": resolve_tx,
                    "ts": int(time.time() * 1000),
                })
                break
            except Exception as exc:
                log.error(
                    "resolveMarket attempt %d/%d failed: %s",
                    attempt,
                    MAX_TX_RETRIES,
                    exc,
                )
                if attempt < MAX_TX_RETRIES:
                    await asyncio.sleep(5 * attempt)
                else:
                    log.error("All resolveMarket attempts exhausted — market left unresolved")

        # Auto-distribute winnings to all bettors
        if resolve_tx:
            distribute_tx = self.chain.distribute_all(market_address)
            if distribute_tx:
                log.info("Auto-distributed winnings (tx: %s)", distribute_tx)
                self._publish_ably("winnings_distributed", {
                    "marketAddress": market_address,
                    "txHash": distribute_tx,
                    "ts": int(time.time() * 1000),
                })

        # ── Step 4: Post to ledger API ────────────────────────────────────────
        # Extract evidence data from result.json if available
        evidence_data = None
        if result and "evidence" in result:
            evidence_data = result["evidence"]

        ledger_record = {
            "address": market_address,
            "createdAt": int(time.time()) - self.cfg.round_duration,
            "resolvedAt": int(time.time()),
            "state": "resolved",
            "streamUrl": stream_url,
            "description": description,
            "cameraName": cam_name,
            "threshold": threshold,
            "actualCount": count,
            "winningRange": winning_label,
            "winningRangeIndex": 0 if count <= threshold else 1,
            "totalPool": "0",       # read from chain if needed
            "overPool": "0",
            "underPool": "0",
            "totalBettors": 0,
            "feeCollected": "0",
            "txHashCreate": create_tx,
            "txHashResolve": resolve_tx,
            "roundNumber": self.round_number,
            "bets": [],
        }
        if evidence_data is not None:
            ledger_record["evidence"] = evidence_data

        self._post_ledger(ledger_record)

        # ── Step 5: Update adaptive threshold ─────────────────────────────────
        self.threshold.update(count)

    # ── Main loop ─────────────────────────────────────────────────────────────

    async def run(self, max_rounds: int = 0) -> None:
        """
        Run rounds in an infinite loop (or up to max_rounds if > 0).

        Args:
            max_rounds: 0 means run indefinitely.
        """
        log.info("=" * 60)
        log.info("  SinalBet Rush Round Manager")
        log.info("  Factory:  %s", self.cfg.factory_address)
        log.info("  Duration: %ds per round", self.cfg.round_duration)
        log.info("  Cameras:  %s", " | ".join(c["name"] for c in self.cameras))
        log.info("=" * 60)

        finished = 0
        while not self._shutdown:
            if max_rounds > 0 and finished >= max_rounds:
                break

            try:
                await self._run_round()
                finished += 1
            except KeyboardInterrupt:
                log.info("KeyboardInterrupt — stopping.")
                break
            except asyncio.CancelledError:
                log.info("Task cancelled — stopping.")
                break
            except Exception as exc:
                log.exception("Unhandled exception in round %d: %s", self.round_number, exc)
                log.info("Waiting 30s before retrying...")
                await asyncio.sleep(30)
                continue

            if self._shutdown:
                break
            if max_rounds > 0 and finished >= max_rounds:
                break

            log.info(
                "Waiting %ds before Round #%d...",
                INTER_ROUND_SECS,
                self.round_number + 1,
            )
            await asyncio.sleep(INTER_ROUND_SECS)

        log.info("Round Manager stopped after %d round(s).", finished)


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="SinalBet Rush — Automated Oracle (market create → count → resolve)",
    )
    parser.add_argument(
        "--rounds", "-r",
        type=int,
        default=0,
        metavar="N",
        help="Number of rounds to run (default: 0 = infinite)",
    )
    args = parser.parse_args()

    cfg = Config()
    manager = RushRoundManager(cfg)

    loop = asyncio.new_event_loop()

    def _sigterm(signum, frame):  # noqa: ANN001
        log.info("SIGTERM received — requesting graceful shutdown")
        manager.request_shutdown()

    signal.signal(signal.SIGTERM, _sigterm)

    try:
        loop.run_until_complete(manager.run(max_rounds=args.rounds))
    except KeyboardInterrupt:
        log.info("Interrupted by user.")
    finally:
        loop.close()


if __name__ == "__main__":
    main()
