// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {TradingVault} from "../src/TradingVault.sol";

/**
 * @notice Deploy TradingVault to Base mainnet (chainId 8453).
 *
 * Required env vars:
 *   PRIVATE_KEY         — deployer key (must have gas on Base)
 *   VAULT_OWNER         — owner address (multisig recommended in prod)
 *   ENGINE_SIGNER       — EOA whose ECDSA sig authorizes withdrawals
 *
 * Optional:
 *   HOUSE_DEPOSIT_WEI   — initial buffer to seed houseBalance (e.g. 50 ETH)
 *                         Sent in the same tx as deployment.
 *   MAX_SINGLE_WITHDRAW — circuit breaker cap per withdraw, in wei.
 *                         0 (default) means no cap.
 *
 * Usage:
 *   forge script script/DeployTradingVault.s.sol \
 *     --rpc-url base \
 *     --broadcast \
 *     --verify
 *
 * After deploy, set the address in:
 *   - rush-engine .env: APP_CHAIN__VAULT_ADDRESS=...
 *   - frontend .env.local: NEXT_PUBLIC_VAULT_ADDRESS=...
 */
contract DeployTradingVaultScript is Script {
    function run() external {
        uint256 key = vm.envUint("PRIVATE_KEY");
        address owner = vm.envAddress("VAULT_OWNER");
        address signer = vm.envAddress("ENGINE_SIGNER");
        uint256 houseSeed = vm.envOr("HOUSE_DEPOSIT_WEI", uint256(0));
        uint256 maxWithdraw = vm.envOr("MAX_SINGLE_WITHDRAW", uint256(0));

        require(owner != address(0), "VAULT_OWNER must be set");
        require(signer != address(0), "ENGINE_SIGNER must be set");

        vm.startBroadcast(key);

        TradingVault vault = new TradingVault(owner, signer);
        console.log("TradingVault deployed at:", address(vault));
        console.log("  owner:", owner);
        console.log("  engineSigner:", signer);
        console.log("  chainId:", block.chainid);

        if (maxWithdraw > 0) {
            // Owner-only — only callable if deployer == owner. Otherwise
            // skipped here and must be set post-deploy by the owner.
            if (owner == vm.addr(key)) {
                vault.setMaxSingleWithdraw(maxWithdraw);
                console.log("  maxSingleWithdraw:", maxWithdraw);
            } else {
                console.log("  maxSingleWithdraw: SKIPPED (deployer != owner)");
            }
        }

        if (houseSeed > 0) {
            vault.houseDeposit{value: houseSeed}();
            console.log("  houseBalance seeded:", houseSeed);
        }

        vm.stopBroadcast();

        console.log("");
        console.log("=== NEXT STEPS ===");
        console.log("1. Set in rush-engine .env:");
        console.log("   APP_CHAIN__VAULT_ADDRESS=", address(vault));
        console.log("2. Set in frontend .env.local:");
        console.log("   NEXT_PUBLIC_VAULT_ADDRESS=", address(vault));
        console.log("3. Verify on Basescan (if --verify omitted).");
        console.log("4. If owner is multisig, transfer ownership now.");
    }
}
