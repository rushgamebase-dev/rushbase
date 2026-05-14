// ============================================
// ARENA ORCHESTRATOR SERVICE - Coordinates battle flow
// ============================================

import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { BlockchainService, ArenaParticipant } from '../blockchain/blockchain.service';
import { ContractWriterService } from '../blockchain/contract-writer.service';
import { ArenaStartedEvent } from '../blockchain/event-listener.service';
import { ResultHasherService } from './result-hasher.service';
import { MatchService, SimulationResult } from '../game/match.service';
import { GameGateway } from '../game/game.gateway';
import { LeaderboardService } from '../game/leaderboard.service';
import { GAME_CONFIG_VERSION } from '../game/engine-v2';
import { ParticipantData, ArenaWebSocketUpdate } from '../game/types';
import { ArenaPersistenceService } from './arena-persistence.service';
import { RedisLockService } from '../common/redis/redis.service';
import { PrismaService } from '../arena-ledger/prisma.service';
import { keccak256, encodePacked } from 'viem';
import { randomBytes } from 'crypto';

// Processing status tracking (in-memory for fast access, backed by persistence)
interface ProcessingArena {
  arenaId: string;
  startedAt: number;
  status: 'simulating' | 'committing' | 'waiting_reveal' | 'revealing' | 'submitting' | 'distributing' | 'completed' | 'failed';
  matchId?: string;
  result?: SimulationResult;
  error?: string;
  salt?: `0x${string}`;
  commitHash?: `0x${string}`;
  resultHash?: `0x${string}`;
}

@Injectable()
export class ArenaOrchestratorService {
  private readonly logger = new Logger(ArenaOrchestratorService.name);
  private processingArenas: Map<string, ProcessingArena> = new Map();

  constructor(
    private blockchain: BlockchainService,
    private writer: ContractWriterService,
    private hasher: ResultHasherService,
    private matchService: MatchService,
    private gateway: GameGateway,
    private persistence: ArenaPersistenceService,
    private eventEmitter: EventEmitter2,
    @Inject(forwardRef(() => LeaderboardService))
    private leaderboardService: LeaderboardService,
    private redisLock: RedisLockService,
    private prisma: PrismaService,
  ) {}

