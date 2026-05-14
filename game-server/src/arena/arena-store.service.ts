// ============================================
// ARENA STORE SERVICE - In-memory state + event replay
// ============================================

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

// Normalized event from on-chain
export interface ChainEvent {
  type: string;
  arenaId: string;
  blockNumber: number;
  txHash: string;
  logIndex: number;
  timestamp: number;
  data: Record<string, any>;
}

// Blockchain artifacts for explorer-grade display
export interface ArenaArtifacts {
  // Arena lifecycle
  arenaId: string;
  createTxHash?: string;
  lockTxHash?: string;

  // VRF
  vrfRequestId?: string;
  vrfRequestTxHash?: string;
  vrfRequestBlockNumber?: number;
  seed?: string;

  // Battle result
  battleResultTxHash?: string;
  battleResultBlockNumber?: number;
  resultHash?: string;

  // Prize distribution
  prizesDistributedTxHash?: string;
  prizesDistributedBlockNumber?: number;
  prizeAmount?: string;

  // Winner info
  winnerId?: string;
  winnerOwner?: string;

  // Cancellation
  cancelTxHash?: string;
}

export type ArenaStoreState =
  | 'unknown'
  | 'created'
  | 'open'
  | 'full'
  | 'locked'
  | 'vrf_pending'
  | 'running'
  | 'finished'
  | 'cancelled';

export interface ArenaSnapshot {
  arenaId: string;
  state: ArenaStoreState;
  artifacts: ArenaArtifacts;
  recentEvents: ChainEvent[];
  participantCount: number;
  maxPlayers?: number;
  participants: Array<{ agentId: string; owner: string; joinTxHash: string }>;
  matchId?: string;
  updatedAt: number;
}

@Injectable()
export class ArenaStoreService {
  private readonly logger = new Logger(ArenaStoreService.name);

  // In-memory store per arena
  private arenas: Map<string, ArenaSnapshot> = new Map();

  // Max events to keep per arena for replay
  private readonly MAX_EVENTS_PER_ARENA = 50;

  // ============================================
  // DATABASE HYDRATION - Restore from PostgreSQL on startup
  // ============================================

  /**
   * Hydrate the in-memory store from PostgreSQL data.
   * Called on startup BEFORE the RPC backfill so data is immediately available.
   */
  hydrateFromDatabase(records: Array<{
    arenaId: string;
    state: string;
    maxPlayers: number;
    totalParticipants: number;
    createTxHash: string | null;
    lockTxHash: string | null;
    vrfRequestId: string | null;
    vrfRequestTxHash: string | null;
    vrfRequestBlock: number | null;
    seed: string | null;
    battleTxHash: string | null;
    battleBlock: number | null;
    resultHash: string | null;
    prizeTxHash: string | null;
    prizeBlock: number | null;
    prizeAmount: string | null;
    winnerId: string | null;
    winnerOwner: string | null;
    cancelTxHash: string | null;
    participants: Array<{ agentId: string; owner: string; joinTxHash: string | null }>;
    events: Array<{ eventType: string; txHash: string; blockNumber: number; logIndex: number; timestamp: Date; data: string }>;
  }>): number {
    let hydrated = 0;

    for (const record of records) {
      // Map Prisma state to ArenaStoreState
      const stateMap: Record<string, ArenaStoreState> = {
        created: 'created',
        open: 'open',
        locked: 'locked',
        running: 'running',
        finished: 'finished',
        cancelled: 'cancelled',
      };

      const state: ArenaStoreState = stateMap[record.state] || 'unknown';

      const snapshot: ArenaSnapshot = {
        arenaId: record.arenaId,
        state,
        maxPlayers: record.maxPlayers,
        participantCount: record.totalParticipants,
        participants: record.participants.map(p => ({
          agentId: p.agentId,
          owner: p.owner,
          joinTxHash: p.joinTxHash || '',
        })),
        artifacts: {
          arenaId: record.arenaId,
          createTxHash: record.createTxHash || undefined,
          lockTxHash: record.lockTxHash || undefined,
          vrfRequestId: record.vrfRequestId || undefined,
          vrfRequestTxHash: record.vrfRequestTxHash || undefined,
          vrfRequestBlockNumber: record.vrfRequestBlock || undefined,
          seed: record.seed || undefined,
          battleResultTxHash: record.battleTxHash || undefined,
          battleResultBlockNumber: record.battleBlock || undefined,
          resultHash: record.resultHash || undefined,
          prizesDistributedTxHash: record.prizeTxHash || undefined,
          prizesDistributedBlockNumber: record.prizeBlock || undefined,
          prizeAmount: record.prizeAmount || undefined,
          winnerId: record.winnerId || undefined,
          winnerOwner: record.winnerOwner || undefined,
          cancelTxHash: record.cancelTxHash || undefined,
        },
        recentEvents: record.events.map(e => ({
          type: e.eventType,
          arenaId: record.arenaId,
          blockNumber: e.blockNumber,
          txHash: e.txHash,
          logIndex: e.logIndex,
          timestamp: e.timestamp.getTime(),
          data: (() => { try { return JSON.parse(e.data); } catch { return {}; } })(),
        })).sort((a, b) => {
          if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
          return a.logIndex - b.logIndex;
        }).slice(-this.MAX_EVENTS_PER_ARENA),
        updatedAt: Date.now(),
      };

      this.arenas.set(record.arenaId, snapshot);
      hydrated++;
    }

    this.logger.log(`Hydrated ${hydrated} arenas from PostgreSQL`);
    return hydrated;
  }

