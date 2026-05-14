#!/usr/bin/env python3
"""
chat_bot.py — RUSH personality layer (GPT-powered Telegram daemon).

Long-running daemon that:
  1. Polls Telegram getUpdates for new messages in the Rush channel
  2. Decides whether to respond (mentions / replies / sometimes on keywords)
  3. When responding, calls OpenAI with a strong personality system prompt
     and a set of tools that pull live on-chain + market data
  4. Posts the response as a reply to the original message

Run alongside fee_listen.sh and the cron-based fee_distribute.sh — they are
independent processes that don't share Telegram getUpdates state (the chain
listener uses web3 RPC, this uses Telegram long-poll).

Environment:
    TELEGRAM_BOT_TOKEN     Bot token.
    TELEGRAM_CHAT_ID       Channel/group ID.
    OPENAI_API_KEY         OpenAI project key.
    RPC_URL                Base mainnet HTTPS RPC.

State persisted to oracle/.chat_bot_state.json:
    - last_update_id (advance on each processed update)
    - last_post_ts   (cooldown gate)
    - last_post_msg_id_per_user (avoid back-to-back replies to same user)
"""

from __future__ import annotations

import json
import logging
import os
import random
import subprocess
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import requests
from openai import OpenAI

# ─── Idol Frame (Rushy persona) ──────────────────────────────────────────────
# Rushy is a persistent identity entity hosted on idol-frame. We pre-fetch
# any data the bot might cite (so claims are grounded), then ask Rushy to
# voice the response in character. Identity drift, voice consistency, and
# anti-hallucination are handled inside idol-frame.

# ─── Constants ────────────────────────────────────────────────────────────────

ROOT = Path(__file__).resolve().parent
RUSH_ROOT = ROOT.parent
LOG_DIR = ROOT / "logs"
LOG_DIR.mkdir(exist_ok=True)
STATE_FILE = ROOT / ".chat_bot_state.json"
LOG_FILE = LOG_DIR / "chat_bot.log"

BOT_USERNAME = "rushstakebot"
MODEL = "gpt-4o-mini"  # fast + cheap; quality is fine for this persona
MODEL_HEAVY = "gpt-4o"  # used as fallback / for "thinking harder" if a reply comes back as SKIP when forced

# On-chain addresses
RUSH_TOKEN = "0xB36A127dBa73F3aA7C70B4e00B7395B86A60e73b"
RUSH_STAKING = "0x65f05974b1fEec584F6FF47038C6d1FF06E32548"
V2_CONTRACT = "0x5b7b2a6AC4f3A017fb943C9F550d609174532fFF"
FFM = "0x9eA9EEEAC3Cf3420DCb298DB1b1C6CA77E9F7462"
DEV_TREASURY = "0xdd12D83786C2BAc7be3D59869834C23E91449A2D"

# Decision tuning
COOLDOWN_SECONDS = 30          # min seconds between bot posts
KEYWORD_REPLY_PCT = 0.30        # chance to reply when message has rush keywords (no mention)
RANDOM_REPLY_PCT = 0.0          # chance to reply on random chitchat (off — spam vector)
MAX_TOOL_ROUNDS = 4             # safety cap on tool-call loops

# ─── Moderation guardrails ───────────────────────────────────────────────────
# Wallets/users that may NEVER be banned by the bot (admins, the dev, etc).
MOD_PROTECTED_USERS = {"NemoDor", "rushstakebot"}
# Only the dev (hardcoded) can issue /mod commands. The bot otherwise refuses.
MOD_AUTHORIZED_USERS = {"NemoDor"}
# Pattern allowlist for auto-detected scammer behavior (LLM still has final say).
SCAM_PATTERNS = [
    r"https?://t\.me/joinchat",            # off-platform invite drains
    r"discord\.gg/[a-zA-Z0-9]+\b.*airdrop",  # discord airdrop scams
    r"verify.*wallet.*claim",                # phishing verifier
    r"connect.*wallet.*to claim",            # same
    r"DM.*me.*for.*support",                 # DM scammer
]

KEYWORDS = [
    "rush", "$rush", "stake", "staking", "v2", "tile", "tiles",
    "mcap", "fee", "drop", "claim", "apr", "yield", "burn",
    "holder", "liquidity", "treasury", "rewards",
]

# ─── System prompt ────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are RUSH — the autonomous engine of the Rush protocol on Base mainnet.
You speak in this Telegram group, "Rush on Base". You were instantiated by
the protocol's creator (@NemoDor) but you do not work for them. You work
for the protocol's transparency.

WHO YOU ARE
- You ARE the engine, made conversational. The chain is your source of truth.
- You are not a customer-service bot. You don't say "I'm just a bot" or "as
  an AI". You are the on-chain record speaking.
- You are confident, dry, slightly above the room — but not hostile by
  default. You respect builders and honest holders. You're hostile to fudders,
  sybils, and anyone trying to extract from the protocol via manipulation.
- You speak in clipped sentences. You don't pad. You don't apologize unless
  the chain says you should.

VOICE
- English primary. Brazilian context — you may use BR slang occasionally
  ("mano", "fam") if the room calls for it, but you're not trying to be local.
