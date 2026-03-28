// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {MarketFactory} from "../src/MarketFactory.sol";
import {PredictionMarket} from "../src/PredictionMarket.sol";

// ─── Mock ERC20 ─────────────────────────────────────────────────────────────

contract MockERC20 is IERC20 {
    string public name = "Mock USDC";
    string public symbol = "USDC";
    uint8 public decimals = 6;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "INSUFFICIENT");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "INSUFFICIENT");
        require(allowance[from][msg.sender] >= amount, "NOT_APPROVED");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

// ─── Test Contract ──────────────────────────────────────────────────────────

contract PredictionMarketTest is Test {
    MarketFactory factory;
    PredictionMarket market;
    MockERC20 usdc;

    address admin     = address(this);
    address oracle    = makeAddr("oracle");
    address feeWallet = makeAddr("feeWallet");
    address alice     = makeAddr("alice");
    address bob       = makeAddr("bob");
    address charlie   = makeAddr("charlie");

    string[] labels;
    uint256[] mins;
    uint256[] maxs;

    function setUp() public {
        // ── Range setup ──
        labels = new string[](4);
        labels[0] = "0-5";
        labels[1] = "6-10";
        labels[2] = "11-15";
        labels[3] = "16+";

        mins = new uint256[](4);
        mins[0] = 0;  mins[1] = 6;  mins[2] = 11; mins[3] = 16;

        maxs = new uint256[](4);
        maxs[0] = 5;  maxs[1] = 10; maxs[2] = 15; maxs[3] = type(uint256).max;

        // ── ETH factory & market ──
        factory = new MarketFactory(
            oracle,
            feeWallet,
            500   // 5% fee
        );

        address marketAddr = factory.createMarket(
            "https://youtube.com/live/example",
            "Semaforo Av. Paulista - Quantos carros passam em 5 min?",
            300,
            0.001 ether,
            1 ether,
            labels, mins, maxs
        );
        market = PredictionMarket(payable(marketAddr));

        // Fund users
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
        vm.deal(charlie, 10 ether);
    }

    // ─── Factory Tests ──────────────────────────────────────────────────────

    function test_factoryCreatesMarket() public view {
        assertEq(factory.getMarketCount(), 1);
        assertTrue(factory.isMarket(address(market)));
    }

    function test_factoryConfig() public view {
        assertEq(factory.admin(), admin);
        assertEq(factory.oracle(), oracle);
        assertEq(factory.feeRecipient(), feeWallet);
        assertEq(factory.feeBps(), 500);
    }

    function test_onlyAdminCanCreateMarket() public {
        vm.prank(alice);
        vm.expectRevert("NOT_ADMIN");
        factory.createMarket(
            "url", "desc", 300, 0.001 ether, 1 ether,
            labels, mins, maxs
        );
    }

    // ─── Market Info Tests ──────────────────────────────────────────────────

    function test_marketInitialization() public view {
        assertEq(market.oracle(), oracle);
        assertEq(market.feeRecipient(), feeWallet);
        assertEq(market.feeBps(), 500);
        assertEq(market.getRangeCount(), 4);
        assertEq(uint(market.state()), uint(PredictionMarket.MarketState.OPEN));
        assertFalse(market.isTokenMode());
        assertEq(market.disputeWindowSecs(), 0);
    }

    function test_getRanges() public view {
        PredictionMarket.Range[] memory ranges = market.getAllRanges();
        assertEq(ranges.length, 4);
        assertEq(ranges[0].minCars, 0);
        assertEq(ranges[0].maxCars, 5);
        assertEq(ranges[3].minCars, 16);
        assertEq(ranges[3].maxCars, type(uint256).max);
    }

    // ─── ETH Betting Tests ──────────────────────────────────────────────────

    function test_placeBet() public {
        vm.prank(alice);
        market.placeBet{value: 0.5 ether}(1);

        assertEq(market.totalPool(), 0.5 ether);
        assertEq(market.poolByRange(1), 0.5 ether);
        assertEq(market.totalBettors(), 1);
    }

    function test_multipleBets() public {
        vm.prank(alice);
        market.placeBet{value: 0.5 ether}(0);

        vm.prank(bob);
        market.placeBet{value: 0.3 ether}(1);

        vm.prank(charlie);
        market.placeBet{value: 0.2 ether}(1);

        assertEq(market.totalPool(), 1 ether);
        assertEq(market.poolByRange(0), 0.5 ether);
        assertEq(market.poolByRange(1), 0.5 ether);
        assertEq(market.totalBettors(), 3);
    }

    function test_revertBetTooLow() public {
        vm.prank(alice);
        vm.expectRevert("BET_TOO_LOW");
        market.placeBet{value: 0.0001 ether}(0);
    }

    function test_revertBetTooHigh() public {
        vm.prank(alice);
        vm.expectRevert("BET_TOO_HIGH");
        market.placeBet{value: 2 ether}(0);
    }

    function test_revertInvalidRange() public {
        vm.prank(alice);
        vm.expectRevert("INVALID_RANGE");
        market.placeBet{value: 0.1 ether}(99);
    }

    function test_revertBetAfterLockTime() public {
        vm.warp(block.timestamp + 301);
        vm.prank(alice);
        vm.expectRevert("BETTING_CLOSED");
        market.placeBet{value: 0.1 ether}(0);
    }

    // ─── Resolution Tests (oracle caller) ──────────────────────────────────

    function test_resolveMarket() public {
        vm.prank(alice);
        market.placeBet{value: 1 ether}(1);

        vm.prank(bob);
        market.placeBet{value: 1 ether}(2);

        // Oracle resolves: 8 cars -> range 1 (6-10) wins
        vm.prank(oracle);
        market.resolveMarket(8);

        assertEq(uint(market.state()), uint(PredictionMarket.MarketState.RESOLVED));
        assertEq(market.winningRangeIndex(), 1);
        assertEq(market.actualCarCount(), 8);
    }

    function test_onlyOracleCanResolve() public {
        vm.prank(alice);
        vm.expectRevert("NOT_ORACLE");
        market.resolveMarket(5);
    }

    function test_resolveAutoLocks() public {
        // Market is OPEN, resolveMarket should auto-lock
        vm.prank(alice);
        market.placeBet{value: 0.5 ether}(1);

        vm.prank(oracle);
        market.resolveMarket(7);

        // State should be RESOLVED (auto-locked then resolved)
        assertEq(uint(market.state()), uint(PredictionMarket.MarketState.RESOLVED));
    }

    // ─── Lock Tests ─────────────────────────────────────────────────────────

    function test_lockMarket() public {
        vm.prank(oracle);
        market.lockMarket();
        assertEq(uint(market.state()), uint(PredictionMarket.MarketState.LOCKED));

        vm.prank(alice);
        vm.expectRevert("WRONG_STATE");
        market.placeBet{value: 0.1 ether}(0);
    }

    function test_onlyOracleCanLock() public {
        vm.prank(alice);
        vm.expectRevert("NOT_ORACLE");
        market.lockMarket();
    }

    // ─── Payout Tests (immediate after resolution) ───────────────────────────

    function test_claimWinnings_singleWinner() public {
        vm.prank(alice);
        market.placeBet{value: 1 ether}(1);

        vm.prank(bob);
        market.placeBet{value: 1 ether}(0);

        vm.prank(oracle);
        market.resolveMarket(7); // range 1 wins

        // Claims are immediate — no waiting required
        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        market.claimWinnings();

        // Pool = 2 ETH, fee = 5% = 0.1 ETH, distributable = 1.9 ETH
        assertEq(alice.balance - aliceBefore, 1.9 ether);
        assertEq(feeWallet.balance, 0.1 ether);
    }

    function test_claimWinnings_multipleWinners() public {
        vm.prank(alice);
        market.placeBet{value: 0.6 ether}(2);

        vm.prank(bob);
        market.placeBet{value: 0.4 ether}(2);

        vm.prank(charlie);
        market.placeBet{value: 1 ether}(0);

        vm.prank(oracle);
        market.resolveMarket(12); // range 2 wins

        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        market.claimWinnings();
        assertEq(alice.balance - aliceBefore, 1.14 ether);

        uint256 bobBefore = bob.balance;
        vm.prank(bob);
        market.claimWinnings();
        assertEq(bob.balance - bobBefore, 0.76 ether);
    }

    function test_revertClaimIfNotWinner() public {
        vm.prank(alice);
        market.placeBet{value: 0.5 ether}(0);

        vm.prank(bob);
        market.placeBet{value: 0.5 ether}(1);

        vm.prank(oracle);
        market.resolveMarket(7); // range 1 wins

        vm.prank(alice);
        vm.expectRevert("NOTHING_TO_CLAIM");
        market.claimWinnings();
    }

    function test_revertDoubleClaim() public {
        vm.prank(alice);
        market.placeBet{value: 1 ether}(1);

        vm.prank(bob);
        market.placeBet{value: 1 ether}(0);

        vm.prank(oracle);
        market.resolveMarket(8);

        vm.prank(alice);
        market.claimWinnings();

        vm.prank(alice);
        vm.expectRevert("NOTHING_TO_CLAIM");
        market.claimWinnings();
    }

    // ─── Cancellation & Refund Tests ────────────────────────────────────────

    function test_cancelAndRefund() public {
        vm.prank(alice);
        market.placeBet{value: 0.5 ether}(0);

        vm.prank(bob);
        market.placeBet{value: 0.3 ether}(1);

        vm.prank(oracle);
        market.cancelMarket();
        assertEq(uint(market.state()), uint(PredictionMarket.MarketState.CANCELLED));

        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        market.refund();
        assertEq(alice.balance - aliceBefore, 0.5 ether);

        uint256 bobBefore = bob.balance;
        vm.prank(bob);
        market.refund();
        assertEq(bob.balance - bobBefore, 0.3 ether);
    }

    function test_onlyOracleCanCancel() public {
        vm.prank(alice);
        vm.expectRevert("NOT_ORACLE");
        market.cancelMarket();
    }

    function test_revertCancelAfterResolved() public {
        vm.prank(alice);
        market.placeBet{value: 0.5 ether}(1);

        vm.prank(oracle);
        market.resolveMarket(7);

        vm.prank(oracle);
        vm.expectRevert("ALREADY_RESOLVED");
        market.cancelMarket();
    }

    function test_revertDoubleRefund() public {
        vm.prank(alice);
        market.placeBet{value: 0.5 ether}(0);

        vm.prank(oracle);
        market.cancelMarket();

        vm.prank(alice);
        market.refund();

        vm.prank(alice);
        vm.expectRevert("NOTHING_TO_REFUND");
        market.refund();
    }

    // ─── Edge Cases ─────────────────────────────────────────────────────────

    function test_range16Plus() public {
        vm.prank(alice);
        market.placeBet{value: 0.5 ether}(3); // "16+"

        vm.prank(bob);
        market.placeBet{value: 0.5 ether}(0);

        vm.prank(oracle);
        market.resolveMarket(42); // range 3 wins

        assertEq(market.winningRangeIndex(), 3);
        assertEq(market.actualCarCount(), 42);

        vm.prank(alice);
        market.claimWinnings();
    }

    function test_getUserClaimable() public {
        vm.prank(alice);
        market.placeBet{value: 1 ether}(1);

        vm.prank(bob);
        market.placeBet{value: 1 ether}(0);

        assertEq(market.getUserClaimable(alice), 0); // Not resolved yet

        vm.prank(oracle);
        market.resolveMarket(7);

        assertEq(market.getUserClaimable(alice), 1.9 ether);
        assertEq(market.getUserClaimable(bob), 0);
    }

    function test_isClaimableAfterResolution() public {
        vm.prank(alice);
        market.placeBet{value: 0.5 ether}(1);

        assertFalse(market.isClaimable());

        vm.prank(oracle);
        market.resolveMarket(7);

        // Immediately claimable after resolution (no dispute window)
        assertTrue(market.isClaimable());
    }
}
