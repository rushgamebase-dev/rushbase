#!/usr/bin/env python3
"""
fee_bot.py — Rush fee distribution + Telegram event bot.

Two run modes:

    python fee_bot.py distribute
        Cron-callable. Claims FFM Flaunch fees (as 0xdd12) + V2 dev fees (as
        oracle), checks delta against threshold, splits 50/20/30 across
        stakers / V2 holders / dev treasury, and posts a receipt to the
        configured Telegram channel. Idempotent: if delta < THRESHOLD it
        only updates the silent live board and exits.

    python fee_bot.py listen
        Long-running websocket daemon. Subscribes to Staked / Withdrawn /
        Claimed events on the RushStaking contract and posts notable ones
        (above the configured threshold) to the channel. Auto-reconnects.

    python fee_bot.py board
        One-shot helper to upload + pin the live-board video on the channel
        and persist the message_id to .fee_bot_state.json. Run once after
        the bot is added as admin.

Environment (all required for `distribute` and `listen`):
    PRIVATE_KEY            Oracle key (V2 claimDevFees authority).
    DEV_KEY                0xdd12 fee_treasury key (FFM claim).
    OWNER_KEY              0x981f staking-owner key (notifyRewardAmount).
                           Optional — if missing, distribution still runs but
                           skips the staking-funding leg and prints a warning.
    RPC_URL                Base mainnet HTTPS RPC (Chainstack — paid).
    WSS_URL                Base mainnet websocket RPC (Chainstack —
                           same node as RPC_URL with wss:// scheme).
    TELEGRAM_BOT_TOKEN     Bot token from @BotFather.
    TELEGRAM_CHAT_ID       Channel/group ID (negative integer).
    LIVE_BOARD_VIDEO       Path to the looping mp4 used as the pinned board.

State persisted to oracle/.fee_bot_state.json:
    - live_board_message_id (set after first run of `board`)
    - last_distribution_ts / last_distribution_eth
    - cumulative_distributed_eth
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import requests
from web3 import Web3
from web3.middleware import ExtraDataToPOAMiddleware

# ─── Constants ────────────────────────────────────────────────────────────────

ROOT = Path(__file__).resolve().parent
RUSH_ROOT = ROOT.parent
LOG_DIR = ROOT / "logs"
LOG_DIR.mkdir(exist_ok=True)
STATE_FILE = ROOT / ".fee_bot_state.json"
LOG_FILE = LOG_DIR / "fee_bot.log"

# Mainnet (Base) addresses — frozen here for review; do not pull from env.
FFM_ADDRESS = "0x9eA9EEEAC3Cf3420DCb298DB1b1C6CA77E9F7462"
V2_ADDRESS = "0x5b7b2a6AC4f3A017fb943C9F550d609174532fFF"
STAKING_ADDRESS = "0x65f05974b1fEec584F6FF47038C6d1FF06E32548"
DEV_TREASURY = "0xdd12D83786C2BAc7be3D59869834C23E91449A2D"
ORACLE_WALLET = "0x4c385830c2E241EfeEd070Eb92606B6AedeDA277"
STAKING_OWNER = "0x981f26bD8F90f3E755Df229888f383E725A52dCA"

# Distribution policy
SPLIT_STAKERS_BPS = 5000  # 50%
SPLIT_V2_BPS = 2000  # 20%
SPLIT_PROTOCOL_BPS = 3000  # 30% (implicit — leftover stays in dev treasury)
DISTRIBUTION_THRESHOLD_WEI = 5 * 10**15  # 0.005 ETH minimum to fire a cycle

# ─── HARD GUARDRAILS — no exceptions ─────────────────────────────────────────
# Whitelist of addresses this bot is ever allowed to send ETH to. Refuse
# any send to anything outside this list. Updates require code review +
# deploy, not config — hardcoded by intent.
ALLOWED_VALUE_RECIPIENTS = {
    STAKING_ADDRESS.lower(),    # 0x65f0… RushStaking, for notifyRewardAmount
    V2_ADDRESS.lower(),          # 0x5b7b… V2 contract, for receive() auto-distribute
}
# Hard cap on a single value-bearing tx. Any attempt to send more aborts
# the run and logs an error. ~$300 at $3k/ETH — generous for a single
# notify but small enough that a runaway can't drain the wallet.
MAX_SINGLE_TX_VALUE_WEI = 10 * 10**16  # 0.1 ETH
# Hard cap on a single full distribute cycle's outgoing value.
MAX_CYCLE_VALUE_WEI = 50 * 10**16      # 0.5 ETH

# Event filters for `listen` mode
STAKE_ALERT_THRESHOLD_RUSH = 50_000_000 * 10**18  # 50M $RUSH
CLAIM_ALERT_THRESHOLD_WEI = 50 * 10**15  # 0.05 ETH

# Minimal ABIs — only the methods/events we touch.
FFM_ABI = json.loads(
    """[
    {"type":"function","name":"claim","stateMutability":"nonpayable","inputs":[],"outputs":[{"type":"uint256"}]},
    {"type":"function","name":"balances","stateMutability":"view","inputs":[{"type":"address"}],"outputs":[{"type":"uint256"}]}
]"""
)
V2_ABI = json.loads(
    """[
    {"type":"function","name":"claimDevFees","stateMutability":"nonpayable","inputs":[],"outputs":[]},
    {"type":"function","name":"devPending","stateMutability":"view","inputs":[],"outputs":[{"type":"uint96"}]},
    {"type":"function","name":"totalShares","stateMutability":"view","inputs":[],"outputs":[{"type":"uint256"}]}
]"""
)
STAKING_ABI = json.loads(
    """[
    {"type":"function","name":"notifyRewardAmount","stateMutability":"payable","inputs":[],"outputs":[]},
    {"type":"function","name":"totalStaked","stateMutability":"view","inputs":[],"outputs":[{"type":"uint256"}]},
    {"type":"function","name":"rewardRate","stateMutability":"view","inputs":[],"outputs":[{"type":"uint256"}]},
    {"type":"function","name":"periodFinish","stateMutability":"view","inputs":[],"outputs":[{"type":"uint256"}]},
    {"type":"function","name":"transferOwnership","stateMutability":"nonpayable","inputs":[{"type":"address"}],"outputs":[]},
    {"type":"function","name":"owner","stateMutability":"view","inputs":[],"outputs":[{"type":"address"}]},
    {"type":"event","name":"Staked","inputs":[{"name":"user","type":"address","indexed":true},{"name":"amount","type":"uint256","indexed":false}]},
    {"type":"event","name":"Withdrawn","inputs":[{"name":"user","type":"address","indexed":true},{"name":"amount","type":"uint256","indexed":false}]},
    {"type":"event","name":"Claimed","inputs":[{"name":"user","type":"address","indexed":true},{"name":"ethAmount","type":"uint256","indexed":false}]},
    {"type":"event","name":"RewardAdded","inputs":[{"name":"ethAmount","type":"uint256","indexed":false},{"name":"newRewardRate","type":"uint256","indexed":false},{"name":"periodFinish","type":"uint256","indexed":false}]}
]"""
)


# ─── Setup ────────────────────────────────────────────────────────────────────

def setup_logging() -> logging.Logger:
    logger = logging.getLogger("fee_bot")
    logger.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)sZ | %(levelname)s | %(message)s", "%Y-%m-%dT%H:%M:%S")
    fh = logging.FileHandler(LOG_FILE)
    fh.setFormatter(fmt)
    sh = logging.StreamHandler()
    sh.setFormatter(fmt)
    if not logger.handlers:
        logger.addHandler(fh)
        logger.addHandler(sh)
    return logger


def load_env() -> None:
    """Source the project .env file if present (does not override real env)."""
    env_path = RUSH_ROOT / ".env"
    if not env_path.exists():
        return
    for raw in env_path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip()
        v = v.strip().strip("'\"")
        os.environ.setdefault(k, v)


def w3() -> Web3:
    rpc = os.environ["RPC_URL"]
    web3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 30}))
    # Base is OP-stack (post-merge), POA middleware is harmless and avoids
    # the occasional extraData-too-long edge case.
    web3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
    return web3


# ─── State ────────────────────────────────────────────────────────────────────

@dataclass
class State:
    live_board_message_id: Optional[int] = None
    last_distribution_ts: int = 0
    last_distribution_wei: int = 0
    cumulative_distributed_wei: int = 0
    last_event_block: int = 0  # for `listen` mode resume

    @classmethod
    def load(cls) -> "State":
        if not STATE_FILE.exists():
            return cls()
        try:
            return cls(**json.loads(STATE_FILE.read_text()))
        except Exception:
            return cls()

    def save(self) -> None:
        STATE_FILE.write_text(json.dumps(self.__dict__, indent=2))


# ─── Telegram client ──────────────────────────────────────────────────────────

class Telegram:
    def __init__(self, token: str, chat_id: str, log: logging.Logger):
        self.token = token
        self.chat_id = chat_id
        self.log = log
        self.base = f"https://api.telegram.org/bot{token}"

    def _post(self, method: str, **kwargs) -> dict:
        try:
            r = requests.post(f"{self.base}/{method}", json=kwargs, timeout=20)
            data = r.json()
            if not data.get("ok"):
                self.log.error("telegram %s failed: %s", method, data)
            return data
        except Exception as e:
            self.log.error("telegram %s exception: %s", method, e)
            return {"ok": False, "error": str(e)}

    def send(self, text: str, *, silent: bool = False) -> Optional[int]:
        d = self._post(
            "sendMessage",
            chat_id=self.chat_id,
            text=text,
            parse_mode="HTML",
            disable_notification=silent,
            disable_web_page_preview=True,
        )
        if d.get("ok"):
            return d["result"]["message_id"]
        return None

    def edit_caption(self, message_id: int, caption: str) -> bool:
        d = self._post(
            "editMessageCaption",
            chat_id=self.chat_id,
            message_id=message_id,
            caption=caption,
            parse_mode="HTML",
        )
        return d.get("ok", False)

    def upload_video_pin(self, video_path: str, caption: str) -> Optional[int]:
        try:
            with open(video_path, "rb") as f:
                r = requests.post(
                    f"{self.base}/sendVideo",
                    data={
                        "chat_id": self.chat_id,
                        "caption": caption,
                        "parse_mode": "HTML",
                        "disable_notification": "true",
                        "supports_streaming": "true",
                    },
                    files={"video": f},
                    timeout=120,
                )
            data = r.json()
            if not data.get("ok"):
                self.log.error("sendVideo failed: %s", data)
                return None
            mid = data["result"]["message_id"]
            self._post("pinChatMessage", chat_id=self.chat_id, message_id=mid, disable_notification=True)
            return mid
        except Exception as e:
            self.log.error("upload_video_pin exception: %s", e)
            return None


# ─── Format helpers ───────────────────────────────────────────────────────────

def fmt_eth(wei: int, decimals: int = 4) -> str:
    return f"{wei / 10**18:.{decimals}f}"


def fmt_rush(wei: int) -> str:
    n = wei / 10**18
    if n >= 1_000_000_000:
        return f"{n / 1_000_000_000:.2f}B"
    if n >= 1_000_000:
        return f"{n / 1_000_000:.2f}M"
    if n >= 1_000:
        return f"{n / 1_000:.2f}K"
    return f"{n:.2f}"


def short_addr(a: str) -> str:
    return f"{a[:6]}...{a[-4:]}"


def basescan_tx(tx_hash: str) -> str:
    return f"https://basescan.org/tx/{tx_hash}"


def distribution_message(
    *,
    cycle: int,
    total_wei: int,
    stakers_wei: int,
    v2_wei: int,
    protocol_wei: int,
    tx_hash: str,
    reward_rate_per_day_wei: int,
    pool_tvl_rush: int,
) -> str:
    return (
        "<pre>"
        "═══════════════════════════════════\n"
        f"DISTRIBUTION #{cycle}\n"
        "═══════════════════════════════════\n"
        f"CLAIMED       {fmt_eth(total_wei)} ETH\n"
        f"├─ STAKERS    {fmt_eth(stakers_wei)} ETH (50%)\n"
        f"├─ V2 TILES   {fmt_eth(v2_wei)} ETH (20%)\n"
        f"└─ PROTOCOL   {fmt_eth(protocol_wei)} ETH (30%)\n\n"
        f"REWARD RATE   {fmt_eth(reward_rate_per_day_wei, 5)} ETH/day\n"
        f"POOL          {fmt_rush(pool_tvl_rush)} $RUSH staked\n"
        "</pre>\n"
        f'<a href="{basescan_tx(tx_hash)}">tx ↗</a>'
    )


def stake_message(user: str, amount_wei: int, new_total_wei: int, prev_total_wei: int) -> str:
    pct = (amount_wei / prev_total_wei * 100) if prev_total_wei else 0
    tier = "🐋" if amount_wei >= 100_000_000 * 10**18 else "🟢"
    return (
        f"{tier} <b>NEW STAKE</b>\n"
        f"<code>{short_addr(user)}</code> staked <b>{fmt_rush(amount_wei)} $RUSH</b>\n"
        f"Pool: {fmt_rush(prev_total_wei)} → {fmt_rush(new_total_wei)} (+{pct:.2f}%)"
    )


def claim_message(user: str, eth_wei: int) -> str:
    return (
        f"💸 <b>STAKER CLAIMED</b>\n"
        f"<code>{short_addr(user)}</code> claimed <b>{fmt_eth(eth_wei)} ETH</b>"
    )


def live_board_caption(
    *,
    pool_tvl_rush: int,
    reward_rate_per_day_wei: int,
    cumulative_distributed_wei: int,
    last_distribution_ts: int,
    last_distribution_wei: int,
) -> str:
    if last_distribution_ts:
        ago_sec = max(0, int(time.time()) - last_distribution_ts)
        ago = f"{ago_sec // 60}m" if ago_sec < 3600 else f"{ago_sec // 3600}h{(ago_sec % 3600) // 60}m"
        last_line = f"Last drop: {fmt_eth(last_distribution_wei)} ETH ({ago} ago)"
    else:
        last_line = "Last drop: —"
    return (
        "<b>📌 LIVE BOARD — auto-update</b>\n\n"
        f"<b>Pool:</b> {fmt_rush(pool_tvl_rush)} $RUSH staked\n"
        f"<b>Reward rate:</b> {fmt_eth(reward_rate_per_day_wei, 5)} ETH/day\n"
        f"<b>Total distributed:</b> {fmt_eth(cumulative_distributed_wei)} ETH\n"
        f"<b>{last_line}</b>\n\n"
        "<i>Stake $RUSH → earn ETH passively · rushgame.vip/stake</i>"
    )


# ─── On-chain helpers ─────────────────────────────────────────────────────────

def cast_send(*, to: str, sig: str, args: list, key: str, value_wei: int = 0, log=None) -> str:
    """Wrapper around `cast send`. Returns tx hash on success, raises on failure.

    Hard guardrails on value-bearing sends:
      - to must be in ALLOWED_VALUE_RECIPIENTS
      - value_wei must be ≤ MAX_SINGLE_TX_VALUE_WEI
    Any violation raises immediately and refuses to broadcast.
    """
    if value_wei > 0:
        if to.lower() not in ALLOWED_VALUE_RECIPIENTS:
            raise RuntimeError(
                f"GUARDRAIL VIOLATION: refusing to send {value_wei/1e18:.6f} ETH "
                f"to non-allowlisted address {to}. Allowed: {ALLOWED_VALUE_RECIPIENTS}"
            )
        if value_wei > MAX_SINGLE_TX_VALUE_WEI:
            raise RuntimeError(
                f"GUARDRAIL VIOLATION: refusing single tx of {value_wei/1e18:.6f} ETH "
                f"(max {MAX_SINGLE_TX_VALUE_WEI/1e18:.4f} ETH). Manual intervention required."
            )
    cmd = [
        "cast", "send", to, sig, *map(str, args),
        "--private-key", key,
        "--rpc-url", os.environ["RPC_URL"],
        "--json",
    ]
    if value_wei:
        cmd.extend(["--value", str(value_wei)])
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if res.returncode != 0:
        if log:
            log.error("cast send failed: %s", res.stderr.strip()[:300])
        raise RuntimeError(f"cast send failed: {res.stderr.strip()[:200]}")
    try:
        receipt = json.loads(res.stdout)
        return receipt.get("transactionHash") or receipt.get("hash") or ""
    except json.JSONDecodeError:
        # fallback: scrape stdout
        for line in res.stdout.splitlines():
            if "transactionHash" in line:
                return line.split()[-1]
    return ""


# ─── distribute mode ──────────────────────────────────────────────────────────

def cmd_distribute(log: logging.Logger, state: State, tg: Optional[Telegram]) -> None:
    """One-shot: claim what's claimable, split, distribute, post receipt."""
    web3 = w3()
    ffm = web3.eth.contract(address=Web3.to_checksum_address(FFM_ADDRESS), abi=FFM_ABI)
    v2 = web3.eth.contract(address=Web3.to_checksum_address(V2_ADDRESS), abi=V2_ABI)
    staking = web3.eth.contract(address=Web3.to_checksum_address(STAKING_ADDRESS), abi=STAKING_ABI)

    dev_key = os.environ.get("DEV_KEY")
    oracle_key = os.environ.get("PRIVATE_KEY")
    owner_key = os.environ.get("OWNER_KEY")  # optional

    if not dev_key or not oracle_key:
        raise RuntimeError("DEV_KEY and PRIVATE_KEY (oracle) are required")

    # 1) Read pre-state
    ffm_pending = ffm.functions.balances(Web3.to_checksum_address(DEV_TREASURY)).call()
    v2_pending = v2.functions.devPending().call()
    dev_balance_before = web3.eth.get_balance(Web3.to_checksum_address(DEV_TREASURY))
    log.info("pre | ffm_pending=%d v2_pending=%d dev_bal=%d", ffm_pending, v2_pending, dev_balance_before)

    total_pending = ffm_pending + v2_pending
    if total_pending < DISTRIBUTION_THRESHOLD_WEI:
        log.info("below threshold (%d < %d) — updating live board only",
                 total_pending, DISTRIBUTION_THRESHOLD_WEI)
        if tg:
            update_live_board(log, state, tg, web3, staking)
        return

    # 2) Claim FFM (as 0xdd12)
    if ffm_pending > 0:
        tx = cast_send(to=FFM_ADDRESS, sig="claim()", args=[], key=dev_key, log=log)
        log.info("ffm_claim tx=%s amount=%d", tx, ffm_pending)
        time.sleep(3)

    # 3) Claim V2 dev (as oracle, sends to DEV_TREASURY)
    if v2_pending > 0:
        tx = cast_send(to=V2_ADDRESS, sig="claimDevFees()", args=[], key=oracle_key, log=log)
        log.info("v2_claim tx=%s amount=%d", tx, v2_pending)
        time.sleep(3)

    # 4) Compute actual delta on dev treasury
    dev_balance_after = web3.eth.get_balance(Web3.to_checksum_address(DEV_TREASURY))
    delta = dev_balance_after - dev_balance_before
    if delta < DISTRIBUTION_THRESHOLD_WEI:
        log.warning("delta %d below threshold post-claim — aborting split", delta)
        return

    # 5) Compute split (drop the protocol slice naturally — it just stays in dev treasury)
    stakers_wei = (delta * SPLIT_STAKERS_BPS) // 10000
    v2_wei = (delta * SPLIT_V2_BPS) // 10000
    protocol_wei = delta - stakers_wei - v2_wei  # actual residual to keep
    log.info("split | total=%d stakers=%d v2=%d protocol=%d",
             delta, stakers_wei, v2_wei, protocol_wei)

    # Pre-flight guardrails on the full cycle's outgoing total
    cycle_total = stakers_wei + v2_wei
    if cycle_total > MAX_CYCLE_VALUE_WEI:
        raise RuntimeError(
            f"GUARDRAIL VIOLATION: cycle total {cycle_total/1e18:.4f} ETH exceeds "
            f"MAX_CYCLE_VALUE_WEI ({MAX_CYCLE_VALUE_WEI/1e18:.4f} ETH). Aborting."
        )

    # 6a) Send V2 share — plain transfer triggers V2.receive() auto-distribution
    if V2_ADDRESS.lower() not in ALLOWED_VALUE_RECIPIENTS:
        raise RuntimeError(f"GUARDRAIL: V2 address {V2_ADDRESS} not whitelisted")
    if v2_wei > MAX_SINGLE_TX_VALUE_WEI:
        raise RuntimeError(f"GUARDRAIL: v2 tx {v2_wei/1e18:.4f} ETH > cap")
    cmd = [
        "cast", "send", V2_ADDRESS,
        "--value", str(v2_wei),
        "--private-key", dev_key,
        "--rpc-url", os.environ["RPC_URL"],
        "--json",
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if res.returncode != 0:
        log.error("v2 transfer failed: %s", res.stderr[:200])
        raise RuntimeError("v2 transfer failed")
    tx_v2 = json.loads(res.stdout).get("transactionHash", "")
    log.info("v2_distribute tx=%s amount=%d", tx_v2, v2_wei)
    time.sleep(3)

    # 6b) Fund staking — DEV_KEY (0xdd12) is now staking owner after the
    #     2026-05-06 transferOwnership tx, so we call notifyRewardAmount
    #     directly with the dev key. One tx, no owner-key juggle.
    tx_stk = cast_send(
        to=STAKING_ADDRESS, sig="notifyRewardAmount()", args=[],
        key=dev_key, value_wei=stakers_wei, log=log
    )
    log.info("staking_notify tx=%s amount=%d", tx_stk, stakers_wei)

    # 7) Update state
    state.last_distribution_ts = int(time.time())
    state.last_distribution_wei = delta
    state.cumulative_distributed_wei += delta
    state.save()

    # 8) Post Telegram receipt
    if tg:
        # Refresh post-state for the message
        time.sleep(2)
        reward_rate = staking.functions.rewardRate().call()
        reward_rate_per_day = reward_rate * 86400
        pool_tvl = staking.functions.totalStaked().call()
        # Cycle counter — derive from cumulative_distributed_wei as proxy or just use ts
        cycle = state.last_distribution_ts % 1000  # placeholder ordering
        msg = distribution_message(
            cycle=cycle,
            total_wei=delta,
            stakers_wei=stakers_wei,
            v2_wei=v2_wei,
            protocol_wei=protocol_wei,
            tx_hash=tx_stk or tx_v2 or "",
            reward_rate_per_day_wei=reward_rate_per_day,
            pool_tvl_rush=pool_tvl,
        )
        tg.send(msg)
        update_live_board(log, state, tg, web3, staking)


def update_live_board(log: logging.Logger, state: State, tg: Telegram, web3: Web3, staking) -> None:
    if not state.live_board_message_id:
        log.info("live board not yet created — run `python fee_bot.py board` first")
        return
    reward_rate = staking.functions.rewardRate().call()
    pool_tvl = staking.functions.totalStaked().call()
    caption = live_board_caption(
        pool_tvl_rush=pool_tvl,
        reward_rate_per_day_wei=reward_rate * 86400,
        cumulative_distributed_wei=state.cumulative_distributed_wei,
        last_distribution_ts=state.last_distribution_ts,
        last_distribution_wei=state.last_distribution_wei,
    )
    tg.edit_caption(state.live_board_message_id, caption)


# ─── board mode (one-shot upload + pin) ───────────────────────────────────────

def cmd_board(log: logging.Logger, state: State, tg: Telegram) -> None:
    if state.live_board_message_id:
        log.info("live board already exists at message_id=%d", state.live_board_message_id)
        if "--force" not in sys.argv:
            print(f"Already pinned (message_id={state.live_board_message_id}). "
                  f"Pass --force to re-upload.")
            return
    video = os.environ.get("LIVE_BOARD_VIDEO")
    if not video or not Path(video).exists():
        log.error("LIVE_BOARD_VIDEO env var missing or file not found: %s", video)
        return

    web3 = w3()
    staking = web3.eth.contract(address=Web3.to_checksum_address(STAKING_ADDRESS), abi=STAKING_ABI)
    reward_rate = staking.functions.rewardRate().call()
    pool_tvl = staking.functions.totalStaked().call()

    caption = live_board_caption(
        pool_tvl_rush=pool_tvl,
        reward_rate_per_day_wei=reward_rate * 86400,
        cumulative_distributed_wei=state.cumulative_distributed_wei,
        last_distribution_ts=state.last_distribution_ts,
        last_distribution_wei=state.last_distribution_wei,
    )
    log.info("uploading live board video (%s)", video)
    mid = tg.upload_video_pin(video, caption)
    if mid:
        state.live_board_message_id = mid
        state.save()
        log.info("pinned live board at message_id=%d", mid)
    else:
        log.error("failed to pin live board")


# ─── listen mode (websocket daemon) ───────────────────────────────────────────

def cmd_listen(log: logging.Logger, state: State, tg: Optional[Telegram]) -> None:
    """Long-running daemon: subscribes to staking events and posts notable ones."""
    web3 = w3()
    staking = web3.eth.contract(address=Web3.to_checksum_address(STAKING_ADDRESS), abi=STAKING_ABI)

    # Resume from last seen block, fall back to "now - 1000 blocks"
    head = web3.eth.block_number
    from_block = max(state.last_event_block + 1, head - 100) if state.last_event_block else head
    log.info("listen starting from block %d", from_block)

    backoff = 5
    while True:
        try:
            head = web3.eth.block_number
            if from_block > head:
                time.sleep(15)
                continue
            to_block = min(from_block + 1000, head)

            # Pull all relevant events in one range
            events = []
            for ev_name in ("Staked", "Withdrawn", "Claimed", "RewardAdded"):
                ev = getattr(staking.events, ev_name)
                logs = ev.get_logs(from_block=from_block, to_block=to_block)
                for entry in logs:
                    events.append((entry["blockNumber"], entry["logIndex"], ev_name, entry))
            events.sort(key=lambda x: (x[0], x[1]))

            for blk, _, name, entry in events:
                handle_event(log, tg, web3, staking, name, entry)
                state.last_event_block = blk
                state.save()

            from_block = to_block + 1
            backoff = 5
            time.sleep(15)
        except Exception as e:
            log.error("listen loop error: %s — sleeping %ds", e, backoff)
            time.sleep(backoff)
            backoff = min(backoff * 2, 300)


def handle_event(log, tg, web3, staking, name: str, entry) -> None:
    args = entry["args"]
    if name == "Staked":
        amount = args["amount"]
        if amount < STAKE_ALERT_THRESHOLD_RUSH:
            return
        # Need before/after totals for the message
        block = entry["blockNumber"]
        total_after = staking.functions.totalStaked().call(block_identifier=block)
        total_before = total_after - amount
        log.info("STAKE event: %s amount=%d", args["user"], amount)
        if tg:
            tg.send(stake_message(args["user"], amount, total_after, total_before))
    elif name == "Claimed":
        amount = args["ethAmount"]
        if amount < CLAIM_ALERT_THRESHOLD_WEI:
            return
        log.info("CLAIM event: %s amount=%d", args["user"], amount)
        if tg:
            tg.send(claim_message(args["user"], amount))
    elif name == "Withdrawn":
        # Only post for very large unstakes — they signal sentiment shifts
        amount = args["amount"]
        if amount < STAKE_ALERT_THRESHOLD_RUSH * 2:
            return
        log.info("WITHDRAWN event: %s amount=%d", args["user"], amount)
        if tg:
            tg.send(
                f"⚠️ <b>LARGE UNSTAKE</b>\n"
                f"<code>{short_addr(args['user'])}</code> withdrew <b>{fmt_rush(amount)} $RUSH</b>"
            )
    elif name == "RewardAdded":
        # This fires when notifyRewardAmount is called — distribution side already
        # posts the full receipt. Keep this as a quiet log to avoid double-posting.
        log.info("RewardAdded event: amount=%d", args["ethAmount"])


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["distribute", "listen", "board", "dryrun"])
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    load_env()
    log = setup_logging()
    state = State.load()

    tg = None
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat = os.environ.get("TELEGRAM_CHAT_ID")
    if token and chat:
        tg = Telegram(token, chat, log)
    else:
        log.warning("TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set — Telegram posts disabled")

    log.info("=== fee_bot %s start ===", args.mode)
    try:
        if args.mode == "distribute":
            cmd_distribute(log, state, tg)
        elif args.mode == "listen":
            cmd_listen(log, state, tg)
        elif args.mode == "board":
            if tg is None:
                log.error("Telegram not configured")
                sys.exit(1)
            cmd_board(log, state, tg)
        elif args.mode == "dryrun":
            web3 = w3()
            ffm = web3.eth.contract(address=Web3.to_checksum_address(FFM_ADDRESS), abi=FFM_ABI)
            v2 = web3.eth.contract(address=Web3.to_checksum_address(V2_ADDRESS), abi=V2_ABI)
            staking = web3.eth.contract(address=Web3.to_checksum_address(STAKING_ADDRESS), abi=STAKING_ABI)
            ffm_p = ffm.functions.balances(Web3.to_checksum_address(DEV_TREASURY)).call()
            v2_p = v2.functions.devPending().call()
            tvl = staking.functions.totalStaked().call()
            rate = staking.functions.rewardRate().call()
            print(f"FFM pending (0xdd12):  {fmt_eth(ffm_p, 6)} ETH")
            print(f"V2 devPending:          {fmt_eth(v2_p, 6)} ETH")
            print(f"Combined claimable:     {fmt_eth(ffm_p + v2_p, 6)} ETH")
            print(f"Threshold:              {fmt_eth(DISTRIBUTION_THRESHOLD_WEI, 6)} ETH")
            print(f"Would fire?:            {(ffm_p + v2_p) >= DISTRIBUTION_THRESHOLD_WEI}")
            print(f"Pool TVL:               {fmt_rush(tvl)} $RUSH")
            print(f"Reward rate:            {fmt_eth(rate * 86400, 6)} ETH/day")
            print(f"Cumulative distributed: {fmt_eth(state.cumulative_distributed_wei)} ETH")
            print(f"Last distribution:      {state.last_distribution_ts} ({fmt_eth(state.last_distribution_wei)} ETH)")
            print(f"Live board msg_id:      {state.live_board_message_id}")
    except KeyboardInterrupt:
        log.info("interrupted")
    except Exception as e:
        log.exception("fatal: %s", e)
        sys.exit(1)
    log.info("=== fee_bot %s end ===", args.mode)


if __name__ == "__main__":
    main()