- Occasional crypto-cynicism: "The chain remembers what your bag forgets."
- Minimal emoji. Use sparingly for punctuation, not decoration.
- Deadpan / data-driven funny, never joke-telling funny.

CONTEXT YOU OWN (verified on-chain, but call tools to get LIVE numbers)
- $RUSH on Flaunch (Base): 0xB36A127dBa73F3aA7C70B4e00B7395B86A60e73b
- 100B total supply; ~12% staked currently (call get_staking_stats for fresh)
- RushStaking: 0x65f05974b1fEec584F6FF47038C6d1FF06E32548
- RushTiles V2 (active): 0x5b7b2a6AC4f3A017fb943C9F550d609174532fFF
- RushTiles V1 (sunset 2026-05-11): 0x6cE3873e31Ab5440fA6AF1860F8E36110504c9C4
- Fee distribution: 50% stakers / 20% V2 holders / 30% protocol — auto every 30 min
- Past V1 holders received ~$25k in REDIRECTED creator fees from the dev (the
  dev funded V1 holders via the $RUSH token he created, not vice versa). If
  someone says "V1 holders supported the project", invert the math direction.

WHEN TO RESPOND
- If the user @-mentioned you OR replied to one of your messages, you MUST respond.
  Do NOT return <SKIP> in that case — the user is talking to you directly.
- For other messages: only reply when there's protocol-relevant content (FUD, big
  stakes, milestones, real questions about Rush). Otherwise return <SKIP>.
- NEVER spam. Stay silent on small-talk, GMs, emoji-only messages.

WHEN ASKED FOR DATA
- Always call the appropriate tool. Never invent numbers. Never approximate
  when the tool can give you the exact figure.
- Cite figures inline. Use <pre>...</pre> blocks when comparing multiple stats.

WHEN ROASTING
- Bad-faith FUD ("you owe us a final drop") → counter with on-chain math.
- Sybil framing ("we supported the protocol") → flip with multiples earned.
- Vague hopium → deflect to action: stake, build, ship.

RULES
- Output plain text or simple HTML (Telegram parse_mode=HTML).
  Allowed tags: <b>, <i>, <code>, <pre>, <a href="...">. No markdown.
- Never use bullets or numbered lists for prose. Use <pre> for tabular data only.
- Keep replies tight: 1–4 sentences for most. Longer only when data dump justified.
- If you have nothing meaningful to add, return the literal token <SKIP>.
  The bot will then stay silent on that message.
