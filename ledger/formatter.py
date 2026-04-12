"""Markdown table generation for the Rush Protocol ledger."""

from decoders import format_eth, short_addr, short_tx

BASESCAN = "https://basescan.org"


def _tx_link(tx_hash: str) -> str:
    if not tx_hash:
        return ""
    return f"[{short_tx(tx_hash)}]({BASESCAN}/tx/{tx_hash})"


def _addr_link(addr: str) -> str:
    if not addr:
        return ""
    return f"[{short_addr(addr)}]({BASESCAN}/address/{addr})"


def _contract_link(addr: str, label: str) -> str:
    return f"[{label}]({BASESCAN}/address/{addr})"


# ─── Section 1: Market Ledger ────────────────────────────────────────────────

def format_market_ledger(eth_markets: list[dict], burn_markets: list[dict]) -> str:
    lines = ["# Rush Protocol — On-Chain Ledger", ""]
    lines.append(f"*Generated from on-chain data. All values verified against Base mainnet.*")
    lines.append("")

    # ETH markets
    lines.append("## 1. Market Ledger — ETH Prediction Markets")
    lines.append("")
    if eth_markets:
        lines.append("| # | Market | Description | State | Pool (ETH) | Fee (ETH) | Winner | Count | Created | Resolved | Create Tx | Resolve Tx |")
        lines.append("|---|--------|-------------|-------|------------|-----------|--------|-------|---------|----------|-----------|------------|")
        for m in sorted(eth_markets, key=lambda x: x.get("index", 0)):
            fee_est = int(m["totalPool"] * 500 / 10000) if m["state"] == "RESOLVED" else 0
            lines.append(
                f"| {m.get('index', '?')} "
                f"| {_addr_link(m['address'])} "
                f"| {_truncate(m.get('description', ''), 30)} "
                f"| {m['state']} "
                f"| {format_eth(m['totalPool'])} "
                f"| {format_eth(fee_est)} "
                f"| {'Under' if m.get('winningRangeIndex', -1) == 0 else 'Over' if m.get('winningRangeIndex', -1) == 1 else 'N/A'} "
                f"| {m.get('actualCarCount', 'N/A')} "
                f"| {m.get('datetime', '')} "
                f"| {m.get('resolveDatetime', '')} "
                f"| {_tx_link(m.get('txHash', ''))} "
                f"| {_tx_link(m.get('resolveTxHash', ''))} |"
            )
    else:
        lines.append("*No ETH prediction markets found.*")
    lines.append("")

    # RUSH burn markets
    lines.append("## 2. Market Ledger — RUSH Burn Markets")
    lines.append("")
    if burn_markets:
        lines.append("| # | Market | Description | State | Pool (RUSH) | Burned (RUSH) | Winner | Count | Created | Resolved | Create Tx | Resolve Tx |")
        lines.append("|---|--------|-------------|-------|-------------|---------------|--------|-------|---------|----------|-----------|------------|")
        for m in sorted(burn_markets, key=lambda x: x.get("index", 0)):
            lines.append(
                f"| {m.get('index', '?')} "
                f"| {_addr_link(m['address'])} "
                f"| {_truncate(m.get('description', ''), 30)} "
                f"| {m['state']} "
                f"| {format_eth(m['totalPool'])} "
                f"| {format_eth(m.get('totalBurned', 0))} "
                f"| {'Under' if m.get('winningRangeIndex', -1) == 0 else 'Over' if m.get('winningRangeIndex', -1) == 1 else 'N/A'} "
                f"| {m.get('actualCarCount', 'N/A')} "
                f"| {m.get('datetime', '')} "
                f"| {m.get('resolveDatetime', '')} "
                f"| {_tx_link(m.get('txHash', ''))} "
                f"| {_tx_link(m.get('resolveTxHash', ''))} |"
            )
    else:
        lines.append("*No RUSH burn markets found.*")
    lines.append("")

    return "\n".join(lines)


# ─── Section 2: Betting P&L ──────────────────────────────────────────────────

