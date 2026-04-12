"""ABI event log decoder — turns raw BaseScan log entries into structured dicts."""

from datetime import datetime, timezone

from eth_abi import decode
from web3 import Web3

from config import EVENT_REGISTRY


def _pad_address(topic_hex: str) -> str:
    """Extract address from a 32-byte indexed topic."""
    return Web3.to_checksum_address("0x" + topic_hex[-40:])


def _decode_indexed(input_def: dict, topic_hex: str):
    """Decode a single indexed parameter from its topic."""
    typ = input_def["type"]
    raw = bytes.fromhex(topic_hex[2:] if topic_hex.startswith("0x") else topic_hex)
    if typ == "address":
        return _pad_address(topic_hex)
    elif typ.startswith("uint") or typ.startswith("int"):
        return int.from_bytes(raw, "big")
    elif typ == "bool":
        return bool(int.from_bytes(raw, "big"))
    elif typ.startswith("bytes"):
        return "0x" + raw.hex()
    else:
        # Fallback: return hex
        return "0x" + raw.hex()


def decode_log(raw_log: dict) -> dict | None:
    """Decode a single raw log entry from BaseScan into a structured dict.

    Returns None if the event is not in our registry (e.g. ERC20 Transfer).
    """
    topics = raw_log.get("topics", [])
    if not topics:
        return None

    topic0 = topics[0]
    if topic0 not in EVENT_REGISTRY:
        return None

    info = EVENT_REGISTRY[topic0]
    inputs = info["inputs"]
    indexed_inputs = [i for i in inputs if i.get("indexed")]
    non_indexed_inputs = [i for i in inputs if not i.get("indexed")]

    result = {
        "event": info["name"],
        "contract": info["contract"],
        "signature": info["signature"],
        "txHash": raw_log.get("transactionHash", ""),
        "blockNumber": int(raw_log.get("blockNumber", "0"), 16) if isinstance(raw_log.get("blockNumber"), str) else int(raw_log.get("blockNumber", 0)),
        "logIndex": int(raw_log.get("logIndex", "0"), 16) if isinstance(raw_log.get("logIndex"), str) else int(raw_log.get("logIndex", 0)),
        "address": raw_log.get("address", ""),
    }

    # Parse timestamp
    ts_hex = raw_log.get("timeStamp", "0")
    ts = int(ts_hex, 16) if isinstance(ts_hex, str) and ts_hex.startswith("0x") else int(ts_hex)
    result["timestamp"] = ts
    result["datetime"] = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC") if ts > 0 else ""

    # Decode indexed params from topics[1:]
    for i, inp in enumerate(indexed_inputs):
        if i + 1 < len(topics):
            result[inp["name"]] = _decode_indexed(inp, topics[i + 1])

    # Decode non-indexed params from data
    data_hex = raw_log.get("data", "0x")
    if non_indexed_inputs and data_hex and data_hex != "0x":
        data_bytes = bytes.fromhex(data_hex[2:] if data_hex.startswith("0x") else data_hex)
        types = [i["type"] for i in non_indexed_inputs]
        try:
            values = decode(types, data_bytes)
            for inp, val in zip(non_indexed_inputs, values):
                if inp["type"] == "address":
                    result[inp["name"]] = Web3.to_checksum_address(val)
                elif isinstance(val, bytes):
                    result[inp["name"]] = "0x" + val.hex()
                else:
                    result[inp["name"]] = val
        except Exception as e:
            result["_decode_error"] = str(e)

    return result


def decode_logs(raw_logs: list[dict]) -> list[dict]:
    """Decode a batch of raw logs, filtering out unrecognized events."""
    decoded = []
    for raw in raw_logs:
        d = decode_log(raw)
        if d is not None:
            decoded.append(d)
    return decoded


def wei_to_eth(wei: int) -> float:
    """Convert wei to ETH with full precision."""
    return wei / 1e18


def format_eth(wei: int) -> str:
    """Format wei as ETH string with 6 decimals."""
    return f"{wei / 1e18:.6f}"


def short_addr(addr: str) -> str:
    """Shorten address for display: 0x1234...abcd"""
    if len(addr) < 12:
        return addr
    return f"{addr[:6]}...{addr[-4:]}"


def short_tx(tx_hash: str) -> str:
    """Shorten tx hash for display: 0x1234...abcd"""
    if len(tx_hash) < 12:
        return tx_hash
    return f"{tx_hash[:10]}...{tx_hash[-4:]}"