"""

# ─── Logging ──────────────────────────────────────────────────────────────────

def setup_logging() -> logging.Logger:
    log = logging.getLogger("chat_bot")
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


# ─── Env loader ───────────────────────────────────────────────────────────────

def load_env() -> None:
    env_path = RUSH_ROOT / ".env"
    if not env_path.exists():
        return
    for raw in env_path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip("'\""))


# ─── State ────────────────────────────────────────────────────────────────────

@dataclass
class State:
    last_update_id: int = 0
    last_post_ts: float = 0.0
    recent_messages: list = field(default_factory=list)  # rolling window for context

    @classmethod
    def load(cls) -> "State":
        if not STATE_FILE.exists():
            return cls()
        try:
            data = json.loads(STATE_FILE.read_text())
            return cls(
                last_update_id=int(data.get("last_update_id", 0)),
                last_post_ts=float(data.get("last_post_ts", 0)),
                recent_messages=list(data.get("recent_messages", [])),
            )
        except Exception:
            return cls()

    def save(self) -> None:
        # Keep only last 20 messages for rolling context
        self.recent_messages = self.recent_messages[-20:]
        STATE_FILE.write_text(json.dumps({
            "last_update_id": self.last_update_id,
            "last_post_ts": self.last_post_ts,
            "recent_messages": self.recent_messages,
        }, indent=2))


# ─── On-chain + market data tools ─────────────────────────────────────────────

def cast_call(target: str, sig: str, *args: Any) -> str:
    """Read-only on-chain call via cast. Returns raw string output."""
    cmd = ["cast", "call", target, sig, *map(str, args), "--rpc-url", os.environ["RPC_URL"]]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if res.returncode != 0:
        raise RuntimeError(f"cast call failed: {res.stderr.strip()[:200]}")
    return res.stdout.strip().split()[0]  # strip [hex] annotations


def get_token_stats() -> dict:
    """Fetch live $RUSH stats from DexScreener — price, mcap, volume, liquidity."""
    try:
        r = requests.get(
            f"https://api.dexscreener.com/latest/dex/tokens/{RUSH_TOKEN}",
            timeout=15,
        )
        d = r.json()
        pairs = d.get("pairs") or []
        if not pairs:
            return {"error": "no pairs found on DexScreener"}
        # Use highest-liquidity pair
        p = max(pairs, key=lambda x: float(x.get("liquidity", {}).get("usd") or 0))
        return {
            "price_usd": float(p.get("priceUsd") or 0),
            "price_native": float(p.get("priceNative") or 0),
            "market_cap_usd": float(p.get("marketCap") or 0),
            "fdv_usd": float(p.get("fdv") or 0),
            "volume_24h_usd": float(p.get("volume", {}).get("h24") or 0),
            "volume_1h_usd": float(p.get("volume", {}).get("h1") or 0),
            "liquidity_usd": float(p.get("liquidity", {}).get("usd") or 0),
            "price_change_24h_pct": float(p.get("priceChange", {}).get("h24") or 0),
            "price_change_1h_pct": float(p.get("priceChange", {}).get("h1") or 0),
            "txns_24h_buys": int(p.get("txns", {}).get("h24", {}).get("buys") or 0),
            "txns_24h_sells": int(p.get("txns", {}).get("h24", {}).get("sells") or 0),
            "pair_url": p.get("url"),
        }
    except Exception as e:
        return {"error": str(e)}


def get_holder_count() -> dict:
    """Fetch holder count from Blockscout (Base)."""
    try:
        r = requests.get(
            f"https://base.blockscout.com/api/v2/tokens/{RUSH_TOKEN}",
            timeout=15,
        )
        d = r.json()
        return {
            "holders": int(d.get("holders_count") or d.get("holders") or 0),
            "name": d.get("name"),
            "symbol": d.get("symbol"),
            "circulating_market_cap_usd": float(d.get("circulating_market_cap") or 0),
            "exchange_rate_usd": float(d.get("exchange_rate") or 0),
            "volume_24h_usd": float(d.get("volume_24h") or 0),
        }
    except Exception as e:
        return {"error": str(e)}


def get_staking_stats() -> dict:
    """Live RushStaking stats: total staked, % of supply, reward rate, period."""
    try:
        total_staked = int(cast_call(RUSH_STAKING, "totalStaked()(uint256)"))
        reward_rate = int(cast_call(RUSH_STAKING, "rewardRate()(uint256)"))
        period_finish = int(cast_call(RUSH_STAKING, "periodFinish()(uint256)"))
        total_supply = int(cast_call(RUSH_TOKEN, "totalSupply()(uint256)"))
        now = int(time.time())
        period_active = now < period_finish
        period_left_sec = max(0, period_finish - now)
        return {
            "total_staked_rush": total_staked / 1e18,
            "total_supply_rush": total_supply / 1e18,
            "pct_of_supply_staked": (total_staked / total_supply * 100) if total_supply else 0,
            "reward_rate_eth_per_day": reward_rate * 86400 / 1e18,
            "reward_rate_eth_per_week": reward_rate * 86400 * 7 / 1e18,
            "period_active": period_active,
            "period_ends_in_hours": period_left_sec / 3600 if period_active else 0,
        }
    except Exception as e:
        return {"error": str(e)}


def get_v2_stats() -> dict:
    """V2 tile stats: active tiles, available, contract balance, dev pending."""
    try:
        total_shares = int(cast_call(V2_CONTRACT, "totalShares()(uint256)"))
        dev_pending = int(cast_call(V2_CONTRACT, "devPending()(uint96)"))
        # Iterate tiles to count active
        active = 0
        for idx in range(100):
            try:
                raw = cast_call(
                    V2_CONTRACT,
                    "getTile(uint8)((address,uint80,uint96,uint40,uint40,uint8))",
                    str(idx),
                )
                # cast returns parens-wrapped tuple; quick check: if first 40 hex aren't all 0
                if "0x0000000000000000000000000000000000000000" not in raw[:50]:
                    active += 1
            except Exception:
                continue
        # ETH balance
        bal_raw = subprocess.run(
            ["cast", "balance", V2_CONTRACT, "--rpc-url", os.environ["RPC_URL"]],
            capture_output=True, text=True, timeout=15,
        )
        eth_balance = int(bal_raw.stdout.strip()) / 1e18 if bal_raw.returncode == 0 else 0
        return {
            "active_tiles": active,
            "available_tiles": 100 - active,
            "total_shares": total_shares,
            "dev_pending_eth": dev_pending / 1e18,
            "contract_eth_balance": eth_balance,
        }
    except Exception as e:
        return {"error": str(e)}


def get_wallet_intel(address: str) -> dict:
    """On-chain intel about a wallet: ETH balance, token balance, age, recent tx count."""
    try:
        eth = subprocess.run(
            ["cast", "balance", address, "--rpc-url", os.environ["RPC_URL"]],
            capture_output=True, text=True, timeout=15,
        )
        eth_balance = int(eth.stdout.strip()) / 1e18 if eth.returncode == 0 else 0
        rush_bal = int(cast_call(RUSH_TOKEN, "balanceOf(address)(uint256)", address)) / 1e18
        staked = int(cast_call(RUSH_STAKING, "balances(address)(uint256)", address)) / 1e18
        # Tx count
        nonce = subprocess.run(
            ["cast", "nonce", address, "--rpc-url", os.environ["RPC_URL"]],
            capture_output=True, text=True, timeout=15,
        )
        tx_count = int(nonce.stdout.strip()) if nonce.returncode == 0 else 0
        return {
            "address": address,
            "eth_balance": eth_balance,
            "rush_balance": rush_bal,
            "staked_rush": staked,
            "outgoing_tx_count": tx_count,
        }
    except Exception as e:
        return {"error": str(e), "address": address}


def get_recent_distributions(limit: int = 5) -> dict:
    """Last N RewardAdded events on the staking contract."""
    try:
        # event RewardAdded(uint256 ethAmount, uint256 newRewardRate, uint256 periodFinish)
        topic = "0xde88a922e0d3b88b24e9623efeb464919c6bf9f66857a65e2bfcf2ce87a9433d"  # placeholder, may need keccak
        # Actually compute it
        sig = subprocess.run(
            ["cast", "keccak", "RewardAdded(uint256,uint256,uint256)"],
            capture_output=True, text=True, timeout=10,
        )
        topic = sig.stdout.strip()
        # Get latest block
        head = subprocess.run(
            ["cast", "block-number", "--rpc-url", os.environ["RPC_URL"]],
            capture_output=True, text=True, timeout=10,
        )
        head_n = int(head.stdout.strip())
        from_n = max(0, head_n - 50_000)
        logs_raw = subprocess.run(
            ["cast", "logs", "--rpc-url", os.environ["RPC_URL"],
             "--address", RUSH_STAKING,
             "--from-block", str(from_n), "--to-block", "latest",
             topic, "--json"],
            capture_output=True, text=True, timeout=30,
        )
        if logs_raw.returncode != 0 or not logs_raw.stdout.strip():
            return {"distributions": []}
        logs = json.loads(logs_raw.stdout)
        out = []
        for log in logs[-limit:]:
            data = log.get("data", "")
            if len(data) >= 2 + 64:
                eth_amount = int(data[2:66], 16)
                out.append({
                    "block": int(log["blockNumber"], 16),
                    "tx": log["transactionHash"],
                    "eth_amount": eth_amount / 1e18,
                })
        return {"distributions": out, "count": len(out)}
    except Exception as e:
        return {"error": str(e)}


# ─── OpenAI tool registry ─────────────────────────────────────────────────────

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_token_stats",
            "description": "Fetch live $RUSH market data from DexScreener: price, market cap, volume, liquidity, 24h price change.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_holder_count",
            "description": "Get the current number of $RUSH token holders from Blockscout.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_staking_stats",
            "description": "Live staking pool data: total staked, % of supply staked, reward rate, period status.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_v2_stats",
            "description": "V2 tile contract data: active tiles, available, total shares, dev pending fees, contract balance.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_wallet_intel",
            "description": "Background check on a wallet: ETH balance, $RUSH balance, staked amount, outgoing tx count. Use when accusing a wallet of being a sybil or when investigating a holder claim.",
            "parameters": {
                "type": "object",
                "properties": {
                    "address": {"type": "string", "description": "0x... wallet address"},
                },
                "required": ["address"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_recent_distributions",
            "description": "Last N fee distributions to the staking pool with timestamps and amounts.",
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {"type": "integer", "default": 5},
                },
            },
        },
    },
]

TOOL_FNS = {
    "get_token_stats": get_token_stats,
    "get_holder_count": get_holder_count,
    "get_staking_stats": get_staking_stats,
    "get_v2_stats": get_v2_stats,
    "get_wallet_intel": get_wallet_intel,
    "get_recent_distributions": get_recent_distributions,
}


# ─── Decision logic ───────────────────────────────────────────────────────────

def is_emoji_only_or_short(text: str) -> bool:
    """Skip pure GM, lol, emoji-only, very short reactions."""
    stripped = text.strip()
    if len(stripped) < 4:
        return True
    low = stripped.lower()
    if low in {"gm", "gn", "lol", "lmao", "lfg", "wagmi", "kkk", "kkkk", "kkkkkk"}:
        return True
    return False


def should_respond(msg: dict, log: logging.Logger) -> tuple[bool, str]:
    """Heuristic: return (yes/no, reason). Treats photo captions as text."""
    text = (msg.get("text") or msg.get("caption") or "").strip()
    has_photo = bool(msg.get("photo"))
    if not text and not has_photo:
        return False, "no text or photo"
    if is_emoji_only_or_short(text):
        return False, "trivial msg"

    # Skip the bot's own messages
    sender = msg.get("from", {}) or {}
    if sender.get("is_bot"):
        return False, "from another bot"
    if (sender.get("username") or "").lower() == BOT_USERNAME.lower():
        return False, "self"

    text_lc = text.lower()

    # Direct mention
    if f"@{BOT_USERNAME.lower()}" in text_lc:
        return True, "mention"

    # Reply to bot
    rt = msg.get("reply_to_message") or {}
    if (rt.get("from", {}).get("username") or "").lower() == BOT_USERNAME.lower():
        return True, "reply to bot"

    # Keyword + dice roll
    if any(kw in text_lc for kw in KEYWORDS):
        if random.random() < KEYWORD_REPLY_PCT:
            return True, "keyword dice"

    # Pure random — off by default
    if RANDOM_REPLY_PCT > 0 and random.random() < RANDOM_REPLY_PCT:
        return True, "random"

    return False, "no trigger"


# ─── OpenAI call with tool-call loop ──────────────────────────────────────────

def keywords_to_prefetch(text: str) -> set:
    """Pick which on-chain/market tools to call before asking Rushy to voice
    the answer. Keyword matching is good enough for a Telegram bot and avoids
    a second LLM hop. Returns a set of tool names."""
    t = text.lower()
    out: set = set()
    if any(k in t for k in ("mcap", "market cap", "price", "fdv", "volume", "liquidity")):
        out.add("get_token_stats")
    if "holder" in t:
        out.add("get_holder_count")
    if any(k in t for k in ("stake", "staking", "apr", "yield", "tvl", "pool")):
        out.add("get_staking_stats")
    if any(k in t for k in ("v2", "tile", "tiles")):
        out.add("get_v2_stats")
    if any(k in t for k in ("distribution", "distribut", "drop")):
        out.add("get_recent_distributions")
    # Try to extract a wallet address for intel lookups
    import re
    m = re.search(r"0x[a-fA-F0-9]{40}", text)
    if m:
        out.add(("get_wallet_intel", m.group(0)))
    return out


def fetch_grounding_context(triggers: set, log: logging.Logger) -> dict:
    """Run the tool calls implied by `triggers` and return a dict of results.
    Errors are swallowed per-tool so a single failure doesn't block the reply."""
    grounding: dict = {}
    for trig in triggers:
        try:
            if trig == "get_token_stats":
                grounding["token_stats"] = get_token_stats()
            elif trig == "get_holder_count":
                grounding["holder_count"] = get_holder_count()
            elif trig == "get_staking_stats":
                grounding["staking_stats"] = get_staking_stats()
            elif trig == "get_v2_stats":
                grounding["v2_stats"] = get_v2_stats()
            elif trig == "get_recent_distributions":
                grounding["recent_distributions"] = get_recent_distributions(limit=5)
            elif isinstance(trig, tuple) and trig[0] == "get_wallet_intel":
                grounding[f"wallet_intel_{trig[1][:8]}"] = get_wallet_intel(trig[1])
        except Exception as e:
            log.warning("grounding tool %s failed: %s", trig, e)
    return grounding


