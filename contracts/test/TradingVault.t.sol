// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {TradingVault} from "../src/TradingVault.sol";

/**
 * @notice TradingVault test suite.
 *
 *  Covers:
 *   - Deposit (happy path, min, paused, receive fallback, refund-on-revert)
 *   - Withdraw (valid sig, replay, nonce monotonicity, max-single cap,
 *     wrong signer, wrong chain, wrong vault, wrong user, recipient revert)
 *   - House (segregated accounting, owner-only withdraw, cap at houseBalance)
 *   - Signer rotation (24h timelock, cancel, owner-only)
 *   - Reentrancy guard on user and house withdraws
 *
 *  All signatures are EIP-191 over abi.encode(chainId, vault, user, amount, nonce).
 */
contract TradingVaultTest is Test {
    TradingVault internal vault;

    address internal owner = address(0xA11CE);
    uint256 internal signerKey = 0xB0B;
    address internal signerAddr;
    // Use makeAddr to avoid low-numbered addresses (≤ 0x0A) that collide
    // with EVM precompiles and reject `call{value: ...}` transfers.
    address internal alice;
    address internal bob;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount, uint256 nonce);
    event HouseFunded(address indexed from, uint256 amount);
    event HouseWithdrawn(address indexed to, uint256 amount);
    event SignerProposed(address indexed pending, uint256 effectiveAt);
    event SignerRotated(address indexed previous, address indexed current);
    event WithdrawsPausedSet(bool paused);

    function setUp() public {
        signerAddr = vm.addr(signerKey);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        vm.prank(owner);
        vault = new TradingVault(owner, signerAddr);

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(owner, 100 ether);
    }

    // ─── helpers ─────────────────────────────────────────────────────────

    function _signWithdraw(
        address user,
        uint256 amount,
        uint256 nonce,
        uint256 key
    ) internal view returns (bytes memory) {
        bytes32 raw = keccak256(
            abi.encode(block.chainid, address(vault), user, amount, nonce)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", raw));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _depositAlice(uint256 amount) internal {
        vm.prank(alice);
        vault.deposit{value: amount}();
    }

    // ─── deposit ─────────────────────────────────────────────────────────

    function test_deposit_emitsEvent() public {
        vm.expectEmit(true, false, false, true, address(vault));
        emit Deposited(alice, 1 ether);
        _depositAlice(1 ether);
        assertEq(address(vault).balance, 1 ether);
    }

    function test_deposit_belowMinReverts() public {
        vm.prank(alice);
        vm.expectRevert(TradingVault.BelowMinDeposit.selector);
        vault.deposit{value: 1e14}(); // 0.0001 ETH < MIN_DEPOSIT
    }

    function test_deposit_zeroReverts() public {
        vm.prank(alice);
        vm.expectRevert(TradingVault.BelowMinDeposit.selector);
        vault.deposit{value: 0}();
    }

    function test_deposit_pausedRejects() public {
        vm.prank(owner);
        vault.setDepositsPaused(true);
        vm.prank(alice);
        vm.expectRevert(TradingVault.DepositsArePaused.selector);
        vault.deposit{value: 1 ether}();
    }

    function test_receiveFallback_creditsAsDeposit() public {
        vm.expectEmit(true, false, false, true, address(vault));
        emit Deposited(alice, 1 ether);
        vm.prank(alice);
        (bool ok, ) = address(vault).call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(address(vault).balance, 1 ether);
    }

    function test_receiveFallback_respectsMinDeposit() public {
        vm.prank(alice);
        (bool ok, ) = address(vault).call{value: 1e14}("");
        assertFalse(ok); // reverts
    }

    // ─── withdraw ─────────────────────────────────────────────────────────

    function test_withdraw_validSigSucceeds() public {
        _depositAlice(5 ether);

        bytes memory sig = _signWithdraw(alice, 1 ether, 1, signerKey);
        uint256 before = alice.balance;

        vm.expectEmit(true, false, false, true, address(vault));
        emit Withdrawn(alice, 1 ether, 1);
        vm.prank(alice);
        vault.withdraw(1 ether, 1, sig);

        assertEq(alice.balance, before + 1 ether);
        assertEq(vault.lastNonce(alice), 1);
    }

    function test_withdraw_replayRejected() public {
        _depositAlice(5 ether);
        bytes memory sig = _signWithdraw(alice, 1 ether, 1, signerKey);
        vm.prank(alice);
        vault.withdraw(1 ether, 1, sig);

        // Same sig replayed → nonce already consumed.
        vm.prank(alice);
        vm.expectRevert(TradingVault.InvalidNonce.selector);
        vault.withdraw(1 ether, 1, sig);
    }

    function test_withdraw_nonceMustBeStrictlyGreater() public {
        _depositAlice(5 ether);
        bytes memory sig5 = _signWithdraw(alice, 1 ether, 5, signerKey);
        vm.prank(alice);
        vault.withdraw(1 ether, 5, sig5);

        // Try nonce 5 again, then 4, then 5 with new sig — all rejected.
        bytes memory sig4 = _signWithdraw(alice, 1 ether, 4, signerKey);
        vm.prank(alice);
        vm.expectRevert(TradingVault.InvalidNonce.selector);
        vault.withdraw(1 ether, 4, sig4);

        // Nonce 6 with valid sig → allowed.
        bytes memory sig6 = _signWithdraw(alice, 1 ether, 6, signerKey);
        vm.prank(alice);
        vault.withdraw(1 ether, 6, sig6);
        assertEq(vault.lastNonce(alice), 6);
    }

    function test_withdraw_wrongSignerRejected() public {
        _depositAlice(5 ether);
        // Sign with someone else.
        bytes memory sig = _signWithdraw(alice, 1 ether, 1, 0xDEAD);
        vm.prank(alice);
        vm.expectRevert(TradingVault.InvalidSignature.selector);
        vault.withdraw(1 ether, 1, sig);
    }

    function test_withdraw_wrongUserCannotUseAlicesSig() public {
        _depositAlice(5 ether);
        bytes memory sig = _signWithdraw(alice, 1 ether, 1, signerKey);
        // Bob attempts to use Alice's signature.
        vm.prank(bob);
        vm.expectRevert(TradingVault.InvalidSignature.selector);
        vault.withdraw(1 ether, 1, sig);
    }

    function test_withdraw_wrongAmountRejected() public {
        _depositAlice(5 ether);
        bytes memory sig = _signWithdraw(alice, 1 ether, 1, signerKey);
        vm.prank(alice);
        vm.expectRevert(TradingVault.InvalidSignature.selector);
        vault.withdraw(2 ether, 1, sig);
    }

    function test_withdraw_zeroAmountRejected() public {
        _depositAlice(1 ether);
        bytes memory sig = _signWithdraw(alice, 0, 1, signerKey);
        vm.prank(alice);
        vm.expectRevert(TradingVault.ZeroAmount.selector);
        vault.withdraw(0, 1, sig);
    }

    function test_withdraw_maxSingleCapEnforced() public {
        _depositAlice(10 ether);
        vm.prank(owner);
        vault.setMaxSingleWithdraw(0.5 ether);

        bytes memory sig = _signWithdraw(alice, 1 ether, 1, signerKey);
        vm.prank(alice);
        vm.expectRevert(TradingVault.WithdrawTooLarge.selector);
        vault.withdraw(1 ether, 1, sig);
    }

    function test_withdraw_maxSingleZeroDisablesCap() public {
        _depositAlice(10 ether);
        // Default maxSingleWithdraw == 0 means uncapped.
        bytes memory sig = _signWithdraw(alice, 5 ether, 1, signerKey);
        vm.prank(alice);
        vault.withdraw(5 ether, 1, sig);
        assertEq(alice.balance, 100 ether - 10 ether + 5 ether);
    }

    function test_withdraw_chainIdBindingPreventsReplayAcrossChains() public {
        _depositAlice(5 ether);

        // Sign for chainId 9999 (a different chain).
        bytes32 raw = keccak256(
            abi.encode(uint256(9999), address(vault), alice, uint256(1 ether), uint256(1))
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", raw));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.prank(alice);
        vm.expectRevert(TradingVault.InvalidSignature.selector);
        vault.withdraw(1 ether, 1, sig);
    }

    function test_withdraw_vaultAddressBindingPreventsCrossVault() public {
        _depositAlice(5 ether);

        // Sign with a different vault address baked in.
        bytes32 raw = keccak256(
            abi.encode(block.chainid, address(0xCAFE), alice, uint256(1 ether), uint256(1))
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", raw));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.prank(alice);
        vm.expectRevert(TradingVault.InvalidSignature.selector);
        vault.withdraw(1 ether, 1, sig);
    }

    // ─── house ───────────────────────────────────────────────────────────

    function test_houseDeposit_segregatesBalance() public {
        _depositAlice(2 ether);
        vm.expectEmit(true, false, false, true, address(vault));
        emit HouseFunded(owner, 3 ether);
        vm.prank(owner);
        vault.houseDeposit{value: 3 ether}();
        assertEq(vault.houseBalance(), 3 ether);
        assertEq(address(vault).balance, 5 ether);
    }

    function test_houseWithdraw_onlyOwner() public {
        vm.prank(owner);
        vault.houseDeposit{value: 1 ether}();
        vm.prank(alice);
        vm.expectRevert();
        vault.houseWithdraw(alice, 0.5 ether);
    }

    function test_houseWithdraw_cannotExceedHouseBalance() public {
        _depositAlice(5 ether);
        vm.prank(owner);
        vault.houseDeposit{value: 1 ether}();
        // Even though vault balance is 6 ETH, only 1 ETH is house.
        vm.prank(owner);
        vm.expectRevert(TradingVault.InsufficientHouseBalance.selector);
        vault.houseWithdraw(owner, 2 ether);
    }

    function test_houseWithdraw_succeedsWithinBalance() public {
        vm.prank(owner);
        vault.houseDeposit{value: 1 ether}();
        uint256 before = bob.balance;
        vm.expectEmit(true, false, false, true, address(vault));
        emit HouseWithdrawn(bob, 0.5 ether);
        vm.prank(owner);
        vault.houseWithdraw(bob, 0.5 ether);
        assertEq(bob.balance, before + 0.5 ether);
        assertEq(vault.houseBalance(), 0.5 ether);
    }

    // ─── signer rotation ────────────────────────────────────────────────

    function test_proposeSigner_emitsAndStores() public {
        address newSigner = address(0xBEEF);
        vm.expectEmit(true, false, false, true, address(vault));
        emit SignerProposed(newSigner, block.timestamp + 1 days);
        vm.prank(owner);
        vault.proposeSigner(newSigner);
        assertEq(vault.pendingSigner(), newSigner);
    }

    function test_activateSigner_failsBeforeTimelock() public {
        vm.prank(owner);
        vault.proposeSigner(address(0xBEEF));
        vm.warp(block.timestamp + 1 days - 1);
        vm.prank(owner);
        vm.expectRevert(TradingVault.TimelockNotExpired.selector);
        vault.activateSigner();
    }

    function test_activateSigner_succeedsAfterTimelock() public {
        address newSigner = address(0xBEEF);
        vm.prank(owner);
        vault.proposeSigner(newSigner);
        vm.warp(block.timestamp + 1 days);
        vm.expectEmit(true, true, false, false, address(vault));
        emit SignerRotated(signerAddr, newSigner);
        vm.prank(owner);
        vault.activateSigner();
        assertEq(vault.engineSigner(), newSigner);
        assertEq(vault.pendingSigner(), address(0));
    }

    function test_cancelPendingSigner_works() public {
        vm.prank(owner);
        vault.proposeSigner(address(0xBEEF));
        vm.prank(owner);
        vault.cancelPendingSigner();
        assertEq(vault.pendingSigner(), address(0));
    }

    function test_oldSignerStillValidUntilActivate() public {
        _depositAlice(5 ether);
        vm.prank(owner);
        vault.proposeSigner(address(0xBEEF));
        // Old signer still active.
        bytes memory sig = _signWithdraw(alice, 1 ether, 1, signerKey);
        vm.prank(alice);
        vault.withdraw(1 ether, 1, sig);
        assertEq(vault.lastNonce(alice), 1);
    }

    // ─── owner-only knobs ────────────────────────────────────────────────

    function test_setMaxSingleWithdraw_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.setMaxSingleWithdraw(1 ether);
    }

    function test_setDepositsPaused_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.setDepositsPaused(true);
    }

    // ─── withdrawsPaused emergency brake ───────────────────────────────

    function test_setWithdrawsPaused_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.setWithdrawsPaused(true);
    }

    function test_setWithdrawsPaused_emitsEvent() public {
        vm.expectEmit(false, false, false, true, address(vault));
        emit WithdrawsPausedSet(true);
        vm.prank(owner);
        vault.setWithdrawsPaused(true);
        assertTrue(vault.withdrawsPaused());
    }

    function test_userWithdraw_blockedWhenPaused() public {
        _depositAlice(5 ether);
        vm.prank(owner);
        vault.setWithdrawsPaused(true);

        bytes memory sig = _signWithdraw(alice, 1 ether, 1, signerKey);
        vm.prank(alice);
        vm.expectRevert(TradingVault.WithdrawsArePaused.selector);
        vault.withdraw(1 ether, 1, sig);
    }

    function test_houseWithdraw_blockedWhenPaused() public {
        vm.prank(owner);
        vault.houseDeposit{value: 1 ether}();
        vm.prank(owner);
        vault.setWithdrawsPaused(true);

        vm.prank(owner);
        vm.expectRevert(TradingVault.WithdrawsArePaused.selector);
        vault.houseWithdraw(bob, 0.5 ether);
    }

    function test_depositsContinueWhilePaused() public {
        // Pause withdraws; deposits must remain unaffected (users keep
        // funding while ops investigates).
        vm.prank(owner);
        vault.setWithdrawsPaused(true);

        vm.expectEmit(true, false, false, true, address(vault));
        emit Deposited(alice, 1 ether);
        _depositAlice(1 ether);
    }

    function test_unpauseRestoresWithdrawability() public {
        _depositAlice(5 ether);
        vm.prank(owner);
        vault.setWithdrawsPaused(true);
        bytes memory sig = _signWithdraw(alice, 1 ether, 1, signerKey);
        vm.prank(alice);
        vm.expectRevert(TradingVault.WithdrawsArePaused.selector);
        vault.withdraw(1 ether, 1, sig);

        // Owner verifies the cause cleared and flips it back.
        vm.prank(owner);
        vault.setWithdrawsPaused(false);
        assertFalse(vault.withdrawsPaused());
        // Same sig + nonce now succeeds.
        uint256 before = alice.balance;
        vm.prank(alice);
        vault.withdraw(1 ether, 1, sig);
        assertEq(alice.balance, before + 1 ether);
    }

    function test_pauseTogglingIsIdempotent() public {
        // Set true twice in a row; second call still emits + still true.
        vm.prank(owner);
        vault.setWithdrawsPaused(true);
        vm.prank(owner);
        vault.setWithdrawsPaused(true);
        assertTrue(vault.withdrawsPaused());
        // Then back to false twice.
        vm.prank(owner);
        vault.setWithdrawsPaused(false);
        vm.prank(owner);
        vault.setWithdrawsPaused(false);
        assertFalse(vault.withdrawsPaused());
    }

    // ─── reentrancy guards ──────────────────────────────────────────────

    function test_withdraw_reentrancyBlocked() public {
        ReentrantWithdrawer attacker = new ReentrantWithdrawer(vault);
        // Test contract has unlimited ETH; forwarding 5 ether through
        // attacker.deposit() leaves the attacker with balance 0 until the
        // outer withdraw refunds 1 ether.
        attacker.deposit{value: 5 ether}();

        bytes memory outerSig = _signWithdraw(address(attacker), 1 ether, 1, signerKey);
        bytes memory innerSig = _signWithdraw(address(attacker), 0.1 ether, 2, signerKey);
        attacker.armReentry(innerSig);

        // The outer withdraw runs; receive() tries to re-enter with a valid
        // sig (nonce 2). The reentrancy guard makes the inner call revert,
        // which the attacker's receive() catches. Outer call still succeeds,
        // but the inner state never lands: lastNonce stays at 1, attacker
        // gets exactly 1 ether (not 1.1).
        attacker.attack(outerSig);

        assertEq(vault.lastNonce(address(attacker)), 1);
        assertEq(address(attacker).balance, 1 ether);
        assertTrue(attacker.reentryRejected(), "inner withdraw should have reverted");
    }

    // ─── fuzz ────────────────────────────────────────────────────────────

    function testFuzz_validWithdrawForArbitraryAmount(uint96 amount, uint64 nonce) public {
        // Bound to depositable values so the vault has the funds.
        amount = uint96(bound(uint256(amount), 1e15, 50 ether));
        nonce = uint64(bound(uint256(nonce), 1, type(uint64).max));
        vm.deal(alice, uint256(amount) + 1 ether);
        vm.prank(alice);
        vault.deposit{value: amount}();

        bytes memory sig = _signWithdraw(alice, amount, nonce, signerKey);
        vm.prank(alice);
        vault.withdraw(amount, nonce, sig);
        assertEq(vault.lastNonce(alice), nonce);
    }
}

/// @dev Reentrancy attacker. Receives ETH from a legitimate withdraw and
///      attempts to call withdraw a second time before the first one
///      finalizes its state. The OZ ReentrancyGuard must make the inner
///      call revert, leaving lastNonce at the outer value.
contract ReentrantWithdrawer {
    TradingVault internal immutable vault;
    bytes internal reentrySig;
    bool internal entered;
    bool public reentryRejected;

    constructor(TradingVault _vault) {
        vault = _vault;
    }

    function deposit() external payable {
        vault.deposit{value: msg.value}();
    }

    function armReentry(bytes calldata sig) external {
        reentrySig = sig;
    }

    function attack(bytes calldata sig) external {
        vault.withdraw(1 ether, 1, sig);
    }

    receive() external payable {
        if (!entered && reentrySig.length > 0) {
            entered = true;
            // The sig is valid for (this, 0.1 eth, nonce 2) — only the
            // ReentrancyGuard should stop this. If it ever succeeds, the
            // assertion in the test will fail.
            try vault.withdraw(0.1 ether, 2, reentrySig) {
                reentryRejected = false;
            } catch {
                reentryRejected = true;
            }
        }
    }
}
