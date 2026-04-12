#!/usr/bin/env python3
"""Rush Protocol — Complete On-Chain Ledger Extraction.

Scans all events from RushTiles V1, V2, MarketFactory (ETH), and
BurnMarketFactory on Base mainnet. Computes P&L per wallet, documents
dev fees, distributions, and foreclosures.

Usage:
    python3 extract.py [--output-dir ./output] [--json]
"""

import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

# Add ledger dir to path for imports
sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import (
    FACTORY_BURN, FACTORY_ETH, TILES_V1, TILES_V2,
    DEV_WALLET, ORACLE_WALLET,
)
from decoders import format_eth
from fetcher import make_w3
from formatter import (
    format_market_ledger, format_betting_pnl, format_tiles_ledger,
    format_tiles_pnl, format_dev_fees, format_distributions, format_foreclosures,
)
from markets import discover_markets, scan_all_markets
from pnl import (
    compute_betting_pnl, compute_tiles_pnl,
    aggregate_dev_fees, aggregate_distributions, aggregate_foreclosures,
)
from tiles import scan_tiles

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)


def main(output_dir: Path, emit_json: bool):
    start = datetime.now(tz=timezone.utc)
    log.info("=== Rush Protocol Ledger Extraction ===")
    log.info("Started at %s", start.strftime("%Y-%m-%d %H:%M:%S UTC"))

    w3 = make_w3()
    latest_block = w3.eth.block_number
    log.info("Connected to Base mainnet, latest block: %d", latest_block)

    # ── Phase 1: Discover markets ──────────────────────────────────────
    log.info("Phase 1: Discovering markets from factories...")
    factory_data = discover_markets(w3)

    # ── Phase 2: Scan market events ────────────────────────────────────
    log.info("Phase 2: Scanning ETH market events...")
    eth_markets = scan_all_markets(w3, factory_data["eth_factory"])
    log.info("  ETH markets scanned: %d", len(eth_markets))

    log.info("Phase 2b: Scanning BURN market events...")
    burn_markets = scan_all_markets(w3, factory_data["burn_factory"])
    log.info("  BURN markets scanned: %d", len(burn_markets))

    all_markets = eth_markets + burn_markets

    # ── Phase 3: Scan tile events ──────────────────────────────────────
    log.info("Phase 3: Scanning tile events...")
    tiles_data = scan_tiles(w3)

    v1_events = tiles_data["v1"]["events"]
    v2_events = tiles_data["v2"]["events"]

    # ── Phase 4: Compute P&L ──────────────────────────────────────────
    log.info("Phase 4: Computing P&L...")
    betting_pnl = compute_betting_pnl(all_markets)
    tiles_v1_pnl = compute_tiles_pnl(v1_events, "v1")
    tiles_v2_pnl = compute_tiles_pnl(v2_events, "v2")

    # ── Phase 5: Aggregate dev fees / distributions / foreclosures ────
    log.info("Phase 5: Aggregating dev fees, distributions, foreclosures...")
    dev_fees = aggregate_dev_fees(v1_events, v2_events)
    distributions = aggregate_distributions(v1_events, v2_events)
    foreclosures = aggregate_foreclosures(v1_events, v2_events)

    # ── Phase 6: Generate output ──────────────────────────────────────
    log.info("Phase 6: Generating markdown output...")
    output_dir.mkdir(parents=True, exist_ok=True)

    md_parts = [
        format_market_ledger(eth_markets, burn_markets),
        format_betting_pnl(betting_pnl),
        format_tiles_ledger(v1_events, v2_events),
        format_tiles_pnl(tiles_v1_pnl, tiles_v2_pnl),
        format_dev_fees(dev_fees),
        format_distributions(distributions),
        format_foreclosures(foreclosures),
        _format_summary(eth_markets, burn_markets, v1_events, v2_events,
                        betting_pnl, dev_fees, distributions, foreclosures),
    ]

    md_content = "\n\n---\n\n".join(md_parts)
    md_content += f"\n\n---\n\n*Extracted {datetime.now(tz=timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')} | Block {latest_block}*\n"

    md_path = output_dir / "rush_ledger.md"
    md_path.write_text(md_content, encoding="utf-8")
    log.info("Markdown written to %s (%d bytes)", md_path, len(md_content))

    if emit_json:
        json_data = {
            "extracted_at": datetime.now(tz=timezone.utc).isoformat(),
            "latest_block": latest_block,
            "contracts": {
                "tiles_v1": TILES_V1,
                "tiles_v2": TILES_V2,
                "factory_eth": FACTORY_ETH,
                "factory_burn": FACTORY_BURN,
                "dev_wallet": DEV_WALLET,
                "oracle_wallet": ORACLE_WALLET,
            },
            "eth_markets": _serialize_markets(eth_markets),
            "burn_markets": _serialize_markets(burn_markets),
            "betting_pnl": _serialize_pnl(betting_pnl),
            "tiles_v1_pnl": {k: v for k, v in tiles_v1_pnl.items()},
            "tiles_v2_pnl": {k: v for k, v in tiles_v2_pnl.items()},
            "dev_fees": {
                "total_claimed_wei": dev_fees["total_claimed"],
                "total_claim_fee_cuts_wei": dev_fees["total_claim_fee_cuts"],
                "total_tax_cuts_wei": dev_fees["total_tax_cuts"],
                "claims": dev_fees["claims"],
            },
            "distributions": distributions,
            "foreclosures": foreclosures,
            "summary": {
                "total_eth_markets": len(eth_markets),
                "total_burn_markets": len(burn_markets),
                "total_v1_events": len(v1_events),
                "total_v2_events": len(v2_events),
            },
        }
        json_path = output_dir / "rush_ledger.json"
        json_path.write_text(json.dumps(json_data, indent=2, default=str), encoding="utf-8")
        log.info("JSON written to %s", json_path)

    elapsed = (datetime.now(tz=timezone.utc) - start).total_seconds()
    log.info("=== Done in %.1fs ===", elapsed)