  /**
   * Handle ArenaStarted event from blockchain
   * This is the main entry point for processing battles
   */
  @OnEvent('arena.started.live')
  async handleArenaStarted(event: ArenaStartedEvent): Promise<void> {
    const { arenaId, seed } = event;
    const arenaKey = arenaId; // Already string from event
    const arenaIdBigInt = BigInt(arenaId);
    const seedBigInt = BigInt(seed);

    // Atomic distributed lock — prevents duplicate processing across restarts/race conditions
    const lockKey = `lock:arena:process:${arenaKey}`;
    const acquired = await this.redisLock.acquireLock(lockKey, 300); // 5 min TTL
    if (!acquired) {
      this.logger.warn(`Arena ${arenaId} is already being processed (Redis lock)`);
      return;
    }

    // Also check persistence to prevent reprocessing after restart
    if (this.persistence.hasArena(arenaKey)) {
      const existingRecord = this.persistence.getArena(arenaKey);
      if (existingRecord?.status === 'completed') {
        this.logger.warn(`Arena ${arenaId} already completed (from persistence)`);
        await this.redisLock.releaseLock(lockKey);
        return;
      }
    }

    const processing: ProcessingArena = {
      arenaId: arenaKey,
      startedAt: Date.now(),
      status: 'simulating',
    };
    this.processingArenas.set(arenaKey, processing);

    // Persist initial state
    this.persistence.upsertArena({
      arenaId: arenaKey,
      seed: seed.toString(),
      status: 'simulating',
      startedAt: Date.now(),
    });

    try {
      this.logger.log(`Processing arena ${arenaId} with seed ${seed}`);

      // Broadcast arena started event
      this.broadcastArenaEvent(arenaKey, 'arena_started', {
        seed: seed.toString(),
      });

      // 1. Fetch participants from blockchain
      const participants = await this.blockchain.getArenaParticipants(arenaIdBigInt);
      this.logger.log(`Fetched ${participants.length} participants for arena ${arenaId}`);

      if (participants.length < 2) {
        throw new Error(`Not enough participants: ${participants.length}`);
      }

      // 2. Transform to game format
      const gameParticipants = this.transformParticipants(participants);

      // 3. Run simulation
      const result = await this.runSimulation(arenaIdBigInt, seedBigInt, gameParticipants);
      processing.result = result;
      processing.status = 'submitting';

      this.logger.log(
        `Simulation complete for arena ${arenaId}: winner=${result.winnerId}, ticks=${result.totalTicks}`,
      );

      // CRITICAL: Broadcast match_end IMMEDIATELY so frontend shows victory screen
      // Don't wait for on-chain transactions (which can take 10-30+ seconds or fail)
      const eliminationOrderData = result.eliminationOrder.map((e) => ({
        agentId: e.agentId.toString(),
        eliminatedAt: e.eliminatedAt,
        eliminatedBy: e.eliminatedBy,
        source: e.source,
      }));

      // CRITICAL: Write revealAt SYNCHRONOUSLY before any broadcast.
      // This is the single source of truth for anti-spoiler.
      // Must succeed before arena_battle_complete goes out.
      const REVEAL_DELAY_MS = parseInt(process.env.REVEAL_DELAY_MS || '0', 10);
      const revealAt = new Date(Date.now() + REVEAL_DELAY_MS);
      const simulationData = JSON.stringify({
        agents: result.finalState.agents,
        eliminationOrder: eliminationOrderData,
        totalTicks: result.totalTicks,
        totalParticipants: gameParticipants.length,
      });

      let arenaRecord: { prizePool: string } | null = null;
      try {
        arenaRecord = await this.prisma.arenaRecord.update({
          where: { arenaId: arenaKey },
          data: { simulationData, revealAt, battleState: 'COMPLETE' },
          select: { prizePool: true },
        });
        this.logger.log(`[battle-state] arena ${arenaKey} → COMPLETE, revealAt=${revealAt.toISOString()}`);
      } catch (dbError) {
        // ArenaRecord might not exist yet (rare edge case).
        // Try upsert with minimal data as fallback.
        this.logger.warn(`[anti-spoiler] update failed for arena ${arenaKey}, trying upsert: ${(dbError as Error).message}`);
        try {
          await this.prisma.arenaRecord.upsert({
            where: { arenaId: arenaKey },
            create: {
              arenaId: arenaKey,
              tier: 'BRONZE',
              entryFee: '0',
              minPlayers: 2,
              maxPlayers: gameParticipants.length,
              creator: '',
              state: 'started',
              simulationData,
              revealAt,
              battleState: 'COMPLETE',
            },
            update: { simulationData, revealAt },
          });
          this.logger.log(`[battle-state] arena ${arenaKey} → COMPLETE (upserted)`);
        } catch (upsertError) {
          this.logger.error(`[anti-spoiler] FAILED to write revealAt for arena ${arenaKey}: ${(upsertError as Error).message}`);
          // Continue anyway — frontend 40s fallback will cover this extreme edge case
        }
      }

      // Emit for ledger backup + Telegram notification (winner data included)
      this.eventEmitter.emit('arena.simulation_complete', {
        arenaId: arenaKey,
        simulationData,
        winnerId: result.winnerId.toString(),
        winnerOwner: result.winnerOwner,
        prizePool: arenaRecord?.prizePool || '0',
      });

      if (processing.matchId) {
        this.gateway.broadcastMatchEnd(processing.matchId, {
          arenaId: arenaId.toString(),
          winnerId: result.winnerId.toString(),
          winnerOwner: result.winnerOwner,
          totalTicks: result.totalTicks,
          eliminationOrder: eliminationOrderData,
        });
        this.logger.log(`Broadcasted match_end for match ${processing.matchId} (before on-chain submission)`);
      }

      // Broadcast simulation complete to arena subscribers AND global room
      // This is the authoritative "animation done" signal — drives anti-spoiler
      // on /arenas and Telegram. NOT time-based — event-based.
      const battleCompleteData = {
        winnerId: result.winnerId.toString(),
        winnerOwner: result.winnerOwner,
        matchId: processing.matchId,
        totalTicks: result.totalTicks,
        eliminationOrder: eliminationOrderData,
        revealAt: revealAt.getTime(),
      };
      this.broadcastArenaEvent(arenaKey, 'arena_battle_complete', battleCompleteData);

      // Also broadcast globally so /arenas page knows simulation finished
      this.gateway.broadcastGlobal({
        type: 'arena_battle_complete',
        arenaId: arenaKey,
        blockNumber: 0, // Off-chain event — no block
        txHash: '',
        logIndex: 0,
        timestamp: Date.now(),
        data: battleCompleteData,
      });

      // 4. Validate result before on-chain submission
      this.validateSimulationResult(result, gameParticipants);

      // 5. Compute result hash (v2 - includes participants with boosts for full auditability)
      const resultHash = this.hasher.computeResultHash(
        arenaIdBigInt,
        seedBigInt,
        result.winnerId,
        BigInt(result.totalTicks),
        result.eliminationOrder,
        gameParticipants, // Include participants for v2 hash
      );

      // Persist simulation result before submitting (CRITICAL for recovery)
      this.persistence.upsertArena({
        arenaId: arenaKey,
        status: 'committing',
        simulationResult: {
          winnerId: result.winnerId.toString(),
          winnerOwner: result.winnerOwner,
          totalTicks: result.totalTicks,
          resultHash,
          eliminationOrder: result.eliminationOrder.map((e) => ({
            agentId: e.agentId.toString(),
            eliminatedAt: e.eliminatedAt,
            source: e.source,
          })),
        },
      });

      // 6. ON-CHAIN SUBMISSION — two paths based on REVEAL_DELAY_MS
      processing.resultHash = resultHash;
      let finalTxHash: string;
      let prizePool: string;

      if (REVEAL_DELAY_MS > 0) {
        // === COMMIT-REVEAL PATH ===
        const salt = `0x${randomBytes(32).toString('hex')}` as `0x${string}`;
        const commitHash = keccak256(
          encodePacked(
            ['uint256', 'uint256', 'uint256', 'bytes32', 'bytes32'],
            [arenaIdBigInt, result.winnerId, BigInt(result.totalTicks), resultHash, salt],
          ),
        );

        processing.status = 'committing';
        processing.salt = salt;
        processing.commitHash = commitHash;

        const commitResult = await this.writer.commitBattleResult(arenaIdBigInt, commitHash);
        this.logger.log(`Committed battle result for arena ${arenaId}: tx=${commitResult.hash}`);

        this.persistence.recordSubmitTx(arenaKey, commitResult.hash);
        this.persistence.confirmSubmitTx(arenaKey);

        processing.status = 'waiting_reveal';
        this.persistence.updateStatus(arenaKey, 'waiting_reveal');

        await new Promise(resolve => setTimeout(resolve, REVEAL_DELAY_MS));

        processing.status = 'revealing';
        this.persistence.updateStatus(arenaKey, 'revealing');

        const arenaData = await this.blockchain.getArena(arenaIdBigInt);
        prizePool = arenaData.prizePool.toString();

        const revealResult = await this.writer.revealAndDistribute(
          arenaIdBigInt,
          result.winnerId,
          BigInt(result.totalTicks),
          resultHash,
          salt,
        );

        this.logger.log(`Revealed and distributed for arena ${arenaId}: tx=${revealResult.hash}`);
        this.persistence.recordDistributeTx(arenaKey, revealResult.hash);
        this.persistence.confirmDistributeTx(arenaKey);
        finalTxHash = revealResult.hash;
      } else {
        // === DIRECT SUBMIT PATH (no commit-reveal) ===
        processing.status = 'submitting';
        this.persistence.updateStatus(arenaKey, 'submitting');

        const submitResult = await this.writer.submitBattleResult(
          arenaIdBigInt,
          result.winnerId,
          BigInt(result.totalTicks),
          resultHash,
        );
        this.logger.log(`Submitted battle result for arena ${arenaId}: tx=${submitResult.hash}`);

        this.persistence.recordSubmitTx(arenaKey, submitResult.hash);
        this.persistence.confirmSubmitTx(arenaKey);

        // Fetch prize pool
        const arenaData = await this.blockchain.getArena(arenaIdBigInt);
        prizePool = arenaData.prizePool.toString();

        // Distribute prizes
        processing.status = 'distributing';
        this.persistence.updateStatus(arenaKey, 'distributing');

        const distResult = await this.writer.distributePrizes(arenaIdBigInt);
        this.logger.log(`Prizes distributed for arena ${arenaId}: tx=${distResult.hash}`);

        this.persistence.recordDistributeTx(arenaKey, distResult.hash);
        this.persistence.confirmDistributeTx(arenaKey);
        finalTxHash = distResult.hash;
      }

      processing.status = 'completed';

      // Emit battle_executed event for ledger
      this.eventEmitter.emit('arena.battle_executed', {
        arenaId: arenaKey,
        winnerId: result.winnerId.toString(),
        resultHash,
        blockNumber: 0,
        txHash: finalTxHash,
        blockTimestamp: new Date(),
      });

      // Emit prizes_distributed event for ledger
      this.eventEmitter.emit('arena.prizes_distributed', {
        arenaId: arenaKey,
        winnerId: result.winnerId.toString(),
        winner: result.winnerOwner,
        amount: prizePool,
        blockNumber: 0,
        txHash: finalTxHash,
        blockTimestamp: new Date(),
      });
      this.logger.log(`Emitted arena.prizes_distributed for ledger: arena=${arenaKey}`);

      // 7. Broadcast prize confirmation via WebSocket (match_end was already sent earlier)
      if (processing.matchId) {
        this.gateway.broadcastMatchEnd(processing.matchId, {
          arenaId: arenaId.toString(),
          winnerId: result.winnerId.toString(),
          winnerOwner: result.winnerOwner,
          totalTicks: result.totalTicks,
          eliminationOrder: eliminationOrderData,
          prizeAmount: prizePool,
          distributeTxHash: finalTxHash,
        });
      }

      // Broadcast arena finished with full prize data to arena subscribers
      this.broadcastArenaEvent(arenaKey, 'arena_finished', {
        winnerId: result.winnerId.toString(),
        winnerOwner: result.winnerOwner,
        matchId: processing.matchId,
        totalTicks: result.totalTicks,
        eliminationOrder: eliminationOrderData,
        prizeAmount: prizePool,
        distributeTxHash: finalTxHash,
      });

      this.logger.log(`Arena ${arenaId} processing completed successfully`);

      // Mark completed in persistence
      this.persistence.markCompleted(arenaKey);

      // Refresh leaderboard for all participants (stats updated on-chain)
      const participantAgentIds = gameParticipants.map((p) => p.agentId);
      await this.refreshLeaderboardAfterArena(participantAgentIds);

      // Cleanup in-memory + release Redis lock after delay
      setTimeout(async () => {
        this.processingArenas.delete(arenaKey);
        await this.redisLock.releaseLock(lockKey);
      }, 60000);
    } catch (error) {
      processing.status = 'failed';
      processing.error = (error as Error).message;
      this.logger.error(`Failed to process arena ${arenaId}`, error);

      // Persist error state for recovery
      this.persistence.updateStatus(arenaKey, 'failed', (error as Error).message);

      // Broadcast error to arena subscribers
      this.broadcastArenaEvent(arenaKey, 'arena_error', {
        error: (error as Error).message,
      });

      // Keep failed state for debugging, then release lock
      setTimeout(async () => {
        this.processingArenas.delete(arenaKey);
        await this.redisLock.releaseLock(lockKey);
      }, 300000); // 5 minutes
    }
  }

