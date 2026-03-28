// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {RushTiles} from "../src/RushTiles.sol";

contract DeployRushTilesScript is Script {
    function run() external {
        uint256 key      = vm.envUint("PRIVATE_KEY");
        address devWallet = vm.envAddress("DEV_WALLET");
        vm.startBroadcast(key);
        new RushTiles(devWallet);
        vm.stopBroadcast();
    }
}
