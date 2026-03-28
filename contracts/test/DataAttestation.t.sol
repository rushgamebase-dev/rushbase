// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {OracleRegistry} from "../src/OracleRegistry.sol";
import {DataAttestation} from "../src/DataAttestation.sol";

contract DataAttestationTest is Test {
    OracleRegistry registry;
    DataAttestation attestation;

    address admin   = address(this);
    address oracle1 = makeAddr("oracle1");
    address oracle2 = makeAddr("oracle2");
    address oracle3 = makeAddr("oracle3");
    address market  = makeAddr("market");
    address alice   = makeAddr("alice");

    uint256 constant MIN_STAKE = 1 ether;

    function setUp() public {
        vm.warp(1000);
        vm.deal(admin, 100 ether);

        registry = new OracleRegistry(MIN_STAKE);
        attestation = new DataAttestation(address(registry));

        // Wire up
        registry.setAttestationContract(address(attestation));

        // Register oracles
        registry.registerOracle{value: 1 ether}(oracle1, "Oracle 1");
        registry.registerOracle{value: 1 ether}(oracle2, "Oracle 2");
        registry.registerOracle{value: 1 ether}(oracle3, "Oracle 3");
    }

    // ─── Helper ─────────────────────────────────────────────────────────────

    function _commitHash(uint256 count, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(count, salt));
    }

    function _doCommit(address oracle, uint256 count, bytes32 salt) internal {
        bytes32 h = _commitHash(count, salt);
        vm.prank(oracle);
        attestation.commitResult(market, h);
    }

    function _doReveal(address oracle, uint256 count, bytes32 salt) internal {
        vm.prank(oracle);
        attestation.revealResult(
            market,
            count,
            salt,
            keccak256("streamUrl"),
            keccak256("frame"),
            block.timestamp - 300,
            block.timestamp,
            "yolov8-1.0"
        );
    }

    // ─── Commit Tests ───────────────────────────────────────────────────────

    function test_commitResult() public {
        bytes32 salt = bytes32("salt1");
        bytes32 h = _commitHash(10, salt);

        vm.prank(oracle1);
        attestation.commitResult(market, h);

        assertEq(attestation.commitCount(market), 1);
        assertTrue(attestation.hasCommitted(market, oracle1));
        assertFalse(attestation.hasRevealed(market, oracle1));

        address[] memory oracles = attestation.getMarketOracles(market);
        assertEq(oracles.length, 1);
        assertEq(oracles[0], oracle1);
    }

    function test_multipleCommits() public {
        _doCommit(oracle1, 10, bytes32("s1"));
        _doCommit(oracle2, 11, bytes32("s2"));
        _doCommit(oracle3, 10, bytes32("s3"));

        assertEq(attestation.commitCount(market), 3);

        address[] memory oracles = attestation.getMarketOracles(market);
        assertEq(oracles.length, 3);
    }

    function test_revertDoubleCommit() public {
        _doCommit(oracle1, 10, bytes32("s1"));

        bytes32 h2 = _commitHash(11, bytes32("s2"));
        vm.prank(oracle1);
        vm.expectRevert("ALREADY_COMMITTED");
        attestation.commitResult(market, h2);
    }

    function test_revertCommitEmptyHash() public {
        vm.prank(oracle1);
        vm.expectRevert("EMPTY_COMMIT");
        attestation.commitResult(market, bytes32(0));
    }

    function test_revertCommitZeroMarket() public {
        vm.prank(oracle1);
        vm.expectRevert("ZERO_MARKET");
        attestation.commitResult(address(0), bytes32("hash"));
    }

    function test_revertCommitNotActiveOracle() public {
        vm.prank(alice);
        vm.expectRevert("NOT_ACTIVE_ORACLE");
        attestation.commitResult(market, bytes32("hash"));
    }

    // ─── Reveal Tests ───────────────────────────────────────────────────────

    function test_revealResult() public {
        bytes32 salt = bytes32("salt1");
        uint256 count = 10;

        _doCommit(oracle1, count, salt);
        _doReveal(oracle1, count, salt);

        assertEq(attestation.revealCount(market), 1);
        assertTrue(attestation.hasRevealed(market, oracle1));

        DataAttestation.Attestation memory att = attestation.getAttestation(market, oracle1);
        assertEq(att.vehicleCount, count);
        assertTrue(att.revealed);
        assertEq(att.modelVersion, "yolov8-1.0");
    }

    function test_fullCommitRevealFlow() public {
        bytes32 s1 = bytes32("s1");
        bytes32 s2 = bytes32("s2");
        bytes32 s3 = bytes32("s3");

        // All commit
        _doCommit(oracle1, 10, s1);
        _doCommit(oracle2, 11, s2);
        _doCommit(oracle3, 10, s3);

        assertEq(attestation.commitCount(market), 3);
        assertEq(attestation.revealCount(market), 0);

        // All reveal
        _doReveal(oracle1, 10, s1);
        _doReveal(oracle2, 11, s2);
        _doReveal(oracle3, 10, s3);

        assertEq(attestation.revealCount(market), 3);

        // Check incrementAttestations was called
        OracleRegistry.OracleInfo memory info1 = registry.getOracleInfo(oracle1);
        assertEq(info1.totalAttestations, 1);
    }

    function test_revertRevealHashMismatch() public {
        _doCommit(oracle1, 10, bytes32("salt1"));

        // Reveal with wrong count
        vm.prank(oracle1);
        vm.expectRevert("HASH_MISMATCH");
        attestation.revealResult(
            market, 99, bytes32("salt1"),
            keccak256("url"), keccak256("frame"),
            0, 100, "v1"
        );
    }

    function test_revertRevealWrongSalt() public {
        _doCommit(oracle1, 10, bytes32("salt1"));

        vm.prank(oracle1);
        vm.expectRevert("HASH_MISMATCH");
        attestation.revealResult(
            market, 10, bytes32("wrongSalt"),
            keccak256("url"), keccak256("frame"),
            0, 100, "v1"
        );
    }

    function test_revertDoubleReveal() public {
        bytes32 salt = bytes32("s1");
        _doCommit(oracle1, 10, salt);
        _doReveal(oracle1, 10, salt);

        vm.prank(oracle1);
        vm.expectRevert("ALREADY_REVEALED");
        attestation.revealResult(
            market, 10, salt,
            keccak256("url"), keccak256("frame"),
            0, 100, "v1"
        );
    }

    function test_revertRevealWithoutCommit() public {
        vm.prank(oracle1);
        vm.expectRevert("NOT_COMMITTED");
        attestation.revealResult(
            market, 10, bytes32("salt"),
            keccak256("url"), keccak256("frame"),
            0, 100, "v1"
        );
    }

    function test_revertRevealNotActiveOracle() public {
        _doCommit(oracle1, 10, bytes32("s1"));

        // Deactivate oracle1
        registry.removeOracle(oracle1);

        vm.prank(oracle1);
        vm.expectRevert("NOT_ACTIVE_ORACLE");
        attestation.revealResult(
            market, 10, bytes32("s1"),
            keccak256("url"), keccak256("frame"),
            0, 100, "v1"
        );
    }

    function test_revertRevealInvalidTimestamps() public {
        _doCommit(oracle1, 10, bytes32("s1"));

        vm.prank(oracle1);
        vm.expectRevert("INVALID_TIMESTAMPS");
        attestation.revealResult(
            market, 10, bytes32("s1"),
            keccak256("url"), keccak256("frame"),
            200, 100, // endTs < startTs
            "v1"
        );
    }

    // ─── getRevealedCounts ──────────────────────────────────────────────────

    function test_getRevealedCounts() public {
        bytes32 s1 = bytes32("s1");
        bytes32 s2 = bytes32("s2");
        bytes32 s3 = bytes32("s3");

        _doCommit(oracle1, 10, s1);
        _doCommit(oracle2, 11, s2);
        _doCommit(oracle3, 10, s3);

        // Only reveal oracle1 and oracle3
        _doReveal(oracle1, 10, s1);
        _doReveal(oracle3, 10, s3);

        (uint256[] memory counts, address[] memory addrs) = attestation.getRevealedCounts(market);

        assertEq(counts.length, 2);
        assertEq(addrs.length, 2);
        assertEq(counts[0], 10);
        assertEq(addrs[0], oracle1);
        assertEq(counts[1], 10);
        assertEq(addrs[1], oracle3);
    }

    function test_getRevealedCountsEmpty() public view {
        (uint256[] memory counts, address[] memory addrs) = attestation.getRevealedCounts(market);
        assertEq(counts.length, 0);
        assertEq(addrs.length, 0);
    }

    // ─── Admin Functions ────────────────────────────────────────────────────

    function test_setOracleRegistry() public {
        address newRegistry = makeAddr("newRegistry");
        attestation.setOracleRegistry(newRegistry);
        assertEq(address(attestation.oracleRegistry()), newRegistry);
    }

    function test_revertSetRegistryNotAdmin() public {
        vm.prank(alice);
        vm.expectRevert("NOT_ADMIN");
        attestation.setOracleRegistry(makeAddr("x"));
    }

    function test_revertSetRegistryZero() public {
        vm.expectRevert("ZERO_ADDRESS");
        attestation.setOracleRegistry(address(0));
    }
}