def _format_summary(
    eth_markets, burn_markets, v1_events, v2_events,
    betting_pnl, dev_fees, distributions, foreclosures,
) -> str:
    lines = ["## 10. Summary"]
    lines.append("")

    total_eth_volume = sum(m["totalPool"] for m in eth_markets)
    total_burn_volume = sum(m["totalPool"] for m in burn_markets)
    total_eth_bettors = len(betting_pnl.get("eth", {}))
    total_burn_bettors = len(betting_pnl.get("burn", {}))

    lines.append("| Metric | Value |")
    lines.append("|--------|-------|")
    lines.append(f"| ETH Markets Created | {len(eth_markets)} |")
    lines.append(f"| RUSH Burn Markets Created | {len(burn_markets)} |")
    lines.append(f"| Total ETH Volume | {format_eth(total_eth_volume)} ETH |")
    lines.append(f"| Total RUSH Volume | {format_eth(total_burn_volume)} RUSH |")
    lines.append(f"| Unique ETH Bettors | {total_eth_bettors} |")
    lines.append(f"| Unique RUSH Bettors | {total_burn_bettors} |")
    lines.append(f"| Tiles V1 Events | {len(v1_events)} |")
    lines.append(f"| Tiles V2 Events | {len(v2_events)} |")
    lines.append(f"| Dev Fees Claimed | {format_eth(dev_fees['total_claimed'])} ETH |")
    lines.append(f"| Total Distributions | {format_eth(sum(d['amount'] for d in distributions))} ETH |")
    lines.append(f"| Total Foreclosures | {len(foreclosures)} |")

    return "\n".join(lines)


def _serialize_markets(markets: list[dict]) -> list[dict]:
    result = []
    for m in markets:
        entry = {k: v for k, v in m.items() if k not in ("bets", "claims", "refunds", "burned", "all_events")}
        entry["totalPool_wei"] = str(m["totalPool"])
        entry["bets"] = [
            {"user": b["user"], "rangeIndex": b.get("rangeIndex", 0),
             "amount_wei": str(b.get("amount", 0)), "txHash": b.get("txHash", "")}
            for b in m.get("bets", [])
        ]
        entry["claims"] = [
            {"user": c["user"], "amount_wei": str(c.get("amount", 0)), "txHash": c.get("txHash", "")}
            for c in m.get("claims", [])
        ]
        entry["refunds"] = [
            {"user": r["user"], "amount_wei": str(r.get("amount", 0)), "txHash": r.get("txHash", "")}
            for r in m.get("refunds", [])
        ]
        result.append(entry)
    return result


def _serialize_pnl(pnl: dict) -> dict:
    result = {}
    for market_type, wallets in pnl.items():
        result[market_type] = {}
        for wallet, data in wallets.items():
            result[market_type][wallet] = {
                k: str(v) if isinstance(v, int) and abs(v) > 2**53 else v
                for k, v in data.items()
            }
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Rush Protocol On-Chain Ledger Extraction")
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parent / "output",
                        help="Output directory (default: ./output)")
    parser.add_argument("--json", action="store_true", help="Also emit JSON output")
    args = parser.parse_args()

    main(args.output_dir, args.json)
