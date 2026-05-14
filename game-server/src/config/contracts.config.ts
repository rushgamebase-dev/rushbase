// ============================================
// CONTRACT CONFIGURATION - Base Mainnet
// ============================================

import { base } from 'viem/chains';

export const CHAIN = base;

const envAddress = (name: string, fallback: `0x${string}`): `0x${string}` =>
  (process.env[name] || fallback) as `0x${string}`;

// Rush Royale contract addresses on Base Mainnet.
export const CONTRACT_ADDRESSES = {
  AGENT_REGISTRY: envAddress('AGENT_REGISTRY_ADDRESS', '0x99ce3Ad5cEd0630011B761a590AEB3f8EA653e24'),
  ARENA_MANAGER: envAddress('ARENA_MANAGER_ADDRESS', '0xa8452224F005a3e79f391296cD798B6a79724A63'),
  BATTLE_ENGINE: envAddress('BATTLE_ENGINE_ADDRESS', '0xFA1a670Ff366faA63E87A6b8977dfe5DC22C23Ed'),
  VRF_WRAPPER: envAddress('VRF_WRAPPER_ADDRESS', '0xb0407dbe851f8318bd31404A49e658143C982F23'),
  CHAMPIONSHIP_TROPHY: envAddress('CHAMPIONSHIP_TROPHY_ADDRESS', '0x4d2C1422Dc6B66C6A771123d63adC475439e84f3'),
} as const;

// Retry configuration for blockchain operations
export const RETRY_CONFIG = {
  MAX_RETRIES: 3,
  INITIAL_BACKOFF_MS: 1000,
  MAX_BACKOFF_MS: 10000,
  BACKOFF_MULTIPLIER: 2,
} as const;

// Circuit breaker configuration
export const CIRCUIT_BREAKER_CONFIG = {
  FAILURE_THRESHOLD: 5,
  WINDOW_MS: 10 * 60 * 1000, // 10 minutes
  RESET_TIMEOUT_MS: 60 * 1000, // 1 minute
} as const;

// Gas configuration
export const GAS_CONFIG = {
  // Add 20% buffer to estimated gas
  GAS_LIMIT_MULTIPLIER: 1.2,
  // Max priority fee per gas (in gwei)
  MAX_PRIORITY_FEE_GWEI: 2,
} as const;