  // ============================================
  // SNAPSHOT MANAGEMENT
  // ============================================

  getSnapshot(arenaId: string): ArenaSnapshot | null {
    return this.arenas.get(arenaId) || null;
  }

  getAllArenaIds(): string[] {
    return Array.from(this.arenas.keys());
  }

  getRecentArenas(limit: number = 50): ArenaSnapshot[] {
    const all = Array.from(this.arenas.values());
    return all
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }

  private getOrCreateArena(arenaId: string): ArenaSnapshot {
    let arena = this.arenas.get(arenaId);
    if (!arena) {
      arena = {
        arenaId,
        state: 'unknown',
        artifacts: { arenaId },
        recentEvents: [],
        participantCount: 0,
        participants: [],
        updatedAt: Date.now(),
      };
      this.arenas.set(arenaId, arena);
    }
    return arena;
  }

  private addEvent(arenaId: string, event: ChainEvent): void {
    const arena = this.getOrCreateArena(arenaId);
    arena.recentEvents.push(event);

    // Keep fewer events for terminal arenas to save memory
    const maxEvents = (arena.state === 'finished' || arena.state === 'cancelled')
      ? 20
      : this.MAX_EVENTS_PER_ARENA;

    if (arena.recentEvents.length > maxEvents) {
      arena.recentEvents = arena.recentEvents.slice(-maxEvents);
    }

    // Sort by block + logIndex
    arena.recentEvents.sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
      return a.logIndex - b.logIndex;
    });

    arena.updatedAt = Date.now();
  }

  // ============================================
  // EVENT HANDLERS - Called by EventListenerService
  // ============================================

  handleArenaCreated(
    arenaId: string,
    creator: string,
    entryFee: string,
    minPlayers: number,
    maxPlayers: number,
    blockNumber: number,
    txHash: string,
    logIndex: number,
  ): ChainEvent {
    const arena = this.getOrCreateArena(arenaId);
    arena.state = 'open';
    arena.maxPlayers = maxPlayers;
    arena.artifacts.createTxHash = txHash;

    const event: ChainEvent = {
      type: 'arena_created',
      arenaId,
      blockNumber,
      txHash,
      logIndex,
      timestamp: Date.now(),
      data: { creator, entryFee, minPlayers, maxPlayers },
    };

    this.addEvent(arenaId, event);
    this.logger.debug(`Stored ArenaCreated: arena=${arenaId}, tx=${txHash.slice(0, 10)}...`);

    return event;
  }

  handleAgentJoined(
    arenaId: string,
    agentId: string,
    owner: string,
    blockNumber: number,
    txHash: string,
    logIndex: number,
  ): ChainEvent {
    const arena = this.getOrCreateArena(arenaId);
    arena.participantCount++;
    arena.participants.push({ agentId, owner, joinTxHash: txHash });

    const event: ChainEvent = {
      type: 'agent_joined',
      arenaId,
      blockNumber,
      txHash,
      logIndex,
      timestamp: Date.now(),
      data: { agentId, owner },
    };

    this.addEvent(arenaId, event);
    this.logger.debug(`Stored AgentJoined: arena=${arenaId}, agent=${agentId}`);

    return event;
  }

  handleArenaLocked(
    arenaId: string,
    participantCount: number,
    vrfRequestId: string,
    blockNumber: number,
    txHash: string,
    logIndex: number,
  ): ChainEvent {
    const arena = this.getOrCreateArena(arenaId);
    arena.state = 'locked';
    arena.participantCount = participantCount;
    arena.artifacts.lockTxHash = txHash;
    arena.artifacts.vrfRequestId = vrfRequestId;
    arena.artifacts.vrfRequestTxHash = txHash; // Same tx that locks also requests VRF
    arena.artifacts.vrfRequestBlockNumber = blockNumber;

    const event: ChainEvent = {
      type: 'arena_locked',
      arenaId,
      blockNumber,
      txHash,
      logIndex,
      timestamp: Date.now(),
      data: { participantCount, vrfRequestId },
    };

    this.addEvent(arenaId, event);
    this.logger.debug(`Stored ArenaLocked: arena=${arenaId}, vrfRequestId=${vrfRequestId}`);

    return event;
  }

  handleVRFRequested(
    arenaId: string,
    requestId: string,
    blockNumber: number,
    txHash: string,
    logIndex: number,
  ): ChainEvent {
    const arena = this.getOrCreateArena(arenaId);
    arena.state = 'vrf_pending';
    arena.artifacts.vrfRequestId = requestId;
    arena.artifacts.vrfRequestTxHash = txHash;
    arena.artifacts.vrfRequestBlockNumber = blockNumber;

    const event: ChainEvent = {
      type: 'vrf_requested',
      arenaId,
      blockNumber,
      txHash,
      logIndex,
      timestamp: Date.now(),
      data: { requestId },
    };

    this.addEvent(arenaId, event);
    this.logger.debug(`Stored VRFRequested: arena=${arenaId}, requestId=${requestId}`);

    return event;
  }

  handleArenaStarted(
    arenaId: string,
    seed: string,
    blockNumber: number,
    txHash: string,
    logIndex: number,
  ): ChainEvent {
    const arena = this.getOrCreateArena(arenaId);
    arena.state = 'running';
    arena.artifacts.seed = seed;

    const event: ChainEvent = {
      type: 'arena_started',
      arenaId,
      blockNumber,
      txHash,
      logIndex,
      timestamp: Date.now(),
      data: { seed },
    };

    this.addEvent(arenaId, event);
    this.logger.debug(`Stored ArenaStarted: arena=${arenaId}, seed=${seed.slice(0, 20)}...`);

    return event;
  }

  handleBattleExecuted(
    arenaId: string,
    winnerId: string,
    resultHash: string,
    blockNumber: number,
    txHash: string,
    logIndex: number,
  ): ChainEvent {
    const arena = this.getOrCreateArena(arenaId);
    arena.artifacts.battleResultTxHash = txHash;
    arena.artifacts.battleResultBlockNumber = blockNumber;
    arena.artifacts.resultHash = resultHash;
    arena.artifacts.winnerId = winnerId;

    const event: ChainEvent = {
      type: 'battle_executed',
      arenaId,
      blockNumber,
      txHash,
      logIndex,
      timestamp: Date.now(),
      data: { winnerId, resultHash },
    };

    this.addEvent(arenaId, event);
    this.logger.debug(`Stored BattleExecuted: arena=${arenaId}, winner=${winnerId}`);

    return event;
  }

  handlePrizesDistributed(
    arenaId: string,
    winner: string,
    amount: string,
    blockNumber: number,
    txHash: string,
    logIndex: number,
  ): ChainEvent {
    const arena = this.getOrCreateArena(arenaId);
    arena.state = 'finished';
    arena.artifacts.prizesDistributedTxHash = txHash;
    arena.artifacts.prizesDistributedBlockNumber = blockNumber;
    arena.artifacts.prizeAmount = amount;
    arena.artifacts.winnerOwner = winner;

    const event: ChainEvent = {
      type: 'prizes_distributed',
      arenaId,
      blockNumber,
      txHash,
      logIndex,
      timestamp: Date.now(),
      data: { winner, amount },
    };

    this.addEvent(arenaId, event);
    this.logger.debug(`Stored PrizesDistributed: arena=${arenaId}, winner=${winner}, amount=${amount}`);

    return event;
  }

  handleArenaCancelled(
    arenaId: string,
    blockNumber: number,
    txHash: string,
    logIndex: number,
  ): ChainEvent {
    const arena = this.getOrCreateArena(arenaId);
    arena.state = 'cancelled';
    arena.artifacts.cancelTxHash = txHash;

    const event: ChainEvent = {
      type: 'arena_cancelled',
      arenaId,
      blockNumber,
      txHash,
      logIndex,
      timestamp: Date.now(),
      data: {},
    };

    this.addEvent(arenaId, event);
    this.logger.debug(`Stored ArenaCancelled: arena=${arenaId}`);

    return event;
  }

  // ============================================
  // MATCH INTEGRATION
  // ============================================

  setMatchId(arenaId: string, matchId: string): void {
    const arena = this.getOrCreateArena(arenaId);
    arena.matchId = matchId;
    arena.updatedAt = Date.now();
  }

  // ============================================
  // CLEANUP
  // ============================================

  /**
   * Clear all arenas from memory (for reindex)
   */
  clear(): void {
    const count = this.arenas.size;
    this.arenas.clear();
    this.logger.log(`Cleared ${count} arenas from memory`);
  }

  @Cron('0 */6 * * *') // Every 6 hours
  handleScheduledCleanup(): void {
    const removed = this.cleanup(24 * 60 * 60 * 1000); // 24h
    if (removed > 0) {
      this.logger.log(`Scheduled cleanup removed ${removed} arenas (${this.arenas.size} remaining)`);
    }
  }

  // Remove old finished/cancelled arenas after 24 hours
  cleanup(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
    const now = Date.now();
    let removed = 0;

    for (const [arenaId, arena] of this.arenas.entries()) {
      if (
        (arena.state === 'finished' || arena.state === 'cancelled') &&
        now - arena.updatedAt > maxAgeMs
      ) {
        this.arenas.delete(arenaId);
        removed++;
      }
    }

    if (removed > 0) {
      this.logger.log(`Cleaned up ${removed} old arenas`);
    }

    return removed;
  }
}
