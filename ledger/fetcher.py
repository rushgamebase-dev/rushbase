"""Rate-limited RPC eth_getLogs fetcher with automatic chunking."""

import logging
import time

from web3 import Web3
from web3.types import LogReceipt

from config import RPC_URL

log = logging.getLogger(__name__)

# Max block range per getLogs call (public Base RPC limits to ~2000)
CHUNK_SIZE = 2000

# Throttle: avoid 429s on public RPC
_last_call = 0.0
MIN_INTERVAL = 0.1  # 10 calls/sec max


def _throttle():
    global _last_call
    now = time.monotonic()
    wait = MIN_INTERVAL - (now - _last_call)
    if wait > 0:
        time.sleep(wait)
    _last_call = time.monotonic()


def make_w3() -> Web3:
    """Create a Web3 instance connected to Base mainnet."""
    w3 = Web3(Web3.HTTPProvider(RPC_URL, request_kwargs={"timeout": 30}))
    if not w3.is_connected():
        raise RuntimeError(f"Cannot connect to RPC: {RPC_URL}")
    return w3


def get_logs_chunked(
    w3: Web3,
    address: str,
    from_block: int,
    to_block: int | None = None,
    topics: list[str] | None = None,
    chunk_size: int = CHUNK_SIZE,
) -> list[dict]:
    """Fetch logs in chunks to respect RPC block-range limits.

    Returns raw log entries as dicts with hex-encoded fields
    (matching BaseScan format for decoder compatibility).
    """
    if to_block is None:
        to_block = w3.eth.block_number

    address = Web3.to_checksum_address(address)
    all_logs: list[dict] = []
    total_chunks = (to_block - from_block) // chunk_size + 1

    for i, start in enumerate(range(from_block, to_block + 1, chunk_size)):
        end = min(start + chunk_size - 1, to_block)
        _throttle()

        filter_params: dict = {
            "address": address,
            "fromBlock": start,
            "toBlock": end,
        }
        if topics:
            filter_params["topics"] = topics

        try:
            raw_logs: list[LogReceipt] = w3.eth.get_logs(filter_params)
        except Exception as e:
            err_msg = str(e)
            if "too large" in err_msg.lower() or "range" in err_msg.lower():
                # Split further
                mid = (start + end) // 2
                left = get_logs_chunked(w3, address, start, mid, topics, chunk_size // 2)
                right = get_logs_chunked(w3, address, mid + 1, end, topics, chunk_size // 2)
                all_logs.extend(left)
                all_logs.extend(right)
                continue
            raise

        # Convert LogReceipt to dict format compatible with our decoder
        for entry in raw_logs:
            all_logs.append(_log_receipt_to_dict(w3, entry))

        if (i + 1) % 50 == 0:
            log.info("    chunk %d/%d (%d logs so far)", i + 1, total_chunks, len(all_logs))

    return all_logs


# Block timestamp cache
_block_ts_cache: dict[int, int] = {}


def get_block_timestamp(w3: Web3, block_number: int) -> int:
    """Get timestamp for a block, cached."""
    if block_number in _block_ts_cache:
        return _block_ts_cache[block_number]
    _throttle()
    block = w3.eth.get_block(block_number)
    ts = block["timestamp"]
    _block_ts_cache[block_number] = ts
    return ts


def _log_receipt_to_dict(w3: Web3, entry: LogReceipt) -> dict:
    """Convert a web3 LogReceipt to a dict matching our decoder's expected format."""
    block_num = entry["blockNumber"]
    ts = get_block_timestamp(w3, block_num)

    return {
        "address": entry["address"],
        "topics": [("0x" + t.hex() if isinstance(t, bytes) else t) for t in entry["topics"]],
        "data": ("0x" + entry["data"].hex() if isinstance(entry["data"], bytes) else entry["data"]),
        "blockNumber": hex(block_num),
        "timeStamp": str(ts),
        "transactionHash": ("0x" + entry["transactionHash"].hex() if isinstance(entry["transactionHash"], bytes) else entry["transactionHash"]),
        "logIndex": hex(entry["logIndex"]),
    }
