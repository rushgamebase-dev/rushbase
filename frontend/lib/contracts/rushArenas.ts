import { parseAbi } from "viem";

export const RUSH_ARENAS_CONTRACTS = {
  agentRegistry: "0x99ce3Ad5cEd0630011B761a590AEB3f8EA653e24",
  arenaManager: "0xa8452224F005a3e79f391296cD798B6a79724A63",
  battleEngine: "0xFA1a670Ff366faA63E87A6b8977dfe5DC22C23Ed",
  championshipTrophy: "0x4d2C1422Dc6B66C6A771123d63adC475439e84f3",
} as const satisfies Record<string, `0x${string}`>;

export const AGENT_REGISTRY_ABI = parseAbi([
  "function totalAgents() view returns (uint256)",
  "function creationFee() view returns (uint256)",
]);

export const ARENA_MANAGER_ABI = parseAbi([
  "function totalArenas() view returns (uint256)",
]);

export const BATTLE_ENGINE_ABI = parseAbi([
  "function protocolFeeBps() view returns (uint256)",
  "function treasuryAddress() view returns (address)",
  "function revealDelay() view returns (uint256)",
]);

export function basescanAddressUrl(address: `0x${string}`) {
  return `https://basescan.org/address/${address}`;
}
