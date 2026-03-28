// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title OracleRegistry
 * @notice Manages oracle registration, staking, and slashing for the prediction
 *         market system. Oracles must stake ETH as a guarantee of honest behavior.
 *
 *  Admin can register, remove, and slash oracles.
 *  The attestation contract can increment oracle attestation counts.
 *  Minimum 3 active oracles recommended (enforced by ConsensusEngine, not here).
 */
contract OracleRegistry {
    // ─── Types ───────────────────────────────────────────────────────────

    struct OracleInfo {
        bool    active;
        string  name;
        uint256 stake;
        uint256 registeredAt;
        uint256 totalAttestations;
        uint256 totalSlashed;
    }

    // ─── State ───────────────────────────────────────────────────────────

    address public admin;
    address public attestationContract;

    uint256 public minStake;
    uint256 public activeOracleCount;

    mapping(address => OracleInfo) public oracles;
    address[] public oracleList;

    // ─── Events ──────────────────────────────────────────────────────────

    event OracleRegistered(address indexed oracle, string name, uint256 stake);
    event OracleRemoved(address indexed oracle);
    event OracleSlashed(address indexed oracle, uint256 amount, string reason);
    event StakeAdded(address indexed oracle, uint256 amount);
    event AdminChanged(address indexed oldAdmin, address indexed newAdmin);
    event MinStakeChanged(uint256 oldMinStake, uint256 newMinStake);
    event AttestationContractChanged(address indexed oldContract, address indexed newContract);

    // ─── Modifiers ───────────────────────────────────────────────────────

    modifier onlyAdmin() {
        require(msg.sender == admin, "NOT_ADMIN");
        _;
    }

    modifier onlyActiveOracle() {
        require(oracles[msg.sender].active, "NOT_ORACLE");
        _;
    }

    modifier onlyAttestationContract() {
        require(msg.sender == attestationContract, "NOT_ATTESTATION_CONTRACT");
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────

    constructor(uint256 _minStake) {
        require(_minStake > 0, "MIN_STAKE_ZERO");
        admin = msg.sender;
        minStake = _minStake;
    }

    // ─── Admin Functions ─────────────────────────────────────────────────

    /**
     * @notice Register a new oracle with an initial stake
     * @param _oracle Address of the oracle to register
     * @param _name Human-readable name for the oracle
     */
    function registerOracle(address _oracle, string calldata _name) external payable onlyAdmin {
        require(_oracle != address(0), "ZERO_ADDRESS");
        require(!oracles[_oracle].active, "ALREADY_ACTIVE");
        require(msg.value >= minStake, "STAKE_TOO_LOW");
        require(bytes(_name).length > 0, "EMPTY_NAME");

        bool existsInList = oracles[_oracle].registeredAt != 0;

        oracles[_oracle] = OracleInfo({
            active: true,
            name: _name,
            stake: msg.value,
            registeredAt: block.timestamp,
            totalAttestations: oracles[_oracle].totalAttestations,
            totalSlashed: oracles[_oracle].totalSlashed
        });

        if (!existsInList) {
            oracleList.push(_oracle);
        }

        activeOracleCount++;

        emit OracleRegistered(_oracle, _name, msg.value);
    }

    /**
     * @notice Remove an oracle and return its remaining stake
     * @param _oracle Address of the oracle to remove
     */
    function removeOracle(address _oracle) external onlyAdmin {
        OracleInfo storage info = oracles[_oracle];
        require(info.active, "NOT_ACTIVE");

        info.active = false;
        activeOracleCount--;

        uint256 remainingStake = info.stake;
        info.stake = 0;

        if (remainingStake > 0) {
            (bool sent,) = _oracle.call{value: remainingStake}("");
            require(sent, "TRANSFER_FAILED");
        }

        emit OracleRemoved(_oracle);
    }

    /**
     * @notice Slash an oracle's stake for dishonest behavior
     * @param _oracle Address of the oracle to slash
     * @param _amount Amount of stake to slash
     * @param _reason Human-readable reason for the slash
     */
    function slashOracle(
        address _oracle,
        uint256 _amount,
        string calldata _reason
    ) external onlyAdmin {
        OracleInfo storage info = oracles[_oracle];
        require(info.active || info.stake > 0, "NOTHING_TO_SLASH");
        require(_amount > 0, "ZERO_AMOUNT");
        require(_amount <= info.stake, "SLASH_EXCEEDS_STAKE");

        info.stake -= _amount;
        info.totalSlashed += _amount;

        // If stake falls below minimum, deactivate the oracle
        if (info.active && info.stake < minStake) {
            info.active = false;
            activeOracleCount--;
        }

        // Transfer slashed funds to admin
        (bool sent,) = admin.call{value: _amount}("");
        require(sent, "TRANSFER_FAILED");

        emit OracleSlashed(_oracle, _amount, _reason);
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

    /**
     * @notice Update the minimum stake requirement
     * @param _minStake New minimum stake amount
     */
    function setMinStake(uint256 _minStake) external onlyAdmin {
        require(_minStake > 0, "MIN_STAKE_ZERO");
        uint256 oldMinStake = minStake;
        minStake = _minStake;
        emit MinStakeChanged(oldMinStake, _minStake);
    }

    /**
     * @notice Set the attestation contract authorized to increment attestation counts
     * @param _attestationContract Address of the attestation contract
     */
    function setAttestationContract(address _attestationContract) external onlyAdmin {
        address oldContract = attestationContract;
        attestationContract = _attestationContract;
        emit AttestationContractChanged(oldContract, _attestationContract);
    }

    // ─── Staking Functions ───────────────────────────────────────────────

    /**
     * @notice Add stake to an existing oracle
     * @param _oracle Address of the oracle to add stake to
     */
    function addStake(address _oracle) external payable {
        require(msg.value > 0, "ZERO_AMOUNT");
        require(oracles[_oracle].registeredAt != 0, "ORACLE_NOT_FOUND");

        oracles[_oracle].stake += msg.value;

        emit StakeAdded(_oracle, msg.value);
    }

    // ─── Attestation Functions ───────────────────────────────────────────

    /**
     * @notice Increment the attestation count for an oracle (called by attestation contract)
     * @param _oracle Address of the oracle
     */
    function incrementAttestations(address _oracle) external onlyAttestationContract {
        require(oracles[_oracle].active, "NOT_ACTIVE");
        oracles[_oracle].totalAttestations++;
    }

    // ─── View Functions ──────────────────────────────────────────────────

    /**
     * @notice Check if an address is an active oracle
     * @param _oracle Address to check
     */
    function isActiveOracle(address _oracle) external view returns (bool) {
        return oracles[_oracle].active;
    }

    /**
     * @notice Get full info for an oracle
     * @param _oracle Address of the oracle
     */
    function getOracleInfo(address _oracle) external view returns (OracleInfo memory) {
        return oracles[_oracle];
    }

    /**
     * @notice Get all addresses that have ever been registered as oracles
     */
    function getOracleList() external view returns (address[] memory) {
        return oracleList;
    }

    /**
     * @notice Get all currently active oracle addresses
     */
    function getActiveOracles() external view returns (address[] memory) {
        address[] memory active = new address[](activeOracleCount);
        uint256 idx = 0;

        for (uint256 i = 0; i < oracleList.length; i++) {
            if (oracles[oracleList[i]].active) {
                active[idx] = oracleList[i];
                idx++;
            }
        }

        return active;
    }

    /**
     * @notice Get the total number of oracles ever registered
     */
    function getOracleListLength() external view returns (uint256) {
        return oracleList.length;
    }
}