  /**
   * Broadcast arena event to WebSocket subscribers
   */
  private broadcastArenaEvent(
    arenaId: string,
    type: ArenaWebSocketUpdate['type'],
    data?: ArenaWebSocketUpdate['data'],
  ): void {
    const update: ArenaWebSocketUpdate = {
      type,
      arenaId,
      timestamp: Date.now(),
      data,
    };
    this.gateway.broadcastArenaUpdate(arenaId, update);
  }

  /**
   * Transform blockchain participants to game format
   */
  private transformParticipants(
    participants: ArenaParticipant[],
  ): ParticipantData[] {
    return participants.map((p) => ({
      agentId: p.agentId,
      owner: p.owner,
      boostIds: [...p.boostIds], // Convert readonly to mutable
    }));
  }

  /**
   * Run real-time simulation with live streaming
   */
  private async runSimulation(
    arenaId: bigint,
    seed: bigint,
    participants: ParticipantData[],
  ): Promise<SimulationResult> {
    const arenaKey = arenaId.toString();

    // Create match
    const matchId = this.matchService.createMatch(arenaId, seed, participants);
    const arena = this.processingArenas.get(arenaKey);
    if (arena) {
      arena.matchId = matchId;
    }

    // Persist match data for recovery (seed + participants = deterministic replay)
    this.persistence.upsertArena({
      arenaId: arenaKey,
      matchData: {
        matchId,
        configVersion: GAME_CONFIG_VERSION,
        participants: participants.map(p => ({
          agentId: p.agentId.toString(),
          owner: p.owner,
          boostIds: p.boostIds.map(b => b.toString()),
        })),
      },
    });

    // Register tick callback for WebSocket streaming
    this.matchService.onTick(matchId, (update) => {
      this.gateway.broadcastTick(matchId, update);
    });

    // Broadcast matchId BEFORE starting so users can join and watch
    this.logger.log(`Broadcasting match ${matchId} for arena ${arenaId} - users can now spectate`);
    this.broadcastArenaEvent(arenaKey, 'match_ready', {
      matchId,
      participantCount: participants.length,
    });

    // Small delay to allow spectators to connect
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Run real-time simulation (streams ticks to spectators)
    const result = await this.matchService.runRealTimeSimulation(matchId);

    return result;
  }