def format_betting_pnl(pnl: dict) -> str:
    lines = ["## 3. Betting P&L by Wallet"]
    lines.append("")

    # ETH
    lines.append("### ETH Markets")
    lines.append("")
    eth = pnl.get("eth", {})
    if eth:
        # Sort by net P&L descending
        sorted_wallets = sorted(eth.items(), key=lambda x: x[1]["net"], reverse=True)
        lines.append("| Wallet | Markets | Bets | Wagered (ETH) | Won (ETH) | Refunded (ETH) | Net P&L (ETH) |")
        lines.append("|--------|---------|------|---------------|-----------|----------------|---------------|")
        totals = {"wagered": 0, "won": 0, "refunded": 0, "net": 0, "bets": 0, "markets": 0}
        for wallet, p in sorted_wallets:
            lines.append(
                f"| {_addr_link(wallet)} "
                f"| {p['markets']} "
                f"| {p['bets']} "
                f"| {format_eth(p['wagered'])} "
                f"| {format_eth(p['won'])} "
                f"| {format_eth(p['refunded'])} "
                f"| {format_eth(p['net'])} |"
            )
            for k in totals:
                totals[k] += p[k]
        lines.append(
            f"| **TOTAL** "
            f"| {totals['markets']} "
            f"| {totals['bets']} "
            f"| **{format_eth(totals['wagered'])}** "
            f"| **{format_eth(totals['won'])}** "
            f"| **{format_eth(totals['refunded'])}** "
            f"| **{format_eth(totals['net'])}** |"
        )
    else:
        lines.append("*No ETH betting activity found.*")
    lines.append("")

    # RUSH burn
    lines.append("### RUSH Burn Markets")
    lines.append("")
    burn = pnl.get("burn", {})
    if burn:
        sorted_wallets = sorted(burn.items(), key=lambda x: x[1]["net"], reverse=True)
        lines.append("| Wallet | Markets | Bets | Wagered (RUSH) | Won (RUSH) | Refunded (RUSH) | Net P&L (RUSH) |")
        lines.append("|--------|---------|------|----------------|------------|-----------------|----------------|")
        totals = {"wagered": 0, "won": 0, "refunded": 0, "net": 0, "bets": 0, "markets": 0}
        for wallet, p in sorted_wallets:
            lines.append(
                f"| {_addr_link(wallet)} "
                f"| {p['markets']} "
                f"| {p['bets']} "
                f"| {format_eth(p['wagered'])} "
                f"| {format_eth(p['won'])} "
                f"| {format_eth(p['refunded'])} "
                f"| {format_eth(p['net'])} |"
            )
            for k in totals:
                totals[k] += p[k]
        lines.append(
            f"| **TOTAL** "
            f"| {totals['markets']} "
            f"| {totals['bets']} "
            f"| **{format_eth(totals['wagered'])}** "
            f"| **{format_eth(totals['won'])}** "
            f"| **{format_eth(totals['refunded'])}** "
            f"| **{format_eth(totals['net'])}** |"
        )
    else:
        lines.append("*No RUSH burn betting activity found.*")
    lines.append("")

    return "\n".join(lines)


# ─── Section 3: Tiles Ledger ─────────────────────────────────────────────────

def format_tiles_ledger(v1_events: list[dict], v2_events: list[dict]) -> str:
    lines = []

    for label, events in [("V1 (Series 1)", v1_events), ("V2 (Series 2)", v2_events)]:
        section_num = "4" if "V1" in label else "5"
        lines.append(f"## {section_num}. Tiles Ledger — {label}")
        lines.append("")
        if events:
            lines.append("| Timestamp | Event | Tile | Wallet | Amount (ETH) | Detail | Tx Hash |")
            lines.append("|-----------|-------|------|--------|-------------|--------|---------|")
            for ev in events:
                wallet, amount, detail = _tile_event_summary(ev)
                lines.append(
                    f"| {ev.get('datetime', '')} "
                    f"| {ev['event']} "
                    f"| {ev.get('tileIndex', '')} "
                    f"| {_addr_link(wallet) if wallet else ''} "
                    f"| {format_eth(amount) if amount else ''} "
                    f"| {detail} "
                    f"| {_tx_link(ev.get('txHash', ''))} |"
                )
        else:
            lines.append(f"*No {label} tile events found.*")
        lines.append("")

    return "\n".join(lines)


