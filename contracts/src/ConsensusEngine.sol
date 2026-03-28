// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ConsensusEngine
 * @notice Multi-oracle consensus engine for prediction market resolution.
 *         Aggregates revealed counts from DataAttestation, computes the median,
 *         and resolves the market when quorum and agreement thresholds are met.
 *
 *  Flow: Oracles reveal → checkAndResolve → median calculated → market resolved
 *   - Quorum: minimum percentage of active oracles that must reveal (default 66.67%)
 *   - Tolerance: maximum deviation from median for an oracle to count as agreeing (default +-2 cars)
 *   - Agreement: enough oracles within tolerance of median to reach consensus
 */

interface IDataAttestation {
    function getRevealedCounts(address market)
        external
        view
        returns (uint256[] memory counts, address[] memory oracleAddrs);

    function revealCount(address market) external view returns (uint256);
    function commitCount(address market) external view returns (uint256);
}

interface IOracleRegistry {
    function activeOracleCount() external view returns (uint256);
}

interface IPredictionMarket {
    function resolveMarket(uint256 _actualCarCount) external;
}

contract ConsensusEngine {
    // ─── State ───────────────────────────────────────────────────────────

    address public admin;
    IDataAttestation public dataAttestation;
    IOracleRegistry public oracleRegistry;

    uint256 public toleranceCars;   // max abs difference to count as agreement (default 2)
    uint256 public quorumBps;       // minimum reveal quorum in basis points (default 6667 = 66.67%)

    mapping(address => uint256) public consensusResult;
    mapping(address => bool)    public consensusReached;

    // ─── Events ──────────────────────────────────────────────────────────

    event ConsensusReached(address indexed market, uint256 result, uint256 oracleCount);
    event ConsensusDisputed(address indexed market, string reason);
    event ToleranceChanged(uint256 oldTolerance, uint256 newTolerance);
    event QuorumChanged(uint256 oldQuorum, uint256 newQuorum);
    event DataAttestationChanged(address indexed oldAddr, address indexed newAddr);
    event OracleRegistryChanged(address indexed oldAddr, address indexed newAddr);
    event AdminChanged(address indexed oldAdmin, address indexed newAdmin);

    // ─── Modifiers ───────────────────────────────────────────────────────

    modifier onlyAdmin() {
        require(msg.sender == admin, "NOT_ADMIN");
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────

    /**
     * @notice Deploy the consensus engine
     * @param _dataAttestation Address of the DataAttestation contract
     * @param _oracleRegistry  Address of the OracleRegistry contract
     * @param _toleranceCars   Max car count deviation for agreement (0 = exact match only)
     * @param _quorumBps       Minimum reveal quorum in basis points (e.g. 6667 = 66.67%)
     */
    constructor(
        address _dataAttestation,
        address _oracleRegistry,
        uint256 _toleranceCars,
        uint256 _quorumBps
    ) {
        require(_dataAttestation != address(0), "ZERO_ATTESTATION");
        require(_oracleRegistry != address(0), "ZERO_REGISTRY");
        require(_quorumBps > 0 && _quorumBps <= 10_000, "INVALID_QUORUM");

        admin = msg.sender;
        dataAttestation = IDataAttestation(_dataAttestation);
        oracleRegistry = IOracleRegistry(_oracleRegistry);
        toleranceCars = _toleranceCars == 0 ? 2 : _toleranceCars;
        quorumBps = _quorumBps == 0 ? 6667 : _quorumBps;
    }

    // ─── Core Functions ──────────────────────────────────────────────────

    /**
     * @notice Attempt to reach consensus and resolve a market
     * @dev    Fetches revealed counts, validates quorum, computes median,
     *         checks agreement, and calls resolveMarket on success.
     * @param market Address of the PredictionMarket to resolve
     */
    function checkAndResolve(address market) external {
        require(market != address(0), "ZERO_MARKET");
        require(!consensusReached[market], "ALREADY_RESOLVED");

        // Fetch all revealed oracle counts for this market
        (uint256[] memory counts, ) = dataAttestation.getRevealedCounts(market);
        uint256 revealed = counts.length;
        require(revealed > 0, "NO_REVEALS");

        // Check quorum against active oracle count
        uint256 totalOracles = oracleRegistry.activeOracleCount();
        require(totalOracles > 0, "NO_ACTIVE_ORACLES");

        uint256 quorumRequired = (totalOracles * quorumBps) / 10_000;
        if (quorumRequired == 0) {
            quorumRequired = 1;
        }

        if (revealed < quorumRequired) {
            emit ConsensusDisputed(market, "QUORUM_NOT_MET");
            return;
        }

        // Calculate median of revealed counts
        uint256 median = calculateMedian(counts);

        // Check if enough oracles agree (within tolerance of median)
        uint256 agreeing = countAgreeing(counts, median);
        if (agreeing < quorumRequired) {
            emit ConsensusDisputed(market, "INSUFFICIENT_AGREEMENT");
            return;
        }

        // Consensus reached — store result and resolve market
        consensusResult[market] = median;
        consensusReached[market] = true;

        IPredictionMarket(market).resolveMarket(median);

        emit ConsensusReached(market, median, revealed);
    }

    // ─── Pure / View Helpers ─────────────────────────────────────────────

    /**
     * @notice Calculate the median of an array of values
     * @dev    Sorts a memory copy and returns the middle element.
     *         For even-length arrays, returns the lower of the two middle values.
     * @param values Array of uint256 values
     * @return The median value
     */
    function calculateMedian(uint256[] memory values) public pure returns (uint256) {
        require(values.length > 0, "EMPTY_ARRAY");

        // Copy to avoid mutating caller's array
        uint256[] memory sorted = new uint256[](values.length);
        for (uint256 i = 0; i < values.length; i++) {
            sorted[i] = values[i];
        }

        // Insertion sort (fine for small oracle sets)
        for (uint256 i = 1; i < sorted.length; i++) {
            uint256 key = sorted[i];
            uint256 j = i;
            while (j > 0 && sorted[j - 1] > key) {
                sorted[j] = sorted[j - 1];
                j--;
            }
            sorted[j] = key;
        }

        uint256 mid = sorted.length / 2;
        if (sorted.length % 2 == 0) {
            // Even length: return lower of the two middle values
            return sorted[mid - 1];
        } else {
            return sorted[mid];
        }
    }

    /**
     * @notice Check if two values are within the tolerance threshold
     * @param a First value
     * @param b Second value
     * @return True if |a - b| <= toleranceCars
     */
    function isWithinTolerance(uint256 a, uint256 b) public view returns (bool) {
        uint256 diff = a > b ? a - b : b - a;
        return diff <= toleranceCars;
    }

    /**
     * @notice Count how many values in an array are within tolerance of a target
     * @param values Array of values to check
     * @param median Target value (typically the median)
     * @return The number of values within tolerance
     */
    function countAgreeing(uint256[] memory values, uint256 median) public view returns (uint256) {
        uint256 count = 0;
        for (uint256 i = 0; i < values.length; i++) {
            if (isWithinTolerance(values[i], median)) {
                count++;
            }
        }
        return count;
    }

    // ─── Admin Functions ─────────────────────────────────────────────────

    /**
     * @notice Update the car count tolerance for consensus agreement
     * @param _toleranceCars New tolerance value
     */
    function setTolerance(uint256 _toleranceCars) external onlyAdmin {
        uint256 oldTolerance = toleranceCars;
        toleranceCars = _toleranceCars;
        emit ToleranceChanged(oldTolerance, _toleranceCars);
    }

    /**
     * @notice Update the quorum threshold in basis points
     * @param _quorumBps New quorum value (1-10000)
     */
    function setQuorum(uint256 _quorumBps) external onlyAdmin {
        require(_quorumBps > 0 && _quorumBps <= 10_000, "INVALID_QUORUM");
        uint256 oldQuorum = quorumBps;
        quorumBps = _quorumBps;
        emit QuorumChanged(oldQuorum, _quorumBps);
    }

    /**
     * @notice Update the DataAttestation contract address
     * @param _dataAttestation New DataAttestation address
     */
    function setDataAttestation(address _dataAttestation) external onlyAdmin {
        require(_dataAttestation != address(0), "ZERO_ADDRESS");
        address oldAddr = address(dataAttestation);
        dataAttestation = IDataAttestation(_dataAttestation);
        emit DataAttestationChanged(oldAddr, _dataAttestation);
    }

    /**
     * @notice Update the OracleRegistry contract address
     * @param _oracleRegistry New OracleRegistry address
     */
    function setOracleRegistry(address _oracleRegistry) external onlyAdmin {
        require(_oracleRegistry != address(0), "ZERO_ADDRESS");
        address oldAddr = address(oracleRegistry);
        oracleRegistry = IOracleRegistry(_oracleRegistry);
        emit OracleRegistryChanged(oldAddr, _oracleRegistry);
    }

    /**
     * @notice Transfer admin role to a new address
     * @param _newAdmin Address of the new admin
     */
    function setAdmin(address _newAdmin) external onlyAdmin {
        require(_newAdmin != address(0), "ZERO_ADDRESS");
        address oldAdmin = admin;
        admin = _newAdmin;
        emit AdminChanged(oldAdmin, _newAdmin);
    }
}
