#!/usr/bin/env python3
"""Process rush_ledger.json into web-optimized transparency data.

Outputs a single JSON file (~200KB) that the /transparency page loads.
"""

import json
import sys
from pathlib import Path


def main():
    input_path = Path(__file__).resolve().parent / "output" / "rush_ledger.json"
    output_dir = Path(__file__).resolve().parent.parent / "frontend" / "public" / "transparency"
    output_dir.mkdir(parents=True, exist_ok=True)

    with open(input_path) as f:
        data = json.load(f)

    def to_int(v):
        return int(v) if isinstance(v, str) else v

    # ── Summary metrics ───────────────────────────────────────────────────
    summary = data["summary"]
    eth_pnl = data["betting_pnl"]["eth"]
    burn_pnl = data["betting_pnl"]["burn"]

    total_eth_wagered = sum(to_int(p["wagered"]) for p in eth_pnl.values())
    total_eth_won = sum(to_int(p["won"]) for p in eth_pnl.values())
    total_eth_refunded = sum(to_int(p["refunded"]) for p in eth_pnl.values())
    total_burn_wagered = sum(to_int(p["wagered"]) for p in burn_pnl.values())

    dev_total = to_int(data["dev_fees"]["total_claimed_wei"])
    dist_total = sum(to_int(d["amount"]) for d in data["distributions"])

    metrics = {
        "extractedAt": data["extracted_at"],
        "latestBlock": data["latest_block"],
        "ethMarketsCreated": summary["total_eth_markets"],
        "burnMarketsCreated": summary["total_burn_markets"],
        "totalEthVolumeWei": str(total_eth_wagered),
        "totalBurnVolumeWei": str(total_burn_wagered),
        "totalEthWonWei": str(total_eth_won),
        "totalEthRefundedWei": str(total_eth_refunded),
        "uniqueEthBettors": len(eth_pnl),
        "uniqueBurnBettors": len(burn_pnl),
        "tilesV1Events": summary["total_v1_events"],
        "tilesV2Events": summary["total_v2_events"],
        "devFeesClaimedWei": str(dev_total),
        "totalDistributedWei": str(dist_total),
        "totalForeclosures": len(data["foreclosures"]),
        "contracts": data["contracts"],
    }

    # ── Market history (compact) ──────────────────────────────────────────
    def compact_market(m):
        return {
            "i": m.get("index", 0),
            "a": m.get("address", ""),
            "d": m.get("description", "")[:60],
            "s": m.get("state", ""),
            "p": m.get("totalPool_wei", "0"),
            "w": m.get("winningRangeIndex", -1),
            "c": m.get("actualCarCount", -1),
            "t1": m.get("datetime", ""),
            "t2": m.get("resolveDatetime", ""),
            "tx1": m.get("txHash", ""),
            "tx2": m.get("resolveTxHash", ""),
            "n": len(m.get("bets", [])),
        }

    eth_markets = [compact_market(m) for m in data["eth_markets"]]
    burn_markets = [compact_market(m) for m in data["burn_markets"]]

    # ── Betting P&L ───────────────────────────────────────────────────────
    def compact_betting(pnl_data):
        rows = []
        for wallet, p in sorted(pnl_data.items(), key=lambda x: to_int(x[1]["net"]), reverse=True):
            rows.append({
                "w": wallet,
                "m": to_int(p["markets"]),
                "b": to_int(p["bets"]),
                "wi": to_int(p.get("wins", 0)),
                "wa": str(to_int(p["wagered"])),
                "wo": str(to_int(p["won"])),
                "r": str(to_int(p["refunded"])),
                "n": str(to_int(p["net"])),
            })
        return rows

    eth_betting = compact_betting(eth_pnl)
    burn_betting = compact_betting(burn_pnl)

    # ── Tiles P&L ─────────────────────────────────────────────────────────
    def compact_tiles_pnl(pnl_data):
        rows = []
        for wallet, p in sorted(pnl_data.items(), key=lambda x: x[1]["net"], reverse=True):
            rows.append({
                "w": wallet,
                "di": str(p["deposits_in"]),
                "do": str(p["deposits_out"]),
                "cf": str(p["claim_fees_paid"]),
                "tp": str(p["tier_price_paid"]),
                "bc": str(p["buyout_cost"]),
                "br": str(p["buyout_revenue"]),
                "fc": str(p["fees_claimed"]),
                "at": str(p["appreciation_tax_paid"]),
                "n": str(p["net"]),
            })
        return rows

    v1_pnl = compact_tiles_pnl(data["tiles_v1_pnl"])
    v2_pnl = compact_tiles_pnl(data["tiles_v2_pnl"])

    # ── Dev fees (V1 only — V2 not active yet) ──────────────────────────
    dev_claims = [{
        "t": c["datetime"],
        "c": c["contract"],
        "a": str(to_int(c["amount"])),
        "tx": c["txHash"],
    } for c in data["dev_fees"]["claims"] if c["contract"] == "V1"]

    dev_total_v1 = sum(to_int(c["amount"]) for c in data["dev_fees"]["claims"] if c["contract"] == "V1")

    # ── Housebot stats ────────────────────────────────────────────────────
    housebot_addr = "0x2d882a197c15B8b3b544b8B131AE229B52643A73"
    hb_eth = eth_pnl.get(housebot_addr, {})
    hb_burn = burn_pnl.get(housebot_addr, {})
    housebot = {
        "address": housebot_addr,
        "ethWagered": str(to_int(hb_eth.get("wagered", 0))),
        "ethWon": str(to_int(hb_eth.get("won", 0))),
        "ethRefunded": str(to_int(hb_eth.get("refunded", 0))),
        "ethNet": str(to_int(hb_eth.get("net", 0))),
        "ethBets": to_int(hb_eth.get("bets", 0)),
        "ethMarkets": to_int(hb_eth.get("markets", 0)),
        "burnWagered": str(to_int(hb_burn.get("wagered", 0))),
        "burnBets": to_int(hb_burn.get("bets", 0)),
        "burnMarkets": to_int(hb_burn.get("markets", 0)),
    }

    # ── Distributions ─────────────────────────────────────────────────────
    distributions = [{
        "t": d["datetime"],
        "c": d["contract"],
        "a": str(to_int(d["amount"])),
        "tx": d["txHash"],
    } for d in data["distributions"]]

    # ── Foreclosures ──────────────────────────────────────────────────────
    foreclosures = [{
        "t": f["datetime"],
        "c": f["contract"],
        "ti": f["tileIndex"],
        "o": f["formerOwner"],
        "tx": f["txHash"],
    } for f in data["foreclosures"]]

    # ── Assemble ──────────────────────────────────────────────────────────
    metrics["devFeesClaimedWei"] = str(dev_total_v1)  # override with V1-only

    web_data = {
        "metrics": metrics,
        "housebot": housebot,
        "ethMarkets": eth_markets,
        "burnMarkets": burn_markets,
        "ethBetting": eth_betting,
        "burnBetting": burn_betting,
        "tilesV1Pnl": v1_pnl,
        "tilesV2Pnl": v2_pnl,
        "devClaims": dev_claims,
        "distributions": distributions,
        "foreclosures": foreclosures,
    }

    out_path = output_dir / "data.json"
    out_path.write_text(json.dumps(web_data, separators=(",", ":")), encoding="utf-8")
    size_kb = out_path.stat().st_size / 1024
    print(f"Written {out_path} ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
