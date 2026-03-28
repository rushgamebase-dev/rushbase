"""
Rush Oracle — Standalone Orphan Market Recovery

Finds markets that are stuck in OPEN or LOCKED state past their
resolution window and cancels them on-chain.

A market is considered orphaned when:
    createdAt + roundDuration + GRACE_SECS < now

Usage
-----
    python3 orphan_recovery.py              # live run (cancels orphans)
    python3 orphan_recovery.py --dry-run    # report only, no transactions

Environment variables
---------------------
    PRIVATE_KEY       Oracle wallet private key (required for live run)
    RPC_URL           Base RPC endpoint
    FACTORY_ADDRESS   MarketFactory contract address
    ROUND_DURATION    Round window in seconds (default: 300)
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from typing import Optional

# ── web3 ──────────────────────────────────────────────────────────────────────
try:
    from web3 import Web3
    from eth_account import Account
except ImportError:
    print("ERROR: web3 not installed.  Run: pip install web3")
    sys.exit(1)

# ── logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("orphan_recovery")

# ── ABI fragments (same names as round_manager_rush.py plus read-only views) ──

FACTORY_ABI = [
    {
        "name": "createMarket",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "_streamUrl",         "type": "string"},
            {"name": "_description",       "type": "string"},
            {"name": "_roundDurationSecs", "type": "uint256"},
            {"name": "_minBet",            "type": "uint256"},
            {"name": "_maxBet",            "type": "uint256"},
            {"name": "_rangeLabels",       "type": "string[]"},
            {"name": "_rangeMins",         "type": "uint256[]"},
            {"name": "_rangeMaxs",         "type": "uint256[]"},
        ],
        "outputs": [{"name": "", "type": "address"}],
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

MARKET_ABI = [
    {
        "name": "resolveMarket",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [{"name": "_actualCarCount", "type": "uint256"}],
        "outputs": [],
    },
    {
        "name": "cancelMarket",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [],
        "outputs": [],
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
]

# ── constants ─────────────────────────────────────────────────────────────────

# Market state values as returned by the contract
MARKET_STATE_OPEN     = 0
MARKET_STATE_LOCKED   = 1
MARKET_STATE_RESOLVED = 2
MARKET_STATE_CANCELLED = 3

STATE_NAMES = {
    MARKET_STATE_OPEN:      "OPEN",
    MARKET_STATE_LOCKED:    "LOCKED",
    MARKET_STATE_RESOLVED:  "RESOLVED",
    MARKET_STATE_CANCELLED: "CANCELLED",
}

GRACE_SECS  = 600        # 10 minutes past end-of-round before we cancel
DEFAULT_GAS = 200_000
TX_TIMEOUT  = 120        # seconds to wait for mining


# ── helpers ───────────────────────────────────────────────────────────────────

def _fmt_age(seconds: float) -> str:
    seconds = int(seconds)
    h, rem = divmod(seconds, 3600)
    m, s   = divmod(rem, 60)
    if h:
        return f"{h}h {m:02d}m {s:02d}s"
    if m:
        return f"{m}m {s:02d}s"
    return f"{s}s"


def _wait_receipt(w3: Web3, tx_hash: bytes, timeout: int = TX_TIMEOUT) -> Optional[dict]:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            receipt = w3.eth.get_transaction_receipt(tx_hash)
            if receipt is not None:
                return receipt
        except Exception:
            pass
        time.sleep(2)
    return None


# ── core logic ────────────────────────────────────────────────────────────────

def find_and_cancel_orphans(dry_run: bool = False) -> int:
    """
    Main entry point.

    Args:
        dry_run: When True, report orphans but do not send any transactions.

    Returns:
        Number of markets cancelled (or that would have been cancelled in dry-run).
    """
    # ── load config from env ──────────────────────────────────────────────────
    private_key    = os.environ.get("PRIVATE_KEY", "").strip()
    rpc_url        = os.environ.get(
        "RPC_URL",
        "https://base-mainnet.core.chainstack.com/977532e58b2430d1f01739e7d209d236",
    )
    factory_raw    = os.environ.get("FACTORY_ADDRESS", "").strip()
    round_duration = int(os.environ.get("ROUND_DURATION", "300"))

    if not factory_raw:
        log.error("FACTORY_ADDRESS environment variable is required")
        sys.exit(1)

    if not dry_run and not private_key:
        log.error("PRIVATE_KEY environment variable is required for live run")
        log.error("Use --dry-run to scan without sending transactions")
        sys.exit(1)

    if not Web3.is_address(factory_raw):
        log.error("FACTORY_ADDRESS is not a valid Ethereum address: %s", factory_raw)
        sys.exit(1)

    factory_address = Web3.to_checksum_address(factory_raw)

    # ── connect ───────────────────────────────────────────────────────────────
    w3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": 60}))
    if not w3.is_connected():
        log.error("Cannot connect to RPC: %s", rpc_url)
        sys.exit(1)

    log.info("Connected to %s (chain_id=%d)", rpc_url, w3.eth.chain_id)

    account: Optional[object] = None
    if not dry_run:
        account = Account.from_key(private_key)
        log.info("Oracle wallet: %s", account.address)

    factory = w3.eth.contract(
        address=factory_address,
        abi=FACTORY_READ_ABI,
    )

    # ── enumerate active markets ──────────────────────────────────────────────
    try:
        active_markets: list[str] = factory.functions.getActiveMarkets().call()
    except Exception as exc:
        log.error("getActiveMarkets() failed: %s", exc)
        sys.exit(1)

    log.info("Active markets returned by factory: %d", len(active_markets))

    if not active_markets:
        log.info("Nothing to do.")
        return 0

    now        = int(time.time())
    orphans    = []
    non_orphan = 0

    # ── inspect each market ───────────────────────────────────────────────────
    for addr in active_markets:
        checksum = Web3.to_checksum_address(addr)
        # Combine read ABI (views) and write ABI (cancelMarket) for this contract
        market = w3.eth.contract(
            address=checksum,
            abi=MARKET_READ_ABI + [e for e in MARKET_ABI if e["name"] == "cancelMarket"],
        )

        try:
            state      = market.functions.state().call()
            created_at = market.functions.createdAt().call()
        except Exception as exc:
            log.warning("Skipping %s — could not read state/createdAt: %s", checksum, exc)
            continue

        state_name = STATE_NAMES.get(state, f"UNKNOWN({state})")

        if state not in (MARKET_STATE_OPEN, MARKET_STATE_LOCKED):
            log.debug(
                "Market %s is in state %s — skipping",
                checksum,
                state_name,
            )
            continue

        # Attempt to read lockTime for better diagnostics (best-effort)
        lock_time: Optional[int] = None
        try:
            lock_time = market.functions.lockTime().call()
        except Exception:
            pass

        expiry     = created_at + round_duration + GRACE_SECS
        age        = now - created_at
        time_over  = now - expiry

        if now < expiry:
            remaining = expiry - now
            log.info(
                "Market %-44s  state=%-8s  age=%s  window closes in %s",
                checksum, state_name, _fmt_age(age), _fmt_age(remaining),
            )
            non_orphan += 1
            continue

        log.warning(
            "ORPHAN  %-44s  state=%-8s  age=%s  overdue by %s  createdAt=%d",
            checksum, state_name, _fmt_age(age), _fmt_age(time_over), created_at,
        )
        orphans.append({
            "address":    checksum,
            "state":      state,
            "state_name": state_name,
            "created_at": created_at,
            "age":        age,
            "time_over":  time_over,
            "lock_time":  lock_time,
            "market_contract": market,
        })

    log.info(
        "Scan complete: %d active, %d still within window, %d orphaned",
        len(active_markets),
        non_orphan,
        len(orphans),
    )

    if not orphans:
        log.info("No orphan markets found.")
        return 0

    if dry_run:
        log.info("[DRY RUN] Would cancel %d orphan market(s):", len(orphans))
        for o in orphans:
            log.info(
                "  [DRY RUN] %s  state=%s  age=%s  overdue_by=%s",
                o["address"],
                o["state_name"],
                _fmt_age(o["age"]),
                _fmt_age(o["time_over"]),
            )
        return len(orphans)

    # ── cancel each orphan ────────────────────────────────────────────────────
    cancelled = 0
    for o in orphans:
        checksum = o["address"]
        market   = o["market_contract"]

        log.info(
            "Cancelling %s (state=%s, age=%s, overdue by %s)...",
            checksum,
            o["state_name"],
            _fmt_age(o["age"]),
            _fmt_age(o["time_over"]),
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

            log.info("cancelMarket tx sent: %s", tx_hash.hex())
            receipt = _wait_receipt(w3, tx_hash)

            if receipt is None:
                log.error("Timed out waiting for receipt for %s", checksum)
                continue

            if receipt["status"] == 1:
                log.info(
                    "CANCELLED: %s  tx: %s  block: %d",
                    checksum,
                    tx_hash.hex(),
                    receipt["blockNumber"],
                )
                cancelled += 1
            else:
                log.error(
                    "cancelMarket REVERTED for %s  tx: %s",
                    checksum,
                    tx_hash.hex(),
                )

        except Exception as exc:
            log.error("cancelMarket failed for %s: %s", checksum, exc)

    log.info(
        "Done. Cancelled %d of %d orphan market(s).",
        cancelled,
        len(orphans),
    )
    return cancelled


# ── entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Rush Oracle — Orphan Market Recovery\n"
            "\n"
            "Scans all active markets and cancels any that are stuck in OPEN or\n"
            "LOCKED state past their resolution window + grace period.\n"
            "\n"
            "Required env vars: FACTORY_ADDRESS, PRIVATE_KEY (not needed for --dry-run)\n"
            "Optional env vars: RPC_URL, ROUND_DURATION"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report orphan markets without cancelling them (no transactions sent)",
    )
    args = parser.parse_args()

    if args.dry_run:
        log.info("DRY RUN mode — no transactions will be sent")

    count = find_and_cancel_orphans(dry_run=args.dry_run)
    sys.exit(0 if count >= 0 else 1)


if __name__ == "__main__":
    main()