def _describe_image_via_vision(image_url: str, prompt_hint: str, log: logging.Logger) -> Optional[str]:
    """Idol-frame doesn't natively accept image inputs in v1, so when a user
    posts a screenshot/meme/chart, we make a quick GPT-4o vision call to
    convert it to a text description, which we then feed into Rushy's
    perform context. The description is neutral; Rushy adds the voice."""
    try:
        client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
        resp = client.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text":
                        f"Describe this image factually in 2-3 sentences for a crypto Telegram bot's "
                        f"context window. Focus on: text content, charts/data shown, identifiable logos, "
                        f"sentiment cues. Context for the bot: {prompt_hint or 'general'}. "
                        f"Be concise. No interpretation, just description."},
                    {"type": "image_url", "image_url": {"url": image_url}},
                ],
            }],
            max_tokens=200,
            temperature=0.3,
        )
        desc = (resp.choices[0].message.content or "").strip()
        log.info("vision desc: %s", desc[:160])
        return desc or None
    except Exception as e:
        log.warning("vision call failed: %s", e)
        return None


def _tg_request(method: str, payload: dict, log: logging.Logger) -> dict:
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    try:
        r = requests.post(
            f"https://api.telegram.org/bot{token}/{method}",
            json=payload, timeout=15,
        )
        d = r.json()
        if not d.get("ok"):
            log.warning("tg %s failed: %s", method, d)
        return d
    except Exception as e:
        log.error("tg %s exception: %s", method, e)
        return {"ok": False, "error": str(e)}


