// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PredictionMarket} from "./PredictionMarket.sol";

/**
 * @title MarketFactory
 * @notice Factory contract that creates and tracks PredictionMarket instances.
 *         Single-oracle, ETH-only mode for Rush MVP.
 */
contract MarketFactory {
    // ─── State ───────────────────────────────────────────────────────────

    address public admin;
    address public oracle;
    address public feeRecipient;
    address public bettingToken;      // address(0) = ETH, else ERC20
    uint256 public feeBps;

    address[] public markets;
    mapping(address => bool) public isMarket;
    mapping(string => address[]) public marketsByStream; // streamUrl => markets

    // ─── Events ──────────────────────────────────────────────────────────

    event MarketCreated(
        uint256 indexed marketIndex,
        address indexed marketAddress,
        string  description,
        uint256 roundDurationSecs,
        bool    isTokenMode
    );
    event AdminChanged(address indexed oldAdmin, address indexed newAdmin);
    event OracleChanged(address indexed oldOracle, address indexed newOracle);
    event FeeRecipientChanged(address indexed oldRecipient, address indexed newRecipient);
    event DefaultFeeChanged(uint256 oldFee, uint256 newFee);

    // ─── Modifiers ───────────────────────────────────────────────────────

    modifier onlyAdmin() {
        require(msg.sender == admin, "NOT_ADMIN");
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────

    constructor(
        address _oracle,
        address _feeRecipient,
        uint256 _feeBps,
        address _bettingToken
    ) {
        require(_feeBps <= 2000, "FEE_TOO_HIGH");
        require(_oracle != address(0), "ZERO_ORACLE");
        require(_feeRecipient != address(0), "ZERO_FEE_RECIPIENT");
        admin = msg.sender;
        oracle = _oracle;
        feeRecipient = _feeRecipient;
        feeBps = _feeBps;
        bettingToken = _bettingToken;
    }

    // ─── Market Creation ─────────────────────────────────────────────────

    function createMarket(
        string calldata _streamUrl,
        string calldata _description,
        uint256 _roundDurationSecs,
        uint256 _minBet,
        uint256 _maxBet,
        string[] calldata _rangeLabels,
        uint256[] calldata _rangeMins,
        uint256[] calldata _rangeMaxs
    ) external onlyAdmin returns (address) {
        require(_roundDurationSecs >= 60, "DURATION_TOO_SHORT");
        require(_rangeLabels.length > 1, "NEED_2+_RANGES");

        address marketAddress = _deployMarket(
            _streamUrl, _description, _roundDurationSecs,
            _minBet, _maxBet,
            _rangeLabels, _rangeMins, _rangeMaxs
        );

        markets.push(marketAddress);
        isMarket[marketAddress] = true;
        marketsByStream[_streamUrl].push(marketAddress);

        emit MarketCreated(
            markets.length - 1,
            marketAddress,
            _description,
            _roundDurationSecs,
            bettingToken != address(0)
        );

        return marketAddress;
    }

    function _deployMarket(
        string calldata _streamUrl,
        string calldata _description,
        uint256 _roundDurationSecs,
        uint256 _minBet,
        uint256 _maxBet,
        string[] calldata _rangeLabels,
        uint256[] calldata _rangeMins,
        uint256[] calldata _rangeMaxs
    ) internal returns (address) {
        PredictionMarket market = new PredictionMarket(
            PredictionMarket.MarketParams({
                oracle: oracle,
                disputeManager: address(0),
                feeRecipient: feeRecipient,
                bettingToken: bettingToken,
                streamUrl: _streamUrl,
                description: _description,
                roundDurationSecs: _roundDurationSecs,
                minBet: _minBet,
                maxBet: _maxBet,
                feeBps: feeBps,
                disputeWindowSecs: 0,           // no dispute window
                rangeLabels: _rangeLabels,
                rangeMins: _rangeMins,
                rangeMaxs: _rangeMaxs
            })
        );
        return address(market);
    }

    // ─── Admin Functions ─────────────────────────────────────────────────

    function setAdmin(address _admin) external onlyAdmin {
        require(_admin != address(0), "ZERO_ADDRESS");
        emit AdminChanged(admin, _admin);
        admin = _admin;
    }

    function setOracle(address _oracle) external onlyAdmin {
        require(_oracle != address(0), "ZERO_ADDRESS");
        emit OracleChanged(oracle, _oracle);
        oracle = _oracle;
    }

    function setFeeRecipient(address _feeRecipient) external onlyAdmin {
        emit FeeRecipientChanged(feeRecipient, _feeRecipient);
        feeRecipient = _feeRecipient;
    }

    function setBettingToken(address _bettingToken) external onlyAdmin {
        bettingToken = _bettingToken;
    }

    function setDefaultFee(uint256 _feeBps) external onlyAdmin {
        require(_feeBps <= 2000, "FEE_TOO_HIGH");
        emit DefaultFeeChanged(feeBps, _feeBps);
        feeBps = _feeBps;
    }

    // ─── View Functions ──────────────────────────────────────────────────

    function getMarketCount() external view returns (uint256) {
        return markets.length;
    }

    function getMarkets() external view returns (address[] memory) {
        return markets;
    }

    function getMarketsByStream(string calldata _streamUrl) external view returns (address[] memory) {
        return marketsByStream[_streamUrl];
    }

    function getActiveMarkets() external view returns (address[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < markets.length; i++) {
            PredictionMarket m = PredictionMarket(markets[i]);
            if (m.state() == PredictionMarket.MarketState.OPEN) {
                count++;
            }
        }

        address[] memory active = new address[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < markets.length; i++) {
            PredictionMarket m = PredictionMarket(markets[i]);
            if (m.state() == PredictionMarket.MarketState.OPEN) {
                active[idx] = markets[i];
                idx++;
            }
        }
        return active;
    }
}
