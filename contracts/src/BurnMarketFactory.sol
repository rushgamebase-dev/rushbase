// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BurnMarket} from "./BurnMarket.sol";

/**
 * @title BurnMarketFactory
 * @notice Factory for $RUSH token prediction markets with 70/30 burn.
 *         Creates BurnMarket instances where 30% of every pool is burned.
 */
contract BurnMarketFactory {
    address public admin;
    address public oracle;
    address public bettingToken; // $RUSH

    // Compatibility with MarketFactory ABI (frontend expects these)
    address public constant feeRecipient = address(0);
    uint256 public constant feeBps = 0;

    address[] public markets;
    mapping(address => bool) public isMarket;

    event MarketCreated(
        uint256 indexed marketIndex,
        address indexed marketAddress,
        string  description,
        uint256 roundDurationSecs,
        bool    isTokenMode
    );
    event AdminChanged(address indexed oldAdmin, address indexed newAdmin);
    event OracleChanged(address indexed oldOracle, address indexed newOracle);

    modifier onlyAdmin() {
        require(msg.sender == admin, "NOT_ADMIN");
        _;
    }

    constructor(address _oracle, address _bettingToken) {
        require(_oracle != address(0), "ZERO_ORACLE");
        require(_bettingToken != address(0), "ZERO_TOKEN");
        admin = msg.sender;
        oracle = _oracle;
        bettingToken = _bettingToken;
    }

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

        BurnMarket market = new BurnMarket(
            BurnMarket.MarketParams({
                oracle: oracle,
                bettingToken: bettingToken,
                streamUrl: _streamUrl,
                description: _description,
                roundDurationSecs: _roundDurationSecs,
                minBet: _minBet,
                maxBet: _maxBet,
                feeBps: 0, // no fee, burn only
                rangeLabels: _rangeLabels,
                rangeMins: _rangeMins,
                rangeMaxs: _rangeMaxs
            })
        );

        address marketAddress = address(market);
        markets.push(marketAddress);
        isMarket[marketAddress] = true;

        emit MarketCreated(
            markets.length - 1,
            marketAddress,
            _description,
            _roundDurationSecs,
            true
        );

        return marketAddress;
    }

    // ── Admin ─────────────────────────────────────────────────────────────

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

    // ── Views ─────────────────────────────────────────────────────────────

    function getMarketCount() external view returns (uint256) { return markets.length; }
    function getMarkets() external view returns (address[] memory) { return markets; }

    function getActiveMarkets() external view returns (address[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < markets.length; i++) {
            BurnMarket m = BurnMarket(markets[i]);
            if (m.state() == BurnMarket.MarketState.OPEN) count++;
        }
        address[] memory active = new address[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < markets.length; i++) {
            BurnMarket m = BurnMarket(markets[i]);
            if (m.state() == BurnMarket.MarketState.OPEN) {
                active[idx] = markets[i];
                idx++;
            }
        }
        return active;
    }
}
