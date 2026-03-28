// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {OracleRegistry} from "../src/OracleRegistry.sol";

contract OracleRegistryTest is Test {
    receive() external payable {}

    OracleRegistry registry;

    address admin       = address(this);
    address oracle1     = makeAddr("oracle1");
    address oracle2     = makeAddr("oracle2");
    address oracle3     = makeAddr("oracle3");
    address attestation = makeAddr("attestation");
    address alice       = makeAddr("alice");

    uint256 constant MIN_STAKE = 1 ether;

    function setUp() public {
        registry = new OracleRegistry(MIN_STAKE);
        registry.setAttestationContract(attestation);

        // Fund admin for registrations
        vm.deal(admin, 100 ether);
    }

    // ─── Registration ───────────────────────────────────────────────────────

    function test_registerOracle() public {
        registry.registerOracle{value: 1 ether}(oracle1, "Oracle One");

        assertTrue(registry.isActiveOracle(oracle1));
        assertEq(registry.activeOracleCount(), 1);

        OracleRegistry.OracleInfo memory info = registry.getOracleInfo(oracle1);
        assertEq(info.stake, 1 ether);
        assertTrue(info.active);
        assertEq(info.name, "Oracle One");
        assertEq(info.registeredAt, block.timestamp);
    }

    function test_registerMultipleOracles() public {
        registry.registerOracle{value: 1 ether}(oracle1, "O1");
        registry.registerOracle{value: 2 ether}(oracle2, "O2");
        registry.registerOracle{value: 1.5 ether}(oracle3, "O3");

        assertEq(registry.activeOracleCount(), 3);
        assertEq(registry.getOracleListLength(), 3);

        address[] memory active = registry.getActiveOracles();
        assertEq(active.length, 3);
    }

    function test_revertRegisterZeroAddress() public {
        vm.expectRevert("ZERO_ADDRESS");
        registry.registerOracle{value: 1 ether}(address(0), "Bad");
    }

    function test_revertRegisterStakeTooLow() public {
        vm.expectRevert("STAKE_TOO_LOW");
        registry.registerOracle{value: 0.5 ether}(oracle1, "O1");
    }

    function test_revertRegisterEmptyName() public {
        vm.expectRevert("EMPTY_NAME");
        registry.registerOracle{value: 1 ether}(oracle1, "");
    }

    function test_revertRegisterAlreadyActive() public {
        registry.registerOracle{value: 1 ether}(oracle1, "O1");

        vm.expectRevert("ALREADY_ACTIVE");
        registry.registerOracle{value: 1 ether}(oracle1, "O1 Again");
    }

    function test_reRegisterAfterRemoval() public {
        registry.registerOracle{value: 1 ether}(oracle1, "O1");
        registry.removeOracle(oracle1);

        assertFalse(registry.isActiveOracle(oracle1));

        // Re-register (should reuse the list entry)
        registry.registerOracle{value: 1 ether}(oracle1, "O1 Reborn");

        assertTrue(registry.isActiveOracle(oracle1));
        // Should not duplicate in oracleList
        assertEq(registry.getOracleListLength(), 1);
    }

    function test_onlyAdminCanRegister() public {
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vm.expectRevert("NOT_ADMIN");
        registry.registerOracle{value: 1 ether}(oracle1, "O1");
    }

    // ─── Removal ────────────────────────────────────────────────────────────

    function test_removeOracle() public {
        registry.registerOracle{value: 2 ether}(oracle1, "O1");

        uint256 oracleBefore = oracle1.balance;
        registry.removeOracle(oracle1);

        assertFalse(registry.isActiveOracle(oracle1));
        assertEq(registry.activeOracleCount(), 0);
        // Stake returned
        assertEq(oracle1.balance - oracleBefore, 2 ether);

        OracleRegistry.OracleInfo memory info = registry.getOracleInfo(oracle1);
        assertEq(info.stake, 0);
    }

    function test_revertRemoveInactive() public {
        vm.expectRevert("NOT_ACTIVE");
        registry.removeOracle(oracle1);
    }

    function test_onlyAdminCanRemove() public {
        registry.registerOracle{value: 1 ether}(oracle1, "O1");

        vm.prank(alice);
        vm.expectRevert("NOT_ADMIN");
        registry.removeOracle(oracle1);
    }

    // ─── Slashing ───────────────────────────────────────────────────────────

    function test_slashPartial() public {
        registry.registerOracle{value: 2 ether}(oracle1, "O1");

        uint256 adminBefore = admin.balance;
        registry.slashOracle(oracle1, 0.5 ether, "Misbehavior");

        OracleRegistry.OracleInfo memory info = registry.getOracleInfo(oracle1);
        assertEq(info.stake, 1.5 ether);
        assertEq(info.totalSlashed, 0.5 ether);
        assertTrue(info.active); // Still above minStake

        // Admin received slashed funds
        assertEq(admin.balance - adminBefore, 0.5 ether);
    }

    function test_slashBelowMinStakeDeactivates() public {
        registry.registerOracle{value: 1 ether}(oracle1, "O1");

        registry.slashOracle(oracle1, 0.5 ether, "Bad data");

        // Stake is 0.5 ETH, below minStake of 1 ETH
        OracleRegistry.OracleInfo memory info = registry.getOracleInfo(oracle1);
        assertEq(info.stake, 0.5 ether);
        assertFalse(info.active); // auto-deactivated
        assertEq(registry.activeOracleCount(), 0);
    }

    function test_slashFullStake() public {
        registry.registerOracle{value: 1 ether}(oracle1, "O1");

        registry.slashOracle(oracle1, 1 ether, "Total slash");

        OracleRegistry.OracleInfo memory info = registry.getOracleInfo(oracle1);
        assertEq(info.stake, 0);
        assertFalse(info.active);
        assertEq(info.totalSlashed, 1 ether);
    }

    function test_revertSlashZeroAmount() public {
        registry.registerOracle{value: 1 ether}(oracle1, "O1");

        vm.expectRevert("ZERO_AMOUNT");
        registry.slashOracle(oracle1, 0, "No amount");
    }

    function test_revertSlashExceedsStake() public {
        registry.registerOracle{value: 1 ether}(oracle1, "O1");

        vm.expectRevert("SLASH_EXCEEDS_STAKE");
        registry.slashOracle(oracle1, 2 ether, "Too much");
    }

    function test_revertSlashNothingToSlash() public {
        vm.expectRevert("NOTHING_TO_SLASH");
        registry.slashOracle(oracle1, 1 ether, "No oracle");
    }

    function test_onlyAdminCanSlash() public {
        registry.registerOracle{value: 1 ether}(oracle1, "O1");

        vm.prank(alice);
        vm.expectRevert("NOT_ADMIN");
        registry.slashOracle(oracle1, 0.5 ether, "Hack");
    }

    // ─── Add Stake ──────────────────────────────────────────────────────────

    function test_addStake() public {
        registry.registerOracle{value: 1 ether}(oracle1, "O1");

        vm.deal(alice, 5 ether);
        vm.prank(alice);
        registry.addStake{value: 2 ether}(oracle1);

        OracleRegistry.OracleInfo memory info = registry.getOracleInfo(oracle1);
        assertEq(info.stake, 3 ether);
    }

    function test_revertAddStakeZero() public {
        registry.registerOracle{value: 1 ether}(oracle1, "O1");

        vm.expectRevert("ZERO_AMOUNT");
        registry.addStake{value: 0}(oracle1);
    }

    function test_revertAddStakeUnknownOracle() public {
        vm.deal(alice, 5 ether);
        vm.prank(alice);
        vm.expectRevert("ORACLE_NOT_FOUND");
        registry.addStake{value: 1 ether}(oracle1);
    }

    // ─── Attestation Increment ──────────────────────────────────────────────

    function test_incrementAttestations() public {
        registry.registerOracle{value: 1 ether}(oracle1, "O1");

        vm.prank(attestation);
        registry.incrementAttestations(oracle1);

        OracleRegistry.OracleInfo memory info = registry.getOracleInfo(oracle1);
        assertEq(info.totalAttestations, 1);

        vm.prank(attestation);
        registry.incrementAttestations(oracle1);
        info = registry.getOracleInfo(oracle1);
        assertEq(info.totalAttestations, 2);
    }

    function test_revertIncrementByNonAttestationContract() public {
        registry.registerOracle{value: 1 ether}(oracle1, "O1");

        vm.prank(alice);
        vm.expectRevert("NOT_ATTESTATION_CONTRACT");
        registry.incrementAttestations(oracle1);
    }

    function test_revertIncrementInactiveOracle() public {
        registry.registerOracle{value: 1 ether}(oracle1, "O1");
        registry.removeOracle(oracle1);

        vm.prank(attestation);
        vm.expectRevert("NOT_ACTIVE");
        registry.incrementAttestations(oracle1);
    }

    // ─── View Functions ─────────────────────────────────────────────────────

    function test_getActiveOracles() public {
        registry.registerOracle{value: 1 ether}(oracle1, "O1");
        registry.registerOracle{value: 1 ether}(oracle2, "O2");
        registry.registerOracle{value: 1 ether}(oracle3, "O3");

        registry.removeOracle(oracle2);

        address[] memory active = registry.getActiveOracles();
        assertEq(active.length, 2);
        assertEq(active[0], oracle1);
        assertEq(active[1], oracle3);
    }

    function test_getOracleList() public {
        registry.registerOracle{value: 1 ether}(oracle1, "O1");
        registry.registerOracle{value: 1 ether}(oracle2, "O2");

        address[] memory list = registry.getOracleList();
        assertEq(list.length, 2);
    }

    // ─── Admin Functions ────────────────────────────────────────────────────

    function test_setAdmin() public {
        registry.setAdmin(alice);
        assertEq(registry.admin(), alice);
    }

    function test_setMinStake() public {
        registry.setMinStake(2 ether);
        assertEq(registry.minStake(), 2 ether);
    }

    function test_setAttestationContract() public {
        address newAttestation = makeAddr("newAttestation");
        registry.setAttestationContract(newAttestation);
        assertEq(registry.attestationContract(), newAttestation);
    }

    function test_revertSetMinStakeZero() public {
        vm.expectRevert("MIN_STAKE_ZERO");
        registry.setMinStake(0);
    }
}
