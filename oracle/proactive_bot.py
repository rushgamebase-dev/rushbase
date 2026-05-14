#!/usr/bin/env python3
"""
proactive_bot.py — Rushy initiates conversations.

Three modes:

  python proactive_bot.py daily
      Daily wrap at 00:00 UTC. Pulls 24h stats (distributions, new stakers,
      claims, pool delta) and posts a summary in character via idol-frame.
      Cron: `0 0 * * *`

  python proactive_bot.py milestone
      Checks pool TVL against last-known milestone tier (1B, 2B, 5B, 10B...
      $RUSH staked) and posts when a new tier is hit. Cron: every hour.

  python proactive_bot.py whale
      One-shot — invoked by event listener (fee_bot listen) when a Stake
      event > 100M $RUSH lands. Args: --user --amount --new_total
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Optional

import requests

ROOT = Path(__file__).resolve().parent
RUSH_ROOT = ROOT.parent
LOG_DIR = ROOT / "logs"
LOG_DIR.mkdir(exist_ok=True)
LOG_FILE = LOG_DIR / "proactive_bot.log"
STATE_FILE = ROOT / ".proactive_state.json"

# Reuse chat_bot's helpers to avoid divergence
sys.path.insert(0, str(ROOT))
from chat_bot import (
    load_env,
    get_token_stats,
    get_staking_stats,
    get_v2_stats,
    get_recent_distributions,
    _idol_perform,
)


def setup_logging() -> logging.Logger:
    log = logging.getLogger("proactive")
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


def load_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text())
        except Exception:
            pass
    return {"last_milestone_b": 0}


def save_state(s: dict) -> None:
    STATE_FILE.write_text(json.dumps(s, indent=2))


def post(text: str, log: logging.Logger) -> Optional[int]:
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat = os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat:
        log.error("Telegram env not set")
        return None
    r = requests.post(
        f"https://api.telegram.org/bot{token}/sendMessage",
        json={
            "chat_id": chat,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        },
        timeout=15,
    ).json()
    if r.get("ok"):
        return r["result"]["message_id"]
    log.error("post failed: %s", r)
    return None


# ─── Daily wrap ──────────────────────────────────────────────────────────────

def cmd_daily(log: logging.Logger) -> None:
    """Pull 24h snapshot + ask Rushy to write the wrap in character."""
    token = get_token_stats()
    staking = get_staking_stats()
    v2 = get_v2_stats()
    distros = get_recent_distributions(limit=10)

    context = f"""You are writing the daily wrap for the Rush on Base Telegram channel.
This post is unprompted — you initiate it. It should feel like a quiet,
confident summary, not an advertisement. Use real numbers from the data.

24h snapshot:
- $RUSH price: ${token.get('price_usd', 0):.2e}
- Market cap: ${token.get('market_cap_usd', 0):,.0f}
- Volume 24h: ${token.get('volume_24h_usd', 0):,.0f}
- Price change 24h: {token.get('price_change_24h_pct', 0):+.2f}%
- Buys/sells 24h: {token.get('txns_24h_buys', 0)}/{token.get('txns_24h_sells', 0)}
- Pool TVL: {staking.get('total_staked_rush', 0)/1e9:.2f}B $RUSH
- % of supply staked: {staking.get('pct_of_supply_staked', 0):.2f}%
- Reward rate: {staking.get('reward_rate_eth_per_day', 0):.5f} ETH/day
- V2 active tiles: {v2.get('active_tiles', 0)}/100
- Recent distributions: {distros.get('count', 0)} in last ~28h

Format: 4-6 short lines, monospace block ok for stats. No fluff. End with a 1-line tag (your style).
"""
    out = _idol_perform(context, log)
    if not out:
        log.error("daily wrap perform failed")
        return
    log.info("daily wrap content: %s", out[:160])
    mid = post(out, log)
    if mid:
        log.info("posted daily wrap msg_id=%d", mid)


# ─── Milestone (TVL crosses 1B/2B/5B/10B etc) ────────────────────────────────

MILESTONE_TIERS_B = [1, 2, 5, 10, 15, 20, 30, 50, 75, 100]


def cmd_milestone(log: logging.Logger) -> None:
    state = load_state()
    last_b = state.get("last_milestone_b", 0)
    s = get_staking_stats()
    current_b = s.get("total_staked_rush", 0) / 1e9

    new_tier = None
    for tier in MILESTONE_TIERS_B:
        if current_b >= tier > last_b:
            new_tier = tier  # take the highest tier crossed since last check

    if new_tier is None:
        log.info("no milestone — current %.2fB, last seen %dB", current_b, last_b)
        return

    context = f"""You are announcing a staking-pool milestone for $RUSH.
This post is unprompted. Stay terse. Don't celebrate; just state.

Pool just crossed {new_tier}B $RUSH staked.
Currently: {current_b:.2f}B
% of total supply: {s.get('pct_of_supply_staked', 0):.2f}%
Reward rate: {s.get('reward_rate_eth_per_day', 0):.5f} ETH/day

Write 2-3 lines, in character. End with a tag line.
"""
    out = _idol_perform(context, log)
    if not out:
        log.error("milestone perform failed")
        return
    mid = post(out, log)
    if mid:
        log.info("posted milestone (%dB) msg_id=%d", new_tier, mid)
        state["last_milestone_b"] = new_tier
        save_state(state)


# ─── Whale alert (event-driven, called by listener) ─────────────────────────

def cmd_whale(user: str, amount_wei: int, new_total_wei: int, log: logging.Logger) -> None:
    amt_b = amount_wei / 1e9 / 1e18  # in billions of $RUSH
    new_total_b = new_total_wei / 1e9 / 1e18
    pct_pool = (amount_wei / new_total_wei * 100) if new_total_wei else 0

    short = f"{user[:6]}…{user[-4:]}"
    context = f"""You are flagging a large stake on $RUSH that just landed on-chain.

Wallet: {short}
Amount staked this tx: {amt_b:.2f}B $RUSH ({amt_b*1000:.0f}M)
New pool size: {new_total_b:.2f}B
This single stake = {pct_pool:.2f}% of the pool.

Write 1-2 lines in character. Treat it as an observation, not hype. End with a tag line.
"""
    out = _idol_perform(context, log)
    if not out:
        log.error("whale perform failed")
        return
    mid = post(out, log)
    if mid:
        log.info("posted whale alert msg_id=%d", mid)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["daily", "milestone", "whale"])
    parser.add_argument("--user", help="wallet address (for whale)")
    parser.add_argument("--amount", type=int, default=0, help="amount in wei (for whale)")
    parser.add_argument("--new_total", type=int, default=0, help="new total staked wei (for whale)")
    args = parser.parse_args()

    load_env()
    log = setup_logging()
    log.info("=== proactive %s start ===", args.mode)

    if args.mode == "daily":
        cmd_daily(log)
    elif args.mode == "milestone":
        cmd_milestone(log)
    elif args.mode == "whale":
        if not args.user or not args.amount:
            log.error("whale mode needs --user and --amount")
            sys.exit(1)
        cmd_whale(args.user, args.amount, args.new_total, log)


if __name__ == "__main__":
    main()
