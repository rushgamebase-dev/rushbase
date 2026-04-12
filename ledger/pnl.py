"""P&L computation engine — betting + tiles."""

import logging
from collections import defaultdict

from config import V2_FOUNDER_PRICE, V2_NORMAL_PRICE

log = logging.getLogger(__name__)


def compute_betting_pnl(markets: list[dict]) -> dict:
    """Compute P&L per wallet across all betting markets.

    Returns {
        'eth': {wallet: {'wagered': int, 'won': int, 'refunded': int, 'net': int, 'bets': int, 'wins': int}},
        'burn': {wallet: {...}},
    }
    All amounts in wei (ETH markets) or token wei (RUSH burn markets).
    """
    eth_pnl: dict[str, dict] = defaultdict(lambda: {
        "wagered": 0, "won": 0, "refunded": 0, "net": 0, "bets": 0, "wins": 0, "markets": 0,
    })
    burn_pnl: dict[str, dict] = defaultdict(lambda: {
        "wagered": 0, "won": 0, "refunded": 0, "net": 0, "bets": 0, "wins": 0,
        "burned": 0, "markets": 0,
    })

    for m in markets:
        is_burn = m.get("isTokenMode", False)
        pnl = burn_pnl if is_burn else eth_pnl

        wallets_in_market = set()

        for bet in m.get("bets", []):
            user = bet.get("user", "")
            if not user:
                continue
            pnl[user]["wagered"] += bet.get("amount", 0)
            pnl[user]["bets"] += 1
            wallets_in_market.add(user)

        for claim in m.get("claims", []):
            user = claim.get("user", "")
            if not user:
                continue
            pnl[user]["won"] += claim.get("amount", 0)
            pnl[user]["wins"] += 1

        for refund in m.get("refunds", []):
            user = refund.get("user", "")
            if not user:
                continue
            pnl[user]["refunded"] += refund.get("amount", 0)

        for w in wallets_in_market:
            pnl[w]["markets"] += 1

    # Compute net
    for wallet_pnl in [eth_pnl, burn_pnl]:
        for w, p in wallet_pnl.items():
            p["net"] = p["won"] + p["refunded"] - p["wagered"]

    return {"eth": dict(eth_pnl), "burn": dict(burn_pnl)}


