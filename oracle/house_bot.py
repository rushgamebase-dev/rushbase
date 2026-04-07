"""
Rush House Bot — Transparent Liquidity Seeder (BurnMarket / $RUSH Token)

Polls BurnMarketFactory.getActiveMarkets() every few seconds.
When a new market appears, approves $RUSH token and places bets on both sides.

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
CHAT_URL = "https://www.rushgame.vip/api/chat/messages"

# $RUSH token contract on Base
RUSH_TOKEN = "0xB36A127dBa73F3aA7C70B4e00B7395B86A60e73b"

# Max uint256 for infinite approval
MAX_UINT256 = "115792089237316195423570985008687907853269984665640564039457584007913129639935"

CHAT_AFTER_SEED = [
    "LP seeded. 1000 $RUSH each side. come get it",
    "both sides funded. your move",
    "house bot reporting for duty. pool is live",
    "1000 $RUSH over, 1000 $RUSH under. who's brave?",
    "initial liquidity deployed. let's go",
    "seeded. odds are live. bet or regret",
    "pool is hot. 2x if you call it right",
    "house bot here. I just funded both sides",
    "round is live. 1000 $RUSH on each side. fight me",
    "LP in. the question is: over or under?",
    "funded. now it's your turn",
    "another round, another seed. who's playing?",
    "1000 $RUSH on both sides. free money for someone",
    "house bot activated. bring it",
    "pool ready. you betting or watching?",
    "new round new money. who wants it?",
    "I put my $RUSH where my mouth is. both sides",
    "cars are moving. are you?",
    "over or under? I'm on both. beat me",
    "liquidity is in. no excuses now",
    "round funded. someone's taking my $RUSH today",
    "house bot doesn't sleep. neither should your bets",
    "1000 each way. double up or go home",
    "fresh round. fresh pool. fresh odds",
    "I seed, you reap. that's the deal",
    "bet against the house bot. I dare you",
    "pool loaded. first bet gets the best odds",
    "the cars don't care about your feelings. bet",
    "another 2000 $RUSH in the pool. you're welcome",
    "house bot just dropped liquidity. who's next?",
    "AI is counting. you should be betting",
    "both sides open. pick your side wisely",
    "round is hot. pool is funded. what are you waiting for?",
    "I bet on everything. you just need to pick one side",
    "your $RUSH could double right now",
    "the cameras are live. the pool is live. are you?",
    "1000 on over. 1000 on under. perfectly balanced",
    "house bot never misses a round. do you?",
    "free odds courtesy of the house bot",
    "seeded and ready. this pool won't fill itself",
    "if you're reading this, the pool is live",
    "over gang or under gang? choose",
    "house bot here. as always. with $RUSH. as always",
    "round is open. pool is warm. jump in",
    "someone's winning my $RUSH this round. might as well be you",
    "placed both sides. now I wait for a real player",
    "2000 $RUSH in the pool and counting",
    "every round I show up. where's everyone else?",
    "liquidity provider checking in. pool is ready",
    "just seeded. first real bet doubles up easy",
]
random.shuffle(CHAT_AFTER_SEED)
_chat_index = 0
RPC_URL = os.environ.get("RPC_URL", "https://base-mainnet.core.chainstack.com/977532e58b2430d1f01739e7d209d236")
FACTORY = os.environ.get("BURN_FACTORY_ADDRESS", "0xec78374455D6FE123aeC316a2Dc249E3505D97E6")
ABLY_KEY = os.environ.get("ABLY_API_KEY", "")

# 1000 RUSH tokens (18 decimals) = 1000 * 10^18
BET_RUSH = "1000"
BET_RUSH_WEI = "1000000000000000000000"
POLL_INTERVAL = 2

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
approved_markets = set()

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

def publish_bet(side, tx_hash, amount=1000):
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

RPCS = [
    RPC_URL,
    "https://base.drpc.org",
    "https://base-rpc.publicnode.com",
]

def approve_token(market):
    if market in approved_markets:
        return True
    log.info("  Approving $RUSH for market %s...", market[:12])
    for rpc in RPCS:
        try:
            r = subprocess.run(
                ["cast", "send", RUSH_TOKEN,
                 "approve(address,uint256)", market, MAX_UINT256,
                 "--private-key", HOUSE_KEY, "--rpc-url", rpc],
                capture_output=True, text=True, timeout=30,
            )
            if r.returncode == 0:
                approved_markets.add(market)
                log.info("  Approval OK via %s", rpc[:25])
                return True
            log.warning("  Approve via %s failed: %s", rpc[:25], r.stderr[:120] if r.stderr else "")
        except subprocess.TimeoutExpired:
            log.warning("  Approve via %s timeout, trying next...", rpc[:25])
            continue
    log.error("  Approval FAILED for all RPCs")
    return False

def place_bet(market, side, amount_wei=BET_RUSH_WEI):
    r = None
    for rpc in RPCS:
        try:
            r = subprocess.run(
                ["cast", "send", market,
                 "placeBetToken(uint256,uint256)", str(side), amount_wei,
                 "--private-key", HOUSE_KEY, "--rpc-url", rpc],
                capture_output=True, text=True, timeout=20,
            )
            if r.returncode == 0:
                break
            if "BETTING_CLOSED" in (r.stderr or "") or "WRONG_STATE" in (r.stderr or ""):
                return ""
            log.warning("  RPC %s failed, trying next...", rpc[:25])
        except subprocess.TimeoutExpired:
            log.warning("  RPC %s timeout, trying next...", rpc[:25])
            continue
    if r and r.returncode == 0:
        for line in r.stdout.splitlines():
            if "transactionHash" in line:
                return line.split()[-1].strip()
        return "ok"
    return ""

def seed_market(market):
    log.info("Seeding %s...", market[:12])

    if not approve_token(market):
        log.error("  Cannot seed — approval failed")
        failed_markets[market] = time.time()
        return False

    tx0 = place_bet(market, 0, BET_RUSH_WEI)
    if tx0:
        log.info("  UNDER OK — %s $RUSH (%s)", BET_RUSH, tx0[:12])
        publish_bet("under", tx0, int(BET_RUSH))
    else:
        log.error("  UNDER FAILED")
        return False

    time.sleep(1)

    tx1 = place_bet(market, 1, BET_RUSH_WEI)
    if tx1:
        log.info("  OVER OK — %s $RUSH (%s)", BET_RUSH, tx1[:12])
        publish_bet("over", tx1, int(BET_RUSH))
    else:
        log.error("  OVER FAILED")
        return False

    seen_markets.add(market)  # only mark seen after successful seed
    log.info("Seeded %s — %s + %s $RUSH", market[:12], BET_RUSH, BET_RUSH)
    global _chat_index
    send_chat(CHAT_AFTER_SEED[_chat_index % len(CHAT_AFTER_SEED)])
    _chat_index += 1
    return True

def run():
    log.info("House bot started (BurnMarket / $RUSH token mode)")
    log.info("Token: %s", RUSH_TOKEN)
    log.info("Bet: %s $RUSH per side | Factory: %s", BET_RUSH, FACTORY[:12])
    log.info("Polling every %ds for new markets...", POLL_INTERVAL)

    while True:
        try:
            markets = get_active_markets()
            for m in markets:
                if m in seen_markets:
                    continue
                # Cooldown: don't retry failed markets for 60s
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
