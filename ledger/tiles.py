"""Tiles V1 + V2 event scanning."""

import logging

from web3 import Web3

from config import DEPLOY_BLOCKS, TILES_V1, TILES_V2
from decoders import decode_logs
from fetcher import get_logs_chunked

log = logging.getLogger(__name__)


def scan_tiles(w3: Web3) -> dict:
    """Scan all tile events from both V1 and V2 contracts.

    Returns {
        'v1': {'deploy_block': int, 'events': [decoded_event, ...]},
        'v2': {'deploy_block': int, 'events': [decoded_event, ...]},
    }
    Events are sorted by (blockNumber, logIndex).
    """
    v1_deploy = DEPLOY_BLOCKS["tiles_v1"]
    v2_deploy = DEPLOY_BLOCKS["tiles_v2"]

    log.info("Scanning Tiles V1 events from block %d...", v1_deploy)
    v1_raw = get_logs_chunked(w3, TILES_V1, v1_deploy)
    v1_events = decode_logs(v1_raw)
    v1_events.sort(key=lambda e: (e["blockNumber"], e["logIndex"]))
    log.info("Tiles V1: %d events decoded", len(v1_events))

    log.info("Scanning Tiles V2 events from block %d...", v2_deploy)
    v2_raw = get_logs_chunked(w3, TILES_V2, v2_deploy)
    v2_events = decode_logs(v2_raw)
    v2_events.sort(key=lambda e: (e["blockNumber"], e["logIndex"]))
    log.info("Tiles V2: %d events decoded", len(v2_events))

    return {
        "v1": {
            "address": TILES_V1,
            "deploy_block": v1_deploy,
            "events": v1_events,
        },
        "v2": {
            "address": TILES_V2,
            "deploy_block": v2_deploy,
            "events": v2_events,
        },
    }
