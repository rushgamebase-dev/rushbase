/**
 * RushStaking — single-sided $RUSH staking with ETH rewards.
 * Synthetix accumulator pattern. earned() ticks live every second.
 *
 * Deployment: Base mainnet, 2026-05-06
 *   contract: 0x65f05974b1fEec584F6FF47038C6d1FF06E32548
 *   $RUSH:    0xB36A127dBa73F3aA7C70B4e00B7395B86A60e73b
 *   owner:    0x981f26bD8F90f3E755Df229888f383E725A52dCA
 */

export const RUSH_STAKING_ADDRESS =
  "0x65f05974b1fEec584F6FF47038C6d1FF06E32548" as `0x${string}`;

export const RUSH_TOKEN_ADDRESS =
  "0xB36A127dBa73F3aA7C70B4e00B7395B86A60e73b" as `0x${string}`;

export const RUSH_STAKING_ABI = [
  // ── reads ────────────────────────────────────────────────────────
  {
    type: "function",
    name: "rush",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "totalStaked",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "balances",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "earned",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "rewardRate",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "periodFinish",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "rewardsDuration",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "rewardPerToken",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },

  // ── writes ───────────────────────────────────────────────────────
  {
    type: "function",
    name: "stake",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "exit",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },

  // ── events ───────────────────────────────────────────────────────
  {
    type: "event",
    name: "Staked",
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
    ],
  },
  {
    type: "event",
    name: "Claimed",
    inputs: [
      { indexed: true, name: "user", type: "address" },
      { indexed: false, name: "ethAmount", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "RewardAdded",
    inputs: [
      { indexed: false, name: "ethAmount", type: "uint256" },
      { indexed: false, name: "newRewardRate", type: "uint256" },
      { indexed: false, name: "periodFinish", type: "uint256" },
    ],
  },
] as const;

export const ERC20_MIN_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;
