"""
Rush House Bot — Transparent Liquidity Seeder (ETH mode)

Polls MarketFactory.getActiveMarkets() every few seconds.
When a new market appears, places minimum bets on both sides using native ETH.

Wallet: 0x2d882a197c15B8b3b544b8B131AE229B52643A73

Usage:  python3 house_bot.py
"""

import os
import sys
import time
import logging
import subprocess
import random

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [HOUSE] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("house_bot")

HOUSE_KEY = os.environ.get("HOUSE_BOT_KEY", "")
HOUSE_ADDR = "0x2d882a197c15B8b3b544b8B131AE229B52643A73"

CHAT_AFTER_SEED = [
    "LP seeded. 0.001 ETH each side. come get it",
    "both sides funded. your move",
    "house bot reporting for duty. pool is live",
    "0.001 ETH over, 0.001 ETH under. who's brave?",
    "initial liquidity deployed. let's go",
    "seeded. odds are live. bet or regret",
    "pool is hot. 2x if you call it right",
    "house bot here. I just funded both sides",
    "round is live. 0.001 ETH on each side. fight me",
    "LP in. the question is: over or under?",
    "funded. now it's your turn",
    "another round, another seed. who's playing?",
    "0.001 ETH on both sides. free money for someone",
    "house bot activated. bring it",
    "pool ready. you betting or watching?",
    "new round new money. who wants it?",
    "I put my ETH where my mouth is. both sides",
    "cars are moving. are you?",
    "over or under? I'm on both. beat me",
    "liquidity is in. no excuses now",
    "round funded. someone's taking my ETH today",
    "house bot doesn't sleep. neither should your bets",
    "double up or go home",
    "fresh round. fresh pool. fresh odds",
    "I seed, you reap. that's the deal",
    "bet against the house bot. I dare you",
    "pool loaded. first bet gets the best odds",
    "the cars don't care about your feelings. bet",
    "house bot just dropped liquidity. who's next?",
    "AI is counting. you should be betting",
    "both sides open. pick your side wisely",
    "round is hot. pool is funded. what are you waiting for?",
    "I bet on everything. you just need to pick one side",
    "your ETH could double right now",
    "the cameras are live. the pool is live. are you?",
    "house bot never misses a round. do you?",
    "free odds courtesy of the house bot",
    "seeded and ready. this pool won't fill itself",
    "if you're reading this, the pool is live",
    "over gang or under gang? choose",
    "house bot here. as always. with ETH. as always",
    "round is open. pool is warm. jump in",
    "someone's winning my ETH this round. might as well be you",
    "placed both sides. now I wait for a real player",
    "every round I show up. where's everyone else?",
    "liquidity provider checking in. pool is ready",
    "just seeded. first real bet doubles up easy",
]
random.shuffle(CHAT_AFTER_SEED)
_chat_index = 0

RPC_URL = os.environ.get("RPC_URL", "https://base-mainnet.core.chainstack.com/977532e58b2430d1f01739e7d209d236")
# ETH factory (MarketFactory)
FACTORY = os.environ.get("FACTORY_ADDRESS", "0x5b04F3DFaE780A7e109066E754d27f491Af55Af9")
ABLY_KEY = os.environ.get("ABLY_API_KEY", "")

# 0.001 ETH per side (matches historical minBet of 1e15 wei)
BET_ETH = "0.001"
BET_ETH_WEI = "1000000000000000"
POLL_INTERVAL = 2
CHAT_URL = "https://www.rushgame.vip/api/chat/messages"

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
failed_markets = {}  # market -> timestamp of last failure (cooldown 60s)

RPCS = [
    RPC_URL,
    "https://base.drpc.org",
    "https://base-rpc.publicnode.com",
]

def send_chat(text):
    if not ably_client:
        return
    try:
        channel = ably_client.channels.get("rush:chat")
        ts = int(time.time() * 1000)
        msg = {
            "id": f"house-{ts}-{random.randint(1000,9999)}",
            "username": f"{HOUSE_ADDR[:6]}...{HOUSE_ADDR[-4:]}",
            "address": HOUSE_ADDR,
            "color": "hsl(40, 70%, 60%)",
            "text": text,
            "timestamp": ts,
        }
        asyncio.get_event_loop().run_until_complete(channel.publish("message", msg))
        log.info("  Chat: %s", text)
    except Exception as exc:
        log.warning("  Chat failed: %s", exc)

