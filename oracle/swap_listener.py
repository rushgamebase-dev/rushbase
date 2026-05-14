#!/usr/bin/env python3
"""
swap_listener.py — Real-time $RUSH buy/sell tracker.

Subscribes via Chainstack WSS to ERC-20 Transfer events on the $RUSH token.
Detects swaps by checking whether one side is a known pool address:

    - 0x498581ff718922c3f8e6a244956af099b2652b2b — Uniswap V4 PoolManager (Base)
    - 0x23321f11a6d44Fd1ab790044FdFDE5758c902FDc — Flaunch position manager

Direction:
    - FROM ∈ POOLS → BUY  (tokens flowing OUT of pool TO a wallet)
    - TO ∈ POOLS   → SELL (tokens flowing FROM a wallet INTO pool)
    - else: ignored (wallet-to-wallet transfer, not a swap)

Tier (USD value, computed via cached DexScreener price):
    < $50   silent count only
    $50–500 medium — counted toward the hourly summary
    $500+   large — individual post via Rushy
    $2000+  whale — individual post (and pinned briefly)

Cooldowns:
    - Individual posts: max 1 per 90 s (anti-spam)
    - Hourly summary: posted at minute 0 of every hour

Reuses chat_bot's Rushy pipeline for in-character commentary.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Optional

import requests
import websockets

ROOT = Path(__file__).resolve().parent
LOG_DIR = ROOT / "logs"
LOG_DIR.mkdir(exist_ok=True)
LOG_FILE = LOG_DIR / "swap_listener.log"

sys.path.insert(0, str(ROOT))
from chat_bot import load_env, _idol_perform

# ─── Constants ───────────────────────────────────────────────────────────────

RUSH_TOKEN = "0xb36a127dba73f3aa7c70b4e00b7395b86a60e73b"
POOL_ADDRESSES = {
    "0x498581ff718922c3f8e6a244956af099b2652b2b",  # Uniswap V4 PoolManager
    "0x23321f11a6d44fd1ab790044fdfde5758c902fdc",  # Flaunch position manager
}
TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

# Tier thresholds in USD
TIER_LARGE_USD = 500
TIER_WHALE_USD = 2000
INDIVIDUAL_POST_COOLDOWN = 90       # seconds between individual posts
PRICE_CACHE_TTL = 60                # seconds — DexScreener price refresh
WSS_RECONNECT_BACKOFF_MAX = 60

# Hourly summary thresholds (only summarize if there's at least N events)
HOURLY_MIN_EVENTS = 5

# ─── Setup ───────────────────────────────────────────────────────────────────

def setup_logging() -> logging.Logger:
    log = logging.getLogger("swap_listener")
    log.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)sZ | %(levelname)s | %(message)s", "%Y-%m-%dT%H:%M:%S")
    fh = logging.FileHandler(LOG_FILE)
    fh.setFormatter(fmt)
    sh = logging.StreamHandler()
    sh.setFormatter(fmt)
    if not log.handlers:
        log.addHandler(fh)
        log.addHandler(sh)
    return log


# ─── Price cache ─────────────────────────────────────────────────────────────

_price_cache = {"price_usd": 0.0, "ts": 0.0}


def get_price_usd() -> float:
    now = time.time()
    if now - _price_cache["ts"] < PRICE_CACHE_TTL and _price_cache["price_usd"]:
        return _price_cache["price_usd"]
    try:
        r = requests.get(
            f"https://api.dexscreener.com/latest/dex/tokens/{RUSH_TOKEN}",
            timeout=10,
        )
        d = r.json()
        pairs = d.get("pairs") or []
        if pairs:
            p = max(pairs, key=lambda x: float(x.get("liquidity", {}).get("usd") or 0))
            _price_cache["price_usd"] = float(p.get("priceUsd") or 0)
            _price_cache["ts"] = now
    except Exception:
        pass
    return _price_cache["price_usd"]


# ─── Telegram ────────────────────────────────────────────────────────────────

def tg_post(text: str, log: logging.Logger) -> Optional[int]:
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat = os.environ.get("TELEGRAM_CHAT_ID")
    if not (token and chat):
        log.error("Telegram env not set")
        return None
    try:
        r = requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat, "text": text, "parse_mode": "HTML",
                  "disable_web_page_preview": True},
            timeout=15,
        ).json()
        if r.get("ok"):
            return r["result"]["message_id"]
        log.warning("tg post failed: %s", r)
    except Exception as e:
        log.error("tg post exception: %s", e)
    return None


# ─── Rolling stats for hourly summary ────────────────────────────────────────

class HourlyStats:
    def __init__(self):
        self.buys = 0
        self.sells = 0
        self.buy_volume_usd = 0.0
        self.sell_volume_usd = 0.0
        self.unique_wallets = set()
        self.last_reset_hour = -1

    def add(self, direction: str, usd: float, wallet: str) -> None:
        if direction == "BUY":
            self.buys += 1
            self.buy_volume_usd += usd
        else:
            self.sells += 1
            self.sell_volume_usd += usd
        self.unique_wallets.add(wallet)

    def reset(self) -> None:
        self.buys = 0
        self.sells = 0
        self.buy_volume_usd = 0.0
        self.sell_volume_usd = 0.0
        self.unique_wallets = set()


hourly = HourlyStats()


# ─── Event handler ───────────────────────────────────────────────────────────

_last_post_ts = 0.0


def short_addr(a: str) -> str:
    return f"{a[:6]}…{a[-4:]}"


async def handle_transfer(log_data: dict, log: logging.Logger) -> None:
    """Process one Transfer log; classify direction; if notable, post."""
    global _last_post_ts
    try:
        topics = log_data["topics"]
        from_addr = ("0x" + topics[1][-40:]).lower()
        to_addr = ("0x" + topics[2][-40:]).lower()
        amount = int(log_data["data"], 16)
        tx = log_data.get("transactionHash", "?")
        block = int(log_data.get("blockNumber", "0x0"), 16)

        if from_addr in POOL_ADDRESSES:
            direction = "BUY"
            counterparty = to_addr
        elif to_addr in POOL_ADDRESSES:
            direction = "SELL"
            counterparty = from_addr
        else:
            return  # not a swap

        amount_rush = amount / 1e18
        price_usd = get_price_usd()
        if price_usd <= 0:
            log.warning("no price — cannot tier")
            return
        usd = amount_rush * price_usd

        log.info(
            "%s @ blk=%d wallet=%s amt=%.2fM RUSH (~$%.0f) tx=%s",
            direction, block, short_addr(counterparty), amount_rush / 1e6, usd, tx[:14],
        )

        # Add to hourly stats regardless of tier
        hourly.add(direction, usd, counterparty)

        # Cooldown check before posting
        now = time.time()
        if now - _last_post_ts < INDIVIDUAL_POST_COOLDOWN:
            return

        # Post only if large enough
        if usd < TIER_LARGE_USD:
            return

        is_whale = usd >= TIER_WHALE_USD
        # Build context for Rushy
        context = f"""You are commenting on a live $RUSH swap on Base.

