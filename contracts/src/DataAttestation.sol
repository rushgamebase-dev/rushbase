// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title DataAttestation
 * @notice On-chain data attestation with commit-reveal scheme for oracle honesty.
 *         Oracles first commit a hash of their count, then reveal it later.
 *         This prevents oracles from copying each other's answers.
 *
 *  Flow: COMMIT (hash) -> REVEAL (count + salt, verified against hash)
 */

interface IOracleRegistry {
    function isActiveOracle(address oracle) external view returns (bool);
    function incrementAttestations(address oracle) external;
}

contract DataAttestation {
    // ─── Types ───────────────────────────────────────────────────────────

    struct Attestation {
        address oracle;
        address market;
        bytes32 streamUrlHash;
        bytes32 frameHash;
        uint256 startTimestamp;
        uint256 endTimestamp;
        string  modelVersion;
        uint256 vehicleCount;
        bytes32 commitHash;
        bool    revealed;
        uint256 committedAt;
        uint256 revealedAt;
    }

    // ─── State ───────────────────────────────────────────────────────────

    address public admin;
    IOracleRegistry public oracleRegistry;

    /// @dev market => oracle => Attestation
    mapping(address => mapping(address => Attestation)) public attestations;

    /// @dev market => list of oracles that attested
    mapping(address => address[]) public marketOracles;

    /// @dev market => number of commits
    mapping(address => uint256) public commitCount;

    /// @dev market => number of reveals
    mapping(address => uint256) public revealCount;

    // ─── Events ──────────────────────────────────────────────────────────

    event ResultCommitted(
        address indexed market,
        address indexed oracle,
        bytes32 commitHash
    );

    event ResultRevealed(
        address indexed market,
        address indexed oracle,
        uint256 vehicleCount,
        bytes32 streamUrlHash,
        bytes32 frameHash
    );

    event OracleRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);

    // ─── Modifiers ───────────────────────────────────────────────────────

    modifier onlyActiveOracle() {
        require(oracleRegistry.isActiveOracle(msg.sender), "NOT_ACTIVE_ORACLE");
        _;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "NOT_ADMIN");
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────

    constructor(address _oracleRegistry) {
        require(_oracleRegistry != address(0), "ZERO_ADDRESS");

        admin = msg.sender;
        oracleRegistry = IOracleRegistry(_oracleRegistry);
    }

    // ─── Core Functions ──────────────────────────────────────────────────

    /**
     * @notice Submit a commitment hash for a market result.
     *         The hash should be keccak256(abi.encodePacked(count, salt)).
     * @param market  Address of the prediction market
     * @param _commitHash  keccak256(abi.encodePacked(vehicleCount, salt))
     */
    function commitResult(
        address market,
        bytes32 _commitHash
    ) external onlyActiveOracle {
        require(market != address(0), "ZERO_MARKET");
        require(_commitHash != bytes32(0), "EMPTY_COMMIT");

        Attestation storage att = attestations[market][msg.sender];
        require(att.commitHash == bytes32(0), "ALREADY_COMMITTED");

        att.oracle = msg.sender;
        att.market = market;
        att.commitHash = _commitHash;
        att.committedAt = block.timestamp;

        commitCount[market]++;
        marketOracles[market].push(msg.sender);

        emit ResultCommitted(market, msg.sender, _commitHash);
    }

    /**
     * @notice Reveal the previously committed result with the actual count and salt.
     *         The hash of (count, salt) must match the earlier commitment.
     * @param market         Address of the prediction market
     * @param _count         The vehicle count observed
     * @param _salt          The salt used in the original commitment
     * @param _streamUrlHash Hash of the stream URL that was observed
     * @param _frameHash     Hash of the video frame used for counting
     * @param _startTs       Start timestamp of the observation window
     * @param _endTs         End timestamp of the observation window
     * @param _modelVersion  Version string of the ML model used
     */
    function revealResult(
        address market,
        uint256 _count,
        bytes32 _salt,
        bytes32 _streamUrlHash,
        bytes32 _frameHash,
        uint256 _startTs,
        uint256 _endTs,
        string calldata _modelVersion
    ) external onlyActiveOracle {
        Attestation storage att = attestations[market][msg.sender];

        require(att.commitHash != bytes32(0), "NOT_COMMITTED");
        require(!att.revealed, "ALREADY_REVEALED");
        require(_endTs >= _startTs, "INVALID_TIMESTAMPS");

        // Verify commitment
        bytes32 computedHash = keccak256(abi.encodePacked(_count, _salt));
        require(computedHash == att.commitHash, "HASH_MISMATCH");

        // Store metadata
        att.vehicleCount = _count;
        att.streamUrlHash = _streamUrlHash;
        att.frameHash = _frameHash;
        att.startTimestamp = _startTs;
        att.endTimestamp = _endTs;
        att.modelVersion = _modelVersion;
        att.revealed = true;
        att.revealedAt = block.timestamp;

        revealCount[market]++;

        // Notify registry for reputation tracking
        oracleRegistry.incrementAttestations(msg.sender);

        emit ResultRevealed(market, msg.sender, _count, _streamUrlHash, _frameHash);
    }

    // ─── View Functions ──────────────────────────────────────────────────

    /**
     * @notice Get the full attestation for a specific oracle on a market
     * @param market  Address of the prediction market
     * @param oracle  Address of the oracle
     * @return The Attestation struct
     */
    function getAttestation(
        address market,
        address oracle
    ) external view returns (Attestation memory) {
        return attestations[market][oracle];
    }

    /**
     * @notice Get all oracles that have committed to a market
     * @param market  Address of the prediction market
     * @return Array of oracle addresses
     */
    function getMarketOracles(address market) external view returns (address[] memory) {
        return marketOracles[market];
    }

    /**
     * @notice Get revealed vehicle counts and corresponding oracle addresses.
     *         Only includes oracles that have completed the reveal phase.
     *         Useful for consensus calculation off-chain or in a resolver.
     * @param market  Address of the prediction market
     * @return counts      Array of revealed vehicle counts
     * @return oracleAddrs Array of oracle addresses (same order as counts)
     */
    function getRevealedCounts(
        address market
    ) external view returns (uint256[] memory counts, address[] memory oracleAddrs) {
        address[] storage oracles = marketOracles[market];
        uint256 revealed = revealCount[market];

        counts = new uint256[](revealed);
        oracleAddrs = new address[](revealed);

        uint256 idx = 0;
        for (uint256 i = 0; i < oracles.length; i++) {
            Attestation storage att = attestations[market][oracles[i]];
            if (att.revealed) {
                counts[idx] = att.vehicleCount;
                oracleAddrs[idx] = oracles[i];
                idx++;
            }
        }
    }

    /**
     * @notice Check if an oracle has committed to a market
     * @param market  Address of the prediction market
     * @param oracle  Address of the oracle
     * @return True if the oracle has committed
     */
    function hasCommitted(address market, address oracle) external view returns (bool) {
        return attestations[market][oracle].commitHash != bytes32(0);
    }

    /**
     * @notice Check if an oracle has revealed their result for a market
     * @param market  Address of the prediction market
     * @param oracle  Address of the oracle
     * @return True if the oracle has revealed
     */
    function hasRevealed(address market, address oracle) external view returns (bool) {
        return attestations[market][oracle].revealed;
    }

    // ─── Admin Functions ─────────────────────────────────────────────────

    /**
     * @notice Update the oracle registry address
     * @param _newRegistry  Address of the new OracleRegistry contract
     */
    function setOracleRegistry(address _newRegistry) external onlyAdmin {
        require(_newRegistry != address(0), "ZERO_ADDRESS");

        address oldRegistry = address(oracleRegistry);
        oracleRegistry = IOracleRegistry(_newRegistry);

        emit OracleRegistryUpdated(oldRegistry, _newRegistry);
    }
}
