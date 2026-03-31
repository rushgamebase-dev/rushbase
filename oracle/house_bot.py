"""
Rush House Bot — Transparent Liquidity Seeder

Polls MarketFactory.getActiveMarkets() every few seconds.
When a new market appears, places 0.01 ETH on both sides.

Wallet: 0x2d882a197c15B8b3b544b8B131AE229B52643A73

Usage:  python3 house_bot.py
"""

import os
import sys
import time
import logging
import subprocess
import json
import random

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [HOUSE] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("house_bot")

HOUSE_KEY = os.environ.get("HOUSE_BOT_KEY", "")
HOUSE_ADDR = "0x2d882a197c15B8b3b544b8B131AE229B52643A73"
RPC_URL = os.environ.get("RPC_URL", "https://base-mainnet.core.chainstack.com/977532e58b2430d1f01739e7d209d236")
FACTORY = os.environ.get("FACTORY_ADDRESS", "0x5b04F3DFaE780A7e109066E754d27f491Af55Af9")
ABLY_KEY = os.environ.get("ABLY_API_KEY", "")
BET_ETH = "0.01"
POLL_INTERVAL = 5

if not HOUSE_KEY:
    print("ERROR: HOUSE_BOT_KEY not set")
    sys.exit(1)

# Ably for broadcasting bets to frontend
ably_client = None
try:
    import asyncio
    from ably import AblyRest
    if ABLY_KEY:
        ably_client = AblyRest(ABLY_KEY)
        log.info("Ably connected for bet broadcasting")
except Exception:
    log.warning("Ably not available — bets won't show in recent bets")

seen_markets = set()

def get_active_markets():
    """Get active markets from factory via cast."""
    r = subprocess.run(
        ["cast", "call", FACTORY, "getActiveMarkets()(address[])", "--rpc-url", RPC_URL],
        capture_output=True, text=True, timeout=15,
    )
    if r.returncode != 0:
        return []
    raw = r.stdout.strip().strip("[]")
    if not raw:
        return []
    return [a.strip() for a in raw.split(",") if a.strip()]

def publish_bet(side: str, tx_hash: str, amount: float = 0.005):
    """Publish bet to Ably so it shows in frontend recent bets."""
    if not ably_client:
        return
    try:
        channel = ably_client.channels.get("rush:bets")
        ts = int(time.time() * 1000)
        bet_data = {
            "id": f"{tx_hash}-{ts}",
            "user": HOUSE_ADDR,
            "shortWallet": f"{HOUSE_ADDR[:6]}...{HOUSE_ADDR[-4:]}",
            "side": side,
            "amount": amount,
            "txHash": tx_hash,
            "timestamp": ts,
        }
        asyncio.get_event_loop().run_until_complete(channel.publish("bet_placed", bet_data))
    except Exception:
        pass

def place_bet(market: str, side: int, amount: str = BET_ETH) -> str:
    """Place bet via cast send. Returns tx hash or empty on failure."""
    r = subprocess.run(
        ["cast", "send", market, "placeBet(uint256)", str(side),
         "--value", f"{amount}ether", "--private-key", HOUSE_KEY, "--rpc-url", RPC_URL],
        capture_output=True, text=True, timeout=30,
    )
    if r.returncode == 0:
        for line in r.stdout.splitlines():
            if "transactionHash" in line:
                return line.split()[-1].strip()
        return "ok"
    return ""

def random_bet():
    """Random bet amount between 0.007 and 0.013 ETH."""
    val = random.randint(7, 13) / 1000
    return f"{val:.3f}"

def seed_market(market: str):
    """Seed both sides with randomized amounts and timing."""
    log.info("Seeding %s...", market[:12])

    # Random delay before first bet (1-4s)
    time.sleep(random.uniform(1, 4))

    # Random order: sometimes OVER first
    sides = [(0, "under"), (1, "over")]
    if random.random() > 0.5:
        sides.reverse()

    bet1_amt = random_bet()
    bet2_amt = random_bet()

    # First side
    tx0 = place_bet(market, sides[0][0], bet1_amt)
    if tx0:
        log.info("  %s OK — %s ETH (%s)", sides[0][1].upper(), bet1_amt, tx0[:12])
        publish_bet(sides[0][1], tx0, float(bet1_amt))
    else:
        log.error("  %s FAILED", sides[0][1].upper())
        return

    # Random gap between bets (2-8s)
    time.sleep(random.uniform(2, 8))

    # Second side
    tx1 = place_bet(market, sides[1][0], bet2_amt)
    if tx1:
        log.info("  %s OK — %s ETH (%s)", sides[1][1].upper(), bet2_amt, tx1[:12])
        publish_bet(sides[1][1], tx1, float(bet2_amt))
    else:
        log.error("  %s FAILED", sides[1][1].upper())
        return

    log.info("Seeded %s — %s + %s ETH", market[:12], bet1_amt, bet2_amt)

def run():
    log.info("House bot started")
    log.info("Bet: %s ETH per side | Factory: %s", BET_ETH, FACTORY[:12])
    log.info("Polling every %ds for new markets...", POLL_INTERVAL)

    while True:
        try:
            markets = get_active_markets()
            for m in markets:
                if m not in seen_markets:
                    seen_markets.add(m)
                    seed_market(m)
        except Exception as exc:
            log.warning("Error: %s", exc)

        time.sleep(POLL_INTERVAL)

if __name__ == "__main__":
    try:
        run()
    except KeyboardInterrupt:
        log.info("Stopped.")