Direction:    {direction}
Wallet:       {short_addr(counterparty)} ({counterparty})
Amount:       {amount_rush:,.0f} $RUSH (~${usd:,.0f} USD)
Tier:         {"WHALE" if is_whale else "LARGE"}
Tx:           https://basescan.org/tx/{tx}

Write 1-2 short lines in character. State the fact. Add a brief in-voice
observation ("flowing", "pool depth holding", "red days build red days",
etc — match your usual register). Don't speculate on intent. Don't praise
or shame the wallet. Tag the basescan tx link.
"""
        out = _idol_perform(context, log)
        if not out:
            return
        mid = tg_post(out, log)
        if mid:
            log.info("posted %s alert msg_id=%d ($%d)", direction, mid, int(usd))
            _last_post_ts = now
    except Exception as e:
        log.error("handle_transfer error: %s — log=%s", e, log_data)


# ─── Hourly summary ──────────────────────────────────────────────────────────

async def hourly_summary_loop(log: logging.Logger) -> None:
    """Every 60 minutes (aligned to top of hour), post a buy-pressure summary
    if there's enough activity."""
    while True:
        # Sleep until next top-of-hour
        now = time.time()
        next_hour = (int(now) // 3600 + 1) * 3600
        await asyncio.sleep(max(1, next_hour - now))

        total = hourly.buys + hourly.sells
        if total < HOURLY_MIN_EVENTS:
            log.info("hourly: only %d events, skipping summary", total)
            hourly.reset()
            continue

        ratio = hourly.buys / total if total else 0
        net = hourly.buy_volume_usd - hourly.sell_volume_usd
        sentiment = "buy pressure" if ratio > 0.6 else "sell pressure" if ratio < 0.4 else "balanced"

        context = f"""You are posting an hourly $RUSH swap summary.

Last 60 minutes:
- Buys: {hourly.buys} (${hourly.buy_volume_usd:,.0f})
- Sells: {hourly.sells} (${hourly.sell_volume_usd:,.0f})
- Net flow: ${net:+,.0f}
- Unique wallets: {len(hourly.unique_wallets)}
- Sentiment: {sentiment}

Write 2-3 lines. Use a code block for the table if it makes sense.
Don't editorialize beyond the data. End with one in-voice tag line.
"""
        out = _idol_perform(context, log)
        if out:
            mid = tg_post(out, log)
            if mid:
                log.info("posted hourly summary msg_id=%d", mid)
        hourly.reset()


# ─── WebSocket listener ──────────────────────────────────────────────────────

async def listen_loop(log: logging.Logger) -> None:
    wss_url = os.environ.get("WSS_URL")
    if not wss_url:
        log.error("WSS_URL not set in env")
        return

    backoff = 5
    while True:
        try:
            async with websockets.connect(wss_url, ping_interval=30, ping_timeout=10) as ws:
                # Subscribe to Transfer logs on RUSH token
                sub_id = None
                await ws.send(json.dumps({
                    "jsonrpc": "2.0", "id": 1, "method": "eth_subscribe",
                    "params": ["logs", {
                        "address": RUSH_TOKEN,
                        "topics": [TRANSFER_TOPIC],
                    }],
                }))
                # First reply has the subscription id
                first = json.loads(await ws.recv())
                sub_id = first.get("result")
                log.info("subscribed: %s", sub_id)
                backoff = 5

                async for raw in ws:
                    msg = json.loads(raw)
                    if msg.get("method") == "eth_subscription":
                        await handle_transfer(msg["params"]["result"], log)
        except Exception as e:
            log.error("ws loop error: %s — reconnecting in %ds", e, backoff)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, WSS_RECONNECT_BACKOFF_MAX)


# ─── Main ────────────────────────────────────────────────────────────────────

async def main() -> None:
    load_env()
    log = setup_logging()
    log.info("=== swap_listener start ===")

    # Run the WS listener and the hourly summary as concurrent tasks
    await asyncio.gather(
        listen_loop(log),
        hourly_summary_loop(log),
    )


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
