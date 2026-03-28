// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {RushTiles} from "../src/RushTiles.sol";
import {IRushTiles} from "../src/interfaces/IRushTiles.sol";

contract RushTilesTest is Test {
    RushTiles public rush;

    address public authority;
    address public dev;
    address public alice;
    address public bob;
    address public carol;

    uint80 constant BASE_PRICE   = 0.1 ether;
    uint80 constant MIN_PRICE    = 0.01 ether;

    // Minimum deposit = 5% of price (1 week tax)
    function _minDeposit(uint80 price) internal pure returns (uint96) {
        return uint96((uint256(price) * 500) / 10_000);
    }

    function setUp() public {
        authority = makeAddr("authority");
        dev       = makeAddr("dev");
        alice     = makeAddr("alice");
        bob       = makeAddr("bob");
        carol     = makeAddr("carol");

        vm.prank(authority);
        rush = new RushTiles(dev);

        vm.deal(alice, 100 ether);
        vm.deal(bob,   100 ether);
        vm.deal(carol, 100 ether);
        vm.deal(authority, 10 ether);
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    /// @dev Claim tile i as caller with BASE_PRICE and required deposit.
    function _claim(address caller, uint8 idx, uint80 price) internal {
        IRushTiles.PlayerState memory ps = rush.getPlayer(caller);
        uint96 deposit = _minDeposit(price);
        uint96 fee = ps.tileCount > 0
            ? uint96((uint256(price) * 1000) / 10_000)
            : 0;
        vm.prank(caller);
        rush.claimTile{value: uint256(deposit) + uint256(fee)}(idx, price);
    }

    // ── Claim Tests ───────────────────────────────────────────────────────

    function test_claimTile() public {
        uint96 deposit = _minDeposit(BASE_PRICE);
        vm.prank(alice);
        rush.claimTile{value: deposit}(0, BASE_PRICE);

        IRushTiles.TileData memory t = rush.getTile(0);
        assertEq(t.owner, alice);
        assertEq(t.price, BASE_PRICE);
        assertEq(t.deposit, deposit);
        assertGt(t.lastTaxTime, 0);
        assertGt(t.lastBuyoutTime, 0);
    }

    function test_claimTileFirstFree() public {
        uint96 deposit = _minDeposit(BASE_PRICE);
        uint256 balBefore = alice.balance;

        vm.prank(alice);
        rush.claimTile{value: deposit}(0, BASE_PRICE);

        // No claim fee charged — all msg.value goes to deposit
        assertEq(alice.balance, balBefore - deposit);
        assertEq(rush.treasuryBalance(), 0);
    }

    function test_claimTileSecondPaysFee() public {
        uint96 deposit = _minDeposit(BASE_PRICE);

        vm.prank(alice);
        rush.claimTile{value: deposit}(0, BASE_PRICE);

        // Second tile: 10% claim fee
        uint96 fee2    = uint96((uint256(BASE_PRICE) * 1000) / 10_000);
        uint96 deposit2 = _minDeposit(BASE_PRICE);
        uint256 balBefore = alice.balance;

        vm.prank(alice);
        rush.claimTile{value: uint256(deposit2) + uint256(fee2)}(1, BASE_PRICE);

        assertEq(alice.balance, balBefore - deposit2 - fee2);
        assertEq(rush.treasuryBalance(), fee2);
    }

    function test_claimRevertsIfAlreadyOwned() public {
        _claim(alice, 0, BASE_PRICE);
        uint96 deposit = _minDeposit(BASE_PRICE);
        vm.prank(bob);
        vm.expectRevert(IRushTiles.TileAlreadyOwned.selector);
        rush.claimTile{value: deposit}(0, BASE_PRICE);
    }

    function test_claimRevertsIfPriceTooLow() public {
        uint96 deposit = _minDeposit(MIN_PRICE);
        vm.prank(alice);
        vm.expectRevert(IRushTiles.ZeroPriceNotAllowed.selector);
        rush.claimTile{value: deposit}(0, uint80(MIN_PRICE - 1));
    }

    function test_claimRevertsIfInsufficientDeposit() public {
        vm.prank(alice);
        vm.expectRevert(IRushTiles.InsufficientDeposit.selector);
        rush.claimTile{value: 0}(0, BASE_PRICE);
    }

    // ── Buyout Tests ──────────────────────────────────────────────────────

    function test_buyoutTile() public {
        _claim(alice, 0, BASE_PRICE);

        uint80 newPrice  = BASE_PRICE; // same price → no appreciation tax
        uint256 buyoutFee = (uint256(BASE_PRICE) * 1000) / 10_000;
        uint96  minDep    = _minDeposit(newPrice);
        uint256 totalCost = uint256(BASE_PRICE) + buyoutFee + minDep;

        uint256 aliceBefore = alice.balance;
        vm.prank(bob);
        rush.buyoutTile{value: totalCost}(0, newPrice);

        IRushTiles.TileData memory t = rush.getTile(0);
        assertEq(t.owner, bob);
        assertEq(t.price, newPrice);

        // Alice receives: effPrice + her deposit
        uint96 aliceDeposit = _minDeposit(BASE_PRICE);
        assertEq(alice.balance, aliceBefore + uint256(BASE_PRICE) + uint256(aliceDeposit));
    }

    function test_buyoutFeeSplit() public {
        _claim(alice, 0, BASE_PRICE);

        // Buy at 2x price → appreciation tax applies
        uint80 newPrice   = uint80(uint256(BASE_PRICE) * 2);
        uint256 effPrice  = uint256(BASE_PRICE); // no decay yet
        uint256 buyoutFee = (effPrice * 1000) / 10_000;
        uint256 appTax    = ((uint256(newPrice) - effPrice) * 3000) / 10_000;
        uint96  minDep    = _minDeposit(newPrice);
        uint256 totalCost = effPrice + buyoutFee + appTax + minDep;

        vm.prank(bob);
        rush.buyoutTile{value: totalCost}(0, newPrice);

        // Buyout fee → treasury; appreciation tax → dev
        assertEq(rush.treasuryBalance(), buyoutFee);
        assertEq(rush.devPending(), appTax);
    }

    function test_revertBuyoutSelf() public {
        _claim(alice, 0, BASE_PRICE);

        vm.prank(alice);
        vm.expectRevert(IRushTiles.CannotBuyoutSelf.selector);
        rush.buyoutTile{value: 10 ether}(0, BASE_PRICE);
    }

    function test_revertBuyoutUnowned() public {
        vm.prank(bob);
        vm.expectRevert(IRushTiles.TileNotOwned.selector);
        rush.buyoutTile{value: 10 ether}(0, BASE_PRICE);
    }

    function test_revertBuyoutMaxPriceIncrease() public {
        _claim(alice, 0, BASE_PRICE);

        uint80 tooHigh = uint80(uint256(BASE_PRICE) * 4); // > 3x
        uint96 minDep  = _minDeposit(tooHigh);
        vm.prank(bob);
        vm.expectRevert(IRushTiles.PriceIncreaseTooLarge.selector);
        rush.buyoutTile{value: 50 ether}(0, tooHigh);
    }

    // ── Abandon Tests ─────────────────────────────────────────────────────

    function test_abandonTile() public {
        uint96 deposit = _minDeposit(BASE_PRICE);
        vm.prank(alice);
        rush.claimTile{value: deposit}(0, BASE_PRICE);

        uint256 balBefore = alice.balance;
        vm.prank(alice);
        rush.abandonTile(0);

        IRushTiles.TileData memory t = rush.getTile(0);
        assertEq(t.owner, address(0));

        // Alice gets remaining deposit back (may be slightly less due to tax)
        assertGt(alice.balance, balBefore);
    }

    function test_revertAbandonNotOwner() public {
        _claim(alice, 0, BASE_PRICE);
        vm.prank(bob);
        vm.expectRevert(IRushTiles.NotTileOwner.selector);
        rush.abandonTile(0);
    }

    // ── Harberger Tax Tests ───────────────────────────────────────────────

    function test_harbergerTax() public {
        _claim(alice, 0, BASE_PRICE);

        // Advance 1 week
        vm.warp(block.timestamp + 7 days);

        uint256 treasuryBefore = rush.treasuryBalance();
        rush.pokeTax(0);
        uint256 treasuryAfter = rush.treasuryBalance();

        // 1 week at 5% → ~0.005 ether tax (all to treasury)
        uint256 expectedTax = (uint256(BASE_PRICE) * 500) / 10_000;
        assertApproxEqAbs(treasuryAfter - treasuryBefore, expectedTax, 100);
    }

    function test_harbergerTaxGoesToTreasury() public {
        _claim(alice, 0, BASE_PRICE);
        vm.warp(block.timestamp + 7 days);

        rush.pokeTax(0);

        // 0% dev cut — all tax to treasury
        assertEq(rush.devPending(), 0);
        assertGt(rush.treasuryBalance(), 0);
    }

    function test_taxForeclosure() public {
        // Claim with exactly the minimum deposit (1 week of tax)
        uint96 deposit = _minDeposit(BASE_PRICE);
        vm.prank(alice);
        rush.claimTile{value: deposit}(0, BASE_PRICE);

        // Advance 2 weeks — deposit will be exhausted
        vm.warp(block.timestamp + 14 days);

        rush.pokeTax(0);

        IRushTiles.TileData memory t = rush.getTile(0);
        assertEq(t.owner, address(0), "tile should be foreclosed");
        assertEq(rush.totalActiveTiles(), 0);
    }

    // ── Price Decay Tests ─────────────────────────────────────────────────

    function test_priceDecay() public {
        _claim(alice, 0, BASE_PRICE);

        // After exactly one PRICE_DECAY_PERIOD (2 weeks), price should be 80% of original
        vm.warp(block.timestamp + 14 days);

        uint80 decayed = rush.effectivePrice(0);
        uint256 expected = (uint256(BASE_PRICE) * 8000) / 10_000;
        assertApproxEqAbs(decayed, expected, 1e12); // small rounding tolerance
    }

    function test_priceDecayFloor() public {
        _claim(alice, 0, BASE_PRICE);

        // Advance far into the future — should hit 10% floor
        vm.warp(block.timestamp + 365 days);

        uint80 decayed = rush.effectivePrice(0);
        uint256 floor  = uint256(BASE_PRICE) / 10;
        assertGe(decayed, floor);
    }

    function test_priceNoDecayBeforeBuyout() public {
        _claim(alice, 0, BASE_PRICE);

        // Immediately after claim: no decay because lastBuyoutTime == block.timestamp
        uint80 eff = rush.effectivePrice(0);
        assertEq(eff, BASE_PRICE);
    }

    // ── Max Price Increase Tests ──────────────────────────────────────────

    function test_maxPriceIncrease() public {
        _claim(alice, 0, BASE_PRICE);

        // 3x is allowed
        uint80 triplePrice = uint80(uint256(BASE_PRICE) * 3);
        uint256 appTax     = ((uint256(triplePrice) - uint256(BASE_PRICE)) * 3000) / 10_000;

        vm.prank(alice);
        rush.setPrice{value: appTax}(0, triplePrice);

        assertEq(rush.getTile(0).price, triplePrice);
    }

    function test_maxPriceIncreaseRevertsAbove3x() public {
        _claim(alice, 0, BASE_PRICE);

        uint80 tooHigh = uint80(uint256(BASE_PRICE) * 3 + 1);
        vm.prank(alice);
        vm.expectRevert(IRushTiles.PriceIncreaseTooLarge.selector);
        rush.setPrice{value: 10 ether}(0, tooHigh);
    }

    // ── setPrice Appreciation Tax Tests ──────────────────────────────────

    function test_appreciationTaxOnSetPrice() public {
        _claim(alice, 0, BASE_PRICE);

        uint80 newPrice = uint80(uint256(BASE_PRICE) * 2);
        uint256 appTax  = ((uint256(newPrice) - uint256(BASE_PRICE)) * 3000) / 10_000;

        uint256 devBefore = rush.devPending();
        vm.prank(alice);
        rush.setPrice{value: appTax}(0, newPrice);

        assertEq(rush.devPending(), devBefore + appTax);
    }

    function test_setPrice_noTaxWhenLowering() public {
        _claim(alice, 0, BASE_PRICE);

        uint80 lowerPrice = uint80(uint256(BASE_PRICE) / 2);

        uint256 devBefore      = rush.devPending();
        uint256 treasuryBefore = rush.treasuryBalance();

        vm.prank(alice);
        rush.setPrice(0, lowerPrice);

        // No fees charged when lowering
        assertEq(rush.devPending(), devBefore);
        assertEq(rush.treasuryBalance(), treasuryBefore);
        assertEq(rush.getTile(0).price, lowerPrice);
    }

    function test_setPriceRevertsInsufficientAppTax() public {
        _claim(alice, 0, BASE_PRICE);

        uint80 newPrice = uint80(uint256(BASE_PRICE) * 2);
        uint256 appTax  = ((uint256(newPrice) - uint256(BASE_PRICE)) * 3000) / 10_000;

        vm.prank(alice);
        vm.expectRevert(IRushTiles.InsufficientPayment.selector);
        rush.setPrice{value: appTax - 1}(0, newPrice);
    }

    // ── Deposit Tests ─────────────────────────────────────────────────────

    function test_depositAddWithdraw() public {
        uint96 initDeposit = _minDeposit(BASE_PRICE);
        vm.prank(alice);
        rush.claimTile{value: initDeposit}(0, BASE_PRICE);

        // Add more deposit
        vm.prank(alice);
        rush.addDeposit{value: 0.05 ether}(0);

        IRushTiles.TileData memory t = rush.getTile(0);
        assertEq(t.deposit, initDeposit + 0.05 ether);

        // Withdraw some (tax first)
        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        rush.withdrawDeposit(0, 0.01 ether);

        assertEq(alice.balance, aliceBefore + 0.01 ether);
    }

    function test_withdrawRevertsExceedsDeposit() public {
        uint96 deposit = _minDeposit(BASE_PRICE);
        vm.prank(alice);
        rush.claimTile{value: deposit}(0, BASE_PRICE);

        vm.prank(alice);
        vm.expectRevert(IRushTiles.WithdrawExceedsAvailable.selector);
        rush.withdrawDeposit(0, deposit + 1);
    }

    // ── Fee Distribution Tests ────────────────────────────────────────────

    function test_distributeFees() public {
        _claim(alice, 0, BASE_PRICE);

        // Poke tax to fill treasury
        vm.warp(block.timestamp + 7 days);
        rush.pokeTax(0);

        uint96 treasury = rush.treasuryBalance();
        assertGt(treasury, 0);

        rush.distributeFees();

        assertEq(rush.treasuryBalance(), 0);
        assertGt(rush.totalDistributed(), 0);
    }

    function test_claimFees() public {
        _claim(alice, 0, BASE_PRICE);

        vm.warp(block.timestamp + 7 days);
        rush.pokeTax(0);
        rush.distributeFees();

        uint256 balBefore = alice.balance;
        vm.prank(alice);
        rush.claimFees();

        assertGt(alice.balance, balBefore);
    }

    function test_proportionalFees() public {
        // Alice claims 3 tiles, Bob claims 1 tile
        _claim(alice, 0, BASE_PRICE);
        _claim(alice, 1, BASE_PRICE);
        _claim(alice, 2, BASE_PRICE);
        _claim(bob,   3, BASE_PRICE);

        // Add 4 ETH directly to treasury manually (bypass time warp complexity)
        vm.deal(address(rush), address(rush).balance + 4 ether);
        // Simulate manual treasury fill
        vm.prank(authority);
        // Use a direct ETH send to fill treasury via receive()
        // Actually send ETH via receive: at 4 tiles, distribute equally
        // Instead let's just distribute fees by sending ETH via receive
        // totalActiveTiles = 4. Send 4 ether → 1 ether per tile
        (bool ok,) = address(rush).call{value: 4 ether}("");
        assertTrue(ok);

        // Alice should get 3x more than Bob
        uint96 alicePending = rush.pendingFees(alice);
        uint96 bobPending   = rush.pendingFees(bob);

        assertApproxEqAbs(alicePending, bobPending * 3, 1000);
    }

    function test_receiveETH() public {
        _claim(alice, 0, BASE_PRICE);
        _claim(bob,   1, BASE_PRICE);

        uint256 distBefore = rush.totalDistributed();

        // Send 1 ETH directly to contract
        (bool ok,) = address(rush).call{value: 1 ether}("");
        assertTrue(ok);

        // Should distribute immediately to holders
        assertEq(rush.totalDistributed(), distBefore + 1 ether);
    }

    function test_receiveETHNoHolders() public {
        // No tiles owned — ETH parks in treasury
        (bool ok,) = address(rush).call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(rush.treasuryBalance(), 1 ether);
    }

    function test_distributeFeesRevertsZero() public {
        vm.expectRevert(IRushTiles.ZeroAmount.selector);
        rush.distributeFees();
    }

    // ── Max Tiles Per Wallet Tests ────────────────────────────────────────

    function test_maxTilesPerWallet() public {
        // Claim 5 tiles successfully
        for (uint8 i = 0; i < 5; i++) {
            _claim(alice, i, BASE_PRICE);
        }

        IRushTiles.PlayerState memory ps = rush.getPlayer(alice);
        assertEq(ps.tileCount, 5);

        // 6th claim must revert — call claimTile directly to avoid getPlayer consuming expectRevert
        uint96 fee6    = uint96((uint256(BASE_PRICE) * 1000) / 10_000);
        uint96 deposit6 = _minDeposit(BASE_PRICE);
        vm.prank(alice);
        vm.expectRevert(IRushTiles.MaxTilesReached.selector);
        rush.claimTile{value: uint256(deposit6) + uint256(fee6)}(5, BASE_PRICE);
    }

    function test_maxTilesPerWalletBuyout() public {
        // Alice fills up to 5
        for (uint8 i = 0; i < 5; i++) {
            _claim(alice, i, BASE_PRICE);
        }
        // Bob owns tile 5
        _claim(bob, 5, BASE_PRICE);

        // Alice cannot buyout Bob's tile
        uint256 buyoutFee = (uint256(BASE_PRICE) * 1000) / 10_000;
        uint96  minDep    = _minDeposit(BASE_PRICE);
        vm.prank(alice);
        vm.expectRevert(IRushTiles.MaxTilesReached.selector);
        rush.buyoutTile{value: uint256(BASE_PRICE) + buyoutFee + minDep}(5, BASE_PRICE);
    }

    // ── Dev Fee Tests ─────────────────────────────────────────────────────

    function test_claimDevFees() public {
        // Generate dev fees via appreciation tax on buyout
        _claim(alice, 0, BASE_PRICE);

        uint80 newPrice   = uint80(uint256(BASE_PRICE) * 2);
        uint256 buyoutFee = (uint256(BASE_PRICE) * 1000) / 10_000;
        uint256 appTax    = ((uint256(newPrice) - uint256(BASE_PRICE)) * 3000) / 10_000;
        uint96  minDep    = _minDeposit(newPrice);

        vm.prank(bob);
        rush.buyoutTile{value: uint256(BASE_PRICE) + buyoutFee + appTax + minDep}(0, newPrice);

        uint96 devFees    = rush.devPending();
        assertGt(devFees, 0);

        uint256 devBefore = dev.balance;
        vm.prank(dev);
        rush.claimDevFees();

        assertEq(dev.balance, devBefore + devFees);
        assertEq(rush.devPending(), 0);
    }

    function test_claimDevFeesRevertsUnauthorized() public {
        vm.prank(alice);
        vm.expectRevert(IRushTiles.NotAuthority.selector);
        rush.claimDevFees();
    }

    // ── Pending Fees View ─────────────────────────────────────────────────

    function test_pendingFeesView() public {
        _claim(alice, 0, BASE_PRICE);

        vm.warp(block.timestamp + 7 days);
        rush.pokeTax(0);

        // Before distribution, no unsettled rewards in globalRewardPerShare
        assertEq(rush.pendingFees(alice), 0);

        // Distribute
        rush.distributeFees();

        // Now alice should have pending fees
        assertGt(rush.pendingFees(alice), 0);
    }

    // ── Admin Tests ───────────────────────────────────────────────────────

    function test_setPaused() public {
        vm.prank(authority);
        rush.setPaused(true);

        vm.prank(alice);
        vm.expectRevert(IRushTiles.Paused.selector);
        rush.claimTile{value: 1 ether}(0, BASE_PRICE);
    }

    function test_setDevWallet() public {
        address newDev = makeAddr("newDev");
        vm.prank(authority);
        rush.setDevWallet(newDev);
        assertEq(rush.devWallet(), newDev);
    }

    function test_setDevWalletRevertsZeroAddress() public {
        vm.prank(authority);
        vm.expectRevert(IRushTiles.ZeroAddress.selector);
        rush.setDevWallet(address(0));
    }

    function test_setPausedRevertsNonAuthority() public {
        vm.prank(alice);
        vm.expectRevert(IRushTiles.NotAuthority.selector);
        rush.setPaused(true);
    }

    function test_executeRevertsOnSelf() public {
        vm.prank(authority);
        vm.expectRevert(IRushTiles.InvalidTarget.selector);
        rush.execute(address(rush), 0, "");
    }

    // ── Valid Tile Bounds ─────────────────────────────────────────────────

    function test_revertInvalidTileIndex() public {
        vm.prank(alice);
        vm.expectRevert(IRushTiles.InvalidTile.selector);
        rush.claimTile{value: 1 ether}(100, BASE_PRICE);
    }

    // ── pokeTax ──────────────────────────────────────────────────────────

    function test_pokeTaxNoopOnEmpty() public {
        // Should not revert on unowned tile
        rush.pokeTax(0);
    }

    // ── getAllTiles ───────────────────────────────────────────────────────

    function test_getAllTiles() public {
        _claim(alice, 0, BASE_PRICE);
        _claim(bob,   1, BASE_PRICE);

        IRushTiles.TileData[100] memory all = rush.getAllTiles();
        assertEq(all[0].owner, alice);
        assertEq(all[1].owner, bob);
        assertEq(all[2].owner, address(0));
    }

    // ── getPlayer ─────────────────────────────────────────────────────────

    function test_getPlayerUninitializedSlotsNormalized() public view {
        IRushTiles.PlayerState memory ps = rush.getPlayer(alice);
        // All slots should be EMPTY_SLOT (0xFF) for fresh address
        for (uint8 i = 0; i < 5; i++) {
            assertEq(ps.tilesOwned[i], 0xFF);
        }
    }

    // ── ERC721 Receiver ───────────────────────────────────────────────────

    function test_onERC721Received() public {
        bytes4 expected = bytes4(keccak256("onERC721Received(address,address,uint256,bytes)"));
        bytes4 actual   = rush.onERC721Received(address(0), address(0), 42, "");
        assertEq(actual, expected);
        // Should register the MemeStream NFT
        assertEq(rush.memeStreamNFT(), address(this));
        assertEq(rush.memeStreamTokenId(), 42);
    }

    function test_onERC721Received_onlyFirstRegistered() public {
        rush.onERC721Received(address(0), address(0), 42, "");
        assertEq(rush.memeStreamTokenId(), 42);
        // Second call should NOT overwrite
        rush.onERC721Received(address(0), address(0), 99, "");
        assertEq(rush.memeStreamTokenId(), 42);
    }
}