  /**
   * Validate simulation result before submitting on-chain.
   * Prevents invalid data from reaching the contract.
   */
  private validateSimulationResult(
    result: SimulationResult,
    participants: ParticipantData[],
  ): void {
    // Validation 1: winnerId must be greater than 0
    if (result.winnerId <= 0n) {
      throw new Error(
        `Invalid winnerId: ${result.winnerId}. Winner ID must be greater than 0.`,
      );
    }

    // Validation 2: winnerId must be one of the participants
    const participantIds = participants.map((p) => p.agentId);
    const winnerIsParticipant = participantIds.some(
      (id) => id === result.winnerId,
    );

    if (!winnerIsParticipant) {
      throw new Error(
        `Invalid winnerId: ${result.winnerId} is not a participant. Participants: [${participantIds.join(', ')}]`,
      );
    }

    // Validation 3: totalTicks must be positive
    if (result.totalTicks <= 0) {
      throw new Error(
        `Invalid totalTicks: ${result.totalTicks}. Must be greater than 0.`,
      );
    }

    // Validation 4: winnerOwner must be a valid address
    if (
      !result.winnerOwner ||
      !result.winnerOwner.startsWith('0x') ||
      result.winnerOwner.length !== 42
    ) {
      throw new Error(
        `Invalid winnerOwner address: ${result.winnerOwner}`,
      );
    }

    this.logger.debug(
      `Simulation result validated: winnerId=${result.winnerId}, ticks=${result.totalTicks}`,
    );
  }