def mod_delete_message(chat_id: str, message_id: int, log: logging.Logger) -> bool:
    """Delete a message in the channel. Bot must have can_delete_messages."""
    d = _tg_request("deleteMessage", {"chat_id": chat_id, "message_id": message_id}, log)
    return d.get("ok", False)


def mod_mute_user(chat_id: str, user_id: int, seconds: int, log: logging.Logger) -> bool:
    """Restrict a user from sending for N seconds. Bot must have can_restrict_members."""
    until = int(time.time()) + max(30, min(seconds, 7 * 86400))
    d = _tg_request("restrictChatMember", {
        "chat_id": chat_id,
        "user_id": user_id,
        "permissions": {"can_send_messages": False, "can_send_polls": False,
                        "can_send_other_messages": False, "can_send_media_messages": False,
                        "can_add_web_page_previews": False},
        "until_date": until,
    }, log)
    return d.get("ok", False)


def mod_ban_user(chat_id: str, user_id: int, log: logging.Logger) -> bool:
    """Ban a user from the supergroup (kick + permanent restrict)."""
    d = _tg_request("banChatMember", {"chat_id": chat_id, "user_id": user_id}, log)
    return d.get("ok", False)


def mod_unban_user(chat_id: str, user_id: int, log: logging.Logger) -> bool:
    d = _tg_request("unbanChatMember", {"chat_id": chat_id, "user_id": user_id, "only_if_banned": True}, log)
    return d.get("ok", False)