def compute_tiles_pnl(events: list[dict], version: str = "v1") -> dict:
    """Compute P&L per wallet from tile events using deposit state machine.

    Processes events chronologically to track deposit balances per tile.

    Returns {
        wallet: {
            'deposits_in': int,        # ETH sent as deposits (claim + add)
            'deposits_out': int,       # ETH received from withdrawals + abandons
            'claim_fees_paid': int,    # claim fees paid
            'tier_price_paid': int,    # V2 only: tier prices paid
            'buyout_cost': int,        # effectivePrice + fees paid as buyer
            'buyout_revenue': int,     # effectivePrice + deposit returned as seller
            'fees_claimed': int,       # holder fee distributions claimed
            'tax_paid': int,           # implicit: tax deducted from deposit
            'appreciation_tax_paid': int,  # price change appreciation tax
            'net': int,
        }
    }
    """
    is_v2 = version == "v2"

    # State machine: current deposit per tile
    tile_deposit: dict[int, int] = defaultdict(int)
    # Current owner per tile
    tile_owner: dict[int, str] = {}

    wallet_pnl: dict[str, dict] = defaultdict(lambda: {
        "deposits_in": 0,
        "deposits_out": 0,
        "claim_fees_paid": 0,
        "tier_price_paid": 0,
        "buyout_cost": 0,
        "buyout_revenue": 0,
        "fees_claimed": 0,
        "tax_paid": 0,
        "appreciation_tax_paid": 0,
        "net": 0,
    })

    for ev in events:
        name = ev["event"]
        tile_idx = ev.get("tileIndex", -1)

        if name == "TileClaimed":
            owner = ev.get("owner", "")
            deposit = ev.get("deposit", 0)
            price = ev.get("price", 0)

            tile_deposit[tile_idx] = deposit
            tile_owner[tile_idx] = owner

            wallet_pnl[owner]["deposits_in"] += deposit

            if is_v2:
                is_founder = ev.get("isFounder", False)
                tier_price = V2_FOUNDER_PRICE if is_founder else V2_NORMAL_PRICE
                wallet_pnl[owner]["tier_price_paid"] += tier_price

        elif name == "ClaimFeeCollected":
            # V1 only — the fee was part of msg.value on claimTile
            fee = ev.get("fee", 0)
            # We need to attribute this to the claimer. The ClaimFeeCollected
            # happens in the same tx as TileClaimed, so the owner is tile_owner[tile_idx]
            owner = tile_owner.get(tile_idx, "")
            if owner:
                wallet_pnl[owner]["claim_fees_paid"] += fee

        elif name == "DepositAdded":
            amount = ev.get("amount", 0)
            owner = tile_owner.get(tile_idx, "")
            tile_deposit[tile_idx] += amount
            if owner:
                wallet_pnl[owner]["deposits_in"] += amount

        elif name == "DepositWithdrawn":
            amount = ev.get("amount", 0)
            owner = tile_owner.get(tile_idx, "")
            tile_deposit[tile_idx] = max(0, tile_deposit[tile_idx] - amount)
            if owner:
                wallet_pnl[owner]["deposits_out"] += amount

        elif name == "TaxCollected":
            tax_amount = ev.get("taxAmount", 0)
            owner = tile_owner.get(tile_idx, "")
            tile_deposit[tile_idx] = max(0, tile_deposit[tile_idx] - tax_amount)
            if owner:
                wallet_pnl[owner]["tax_paid"] += tax_amount

        elif name == "TileBuyout":
            new_owner = ev.get("newOwner", "")
            prev_owner = ev.get("prevOwner", "")
            effective_price = ev.get("effectivePrice", 0)
            new_price = ev.get("newPrice", 0)
            buyout_fee = ev.get("buyoutFee", 0)
            appreciation_tax = ev.get("appreciationTax", 0)

            # Seller receives: effectivePrice + remaining deposit
            seller_deposit = tile_deposit.get(tile_idx, 0)
            if prev_owner:
                wallet_pnl[prev_owner]["buyout_revenue"] += effective_price + seller_deposit

            # Buyer pays: effectivePrice + buyoutFee + appreciationTax
            # The new deposit is msg.value - (effectivePrice + buyoutFee + appreciationTax)
            # We can't know msg.value from events alone, but the new deposit will be
            # tracked via subsequent DepositAdded or inferred from tile state.
            # For now, track what we know from the event:
            if new_owner:
                wallet_pnl[new_owner]["buyout_cost"] += effective_price + buyout_fee + appreciation_tax

            # Reset tile state for new owner
            # The buyer's deposit = msg.value - cost, which we'll pick up from
            # a TileClaimed or DepositAdded event if emitted, or from the contract.
            # Actually, buyoutTile doesn't emit TileClaimed — the deposit is set internally.
            # We approximate: the contract sets deposit = msg.value - effectivePrice - fees.
            # Since we don't have msg.value, we set deposit to 0 and rely on DepositAdded
            # if any extra deposit was added. The buyer's deposit is NOT separately emitted.
            # For P&L purposes, the "cost" side is tracked via buyout_cost, and the
            # deposit portion will show up when they eventually withdraw/abandon/get bought out.
            tile_deposit[tile_idx] = 0  # will be corrected by subsequent events
            tile_owner[tile_idx] = new_owner

        elif name == "TileAbandoned":
            owner = ev.get("owner", "")
            deposit_returned = ev.get("depositReturned", 0)
            if owner:
                wallet_pnl[owner]["deposits_out"] += deposit_returned
            tile_deposit[tile_idx] = 0
            tile_owner[tile_idx] = ""

        elif name == "TileForeclosed":
            former_owner = ev.get("formerOwner", "")
            # Foreclosure: deposit was already zero (consumed by tax)
            tile_deposit[tile_idx] = 0
            tile_owner[tile_idx] = ""

        elif name == "PriceChanged":
            appreciation_tax = ev.get("appreciationTax", 0)
            owner = tile_owner.get(tile_idx, "")
            if owner and appreciation_tax > 0:
                wallet_pnl[owner]["appreciation_tax_paid"] += appreciation_tax

        elif name == "FeesClaimed":
            player = ev.get("player", "")
            amount = ev.get("amount", 0)
            if player:
                wallet_pnl[player]["fees_claimed"] += amount

    # Compute net P&L for each wallet
    for w, p in wallet_pnl.items():
        p["net"] = (
            p["deposits_out"]
            + p["buyout_revenue"]
            + p["fees_claimed"]
            - p["deposits_in"]
            - p["claim_fees_paid"]
            - p["tier_price_paid"]
            - p["buyout_cost"]
            - p["appreciation_tax_paid"]
            # Note: tax_paid is already reflected in reduced deposits
            # (tax comes from deposit, not additional ETH sent)
        )

    return dict(wallet_pnl)