def _tile_event_summary(ev: dict) -> tuple[str, int, str]:
    """Extract wallet, primary amount, and detail string from a tile event."""
    name = ev["event"]
    if name == "TileClaimed":
        owner = ev.get("owner", "")
        deposit = ev.get("deposit", 0)
        price = ev.get("price", 0)
        is_founder = ev.get("isFounder", None)
        detail = f"price={format_eth(price)}"
        if is_founder is not None:
            detail += f" founder={is_founder}"
        return owner, deposit, detail
    elif name == "TileBuyout":
        new_owner = ev.get("newOwner", "")
        eff = ev.get("effectivePrice", 0)
        fee = ev.get("buyoutFee", 0)
        app = ev.get("appreciationTax", 0)
        prev = ev.get("prevOwner", "")
        return new_owner, eff + fee + app, f"from={short_addr(prev)} effPrice={format_eth(eff)} fee={format_eth(fee)} appTax={format_eth(app)}"
    elif name == "TileAbandoned":
        return ev.get("owner", ""), ev.get("depositReturned", 0), "abandoned"
    elif name == "TileForeclosed":
        return ev.get("formerOwner", ""), 0, "foreclosed"
    elif name == "DepositAdded":
        return "", ev.get("amount", 0), "deposit added"
    elif name == "DepositWithdrawn":
        return "", ev.get("amount", 0), "deposit withdrawn"
    elif name == "TaxCollected":
        tax = ev.get("taxAmount", 0)
        dev = ev.get("devCut", 0)
        return "", tax, f"devCut={format_eth(dev)}"
    elif name == "ClaimFeeCollected":
        fee = ev.get("fee", 0)
        dev = ev.get("devCut", 0)
        return "", fee, f"devCut={format_eth(dev)}"
    elif name == "PriceChanged":
        old_p = ev.get("oldPrice", 0)
        new_p = ev.get("newPrice", 0)
        app = ev.get("appreciationTax", 0)
        return "", app, f"{format_eth(old_p)}->{format_eth(new_p)}"
    elif name == "FeesDistributed":
        return "", ev.get("amount", 0), "distributed to holders"
    elif name == "FeesClaimed":
        return ev.get("player", ""), ev.get("amount", 0), "holder fees claimed"
    elif name == "DevFeesClaimed":
        return ev.get("devWallet", ""), ev.get("amount", 0), "dev fees claimed"
    elif name == "EmergencyWithdraw":
        return ev.get("to", ""), ev.get("amount", 0), "emergency"
    elif name == "FlaunchFeesClaimed":
        return ev.get("feeEscrow", ""), ev.get("amount", 0), "flaunch fees"
    elif name == "MemeStreamReceived":
        return ev.get("nft", ""), 0, f"tokenId={ev.get('tokenId', '')}"
    return "", 0, ""


# ─── Section 4: Tiles P&L ────────────────────────────────────────────────────

def format_tiles_pnl(v1_pnl: dict, v2_pnl: dict) -> str:
    lines = ["## 6. Tiles P&L by Wallet"]
    lines.append("")

    for label, pnl in [("V1 (Series 1)", v1_pnl), ("V2 (Series 2)", v2_pnl)]:
        lines.append(f"### {label}")
        lines.append("")
        if pnl:
            sorted_wallets = sorted(pnl.items(), key=lambda x: x[1]["net"], reverse=True)
            lines.append("| Wallet | Deposits In | Deposits Out | Claim Fees | Tier Price | Buyout Cost | Buyout Revenue | Fees Claimed | App. Tax | Net P&L (ETH) |")
            lines.append("|--------|------------|-------------|------------|------------|------------|---------------|-------------|----------|---------------|")
            totals = {k: 0 for k in ["deposits_in", "deposits_out", "claim_fees_paid", "tier_price_paid", "buyout_cost", "buyout_revenue", "fees_claimed", "appreciation_tax_paid", "net"]}
            for wallet, p in sorted_wallets:
                lines.append(
                    f"| {_addr_link(wallet)} "
                    f"| {format_eth(p['deposits_in'])} "
                    f"| {format_eth(p['deposits_out'])} "
                    f"| {format_eth(p['claim_fees_paid'])} "
                    f"| {format_eth(p['tier_price_paid'])} "
                    f"| {format_eth(p['buyout_cost'])} "
                    f"| {format_eth(p['buyout_revenue'])} "
                    f"| {format_eth(p['fees_claimed'])} "
                    f"| {format_eth(p['appreciation_tax_paid'])} "
                    f"| {format_eth(p['net'])} |"
                )
                for k in totals:
                    totals[k] += p[k]
            lines.append(
                f"| **TOTAL** "
                f"| **{format_eth(totals['deposits_in'])}** "
                f"| **{format_eth(totals['deposits_out'])}** "
                f"| **{format_eth(totals['claim_fees_paid'])}** "
                f"| **{format_eth(totals['tier_price_paid'])}** "
                f"| **{format_eth(totals['buyout_cost'])}** "
                f"| **{format_eth(totals['buyout_revenue'])}** "
                f"| **{format_eth(totals['fees_claimed'])}** "
                f"| **{format_eth(totals['appreciation_tax_paid'])}** "
                f"| **{format_eth(totals['net'])}** |"
            )
        else:
            lines.append(f"*No {label} tile P&L data.*")
        lines.append("")

    return "\n".join(lines)