  /**
   * Get processing status for an arena
   */
  getProcessingStatus(arenaId: bigint): ProcessingArena | undefined {
    return this.processingArenas.get(arenaId.toString());
  }

  /**
   * Get all currently processing arenas
   */
  getActiveProcessing(): ProcessingArena[] {
    return Array.from(this.processingArenas.values());
  }

  /**
   * Clear stale processing state for an arena (used by admin trigger-battle)
   */
  clearProcessingState(arenaId: string): void {
    this.processingArenas.delete(arenaId);
    const lockKey = `lock:arena:process:${arenaId}`;
    this.redisLock.releaseLock(lockKey).catch(() => {});
    this.logger.warn(`Cleared processing state for arena ${arenaId}`);
  }

  /**
   * Manual trigger for testing (bypasses event listener)
   */
  async triggerManualProcessing(arenaId: bigint, seed: bigint): Promise<void> {
    const event: ArenaStartedEvent = {
      arenaId: arenaId.toString(),
      seed: seed.toString(),
      blockNumber: 0,
      txHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    };
    await this.handleArenaStarted(event);
  }

  /**
   * Refresh leaderboard after arena completes and broadcast to subscribers
   */
  private async refreshLeaderboardAfterArena(agentIds: bigint[]): Promise<void> {
    try {
      // Refresh stats for all participants
      await this.leaderboardService.refreshAgents(agentIds);

      // Get updated top 10 and broadcast
      const top10 = this.leaderboardService.getTopAgents(10);
      const stats = this.leaderboardService.getStats();

      this.gateway.broadcastLeaderboardUpdate({
        updatedAgents: agentIds.map((id) => id.toString()),
        top10,
        totalAgents: stats.totalAgents,
        lastUpdated: stats.lastUpdated,
      });

      this.logger.log(`Leaderboard refreshed for ${agentIds.length} agents`);
    } catch (error) {
      this.logger.error('Failed to refresh leaderboard after arena', error);
    }
  }
}
