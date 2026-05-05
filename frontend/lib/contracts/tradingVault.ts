/**
 * Minimal ABI for the Rush `TradingVault` — the entry points the
 * frontend touches directly. Full ABI lives in
 * `rush/contracts/out/TradingVault.sol/TradingVault.json` once
 * compiled, and is re-derivable from the Solidity source in
 * `rush/contracts/src/TradingVault.sol`.
 */
export const TRADING_VAULT_ABI = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "sig", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "lastNonce",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "houseBalance",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "depositsPaused",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "withdrawsPaused",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "event",
    name: "Deposited",
    inputs: [
      { indexed: true, name: "user", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "Withdrawn",
    inputs: [
      { indexed: true, name: "user", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "nonce", type: "uint256" },
    ],
  },
] as const;

const RAW =
  process.env.NEXT_PUBLIC_VAULT_ADDRESS ??
  "0x0000000000000000000000000000000000000000";

export const TRADING_VAULT_ADDRESS = RAW as `0x${string}`;

export function isVaultConfigured(): boolean {
  return (
    TRADING_VAULT_ADDRESS !== "0x0000000000000000000000000000000000000000"
  );
}
