// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ConsensusEngine} from "../src/ConsensusEngine.sol";
import {OracleRegistry} from "../src/OracleRegistry.sol";
import {DataAttestation} from "../src/DataAttestation.sol";
import {PredictionMarket} from "../src/PredictionMarket.sol";
import {MarketFactory} from "../src/MarketFactory.sol";

contract ConsensusEngineTest is Test {
    OracleRegistry registry;
    DataAttestation attestation;
    ConsensusEngine consensus;
    MarketFactory factory;

    address admin      = address(this);
    address oracle1    = makeAddr("oracle1");
    address oracle2    = makeAddr("oracle2");
    address oracle3    = makeAddr("oracle3");
    address dispute    = makeAddr("dispute");
    address feeWallet  = makeAddr("feeWallet");

    uint256 constant MIN_STAKE = 1 ether;
    uint256 constant TOLERANCE = 2;
    uint256 constant QUORUM_BPS = 6667; // 66.67%

    function setUp() public {
        vm.warp(1000);
        vm.deal(admin, 100 ether);

        // Deploy infrastructure
        registry = new OracleRegistry(MIN_STAKE);
        attestation = new DataAttestation(address(registry));
        consensus = new ConsensusEngine(
            address(attestation),
            address(registry),
            TOLERANCE,
            QUORUM_BPS
        );

        // Wire up
        registry.setAttestationContract(address(attestation));

        // Register 3 oracles
        registry.registerOracle{value: 1 ether}(oracle1, "O1");
        registry.registerOracle{value: 1 ether}(oracle2, "O2");
        registry.registerOracle{value: 1 ether}(oracle3, "O3");
    }

    // ─── Helpers ────────────────────────────────────────────────────────────

    function _commitHash(uint256 count, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(count, salt));
    }

    function _commit(address oracle, address market, uint256 count, bytes32 salt) internal {
        vm.prank(oracle);
        attestation.commitResult(market, _commitHash(count, salt));
    }

    function _reveal(address oracle, address market, uint256 count, bytes32 salt) internal {
        vm.prank(oracle);
        attestation.revealResult(
            market, count, salt,
            keccak256("url"), keccak256("frame"),
            block.timestamp - 300, block.timestamp, "v1"
        );
    }

    function _createMarket() internal returns (address) {
        // Create factory with consensus engine as the oracle
        factory = new MarketFactory(
            address(consensus),
            feeWallet,
            500,
            address(0)
        );

        string[] memory labels = new string[](4);
        labels[0] = "0-5"; labels[1] = "6-10"; labels[2] = "11-15"; labels[3] = "16+";

        uint256[] memory rangeMins = new uint256[](4);
        rangeMins[0] = 0; rangeMins[1] = 6; rangeMins[2] = 11; rangeMins[3] = 16;

        uint256[] memory rangeMaxs = new uint256[](4);
        rangeMaxs[0] = 5; rangeMaxs[1] = 10; rangeMaxs[2] = 15; rangeMaxs[3] = type(uint256).max;

        return factory.createMarket(
            "https://youtube.com/live/test",
            "Test market",
            300,
            0.001 ether,
            1 ether,
            labels, rangeMins, rangeMaxs
        );
    }

    // ─── Median Calculation ─────────────────────────────────────────────────

    function test_medianOddArray() public view {
        uint256[] memory vals = new uint256[](3);
        vals[0] = 10; vals[1] = 12; vals[2] = 11;

        assertEq(consensus.calculateMedian(vals), 11);
    }

    function test_medianEvenArray() public view {
        uint256[] memory vals = new uint256[](4);
        vals[0] = 10; vals[1] = 20; vals[2] = 15; vals[3] = 12;
        // sorted: 10, 12, 15, 20 -> lower middle = 12
        assertEq(consensus.calculateMedian(vals), 12);
    }

    function test_medianSingleElement() public view {
        uint256[] memory vals = new uint256[](1);
        vals[0] = 42;
        assertEq(consensus.calculateMedian(vals), 42);
    }

    function test_medianAllSame() public view {
        uint256[] memory vals = new uint256[](5);
        for (uint256 i = 0; i < 5; i++) vals[i] = 7;
        assertEq(consensus.calculateMedian(vals), 7);
    }

    function test_medianUnsorted() public view {
        uint256[] memory vals = new uint256[](5);
        vals[0] = 50; vals[1] = 10; vals[2] = 30; vals[3] = 20; vals[4] = 40;
        // sorted: 10, 20, 30, 40, 50 -> median = 30
        assertEq(consensus.calculateMedian(vals), 30);
    }

    function test_revertMedianEmpty() public {
        uint256[] memory vals = new uint256[](0);
        vm.expectRevert("EMPTY_ARRAY");
        consensus.calculateMedian(vals);
    }

    // ─── Tolerance ──────────────────────────────────────────────────────────

    function test_isWithinTolerance() public view {
        assertTrue(consensus.isWithinTolerance(10, 10));  // exact
        assertTrue(consensus.isWithinTolerance(10, 12));  // diff = 2
        assertTrue(consensus.isWithinTolerance(12, 10));  // diff = 2 reversed
        assertFalse(consensus.isWithinTolerance(10, 13)); // diff = 3
    }

    // ─── countAgreeing ──────────────────────────────────────────────────────

    function test_countAgreeing() public view {
        uint256[] memory vals = new uint256[](5);
        vals[0] = 10; vals[1] = 11; vals[2] = 12; vals[3] = 20; vals[4] = 9;
        // median(sorted: 9,10,11,12,20) = 11
        // within tolerance(2) of 11: 10(yes), 11(yes), 12(yes), 20(no), 9(yes)
        assertEq(consensus.countAgreeing(vals, 11), 4);
    }

    // ─── checkAndResolve ────────────────────────────────────────────────────

    function test_consensusAllAgree() public {
        address mkt = _createMarket();

        // All oracles report 10
        _commit(oracle1, mkt, 10, bytes32("s1"));
        _commit(oracle2, mkt, 10, bytes32("s2"));
        _commit(oracle3, mkt, 10, bytes32("s3"));

        _reveal(oracle1, mkt, 10, bytes32("s1"));
        _reveal(oracle2, mkt, 10, bytes32("s2"));
        _reveal(oracle3, mkt, 10, bytes32("s3"));

        consensus.checkAndResolve(mkt);

        assertTrue(consensus.consensusReached(mkt));
        assertEq(consensus.consensusResult(mkt), 10);

        PredictionMarket pm = PredictionMarket(payable(mkt));
        assertEq(uint(pm.state()), uint(PredictionMarket.MarketState.RESOLVED));
        assertEq(pm.actualCarCount(), 10);
        assertEq(pm.winningRangeIndex(), 1); // 6-10
    }

    function test_consensus2of3WithinTolerance() public {
        address mkt = _createMarket();

        // Two report 10, one reports 12 (within tolerance of 2)
        _commit(oracle1, mkt, 10, bytes32("s1"));
        _commit(oracle2, mkt, 12, bytes32("s2"));
        _commit(oracle3, mkt, 10, bytes32("s3"));

        _reveal(oracle1, mkt, 10, bytes32("s1"));
        _reveal(oracle2, mkt, 12, bytes32("s2"));
        _reveal(oracle3, mkt, 10, bytes32("s3"));

        // median(10, 10, 12) = 10, all within tolerance of 2
        consensus.checkAndResolve(mkt);

        assertTrue(consensus.consensusReached(mkt));
        assertEq(consensus.consensusResult(mkt), 10);
    }

    function test_consensus1Disagrees() public {
        address mkt = _createMarket();

        // Two report 10, one reports 100 (far outside tolerance)
        _commit(oracle1, mkt, 10, bytes32("s1"));
        _commit(oracle2, mkt, 100, bytes32("s2"));
        _commit(oracle3, mkt, 10, bytes32("s3"));

        _reveal(oracle1, mkt, 10, bytes32("s1"));
        _reveal(oracle2, mkt, 100, bytes32("s2"));
        _reveal(oracle3, mkt, 10, bytes32("s3"));

        // median(10, 10, 100) = 10
        // agreeing within tolerance: oracle1(10), oracle3(10) = 2 out of 3
        // quorum required: ceil(3 * 6667 / 10000) = 2
        // 2 >= 2, so consensus reached
        consensus.checkAndResolve(mkt);

        assertTrue(consensus.consensusReached(mkt));
        assertEq(consensus.consensusResult(mkt), 10);
    }

    function test_noConsensusAllDisagree() public {
        address mkt = _createMarket();

        // All report wildly different values
        _commit(oracle1, mkt, 1, bytes32("s1"));
        _commit(oracle2, mkt, 50, bytes32("s2"));
        _commit(oracle3, mkt, 100, bytes32("s3"));

        _reveal(oracle1, mkt, 1, bytes32("s1"));
        _reveal(oracle2, mkt, 50, bytes32("s2"));
        _reveal(oracle3, mkt, 100, bytes32("s3"));

        // median(1, 50, 100) = 50
        // within tolerance(2) of 50: only oracle2(50) -> 1 agreeing
        // quorum required: 2
        // 1 < 2, consensus NOT reached (emits INSUFFICIENT_AGREEMENT)
        consensus.checkAndResolve(mkt);

        assertFalse(consensus.consensusReached(mkt));
    }

    function test_revertAlreadyResolved() public {
        address mkt = _createMarket();

        _commit(oracle1, mkt, 10, bytes32("s1"));
        _commit(oracle2, mkt, 10, bytes32("s2"));
        _commit(oracle3, mkt, 10, bytes32("s3"));

        _reveal(oracle1, mkt, 10, bytes32("s1"));
        _reveal(oracle2, mkt, 10, bytes32("s2"));
        _reveal(oracle3, mkt, 10, bytes32("s3"));

        consensus.checkAndResolve(mkt);

        vm.expectRevert("ALREADY_RESOLVED");
        consensus.checkAndResolve(mkt);
    }

    function test_revertNoReveals() public {
        address mkt = _createMarket();

        vm.expectRevert("NO_REVEALS");
        consensus.checkAndResolve(mkt);
    }

    function test_revertZeroMarket() public {
        vm.expectRevert("ZERO_MARKET");
        consensus.checkAndResolve(address(0));
    }

    function test_quorumNotMet() public {
        address mkt = _createMarket();

        // Only 1 of 3 oracles reveals (quorum = 66.67% -> need 2)
        _commit(oracle1, mkt, 10, bytes32("s1"));
        _reveal(oracle1, mkt, 10, bytes32("s1"));

        // Should not revert but emit QUORUM_NOT_MET and not resolve
        consensus.checkAndResolve(mkt);

        assertFalse(consensus.consensusReached(mkt));
    }

    // ─── Admin Functions ────────────────────────────────────────────────────

    function test_setTolerance() public {
        consensus.setTolerance(5);
        assertEq(consensus.toleranceCars(), 5);
    }

    function test_setQuorum() public {
        consensus.setQuorum(5000);
        assertEq(consensus.quorumBps(), 5000);
    }

    function test_revertSetQuorumInvalid() public {
        vm.expectRevert("INVALID_QUORUM");
        consensus.setQuorum(0);

        vm.expectRevert("INVALID_QUORUM");
        consensus.setQuorum(10001);
    }

    function test_setAdmin() public {
        address newAdmin = makeAddr("newAdmin");
        consensus.setAdmin(newAdmin);
        assertEq(consensus.admin(), newAdmin);
    }

    function test_onlyAdminCanSetTolerance() public {
        address alice = makeAddr("alice");
        vm.prank(alice);
        vm.expectRevert("NOT_ADMIN");
        consensus.setTolerance(5);
    }
}