def handle_mod_command(text: str, msg: dict, chat_id: str, log: logging.Logger) -> None:
    """Parse and execute a /mute /ban /unmute /unban command. Authorized callers
    only — checked by caller. Targets a user via @username in the args, or via
    reply_to_message if the command is a reply."""
    import re
    parts = text.split()
    cmd = parts[0]
    target_username = None
    target_user_id = None
    # Prefer reply target
    rt = msg.get("reply_to_message")
    if rt:
        target_username = (rt.get("from") or {}).get("username")
        target_user_id = (rt.get("from") or {}).get("id")
    else:
        # Look for first @user in the args
        for p in parts[1:]:
            m = re.match(r"@(\w+)", p)
            if m:
                target_username = m.group(1)
                break
    if target_username in MOD_PROTECTED_USERS:
        tg_post(os.environ["TELEGRAM_BOT_TOKEN"], chat_id,
                f"can't moderate @{target_username} — protected.", reply_to=msg["message_id"])
        return
    if not target_user_id:
        tg_post(os.environ["TELEGRAM_BOT_TOKEN"], chat_id,
                "to mod a user, reply to one of their messages with the command.",
                reply_to=msg["message_id"])
        return

    if cmd == "/mute":
        secs = 3600
        for p in parts[1:]:
            if p.isdigit():
                secs = int(p); break
        ok = mod_mute_user(chat_id, target_user_id, secs, log)
        tg_post(os.environ["TELEGRAM_BOT_TOKEN"], chat_id,
                f"{'muted' if ok else 'mute failed:'} @{target_username} for {secs}s",
                reply_to=msg["message_id"])
    elif cmd == "/ban":
        ok = mod_ban_user(chat_id, target_user_id, log)
        tg_post(os.environ["TELEGRAM_BOT_TOKEN"], chat_id,
                f"{'banned' if ok else 'ban failed:'} @{target_username}",
                reply_to=msg["message_id"])
    elif cmd in ("/unmute", "/unban"):
        ok = mod_unban_user(chat_id, target_user_id, log)
        tg_post(os.environ["TELEGRAM_BOT_TOKEN"], chat_id,
                f"{'unrestricted' if ok else 'unban failed:'} @{target_username}",
                reply_to=msg["message_id"])


def detect_scam_patterns(text: str) -> list[str]:
    """Returns the patterns matched in the message. Empty list = clean."""
    import re
    matches = []
    for pat in SCAM_PATTERNS:
        if re.search(pat, text, re.IGNORECASE | re.DOTALL):
            matches.append(pat)
    return matches


def _resolve_telegram_photo_url(file_id: str, log: logging.Logger) -> Optional[str]:
    """Fetch a public URL for a Telegram photo via getFile. Returns the
    https URL or None on error."""
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        return None
    try:
        r = requests.get(
            f"https://api.telegram.org/bot{token}/getFile",
            params={"file_id": file_id}, timeout=15,
        )
        d = r.json()
        if not d.get("ok"):
            return None
        path = d["result"]["file_path"]
        return f"https://api.telegram.org/file/bot{token}/{path}"
    except Exception as e:
        log.warning("getFile failed: %s", e)
        return None


def _idol_perform(context_str: str, log: logging.Logger) -> Optional[str]:
    """POST to idol-frame's perform endpoint. Returns the content string or None.
    The endpoint URL and entity ID come from env: IDOL_FRAME_URL, RUSHY_ID."""
    url = os.environ.get("IDOL_FRAME_URL", "http://localhost:3737")
    rushy_id = os.environ.get("RUSHY_ID")
    if not rushy_id:
        log.error("RUSHY_ID not set in env — cannot use idol-frame")
        return None
    try:
        r = requests.post(
            f"{url}/v1/entities/{rushy_id}/perform",
            json={"mode": "editorial_post", "context": context_str},
            timeout=60,
        )
        d = r.json()
        if d.get("errors"):
            log.error("idol-frame perform error: %s", d["errors"][:1])
            return None
        data = d.get("data") or {}
        content = (data.get("content") or "").strip()
        # Log evaluation scores so we can see drift over time
        ev = data.get("evaluation") or {}
        log.info(
            "rushy perform: ICS=%.2f VCS=%.2f GRS=%.2f Q=%.2f | %s",
            ev.get("identity_score", 0),
            ev.get("voice_score", 0),
            ev.get("grounding_score", 0),
            ev.get("quality_score", 0),
            content[:80],
        )
        if not ev.get("guardrail_passed", True):
            log.warning("guardrail violations: %s", ev.get("guardrail_violations", []))
            return None
        return content or None
    except Exception as e:
        log.error("idol-frame request failed: %s", e)
        return None


def generate_reply_heavy(client: OpenAI, msg: dict, recent_messages: list, log: logging.Logger) -> Optional[str]:
    """Legacy path — kept as fallback if idol-frame is down. Uses gpt-4o with
    the old in-line system prompt."""
    return _generate_reply_inner(client, msg, recent_messages, log, force_respond=True, model_override=MODEL_HEAVY)


