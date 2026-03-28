"""
SinalBet Oracle — Cryptographic Signer
Generates commit hashes and signs attestation data for on-chain verification.

Implements a commit-reveal scheme compatible with the on-chain DataAttestation
contract. The commit hash is keccak256(abi.encodePacked(count, salt)), which
matches the Solidity expression used for verification in the reveal phase.

Usage:
    from signer import OracleSigner

    signer = OracleSigner(private_key="0x...")
    attestation = signer.prepare_attestation(
        count=42,
        stream_url="https://youtube.com/watch?v=xxx",
        frame_hashes=[...],
        start_timestamp=1700000000,
        end_timestamp=1700000300,
        model_version="yolov8x.pt",
    )

Requirements:
    pip install web3 eth-abi eth-account
"""

import os
import hashlib

try:
    from eth_account import Account
    from eth_abi import encode
    from web3 import Web3
except ImportError:
    print("ERROR: Missing crypto dependencies. Run: pip install web3 eth-abi eth-account")
    raise


class OracleSigner:
    def __init__(self, private_key: str):
        """
        Initialize with the oracle's private key.

        Args:
            private_key: Hex string with 0x prefix, e.g. "0xdeadbeef..."
        """
        self.account = Account.from_key(private_key)
        self.address = self.account.address
        print(f"[OracleSigner] Initialized for address {self.address}")

    # ------------------------------------------------------------------
    # Primitive helpers
    # ------------------------------------------------------------------

    def generate_salt(self) -> bytes:
        """
        Generate a random 32-byte salt for the commit phase.

        Returns:
            32 bytes of cryptographically secure random data.
        """
        return os.urandom(32)

    def compute_commit_hash(self, count: int, salt: bytes) -> bytes:
        """
        Compute keccak256(abi.encodePacked(uint256 count, bytes32 salt)).

        This replicates the Solidity expression used by DataAttestation so the
        on-chain verification passes without any encoding discrepancy.

        Args:
            count: The vehicle count for this round.
            salt:  The 32-byte random salt generated for the commit phase.

        Returns:
            32-byte keccak256 digest.
        """
        # eth_abi.encode uses standard ABI encoding (padded), which matches
        # abi.encode in Solidity. For abi.encodePacked the values are
        # right/left-padded identically for uint256 and bytes32, so the
        # standard ABI encoding is correct here.
        encoded = encode(["uint256", "bytes32"], [count, salt])
        return bytes(Web3.keccak(encoded))

    def compute_stream_url_hash(self, stream_url: str) -> bytes:
        """
        Compute keccak256 of the UTF-8 encoded stream URL.

        Args:
            stream_url: The video stream URL string.

        Returns:
            32-byte keccak256 digest.
        """
        return bytes(Web3.keccak(text=stream_url))

    def hash_frame(self, frame_bytes: bytes) -> bytes:
        """
        Compute the SHA-256 hash of a single raw video frame.

        Args:
            frame_bytes: Raw frame data (e.g. BGR bytes from OpenCV).

        Returns:
            32-byte SHA-256 digest.
        """
        return hashlib.sha256(frame_bytes).digest()

    def compute_frame_hash(self, frame_hashes: list[bytes]) -> bytes:
        """
        Compute a single aggregate frame hash from a list of per-frame hashes.

        The aggregate is SHA-256 of the concatenation of all individual frame
        hashes (each must already be a 32-byte SHA-256 digest produced by
        ``hash_frame``). This gives a compact commitment to the full frame
        sequence without storing every raw frame.

        Args:
            frame_hashes: List of 32-byte per-frame SHA-256 digests.

        Returns:
            32-byte SHA-256 digest of the concatenated input hashes.
        """
        concatenated = b"".join(frame_hashes)
        return hashlib.sha256(concatenated).digest()

    # ------------------------------------------------------------------
    # High-level attestation builder
    # ------------------------------------------------------------------

    def prepare_attestation(
        self,
        count: int,
        stream_url: str,
        frame_hashes: list[bytes],
        start_timestamp: int,
        end_timestamp: int,
        model_version: str,
    ) -> dict:
        """
        Prepare complete attestation data for both commit and reveal phases.

        Generates a fresh salt, derives all hashes, and bundles everything into
        a dict that the round manager can persist and pass to the publisher.

        Args:
            count:           Vehicle count for this round.
            stream_url:      Video stream URL that was observed.
            frame_hashes:    List of per-frame SHA-256 digests (may be empty).
            start_timestamp: Unix timestamp of round start.
            end_timestamp:   Unix timestamp of round end.
            model_version:   YOLO model filename used for inference.

        Returns:
            Dict with all values needed for the commit and reveal transactions::

                {
                    "count":           int,
                    "salt":            "0x<hex>",
                    "commitHash":      "0x<hex>",
                    "streamUrlHash":   "0x<hex>",
                    "frameHash":       "0x<hex>",
                    "startTimestamp":  int,
                    "endTimestamp":    int,
                    "modelVersion":    str,
                    "oracleAddress":   str,
                }
        """
        salt = self.generate_salt()
        commit_hash = self.compute_commit_hash(count, salt)
        stream_url_hash = self.compute_stream_url_hash(stream_url)

        if frame_hashes:
            frame_hash = self.compute_frame_hash(frame_hashes)
        else:
            # Sentinel: 32 zero bytes when no frame evidence is available.
            frame_hash = bytes(32)

        return {
            "count": count,
            "salt": "0x" + salt.hex(),
            "commitHash": "0x" + commit_hash.hex(),
            "streamUrlHash": "0x" + stream_url_hash.hex(),
            "frameHash": "0x" + frame_hash.hex(),
            "startTimestamp": start_timestamp,
            "endTimestamp": end_timestamp,
            "modelVersion": model_version,
            "oracleAddress": self.address,
        }