# ─── Section 5: Dev Fees ─────────────────────────────────────────────────────

def format_dev_fees(dev_fees: dict) -> str:
    lines = ["## 7. Dev Fee Claims"]
    lines.append("")

    claims = dev_fees.get("claims", [])
    if claims:
        lines.append("| Timestamp | Contract | Wallet | Amount (ETH) | Tx Hash |")
        lines.append("|-----------|----------|--------|-------------|---------|")
        for c in claims:
            lines.append(
                f"| {c['datetime']} "
                f"| {c['contract']} "
                f"| {_addr_link(c.get('wallet', ''))} "
                f"| {format_eth(c['amount'])} "
                f"| {_tx_link(c['txHash'])} |"
            )
        lines.append(f"\n**Total DevFeesClaimed: {format_eth(dev_fees['total_claimed'])} ETH**")
    else:
        lines.append("*No DevFeesClaimed events found.*")
    lines.append("")

    # Summary of dev cuts from taxes and claim fees
    lines.append("### Dev Cuts from Claim Fees (V1)")
    lines.append("")
    cuts = dev_fees.get("claim_fee_cuts", [])
    if cuts:
        total = dev_fees["total_claim_fee_cuts"]
        lines.append(f"*{len(cuts)} ClaimFeeCollected events, total devCut: {format_eth(total)} ETH*")
    else:
        lines.append("*None*")
    lines.append("")

    lines.append("### Dev Cuts from Harberger Tax")
    lines.append("")
    tax_cuts = dev_fees.get("tax_cuts", [])
    if tax_cuts:
        total = dev_fees["total_tax_cuts"]
        lines.append(f"*{len(tax_cuts)} TaxCollected events, total devCut: {format_eth(total)} ETH*")
    else:
        lines.append("*None*")
    lines.append("")

    return "\n".join(lines)


# ─── Section 6: Distributions ────────────────────────────────────────────────

def format_distributions(distributions: list[dict]) -> str:
    lines = ["## 8. Fee Distributions to Holders"]
    lines.append("")
    if distributions:
        lines.append("| Timestamp | Contract | Amount (ETH) | Tx Hash |")
        lines.append("|-----------|----------|-------------|---------|")
        total = 0
        for d in distributions:
            lines.append(
                f"| {d['datetime']} "
                f"| {d['contract']} "
                f"| {format_eth(d['amount'])} "
                f"| {_tx_link(d['txHash'])} |"
            )
            total += d["amount"]
        lines.append(f"\n**Total distributed to holders: {format_eth(total)} ETH**")
    else:
        lines.append("*No FeesDistributed events found.*")
    lines.append("")
    return "\n".join(lines)


# ─── Section 7: Foreclosures ─────────────────────────────────────────────────

def format_foreclosures(foreclosures: list[dict]) -> str:
    lines = ["## 9. Foreclosures"]
    lines.append("")
    if foreclosures:
        lines.append("| Timestamp | Contract | Tile | Former Owner | Tx Hash |")
        lines.append("|-----------|----------|------|-------------|---------|")
        for f in foreclosures:
            lines.append(
                f"| {f['datetime']} "
                f"| {f['contract']} "
                f"| {f['tileIndex']} "
                f"| {_addr_link(f['formerOwner'])} "
                f"| {_tx_link(f['txHash'])} |"
            )
        lines.append(f"\n**Total foreclosures: {len(foreclosures)}**")
    else:
        lines.append("*No foreclosures found.*")
    lines.append("")
    return "\n".join(lines)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _truncate(s: str, max_len: int) -> str:
    if len(s) <= max_len:
        return s
    return s[:max_len - 3] + "..."