def aggregate_dev_fees(v1_events: list[dict], v2_events: list[dict]) -> dict:
    """Aggregate all dev fee related events.

    Returns {
        'claims': [{'contract': str, 'amount': int, 'txHash': str, 'datetime': str}],
        'claim_fee_cuts': [...],   # V1 ClaimFeeCollected.devCut
        'tax_cuts': [...],         # TaxCollected.devCut from both
        'total_claimed': int,
        'total_claim_fee_cuts': int,
        'total_tax_cuts': int,
    }
    """
    claims = []
    claim_fee_cuts = []
    tax_cuts = []

    for label, events in [("V1", v1_events), ("V2", v2_events)]:
        for ev in events:
            if ev["event"] == "DevFeesClaimed":
                claims.append({
                    "contract": label,
                    "amount": ev.get("amount", 0),
                    "wallet": ev.get("devWallet", ""),
                    "txHash": ev.get("txHash", ""),
                    "datetime": ev.get("datetime", ""),
                    "timestamp": ev.get("timestamp", 0),
                })
            elif ev["event"] == "ClaimFeeCollected":
                claim_fee_cuts.append({
                    "contract": label,
                    "tileIndex": ev.get("tileIndex", -1),
                    "fee": ev.get("fee", 0),
                    "devCut": ev.get("devCut", 0),
                    "txHash": ev.get("txHash", ""),
                    "datetime": ev.get("datetime", ""),
                    "timestamp": ev.get("timestamp", 0),
                })
            elif ev["event"] == "TaxCollected":
                tax_cuts.append({
                    "contract": label,
                    "tileIndex": ev.get("tileIndex", -1),
                    "taxAmount": ev.get("taxAmount", 0),
                    "devCut": ev.get("devCut", 0),
                    "txHash": ev.get("txHash", ""),
                    "datetime": ev.get("datetime", ""),
                    "timestamp": ev.get("timestamp", 0),
                })

    return {
        "claims": sorted(claims, key=lambda x: x["timestamp"]),
        "claim_fee_cuts": sorted(claim_fee_cuts, key=lambda x: x["timestamp"]),
        "tax_cuts": sorted(tax_cuts, key=lambda x: x["timestamp"]),
        "total_claimed": sum(c["amount"] for c in claims),
        "total_claim_fee_cuts": sum(c["devCut"] for c in claim_fee_cuts),
        "total_tax_cuts": sum(c["devCut"] for c in tax_cuts),
    }


def aggregate_distributions(v1_events: list[dict], v2_events: list[dict]) -> list[dict]:
    """Aggregate all FeesDistributed events."""
    distributions = []
    for label, events in [("V1", v1_events), ("V2", v2_events)]:
        for ev in events:
            if ev["event"] == "FeesDistributed":
                distributions.append({
                    "contract": label,
                    "amount": ev.get("amount", 0),
                    "txHash": ev.get("txHash", ""),
                    "datetime": ev.get("datetime", ""),
                    "timestamp": ev.get("timestamp", 0),
                })
    return sorted(distributions, key=lambda x: x["timestamp"])


def aggregate_foreclosures(v1_events: list[dict], v2_events: list[dict]) -> list[dict]:
    """Aggregate all TileForeclosed events."""
    foreclosures = []
    for label, events in [("V1", v1_events), ("V2", v2_events)]:
        for ev in events:
            if ev["event"] == "TileForeclosed":
                foreclosures.append({
                    "contract": label,
                    "tileIndex": ev.get("tileIndex", -1),
                    "formerOwner": ev.get("formerOwner", ""),
                    "txHash": ev.get("txHash", ""),
                    "datetime": ev.get("datetime", ""),
                    "timestamp": ev.get("timestamp", 0),
                })
    return sorted(foreclosures, key=lambda x: x["timestamp"])