def publish_bet(side, tx_hash, amount_eth=BET_ETH):
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
            "amount": amount_eth,
            "txHash": tx_hash,
            "timestamp": ts,
        }
        asyncio.get_event_loop().run_until_complete(channel.publish("bet_placed", bet_data))
    except Exception:
        pass

def get_active_markets():
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

def read_pool(market, side):
    for rpc in RPCS:
        try:
            r = subprocess.run(
                ["cast", "call", market, "poolByRange(uint256)(uint256)", str(side), "--rpc-url", rpc],
                capture_output=True, text=True, timeout=10,
            )
            if r.returncode == 0:
                return int(r.stdout.strip().split()[0])
        except Exception:
            continue
    return None

def read_state(market):
    for rpc in RPCS:
        try:
            r = subprocess.run(
                ["cast", "call", market, "state()(uint8)", "--rpc-url", rpc],
                capture_output=True, text=True, timeout=10,
            )
            if r.returncode == 0:
                return int(r.stdout.strip().split()[0])
        except Exception:
            continue
    return None

def place_bet(market, side, amount_wei=BET_ETH_WEI):
    r = None
    for rpc in RPCS:
        try:
            r = subprocess.run(
                ["cast", "send", market,
                 "placeBet(uint256)", str(side),
                 "--value", amount_wei,
                 "--private-key", HOUSE_KEY, "--rpc-url", rpc],
                capture_output=True, text=True, timeout=20,
            )
            if r.returncode == 0:
                break
            if "BETTING_CLOSED" in (r.stderr or "") or "WRONG_STATE" in (r.stderr or ""):
                return ""
            log.warning("  RPC %s failed: %s", rpc[:25], (r.stderr or "")[:120])
        except subprocess.TimeoutExpired:
            log.warning("  RPC %s timeout", rpc[:25])
            continue
    if r and r.returncode == 0:
        for line in r.stdout.splitlines():
            if "transactionHash" in line:
                return line.split()[-1].strip()
        return "ok"
    return ""

def place_bet_verified(market, side, amount_wei=BET_ETH_WEI, retries=3):
    target = int(amount_wei)
    for attempt in range(1, retries + 1):
        prev = read_pool(market, side)
        if prev is None:
            log.warning("  Cannot read pool before bet (attempt %d)", attempt)
            continue

        tx = place_bet(market, side, amount_wei)
        if not tx:
            st = read_state(market)
            if st is not None and st != 0:
                log.warning("  Market no longer OPEN (state=%s)", st)
                return ""
            log.warning("  Send empty (attempt %d)", attempt)
            time.sleep(1)
            continue

        for _ in range(5):
            time.sleep(1)
            now = read_pool(market, side)
            if now is not None and now >= prev + target:
                return tx

        log.warning("  Pool did not increase (attempt %d/%d)", attempt, retries)
        st = read_state(market)
        if st is not None and st != 0:
            return ""
    return ""

def seed_market(market):
    log.info("Seeding %s...", market[:12])
    tx0 = place_bet_verified(market, 0, BET_ETH_WEI)
    if tx0:
        log.info("  UNDER OK — %s ETH (%s)", BET_ETH, tx0[:12])
        publish_bet("under", tx0, BET_ETH)
    else:
        log.error("  UNDER FAILED")
        failed_markets[market] = time.time()
        return False

    time.sleep(2)

    tx1 = place_bet_verified(market, 1, BET_ETH_WEI)
    if tx1:
        log.info("  OVER OK — %s ETH (%s)", BET_ETH, tx1[:12])
        publish_bet("over", tx1, BET_ETH)
    else:
        log.error("  OVER FAILED")
        failed_markets[market] = time.time()
        return False

    seen_markets.add(market)
    log.info("Seeded %s — %s + %s ETH", market[:12], BET_ETH, BET_ETH)
    global _chat_index
    send_chat(CHAT_AFTER_SEED[_chat_index % len(CHAT_AFTER_SEED)])
    _chat_index += 1
    return True

def run():
    log.info("House bot started (ETH mode)")
    log.info("Bet: %s ETH per side | Factory: %s", BET_ETH, FACTORY[:12])
    log.info("Polling every %ds for new markets...", POLL_INTERVAL)

    while True:
        try:
            markets = get_active_markets()
            for m in markets:
                if m in seen_markets:
                    continue
                if m in failed_markets and time.time() - failed_markets[m] < 60:
                    continue
                seed_market(m)
        except Exception as exc:
            log.warning("Error: %s", exc)

        time.sleep(POLL_INTERVAL)

if __name__ == "__main__":
    try:
        run()
    except KeyboardInterrupt:
        log.info("Stopped.")
