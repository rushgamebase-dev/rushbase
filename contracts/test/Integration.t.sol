// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {OracleRegistry} from "../src/OracleRegistry.sol";
import {DataAttestation} from "../src/DataAttestation.sol";
import {ConsensusEngine} from "../src/ConsensusEngine.sol";
import {DisputeManager} from "../src/DisputeManager.sol";
import {PredictionMarket} from "../src/PredictionMarket.sol";
import {MarketFactory} from "../src/MarketFactory.sol";

contract IntegrationTest is Test {
    OracleRegistry registry;
    DataAttestation attestation;
    ConsensusEngine consensus;
    DisputeManager disputeMgr;
    MarketFactory factory;

    address admin      = address(this);
    address arbitrator = makeAddr("arbitrator");
    address feeWallet  = makeAddr("feeWallet");

    address oracle1 = makeAddr("oracle1");
    address oracle2 = makeAddr("oracle2");
    address oracle3 = makeAddr("oracle3");

    address alice   = makeAddr("alice");
    address bob     = makeAddr("bob");
    address charlie = makeAddr("charlie");

    uint256 constant MIN_STAKE = 1 ether;
    uint256 constant TOLERANCE = 2;
    uint256 constant QUORUM_BPS = 6667;
    uint256 constant DISPUTE_WINDOW = 3600;
    uint256 constant FEE_BPS = 500; // 5%

    string[] labels;
    uint256[] rangeMins;
    uint256[] rangeMaxs;

    function setUp() public {
        vm.warp(1000);
        vm.deal(admin, 100 ether);
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
        vm.deal(charlie, 10 ether);

        // ── Deploy all contracts ──
        registry = new OracleRegistry(MIN_STAKE);
        attestation = new DataAttestation(address(registry));
        consensus = new ConsensusEngine(
            address(attestation),
            address(registry),
            TOLERANCE,
            QUORUM_BPS
        );
        disputeMgr = new DisputeManager(
            address(registry),
            DISPUTE_WINDOW,
            0.01 ether,       // min deposit
            arbitrator,
            feeWallet
        );

        // ── Wire up ──
        registry.setAttestationContract(address(attestation));

        // ── Register 3 oracles ──
        registry.registerOracle{value: 1 ether}(oracle1, "Oracle Alpha");
        registry.registerOracle{value: 1 ether}(oracle2, "Oracle Beta");
        registry.registerOracle{value: 1 ether}(oracle3, "Oracle Gamma");

        // ── Deploy factory (consensus engine is the oracle) ──
        factory = new MarketFactory(
            address(consensus),
            feeWallet,
            FEE_BPS,
            address(0)
        );

        // ── Range setup ──
        labels = new string[](4);
        labels[0] = "0-5"; labels[1] = "6-10"; labels[2] = "11-15"; labels[3] = "16+";

        rangeMins = new uint256[](4);
        rangeMins[0] = 0; rangeMins[1] = 6; rangeMins[2] = 11; rangeMins[3] = 16;

        rangeMaxs = new uint256[](4);
        rangeMaxs[0] = 5; rangeMaxs[1] = 10; rangeMaxs[2] = 15; rangeMaxs[3] = type(uint256).max;
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
            keccak256("streamUrl"),
            keccak256("frame"),
            block.timestamp - 300,
            block.timestamp,
            "yolov8-1.0"
        );
    }

    function _createMarket() internal returns (address) {
        return factory.createMarket(
            "https://youtube.com/live/paulista",
            "Carros na Av. Paulista em 5 min",
            300,
            0.01 ether,
            5 ether,
            labels, rangeMins, rangeMaxs
        );
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  FULL E2E: Deploy -> Register -> Create -> Bet -> Commit -> Reveal
    //            -> Consensus Resolve -> Wait Dispute Window -> Claim
    // ═══════════════════════════════════════════════════════════════════════

    function test_fullEndToEnd() public {
        // 1. Create market
        address mktAddr = _createMarket();
        PredictionMarket mkt = PredictionMarket(payable(mktAddr));

        assertEq(uint(mkt.state()), uint(PredictionMarket.MarketState.OPEN));
        assertTrue(factory.isMarket(mktAddr));

        // 2. Users place bets
        vm.prank(alice);
        mkt.placeBet{value: 1 ether}(1); // bets on 6-10

        vm.prank(bob);
        mkt.placeBet{value: 1 ether}(2); // bets on 11-15

        vm.prank(charlie);
        mkt.placeBet{value: 0.5 ether}(1); // also bets on 6-10

        assertEq(mkt.totalPool(), 2.5 ether);
        assertEq(mkt.totalBettors(), 3);

        // 3. Oracles commit (all observe 8 cars)
        _commit(oracle1, mktAddr, 8, bytes32("salt_o1"));
        _commit(oracle2, mktAddr, 8, bytes32("salt_o2"));
        _commit(oracle3, mktAddr, 8, bytes32("salt_o3"));

        assertEq(attestation.commitCount(mktAddr), 3);

        // 4. Oracles reveal
        _reveal(oracle1, mktAddr, 8, bytes32("salt_o1"));
        _reveal(oracle2, mktAddr, 8, bytes32("salt_o2"));
        _reveal(oracle3, mktAddr, 8, bytes32("salt_o3"));

        assertEq(attestation.revealCount(mktAddr), 3);

        // 5. Consensus engine resolves
        consensus.checkAndResolve(mktAddr);

        assertTrue(consensus.consensusReached(mktAddr));
        assertEq(consensus.consensusResult(mktAddr), 8);
        assertEq(uint(mkt.state()), uint(PredictionMarket.MarketState.RESOLVED));
        assertEq(mkt.winningRangeIndex(), 1); // 6-10

        // 6. Claims are immediate after resolution (no dispute window)
        assertTrue(mkt.isClaimable());

        // 7. Winners claim
        // Pool = 2.5 ETH, fee = 5% = 0.125 ETH, distributable = 2.375 ETH
        // Winning pool (range 1) = 1.5 ETH (alice 1 + charlie 0.5)
        // Alice share: (1 / 1.5) * 2.375 = 1.583333... ETH
        // Charlie share: (0.5 / 1.5) * 2.375 = 0.791666... ETH

        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        mkt.claimWinnings();
        uint256 alicePayout = alice.balance - aliceBefore;

        uint256 charlieBefore = charlie.balance;
        vm.prank(charlie);
        mkt.claimWinnings();
        uint256 charliePayout = charlie.balance - charlieBefore;

        // Verify proportional payouts (with rounding)
        assertGt(alicePayout, 1.58 ether);
        assertLt(alicePayout, 1.59 ether);
        assertGt(charliePayout, 0.79 ether);
        assertLt(charliePayout, 0.80 ether);

        // Fee collected
        assertEq(feeWallet.balance, 0.125 ether);

        // Bob (loser) cannot claim
        vm.prank(bob);
        vm.expectRevert("NOTHING_TO_CLAIM");
        mkt.claimWinnings();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  RESOLVE THEN CLAIM (no dispute system in MVP)
    // ═══════════════════════════════════════════════════════════════════════

    function test_resolveAndClaimImmediate() public {
        // 1. Create market and place bets
        address mktAddr = _createMarket();
        PredictionMarket mkt = PredictionMarket(payable(mktAddr));

        vm.prank(alice);
        mkt.placeBet{value: 1 ether}(1); // bets on 6-10

        vm.prank(bob);
        mkt.placeBet{value: 1 ether}(2); // bets on 11-15

        // 2. Oracles report 8 cars (range 1 wins)
        _commit(oracle1, mktAddr, 8, bytes32("s1"));
        _commit(oracle2, mktAddr, 8, bytes32("s2"));
        _commit(oracle3, mktAddr, 8, bytes32("s3"));

        _reveal(oracle1, mktAddr, 8, bytes32("s1"));
        _reveal(oracle2, mktAddr, 8, bytes32("s2"));
        _reveal(oracle3, mktAddr, 8, bytes32("s3"));

        // 3. Consensus resolves
        consensus.checkAndResolve(mktAddr);
        assertEq(mkt.winningRangeIndex(), 1); // 6-10

        // 4. Claims are immediately available (no dispute window)
        assertTrue(mkt.isClaimable());

        // 5. Alice (winner) claims immediately after resolution
        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        mkt.claimWinnings();
        uint256 alicePayout = alice.balance - aliceBefore;

        // Pool = 2 ETH, fee = 0.1 ETH, distributable = 1.9 ETH
        // Alice is sole winner of range 1
        assertEq(alicePayout, 1.9 ether);

        // Bob (loser) cannot claim
        vm.prank(bob);
        vm.expectRevert("NOTHING_TO_CLAIM");
        mkt.claimWinnings();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  CANCEL FLOW: Market cancelled -> Users refunded
    // ═══════════════════════════════════════════════════════════════════════

    function test_cancelFlow() public {
        address mktAddr = _createMarket();
        PredictionMarket mkt = PredictionMarket(payable(mktAddr));

        // Users bet
        vm.prank(alice);
        mkt.placeBet{value: 1 ether}(0);

        vm.prank(bob);
        mkt.placeBet{value: 0.5 ether}(2);

        // Consensus engine cancels the market (e.g., stream went down)
        vm.prank(address(consensus));
        mkt.cancelMarket();

        assertEq(uint(mkt.state()), uint(PredictionMarket.MarketState.CANCELLED));

        // All users get full refunds
        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        mkt.refund();
        assertEq(alice.balance - aliceBefore, 1 ether);

        uint256 bobBefore = bob.balance;
        vm.prank(bob);
        mkt.refund();
        assertEq(bob.balance - bobBefore, 0.5 ether);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  DISPUTE EDGE CASES
    // ═══════════════════════════════════════════════════════════════════════

    function test_revertDisputeOutsideWindow() public {
        address mktAddr = _createMarket();
        PredictionMarket mkt = PredictionMarket(payable(mktAddr));

        vm.prank(alice);
        mkt.placeBet{value: 0.5 ether}(1);

        _commit(oracle1, mktAddr, 8, bytes32("s1"));
        _commit(oracle2, mktAddr, 8, bytes32("s2"));
        _commit(oracle3, mktAddr, 8, bytes32("s3"));

        _reveal(oracle1, mktAddr, 8, bytes32("s1"));
        _reveal(oracle2, mktAddr, 8, bytes32("s2"));
        _reveal(oracle3, mktAddr, 8, bytes32("s3"));

        consensus.checkAndResolve(mktAddr);

        // Warp past dispute window
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);

        vm.prank(bob);
        vm.expectRevert("DISPUTE_WINDOW_CLOSED");
        disputeMgr.openDispute{value: 0.01 ether}(
            mktAddr,
            "ipfs://QmTooLate",
            12
        );
    }

    function test_revertDisputeDepositTooLow() public {
        address mktAddr = _createMarket();
        PredictionMarket mkt = PredictionMarket(payable(mktAddr));

        vm.prank(alice);
        mkt.placeBet{value: 0.5 ether}(1);

        _commit(oracle1, mktAddr, 8, bytes32("s1"));
        _commit(oracle2, mktAddr, 8, bytes32("s2"));
        _commit(oracle3, mktAddr, 8, bytes32("s3"));

        _reveal(oracle1, mktAddr, 8, bytes32("s1"));
        _reveal(oracle2, mktAddr, 8, bytes32("s2"));
        _reveal(oracle3, mktAddr, 8, bytes32("s3"));

        consensus.checkAndResolve(mktAddr);

        vm.prank(bob);
        vm.expectRevert("DEPOSIT_TOO_LOW");
        disputeMgr.openDispute{value: 0.001 ether}(
            mktAddr,
            "ipfs://QmEvidence",
            12
        );
    }

    function test_revertDisputeNotResolved() public {
        address mktAddr = _createMarket();

        // Market still OPEN, not resolved
        vm.prank(bob);
        vm.expectRevert("MARKET_NOT_RESOLVED");
        disputeMgr.openDispute{value: 0.01 ether}(
            mktAddr,
            "ipfs://QmEvidence",
            12
        );
    }

    function test_revertDisputeOnlyArbitrator() public {
        address mktAddr = _createMarket();
        PredictionMarket mkt = PredictionMarket(payable(mktAddr));

        vm.prank(alice);
        mkt.placeBet{value: 0.5 ether}(1);

        _commit(oracle1, mktAddr, 8, bytes32("s1"));
        _commit(oracle2, mktAddr, 8, bytes32("s2"));
        _commit(oracle3, mktAddr, 8, bytes32("s3"));

        _reveal(oracle1, mktAddr, 8, bytes32("s1"));
        _reveal(oracle2, mktAddr, 8, bytes32("s2"));
        _reveal(oracle3, mktAddr, 8, bytes32("s3"));

        consensus.checkAndResolve(mktAddr);

        vm.prank(bob);
        disputeMgr.openDispute{value: 0.01 ether}(
            mktAddr,
            "ipfs://QmEvidence",
            12
        );

        // Non-arbitrator tries to resolve
        vm.prank(alice);
        vm.expectRevert("NOT_ARBITRATOR");
        disputeMgr.resolveDispute(0, true);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  ORACLE ATTESTATION TRACKING
    // ═══════════════════════════════════════════════════════════════════════

    function test_oracleAttestationCountTracked() public {
        address mktAddr = _createMarket();

        _commit(oracle1, mktAddr, 8, bytes32("s1"));
        _commit(oracle2, mktAddr, 8, bytes32("s2"));
        _commit(oracle3, mktAddr, 8, bytes32("s3"));

        _reveal(oracle1, mktAddr, 8, bytes32("s1"));
        _reveal(oracle2, mktAddr, 8, bytes32("s2"));
        _reveal(oracle3, mktAddr, 8, bytes32("s3"));

        OracleRegistry.OracleInfo memory info1 = registry.getOracleInfo(oracle1);
        OracleRegistry.OracleInfo memory info2 = registry.getOracleInfo(oracle2);
        OracleRegistry.OracleInfo memory info3 = registry.getOracleInfo(oracle3);

        assertEq(info1.totalAttestations, 1);
        assertEq(info2.totalAttestations, 1);
        assertEq(info3.totalAttestations, 1);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  MULTIPLE MARKETS
    // ═══════════════════════════════════════════════════════════════════════

    function test_multipleMarketsIndependent() public {
        address mkt1Addr = _createMarket();
        address mkt2Addr = _createMarket();

        PredictionMarket mkt1 = PredictionMarket(payable(mkt1Addr));
        PredictionMarket mkt2 = PredictionMarket(payable(mkt2Addr));

        // Bets on market 1
        vm.prank(alice);
        mkt1.placeBet{value: 1 ether}(1); // 6-10

        // Bets on market 2
        vm.prank(bob);
        mkt2.placeBet{value: 1 ether}(2); // 11-15

        // Resolve market 1 with 8 cars
        _commit(oracle1, mkt1Addr, 8, bytes32("m1s1"));
        _commit(oracle2, mkt1Addr, 8, bytes32("m1s2"));
        _commit(oracle3, mkt1Addr, 8, bytes32("m1s3"));

        _reveal(oracle1, mkt1Addr, 8, bytes32("m1s1"));
        _reveal(oracle2, mkt1Addr, 8, bytes32("m1s2"));
        _reveal(oracle3, mkt1Addr, 8, bytes32("m1s3"));

        consensus.checkAndResolve(mkt1Addr);

        // Market 1 resolved, market 2 still open
        assertEq(uint(mkt1.state()), uint(PredictionMarket.MarketState.RESOLVED));
        assertEq(uint(mkt2.state()), uint(PredictionMarket.MarketState.OPEN));

        // Resolve market 2 with 13 cars
        _commit(oracle1, mkt2Addr, 13, bytes32("m2s1"));
        _commit(oracle2, mkt2Addr, 13, bytes32("m2s2"));
        _commit(oracle3, mkt2Addr, 13, bytes32("m2s3"));

        _reveal(oracle1, mkt2Addr, 13, bytes32("m2s1"));
        _reveal(oracle2, mkt2Addr, 13, bytes32("m2s2"));
        _reveal(oracle3, mkt2Addr, 13, bytes32("m2s3"));

        consensus.checkAndResolve(mkt2Addr);

        assertEq(uint(mkt2.state()), uint(PredictionMarket.MarketState.RESOLVED));
        assertEq(mkt2.winningRangeIndex(), 2); // 11-15

        assertEq(factory.getMarketCount(), 2);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  DISPUTE MANAGER VIEW HELPERS
    // ═══════════════════════════════════════════════════════════════════════

    function test_disputeManagerViews() public {
        address mktAddr = _createMarket();
        PredictionMarket mkt = PredictionMarket(payable(mktAddr));

        vm.prank(alice);
        mkt.placeBet{value: 0.5 ether}(1);

        _commit(oracle1, mktAddr, 8, bytes32("s1"));
        _commit(oracle2, mktAddr, 8, bytes32("s2"));
        _commit(oracle3, mktAddr, 8, bytes32("s3"));

        _reveal(oracle1, mktAddr, 8, bytes32("s1"));
        _reveal(oracle2, mktAddr, 8, bytes32("s2"));
        _reveal(oracle3, mktAddr, 8, bytes32("s3"));

        consensus.checkAndResolve(mktAddr);

        assertTrue(disputeMgr.isInDisputeWindow(mktAddr));

        vm.prank(bob);
        disputeMgr.openDispute{value: 0.01 ether}(
            mktAddr,
            "ipfs://QmEvidence",
            12
        );

        uint256[] memory ids = disputeMgr.getDisputesByMarket(mktAddr);
        assertEq(ids.length, 1);

        DisputeManager.Dispute memory d = disputeMgr.getDispute(0);
        assertEq(d.challenger, bob);
        assertEq(d.market, mktAddr);
        assertEq(d.proposedCount, 12);
        assertEq(uint(d.state), uint(DisputeManager.DisputeState.OPEN));

        // After window closes
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        assertFalse(disputeMgr.isInDisputeWindow(mktAddr));
    }
}
