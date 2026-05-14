// ============================================
// BLOCKCHAIN SERVICE - Viem client management
// ============================================

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { CHAIN, CONTRACT_ADDRESSES } from '../config/contracts.config';

import ArenaManagerAbi from './abis/ArenaManager.json';
import BattleEngineAbi from './abis/BattleEngine.json';
import AgentRegistryAbi from './abis/AgentRegistry.json';
import ChampionshipTrophyAbi from './abis/ChampionshipTrophy.json';

export { ArenaManagerAbi, BattleEngineAbi, AgentRegistryAbi, ChampionshipTrophyAbi };

// Re-export for type safety
export const ABIS = {
  ArenaManager: ArenaManagerAbi as readonly unknown[],
  BattleEngine: BattleEngineAbi as readonly unknown[],
  AgentRegistry: AgentRegistryAbi as readonly unknown[],
  ChampionshipTrophy: ChampionshipTrophyAbi as readonly unknown[],
} as const;

// Types for contract participant data
export interface ArenaParticipant {
  agentId: bigint;
  owner: Address;
  boostIds: readonly bigint[];
  joinedAt: bigint;
  eliminated: boolean;
  eliminatedRound: bigint;
}

export interface ArenaData {
  arenaId: bigint;
  tier: number;
  entryFee: bigint;
  minPlayers: bigint;
  maxPlayers: bigint;
  registrationStart: bigint;
  registrationEnd: bigint;
  prizePool: bigint;
  state: number;
  creator: Address;
  vrfRequestId: bigint;
  seed: bigint;
  winnerId: bigint;
}

@Injectable()
export class BlockchainService implements OnModuleInit {
  private readonly logger = new Logger(BlockchainService.name);
  private publicClient: any;
  private walletClient: any = null;
  private executorAccount: any = null;

  constructor(private configService: ConfigService) {
    // Initialize public client (read-only)
    const rpcUrl = this.configService.get<string>('BASE_RPC_URL') || 'https://mainnet.base.org';

    this.publicClient = createPublicClient({
      chain: CHAIN,
      transport: http(rpcUrl),
    });

    this.logger.log(`BlockchainService initialized for chain: ${CHAIN.name}`);
  }

  async onModuleInit() {
    // Initialize wallet client if private key is available
    const privateKey = this.configService.get<string>('EXECUTOR_PRIVATE_KEY');

    if (privateKey) {
      try {
        this.executorAccount = privateKeyToAccount(privateKey as `0x${string}`);
        const rpcUrl = this.configService.get<string>('BASE_RPC_URL') || 'https://mainnet.base.org';

        this.walletClient = createWalletClient({
          account: this.executorAccount,
          chain: CHAIN,
          transport: http(rpcUrl),
        });

        this.logger.log(`Wallet client initialized with executor: ${this.executorAccount.address}`);
      } catch (error) {
        this.logger.error('Failed to initialize wallet client', error);
      }
    } else {
      this.logger.warn('EXECUTOR_PRIVATE_KEY not set - write operations will fail');
    }
  }

  // =============================================================
  //                       GETTERS
  // =============================================================

  getPublicClient(): any {
    return this.publicClient;
  }

  getWalletClient(): any {
    if (!this.walletClient) {
      throw new Error('Wallet client not initialized - EXECUTOR_PRIVATE_KEY not set');
    }
    return this.walletClient;
  }

  getExecutorAddress(): Address {
    if (!this.executorAccount) {
      throw new Error('Executor account not initialized');
    }
    return this.executorAccount.address;
  }

  // =============================================================
  //                    CONTRACT ADDRESSES
  // =============================================================

  get arenaManagerAddress(): Address {
    return CONTRACT_ADDRESSES.ARENA_MANAGER;
  }

  get battleEngineAddress(): Address {
    return CONTRACT_ADDRESSES.BATTLE_ENGINE;
  }

  get agentRegistryAddress(): Address {
    return CONTRACT_ADDRESSES.AGENT_REGISTRY;
  }

  get championshipTrophyAddress(): Address {
    return CONTRACT_ADDRESSES.CHAMPIONSHIP_TROPHY;
  }

  // =============================================================
  //                       READ OPERATIONS
  // =============================================================

  async getArena(arenaId: bigint): Promise<ArenaData> {
    const result = await this.publicClient.readContract({
      address: this.arenaManagerAddress,
      abi: ABIS.ArenaManager,
      functionName: 'getArena',
      args: [arenaId],
    });
    return result as ArenaData;
  }

  async getArenaParticipants(arenaId: bigint): Promise<ArenaParticipant[]> {
    const result = await this.publicClient.readContract({
      address: this.arenaManagerAddress,
      abi: ABIS.ArenaManager,
      functionName: 'getArenaParticipants',
      args: [arenaId],
    });
    return result as ArenaParticipant[];
  }

  async getSeed(arenaId: bigint): Promise<bigint> {
    const result = await this.publicClient.readContract({
      address: this.battleEngineAddress,
      abi: ABIS.BattleEngine,
      functionName: 'getSeed',
      args: [arenaId],
    });
    return result as bigint;
  }

