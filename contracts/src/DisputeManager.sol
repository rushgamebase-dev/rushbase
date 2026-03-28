// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title DisputeManager
 * @notice Dispute resolution system for prediction market outcomes.
 *         Any participant can challenge a market result by posting a deposit
 *         and providing evidence. An arbitrator (admin, multisig, or DAO)
 *         reviews the dispute and either corrects the result or dismisses it.
 *
 *  Flow: Market resolved → challenger opens dispute → arbitrator resolves
 *   - Challenger posts deposit + evidence URI (IPFS hash with video/screenshots)
 *   - If upheld: deposit returned, market corrected, oracle slashed
 *   - If dismissed: deposit sent to feeRecipient (anti-spam)
 *   - Disputes expire after disputeWindow if not resolved
 */

interface IPredictionMarketDispute {
    function correctResult(uint256 newCount) external;
    function state() external view returns (uint8);
    function resolvedAt() external view returns (uint256);
}

interface IOracleRegistrySlash {
    function slashOracle(address _oracle, uint256 _amount, string calldata _reason) external;
}

contract DisputeManager {
    // ─── Types ───────────────────────────────────────────────────────────

    enum DisputeState { OPEN, RESOLVED_FOR_CHALLENGER, RESOLVED_FOR_ORACLE, EXPIRED }

    struct Dispute {
        address challenger;
        address market;
        uint256 deposit;
        string  evidenceURI;       // IPFS hash with video/screenshots
        uint256 proposedCount;
        DisputeState state;
        uint256 createdAt;
        uint256 resolvedAt;
    }

    // ─── State ───────────────────────────────────────────────────────────

    address public admin;
    address public arbitrator;      // authorized to resolve disputes
    IOracleRegistrySlash public oracleRegistry;

    uint256 public disputeWindow;   // seconds after market resolution to open disputes
    uint256 public minDeposit;      // minimum ETH deposit to open a dispute (anti-spam)
    address public feeRecipient;    // receives deposits from dismissed disputes

    Dispute[] public disputes;
    mapping(address => uint256[]) public disputesByMarket;

    // ─── Events ──────────────────────────────────────────────────────────

    event DisputeOpened(
        uint256 indexed disputeId,
        address indexed market,
        address indexed challenger,
        uint256 proposedCount
    );
    event DisputeResolved(uint256 indexed disputeId, DisputeState result);
    event DisputeWindowChanged(uint256 oldWindow, uint256 newWindow);
    event MinDepositChanged(uint256 oldDeposit, uint256 newDeposit);
    event ArbitratorChanged(address indexed oldArbitrator, address indexed newArbitrator);
    event FeeRecipientChanged(address indexed oldRecipient, address indexed newRecipient);
    event AdminChanged(address indexed oldAdmin, address indexed newAdmin);

    // ─── Modifiers ───────────────────────────────────────────────────────

    modifier onlyAdmin() {
        require(msg.sender == admin, "NOT_ADMIN");
        _;
    }

    modifier onlyArbitrator() {
        require(msg.sender == arbitrator, "NOT_ARBITRATOR");
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────

    /**
     * @notice Deploy the dispute manager
     * @param _oracleRegistry Address of the OracleRegistry (for slashing)
     * @param _disputeWindow  Seconds after market resolution to allow disputes (default 3600)
     * @param _minDeposit     Minimum ETH deposit to open a dispute (default 0.001 ether)
     * @param _arbitrator     Address authorized to resolve disputes
     * @param _feeRecipient   Address that receives deposits from dismissed disputes
     */
    constructor(
        address _oracleRegistry,
        uint256 _disputeWindow,
        uint256 _minDeposit,
        address _arbitrator,
        address _feeRecipient
    ) {
        require(_oracleRegistry != address(0), "ZERO_REGISTRY");
        require(_arbitrator != address(0), "ZERO_ARBITRATOR");
        require(_feeRecipient != address(0), "ZERO_FEE_RECIPIENT");

        admin = msg.sender;
        oracleRegistry = IOracleRegistrySlash(_oracleRegistry);
        disputeWindow = _disputeWindow == 0 ? 3600 : _disputeWindow;
        minDeposit = _minDeposit == 0 ? 0.001 ether : _minDeposit;
        arbitrator = _arbitrator;
        feeRecipient = _feeRecipient;
    }

    // ─── Core Functions ──────────────────────────────────────────────────

    /**
     * @notice Open a dispute against a resolved market
     * @dev    Caller must send at least minDeposit as anti-spam collateral.
     *         The market must be in RESOLVED state (state == 2) and within
     *         the dispute window.
     * @param market        Address of the PredictionMarket to dispute
     * @param evidenceURI   IPFS URI pointing to evidence (video, screenshots, etc.)
     * @param proposedCount The correct car count proposed by the challenger
     */
    function openDispute(
        address market,
        string calldata evidenceURI,
        uint256 proposedCount
    ) external payable {
        require(market != address(0), "ZERO_MARKET");
        require(msg.value >= minDeposit, "DEPOSIT_TOO_LOW");
        require(bytes(evidenceURI).length > 0, "EMPTY_EVIDENCE");

        // Market must be RESOLVED (state enum index 2)
        IPredictionMarketDispute pm = IPredictionMarketDispute(market);
        require(pm.state() == 2, "MARKET_NOT_RESOLVED");

        // Must be within dispute window
        uint256 marketResolvedAt = pm.resolvedAt();
        require(marketResolvedAt > 0, "NOT_RESOLVED_YET");
        require(
            block.timestamp <= marketResolvedAt + disputeWindow,
            "DISPUTE_WINDOW_CLOSED"
        );

        uint256 disputeId = disputes.length;

        disputes.push(Dispute({
            challenger: msg.sender,
            market: market,
            deposit: msg.value,
            evidenceURI: evidenceURI,
            proposedCount: proposedCount,
            state: DisputeState.OPEN,
            createdAt: block.timestamp,
            resolvedAt: 0
        }));

        disputesByMarket[market].push(disputeId);

        emit DisputeOpened(disputeId, market, msg.sender, proposedCount);
    }

    /**
     * @notice Resolve a dispute (arbitrator only)
     * @dev    If in favor of challenger: return deposit, correct market result,
     *         and slash the oracle. If against: send deposit to feeRecipient.
     * @param disputeId            Index of the dispute in the disputes array
     * @param inFavorOfChallenger   True to uphold the dispute, false to dismiss
     */
    function resolveDispute(
        uint256 disputeId,
        bool inFavorOfChallenger
    ) external onlyArbitrator {
        require(disputeId < disputes.length, "INVALID_DISPUTE_ID");

        Dispute storage d = disputes[disputeId];
        require(d.state == DisputeState.OPEN, "DISPUTE_NOT_OPEN");

        d.resolvedAt = block.timestamp;

        if (inFavorOfChallenger) {
            d.state = DisputeState.RESOLVED_FOR_CHALLENGER;

            // Return deposit to challenger
            (bool sentChallenger,) = d.challenger.call{value: d.deposit}("");
            require(sentChallenger, "DEPOSIT_RETURN_FAILED");

            // Correct the market result
            IPredictionMarketDispute(d.market).correctResult(d.proposedCount);

            // Slash oracles that provided incorrect data
            oracleRegistry.slashOracle(
                d.market,
                d.deposit,
                "DISPUTE_UPHELD"
            );
        } else {
            d.state = DisputeState.RESOLVED_FOR_ORACLE;

            // Send deposit to fee recipient (anti-spam penalty)
            (bool sentFee,) = feeRecipient.call{value: d.deposit}("");
            require(sentFee, "FEE_TRANSFER_FAILED");
        }

        emit DisputeResolved(disputeId, d.state);
    }

    // ─── View Functions ──────────────────────────────────────────────────

    /**
     * @notice Get all dispute IDs for a given market
     * @param market Address of the market
     * @return Array of dispute IDs
     */
    function getDisputesByMarket(address market) external view returns (uint256[] memory) {
        return disputesByMarket[market];
    }

    /**
     * @notice Get full details of a dispute
     * @param id Dispute index
     * @return The Dispute struct
     */
    function getDispute(uint256 id) external view returns (Dispute memory) {
        require(id < disputes.length, "INVALID_DISPUTE_ID");
        return disputes[id];
    }

    /**
     * @notice Check if a market has any unresolved disputes
     * @param market Address of the market
     * @return True if at least one dispute is still OPEN
     */
    function hasActiveDispute(address market) external view returns (bool) {
        uint256[] storage ids = disputesByMarket[market];
        for (uint256 i = 0; i < ids.length; i++) {
            if (disputes[ids[i]].state == DisputeState.OPEN) {
                return true;
            }
        }
        return false;
    }

    /**
     * @notice Check if a market is still within its dispute window
     * @param market Address of the market
     * @return True if the dispute window has not yet closed
     */
    function isInDisputeWindow(address market) external view returns (bool) {
        IPredictionMarketDispute pm = IPredictionMarketDispute(market);

        // Not resolved yet or state is not RESOLVED
        if (pm.state() != 2) {
            return false;
        }

        uint256 marketResolvedAt = pm.resolvedAt();
        if (marketResolvedAt == 0) {
            return false;
        }

        return block.timestamp <= marketResolvedAt + disputeWindow;
    }

    /**
     * @notice Get the total number of disputes
     * @return The length of the disputes array
     */
    function getDisputeCount() external view returns (uint256) {
        return disputes.length;
    }

    // ─── Admin Functions ─────────────────────────────────────────────────

    /**
     * @notice Update the dispute window duration
     * @param _disputeWindow New window in seconds
     */
    function setDisputeWindow(uint256 _disputeWindow) external onlyAdmin {
        require(_disputeWindow > 0, "ZERO_WINDOW");
        uint256 oldWindow = disputeWindow;
        disputeWindow = _disputeWindow;
        emit DisputeWindowChanged(oldWindow, _disputeWindow);
    }

    /**
     * @notice Update the minimum deposit to open a dispute
     * @param _minDeposit New minimum deposit in wei
     */
    function setMinDeposit(uint256 _minDeposit) external onlyAdmin {
        require(_minDeposit > 0, "ZERO_DEPOSIT");
        uint256 oldDeposit = minDeposit;
        minDeposit = _minDeposit;
        emit MinDepositChanged(oldDeposit, _minDeposit);
    }

    /**
     * @notice Update the arbitrator address
     * @param _arbitrator New arbitrator address
     */
    function setArbitrator(address _arbitrator) external onlyAdmin {
        require(_arbitrator != address(0), "ZERO_ADDRESS");
        address oldArbitrator = arbitrator;
        arbitrator = _arbitrator;
        emit ArbitratorChanged(oldArbitrator, _arbitrator);
    }

    /**
     * @notice Update the fee recipient for dismissed dispute deposits
     * @param _feeRecipient New fee recipient address
     */
    function setFeeRecipient(address _feeRecipient) external onlyAdmin {
        require(_feeRecipient != address(0), "ZERO_ADDRESS");
        address oldRecipient = feeRecipient;
        feeRecipient = _feeRecipient;
        emit FeeRecipientChanged(oldRecipient, _feeRecipient);
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