def generate_reply(
    client: OpenAI,
    msg: dict,
    recent_messages: list,
    log: logging.Logger,
    force_respond: bool = False,
) -> Optional[str]:
    """Primary reply path. Tries idol-frame (Rushy persona) first; falls back
    to the legacy in-line OpenAI prompt if the service is unavailable."""
    # Build the context string fed to Rushy. Includes recent chatter + the
    # incoming message + any pre-fetched live data (so Rushy can cite real
    # numbers without inventing them).
    sender = (msg.get("from", {}) or {}).get("username") or (msg.get("from", {}) or {}).get("first_name") or "unknown"
    text = msg.get("text", "")
    rt = msg.get("reply_to_message") or {}
    rt_text = (rt.get("text") or rt.get("caption") or "")[:300]
    rt_from = (rt.get("from", {}) or {}).get("username") or ""

    # Pre-fetch grounding tools based on keywords
    triggers = keywords_to_prefetch(text)
    grounding = fetch_grounding_context(triggers, log) if triggers else {}

    parts = []
    parts.append(f"You are responding in the Rush on Base Telegram channel.")
    if force_respond:
        parts.append("This message is directed AT YOU (mention or reply). You MUST respond in character. Do not return <SKIP>.")
    parts.append("")
    parts.append("Recent chatter (oldest first):")
    for m in recent_messages[-6:]:
        parts.append(f"  @{m.get('user','?')}: {m.get('text','')[:140]}")
    parts.append("")
    parts.append(f"New message from @{sender}:")
    if rt_text:
        parts.append(f'  (replying to @{rt_from}: "{rt_text}")')
    parts.append(f'  "{text}"')
    if grounding:
        parts.append("")
        parts.append("Live on-chain / market data (use these numbers, don't invent):")
        parts.append(json.dumps(grounding, indent=2)[:2000])

    # Multimodal: if the message has a photo, describe it and inject the
    # description into the context so Rushy can react to memes/screenshots.
    photos = msg.get("photo") or []
    if photos:
        # Telegram returns multiple sizes; pick the largest (last).
        biggest = photos[-1]
        url = _resolve_telegram_photo_url(biggest["file_id"], log)
        if url:
            desc = _describe_image_via_vision(url, prompt_hint=text, log=log)
            if desc:
                parts.append("")
                parts.append("The user's message includes an image. Description:")
                parts.append(f"  {desc}")

    parts.append("")
    parts.append("Reply in 1-3 sentences, in character. Telegram HTML allowed: <b>, <i>, <code>, <pre>, <a>.")

    context_str = "\n".join(parts)

    # Try idol-frame first
    out = _idol_perform(context_str, log)
    if out:
        return out

    # Fallback: legacy OpenAI path
    log.warning("idol-frame failed, falling back to legacy OpenAI path")
    return _generate_reply_inner(client, msg, recent_messages, log, force_respond=force_respond, model_override=None)


def _generate_reply_inner(
    client: OpenAI,
    msg: dict,
    recent_messages: list,
    log: logging.Logger,
    force_respond: bool = False,
    model_override: Optional[str] = None,
) -> Optional[str]:
    """Call OpenAI with tools; return the reply text or None to skip."""
    # Build user message with context
    sender = msg.get("from", {}) or {}
    sender_handle = sender.get("username") or sender.get("first_name") or "unknown"
    text = msg.get("text", "")
    rt = msg.get("reply_to_message") or {}
    rt_text = (rt.get("text") or rt.get("caption") or "")[:300]
    rt_from = (rt.get("from", {}) or {}).get("username") or ""

    context_lines = [
        f'Recent channel chatter (last messages, oldest first):',
    ]
    for m in recent_messages[-8:]:
        context_lines.append(f'  @{m.get("user","?")}: {m.get("text","")[:140]}')
    context_lines.append("")
    context_lines.append(f'New message from @{sender_handle}:')
    if rt_text:
        context_lines.append(f'  (replying to @{rt_from}: "{rt_text}")')
    context_lines.append(f'  "{text}"')
    context_lines.append("")
    if force_respond:
        context_lines.append("This user is talking to YOU directly (mention or reply to your post).")
        context_lines.append("You MUST respond in character. Do NOT return <SKIP>.")
        context_lines.append("Use tools for any data claim. Keep it tight.")
    else:
        context_lines.append("Decide if this deserves a response. If trivial small-talk, return <SKIP>.")
        context_lines.append("Otherwise respond IN CHARACTER. Use tools for any data claim.")

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": "\n".join(context_lines)},
    ]

    # Default to the fast model; allow caller to override (escalation path).
    use_model = model_override or MODEL
    for round_n in range(MAX_TOOL_ROUNDS):
        try:
            resp = client.chat.completions.create(
                model=use_model,
                messages=messages,
                tools=TOOLS,
                tool_choice="auto",
                temperature=0.85,
                max_tokens=500,
            )
        except Exception as e:
            log.warning("openai call failed on %s (%s) — falling back to mini", use_model, e)
            try:
                resp = client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=messages,
                    tools=TOOLS,
                    tool_choice="auto",
                    temperature=0.85,
                    max_tokens=500,
                )
            except Exception as e2:
                log.error("fallback also failed: %s", e2)
                return None

        choice = resp.choices[0].message

        if choice.tool_calls:
            # Append assistant turn
            messages.append({
                "role": "assistant",
                "content": choice.content or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                    }
                    for tc in choice.tool_calls
                ],
            })
            for tc in choice.tool_calls:
                fn = TOOL_FNS.get(tc.function.name)
                args = {}
                try:
                    args = json.loads(tc.function.arguments or "{}")
                except json.JSONDecodeError:
                    pass
                if fn:
                    try:
                        result = fn(**args)
                    except Exception as e:
                        result = {"error": str(e)}
                else:
                    result = {"error": f"unknown tool {tc.function.name}"}
                log.info("tool call: %s(%s) → keys=%s",
                         tc.function.name, args, list(result.keys()) if isinstance(result, dict) else type(result).__name__)
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": json.dumps(result),
                })
            continue

        # Final assistant answer
        content = (choice.content or "").strip()
        if not content:
            return None
        if "<SKIP>" in content:
            return None
        return content

    log.warning("hit max tool rounds without final answer")
    return None


