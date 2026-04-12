"""Static configuration — addresses, ABI event definitions, API keys."""

import json
from pathlib import Path
from web3 import Web3

# ── Paths ─────────────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent.parent
ABI_DIR = PROJECT_ROOT / "contracts" / "out"

# ── Network ───────────────────────────────────────────────────────────────────
CHAIN_ID = 8453  # Base mainnet
RPC_URL = "https://mainnet.base.org"
BASESCAN_URL = "https://basescan.org"

# ── Known deployment blocks (from Foundry broadcasts + binary search) ─────────
DEPLOY_BLOCKS = {
    "factory_eth": 43983699,
    "tiles_v1": 43984527,
    "tiles_v2": 44377963,
    "factory_burn": 44381099,
}

# ── Contract addresses ────────────────────────────────────────────────────────
TILES_V1 = Web3.to_checksum_address("0x6cE3873e31Ab5440fA6AF1860F8E36110504c9C4")
TILES_V2 = Web3.to_checksum_address("0x5b7b2a6AC4f3A017fb943C9F550d609174532fFF")
FACTORY_ETH = Web3.to_checksum_address("0x5b04F3DFaE780A7e109066E754d27f491Af55Af9")
FACTORY_BURN = Web3.to_checksum_address("0xf3edae04f632bc4cfde9a08e06f36a17bfaee83f")
DEV_WALLET = Web3.to_checksum_address("0xdd12D83786C2BAc7be3D59869834C23E91449A2D")
ORACLE_WALLET = Web3.to_checksum_address("0x4c385830c2E241EfeEd070Eb92606B6AedeDA277")

# ── V2 constants (for P&L reconstruction) ─────────────────────────────────────
V2_NORMAL_PRICE = Web3.to_wei(0.1, "ether")
V2_FOUNDER_PRICE = Web3.to_wei(0.5, "ether")


def _load_events(contract_name: str) -> list[dict]:
    """Load event ABI entries from compiled Foundry artifact."""
    path = ABI_DIR / f"{contract_name}.sol" / f"{contract_name}.json"
    with open(path) as f:
        abi = json.load(f)["abi"]
    return [e for e in abi if e["type"] == "event"]


def _event_topic0(event_abi: dict) -> str:
    """Compute keccak256 topic0 for an event ABI entry."""
    sig = f"{event_abi['name']}({','.join(i['type'] for i in event_abi['inputs'])})"
    return "0x" + Web3.keccak(text=sig).hex()


def _build_event_registry() -> dict[str, dict]:
    """Build topic0 -> event info lookup across all contracts.

    Returns dict keyed by topic0 hex string, value = {
        'name': str, 'inputs': list, 'contract': str, 'signature': str
    }
    For shared signatures (e.g. BetPlaced in both PredictionMarket and BurnMarket),
    we keep the first one since the ABI is identical.
    """
    registry: dict[str, dict] = {}
    contracts = [
        "RushTiles", "RushTilesV2", "PredictionMarket",
        "BurnMarket", "MarketFactory", "BurnMarketFactory",
    ]
    for contract in contracts:
        for ev in _load_events(contract):
            sig = f"{ev['name']}({','.join(i['type'] for i in ev['inputs'])})"
            t0 = _event_topic0(ev)
            if t0 not in registry:
                registry[t0] = {
                    "name": ev["name"],
                    "inputs": ev["inputs"],
                    "contract": contract,
                    "signature": sig,
                }
    return registry


# Pre-built at import time
EVENT_REGISTRY = _build_event_registry()

# Convenience: topic0 for key events
TOPIC_MARKET_CREATED = _event_topic0(
    _load_events("MarketFactory")[
        next(i for i, e in enumerate(_load_events("MarketFactory")) if e["name"] == "MarketCreated")
    ]
)
TOPIC_BET_PLACED = _event_topic0(
    _load_events("PredictionMarket")[
        next(i for i, e in enumerate(_load_events("PredictionMarket")) if e["name"] == "BetPlaced")
    ]
)
