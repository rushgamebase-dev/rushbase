// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MarketFactory} from "../src/MarketFactory.sol";
import {RushTiles} from "../src/RushTiles.sol";

/**
 * @notice Deploy the Rush MVP stack (single oracle, ETH only)
 *
 * Required env vars:
 *   PRIVATE_KEY        — deployer private key (deployer IS the oracle for MVP)
 *   FEE_RECIPIENT      — address that receives market fees
 *
 * Optional:
 *   FEE_BPS            — fee in basis points (default 500 = 5%)
 *
 * Usage:
 *   forge script script/Deploy.s.sol --broadcast --rpc-url https://mainnet.base.org
 */
contract DeployScript is Script {
    function run() external {
        uint256 key = vm.envUint("PRIVATE_KEY");
        address oracle = vm.addr(key); // deployer IS the oracle
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        uint256 feeBps = vm.envOr("FEE_BPS", uint256(500));

        vm.startBroadcast(key);

        // 1. Market Factory (ETH mode, configurable fee)
        MarketFactory factory = new MarketFactory(oracle, feeRecipient, feeBps);
        console.log("MarketFactory:", address(factory));

        // 2. RushTiles
        RushTiles tiles = new RushTiles(feeRecipient);
        console.log("RushTiles:", address(tiles));

        console.log("");
        console.log("=== DEPLOY COMPLETE ===");
        console.log("Oracle (deployer):", oracle);
        console.log("FeeRecipient:", feeRecipient);
        console.log("FeeBps:", feeBps);
        console.log("Set these in your frontend/oracle config:");
        console.log("  FACTORY_ADDRESS=", address(factory));
        console.log("  RUSH_TILES_ADDRESS=", address(tiles));

        vm.stopBroadcast();
    }
}