  async getBattleResult(arenaId: bigint): Promise<{
    arenaId: bigint;
    winnerId: bigint;
    totalRounds: bigint;
    seed: bigint;
    resultHash: `0x${string}`;
    executedAt: bigint;
  }> {
    const result = await this.publicClient.readContract({
      address: this.battleEngineAddress,
      abi: ABIS.BattleEngine,
      functionName: 'getBattleResult',
      args: [arenaId],
    });
    return result as {
      arenaId: bigint;
      winnerId: bigint;
      totalRounds: bigint;
      seed: bigint;
      resultHash: `0x${string}`;
      executedAt: bigint;
    };
  }

  /**
   * Get total number of arenas created
   */
  async getTotalArenas(): Promise<bigint> {
    const result = await this.publicClient.readContract({
      address: this.arenaManagerAddress,
      abi: ABIS.ArenaManager,
      functionName: 'totalArenas',
    });
    return result as bigint;
  }

  /**
   * Get multiple arenas in a single call (uses multicall internally)
   */
  async getMultipleArenas(startId: bigint, count: number): Promise<ArenaData[]> {
    const calls: any[] = [];
    for (let i = 0; i < count; i++) {
      const arenaId = startId + BigInt(i);
      calls.push({
        address: this.arenaManagerAddress,
        abi: ABIS.ArenaManager,
        functionName: 'getArena',
        args: [arenaId],
      } as const);
    }

    try {
      const results = await this.publicClient.multicall({
        contracts: calls,
      });

      return results
        .filter((r: any) => r.status === 'success')
        .map((r: any) => r.result as ArenaData);
    } catch (error) {
      this.logger.error('Multicall failed, falling back to sequential calls', error);
      // Fallback to sequential calls
      const arenas: ArenaData[] = [];
      for (let i = 0; i < count; i++) {
        try {
          const arena = await this.getArena(startId + BigInt(i));
          arenas.push(arena);
        } catch {
          // Skip failed individual calls
        }
      }
      return arenas;
    }
  }

  /**
   * Get participant count for an arena
   */
  async getParticipantCount(arenaId: bigint): Promise<bigint> {
    const result = await this.publicClient.readContract({
      address: this.arenaManagerAddress,
      abi: ABIS.ArenaManager,
      functionName: 'getParticipantCount',
      args: [arenaId],
    });
    return result as bigint;
  }

  /**
   * Get BattleEngine ETH balance (for VRF funding check)
   */
  async getBattleEngineBalance(): Promise<bigint> {
    const result = await this.publicClient.getBalance({
      address: this.battleEngineAddress,
    });
    return result as bigint;
  }

  /**
   * Estimate VRF request cost
   */
  async estimateVRFCost(): Promise<bigint> {
    const result = await this.publicClient.readContract({
      address: this.battleEngineAddress,
      abi: ABIS.BattleEngine,
      functionName: 'estimateVRFCost',
    });
    return result as bigint;
  }

  // =============================================================
  //                       HEALTH CHECK
  // =============================================================

  async checkConnection(): Promise<boolean> {
    try {
      const blockNumber = await this.publicClient.getBlockNumber();
      this.logger.log(`Connected to blockchain, current block: ${blockNumber}`);
      return true;
    } catch (error) {
      this.logger.error('Blockchain connection failed', error);
      return false;
    }
  }

  // =============================================================
  //                    AGENT REGISTRY READS
  // =============================================================

  /**
   * Get all agent IDs owned by an address
   */
  async getAgentsByOwner(owner: Address): Promise<bigint[]> {
    const result = await this.publicClient.readContract({
      address: this.agentRegistryAddress,
      abi: ABIS.AgentRegistry,
      functionName: 'getAgentsByOwner',
      args: [owner],
    });
    return result as bigint[];
  }

  /**
   * Get agent details by ID
   */
  async getAgent(agentId: bigint): Promise<{
    owner: Address;
    agentId: bigint;
    createdAt: bigint;
    totalBattles: bigint;
    totalWins: bigint;
    isActive: boolean;
  }> {
    const result = await this.publicClient.readContract({
      address: this.agentRegistryAddress,
      abi: ABIS.AgentRegistry,
      functionName: 'getAgent',
      args: [agentId],
    });
    return result as {
      owner: Address;
      agentId: bigint;
      createdAt: bigint;
      totalBattles: bigint;
      totalWins: bigint;
      isActive: boolean;
    };
  }

  /**
   * Get multiple agents details (for public profile)
   */
  async getAgentsDetails(agentIds: bigint[]): Promise<Array<{
    agentId: bigint;
    totalBattles: bigint;
    totalWins: bigint;
    isActive: boolean;
  }>> {
    if (agentIds.length === 0) return [];

    const calls = agentIds.map((agentId) => ({
      address: this.agentRegistryAddress,
      abi: ABIS.AgentRegistry,
      functionName: 'getAgent',
      args: [agentId],
    }));

    try {
      const results = await this.publicClient.multicall({ contracts: calls });
      return results
        .filter((r: any) => r.status === 'success')
        .map((r: any) => ({
          agentId: r.result.agentId,
          totalBattles: r.result.totalBattles,
          totalWins: r.result.totalWins,
          isActive: r.result.isActive,
        }));
    } catch (error) {
      this.logger.error('Failed to fetch agents details', error);
      return [];
    }
  }
}
