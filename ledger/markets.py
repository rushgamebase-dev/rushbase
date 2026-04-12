"""Market discovery via factories + per-market event scanning."""

import logging

from web3 import Web3

from config import (
    DEPLOY_BLOCKS, FACTORY_BURN, FACTORY_ETH, TOPIC_MARKET_CREATED,
)
from decoders import decode_logs
from fetcher import get_logs_chunked, make_w3

log = logging.getLogger(__name__)


def discover_markets(w3: Web3) -> dict:
    """Discover all market addresses from both factories.

    Returns {
        'eth_factory': {'deploy_block': int, 'markets': [decoded_event, ...]},
        'burn_factory': {'deploy_block': int, 'markets': [...]},
    }
    """
    eth_deploy = DEPLOY_BLOCKS["factory_eth"]
    burn_deploy = DEPLOY_BLOCKS["factory_burn"]

    log.info("Scanning ETH factory for MarketCreated from block %d...", eth_deploy)
    eth_logs = get_logs_chunked(w3, FACTORY_ETH, eth_deploy, topics=[TOPIC_MARKET_CREATED])
    eth_markets = decode_logs(eth_logs)
    log.info("ETH factory: %d markets created", len(eth_markets))

    log.info("Scanning BURN factory for MarketCreated from block %d...", burn_deploy)
    burn_logs = get_logs_chunked(w3, FACTORY_BURN, burn_deploy, topics=[TOPIC_MARKET_CREATED])
    burn_markets = decode_logs(burn_logs)
    log.info("BURN factory: %d markets created", len(burn_markets))

    return {
        "eth_factory": {
            "address": FACTORY_ETH,
            "deploy_block": eth_deploy,
            "markets": eth_markets,
        },
        "burn_factory": {
            "address": FACTORY_BURN,
            "deploy_block": burn_deploy,
            "markets": burn_markets,
        },
    }


def scan_market_events(w3: Web3, market_address: str, from_block: int) -> list[dict]:
    """Scan all events for a single prediction/burn market.

    Each market lives ~150 blocks (5 min at 2s/block), scan 500 block window.
    """
    to_block = from_block + 500
    raw_logs = get_logs_chunked(w3, market_address, from_block, to_block)
    return decode_logs(raw_logs)


def scan_all_markets(w3: Web3, factory_data: dict) -> list[dict]:
    """Scan events for all markets from a factory."""
    markets = factory_data["markets"]
    results = []

    for i, m in enumerate(markets):
        addr = m.get("marketAddress", "")
        if not addr:
            continue
        block = m.get("blockNumber", factory_data["deploy_block"])
        events = scan_market_events(w3, addr, block)

        # Categorize events
        bets = [e for e in events if e["event"] == "BetPlaced"]
        resolved = [e for e in events if e["event"] == "MarketResolved"]
        claims = [e for e in events if e["event"] == "WinningsClaimed"]
        refunds = [e for e in events if e["event"] == "Refunded"]
        cancelled = [e for e in events if e["event"] == "MarketCancelled"]
        locked = [e for e in events if e["event"] == "MarketLocked"]
        burned = [e for e in events if e["event"] == "TokensBurned"]

        if cancelled:
            state = "CANCELLED"
        elif resolved:
            state = "RESOLVED"
        elif locked:
            state = "LOCKED"
        else:
            state = "OPEN"

        total_pool = sum(b.get("amount", 0) for b in bets)

        result = {
            "address": addr,
            "index": m.get("marketIndex", 0),
            "description": m.get("description", ""),
            "isTokenMode": m.get("isTokenMode", False),
            "blockNumber": block,
            "timestamp": m.get("timestamp", 0),
            "datetime": m.get("datetime", ""),
            "txHash": m.get("txHash", ""),
            "state": state,
            "totalPool": total_pool,
            "totalClaimed": sum(c.get("amount", 0) for c in claims),
            "totalRefunded": sum(r.get("amount", 0) for r in refunds),
            "totalBurned": sum(b.get("amount", 0) for b in burned),
            "winningRangeIndex": resolved[0].get("winningRangeIndex", -1) if resolved else -1,
            "actualCarCount": resolved[0].get("actualCarCount", -1) if resolved else -1,
            "resolveTxHash": resolved[0].get("txHash", "") if resolved else "",
            "resolveTimestamp": resolved[0].get("timestamp", 0) if resolved else 0,
            "resolveDatetime": resolved[0].get("datetime", "") if resolved else "",
            "bettorCount": len(set(b.get("user", "") for b in bets)),
            "bets": bets,
            "claims": claims,
            "refunds": refunds,
            "burned": burned,
            "all_events": events,
        }
        results.append(result)

        if (i + 1) % 25 == 0:
            log.info("  Scanned %d/%d markets...", i + 1, len(markets))

    return results