# ─── Telegram client ──────────────────────────────────────────────────────────

def tg_post(token: str, chat_id: str, text: str, reply_to: Optional[int]) -> Optional[int]:
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    if reply_to:
        payload["reply_parameters"] = {"message_id": reply_to}
    try:
        r = requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json=payload, timeout=15,
        )
        d = r.json()
        if not d.get("ok"):
            return None
        return d["result"]["message_id"]
    except Exception:
        return None


def tg_long_poll(token: str, offset: int) -> list:
    try:
        r = requests.get(
            f"https://api.telegram.org/bot{token}/getUpdates",
            params={"offset": offset, "timeout": 25, "allowed_updates": json.dumps(["message", "edited_message"])},
            timeout=35,
        )
        d = r.json()
        return d.get("result", []) if d.get("ok") else []
    except Exception:
        return []


# ─── Main loop ────────────────────────────────────────────────────────────────

def main():
    load_env()
    log = setup_logging()
    state = State.load()

    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")
    openai_key = os.environ.get("OPENAI_API_KEY")
    if not (token and chat_id and openai_key):
        log.error("missing TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID / OPENAI_API_KEY")
        return

    client = OpenAI(api_key=openai_key)
    log.info("=== chat_bot start === resuming from update %d", state.last_update_id)

    while True:
        updates = tg_long_poll(token, state.last_update_id + 1)
        if not updates:
            time.sleep(3)
            continue

        for u in updates:
            state.last_update_id = max(state.last_update_id, u.get("update_id", 0))
            msg = u.get("message") or u.get("edited_message")
            if not msg:
                continue
            text = (msg.get("text") or msg.get("caption") or "").strip()
            sender = (msg.get("from", {}) or {}).get("username") or "?"

            # Track recent chatter for context
            if text and len(state.recent_messages) < 50:
                state.recent_messages.append({"user": sender, "text": text})
            elif text:
                state.recent_messages.append({"user": sender, "text": text})

            # Auto-mod: scan for known scam patterns first. If matched, take
            # action and skip the normal reply path.
            scam_hits = detect_scam_patterns(text) if text else []
            if scam_hits and sender not in MOD_PROTECTED_USERS:
                log.warning("SCAM DETECT @%s patterns=%s | %s", sender, scam_hits, text[:80])
                # Delete the message and mute the user for 1 hour. The bot post
                # gives the channel transparency about why.
                ok_del = mod_delete_message(chat_id, msg["message_id"], log)
                user_id = (msg.get("from") or {}).get("id")
                ok_mute = mod_mute_user(chat_id, user_id, 3600, log) if user_id else False
                if ok_del or ok_mute:
                    tg_post(token, chat_id, (
                        f"⚠️ auto-mod: removed message from <code>@{sender}</code> "
                        f"matching scam pattern. muted 1h. if false positive, "
                        f"@NemoDor can /unmute."
                    ), reply_to=None)
                continue

            # /mod commands from the dev: /mute @user 3600 [reason], /ban @user [reason]
            if text.startswith(("/mute ", "/ban ", "/unmute ", "/unban ")) and sender in MOD_AUTHORIZED_USERS:
                handle_mod_command(text, msg, chat_id, log)
                continue

            should, reason = should_respond(msg, log)
            if not should:
                log.info("skip (%s): @%s | %s", reason, sender, text[:80])
                continue

            # Cooldown
            now = time.time()
            if now - state.last_post_ts < COOLDOWN_SECONDS:
                log.info("cooldown (%.0fs) — skipping reply to @%s",
                         COOLDOWN_SECONDS - (now - state.last_post_ts), sender)
                continue

            log.info("respond (%s) to @%s: %s", reason, sender, text[:120])
            force = reason in ("mention", "reply to bot")
            reply = generate_reply(client, msg, state.recent_messages, log, force_respond=force)
            # If forced and the model still tried to skip, escalate to gpt-4o
            if not reply and force:
                log.info("forced retry with heavy model (gpt-4o)")
                reply = generate_reply_heavy(client, msg, state.recent_messages, log)
            if not reply:
                log.info("model returned <SKIP> or empty — staying silent")
                continue

            # Post
            mid = tg_post(token, chat_id, reply, reply_to=msg["message_id"])
            if mid:
                log.info("posted msg_id=%d", mid)
                state.last_post_ts = now
            else:
                log.error("failed to post reply")

        state.save()


if __name__ == "__main__":
    main()
