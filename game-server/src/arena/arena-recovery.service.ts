// ============================================
// ARENA RECOVERY SERVICE - Recovers stuck arenas on boot
// ============================================

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ArenaPersistenceService, ArenaProcessingRecord, TxState } from './arena-persistence.service';
import { BlockchainService } from '../blockchain/blockchain.service';
import { ContractWriterService } from '../blockchain/contract-writer.service';
import { MatchService } from '../game/match.service';
import { ResultHasherService } from './result-hasher.service';
import { ArenaOrchestratorService } from './arena-orchestrator.service';
import { ArenaStoreService } from './arena-store.service';
import { GAME_CONFIG_VERSION } from '../game/engine-v2';
import { ParticipantData } from '../game/types';
import { encodePacked, keccak256 } from 'viem';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';

/**
 * Arena state from on-chain
 */
enum OnChainArenaState {
  CREATED = 0,
  OPEN = 1,
  LOCKED = 2,
  RUNNING = 3,
  FINISHED = 4,
  CANCELLED = 5,
}

@Injectable()
export class ArenaRecoveryService implements OnModuleInit {
  private readonly logger = new Logger(ArenaRecoveryService.name);
  private readonly MAX_RETRY_COUNT = 3;
  private readonly RECOVERY_DELAY_MS = 5000; // Wait 5 seconds after boot before recovery
  private recentlyTriggered: Set<string> = new Set();
  private recoveryInProgress = false;

  constructor(
    private persistence: ArenaPersistenceService,
    private blockchain: BlockchainService,
    private writer: ContractWriterService,
    private matchService: MatchService,
    private hasher: ResultHasherService,
    private config: ConfigService,
    private orchestrator: ArenaOrchestratorService,
    private arenaStore: ArenaStoreService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Delay recovery to allow other services to initialize
    setTimeout(() => {
      this.runRecovery().catch(err => {
        this.logger.error('Recovery process failed', err);
      });
    }, this.RECOVERY_DELAY_MS);
  }

  @Cron('*/120 * * * * *') // Every 2 minutes
  async scheduledRecovery(): Promise<void> {
    try {
      await this.runRecovery();
      await this.recoverOrphanedArenas();
    } catch (error) {
      this.logger.error('Scheduled recovery failed', error);
    }
  }

  private async recoverOrphanedArenas(): Promise<void> {
    const recentArenas = this.arenaStore.getRecentArenas(30);

    for (const snapshot of recentArenas) {
      if (['finished', 'cancelled'].includes(snapshot.state)) continue;

      const arenaKey = snapshot.arenaId;

      // Skip if recently triggered (5 min cooldown)
      if (this.recentlyTriggered.has(arenaKey)) continue;

      // Skip if already processing in orchestrator
      const active = this.orchestrator.getActiveProcessing();
      if (active.some(a => a.arenaId.toString() === arenaKey)) continue;

      // Skip if persistence says completed
      const record = this.persistence.getArena(arenaKey);
      if (record?.status === 'completed') continue;

      // Skip if match is active
      const matchId = this.matchService.getMatchByArena(BigInt(arenaKey));
      if (matchId) continue;

      // Check on-chain: is it RUNNING with seed?
      try {
        const arena = await this.blockchain.getArena(BigInt(arenaKey));

        if (arena.state === OnChainArenaState.RUNNING && arena.seed && arena.seed !== 0n) {
          this.logger.warn(`Orphaned arena detected: ${arenaKey} (RUNNING on-chain, no match)`);

          // Mark as recently triggered (5 min cooldown)
          this.recentlyTriggered.add(arenaKey);
          setTimeout(() => this.recentlyTriggered.delete(arenaKey), 5 * 60 * 1000);

          // Trigger manual processing (fire and forget)
          this.orchestrator.triggerManualProcessing(BigInt(arenaKey), arena.seed).catch(err => {
            this.logger.error(`Failed to recover orphaned arena ${arenaKey}`, err);
          });
        }
      } catch (error) {
        this.logger.debug(`Failed to check on-chain state for arena ${arenaKey}`);
      }
    }
  }

  /**
   * Main recovery process - runs on boot and every 2 minutes
   */
  async runRecovery(): Promise<void> {
    if (this.recoveryInProgress) {
      this.logger.debug('Recovery already in progress, skipping overlapping run');
      return;
    }

    this.recoveryInProgress = true;

    try {
      this.logger.log('Starting arena recovery process...');

      // 1. Get arenas that need recovery
      const needsRecovery = this.persistence.getArenasNeedingRecovery();
      this.logger.log(`Found ${needsRecovery.length} arenas needing recovery`);

      if (needsRecovery.length === 0) {
        this.logger.log('No arenas need recovery');
        return;
      }

      // 2. Process each arena
      for (const record of needsRecovery) {
        try {
          await this.recoverArena(record);
        } catch (error) {
          this.logger.error(`Failed to recover arena ${record.arenaId}`, error);
          this.persistence.updateStatus(record.arenaId, 'failed', (error as Error).message);
        }
      }

      // 3. Log summary
      const counts = this.persistence.getStatusCounts();
      this.logger.log(`Recovery complete. Status counts: ${JSON.stringify(counts)}`);
    } finally {
      this.recoveryInProgress = false;
    }
  }

  /**
   * Recover a single arena based on its last known state
   */
  private async recoverArena(record: ArenaProcessingRecord): Promise<void> {
    const isActivelyProcessing = this.orchestrator
      .getActiveProcessing()
      .some((arena) => arena.arenaId.toString() === record.arenaId);

    if (isActivelyProcessing) {
      this.logger.log(`Arena ${record.arenaId} is active in orchestrator, skipping recovery`);
      return;
    }

    this.logger.log(`Recovering arena ${record.arenaId} (status: ${record.status})`);

    // Check retry count
    if (record.retryCount >= this.MAX_RETRY_COUNT) {
      const onChainState = await this.getOnChainArenaState(BigInt(record.arenaId));
      if (onChainState === OnChainArenaState.FINISHED || onChainState === OnChainArenaState.CANCELLED) {
        this.logger.log(`Arena ${record.arenaId} already ${OnChainArenaState[onChainState]} on-chain`);
        this.persistence.markCompleted(record.arenaId);
        return;
      }
      this.logger.warn(`Arena ${record.arenaId} exceeded max retries (${record.retryCount}), marking as failed`);
      this.persistence.updateStatus(record.arenaId, 'failed', 'Max retries exceeded');
      return;
    }

    // Increment retry count
    this.persistence.incrementRetry(record.arenaId);

    // Get current on-chain state
    const onChainState = await this.getOnChainArenaState(BigInt(record.arenaId));
    this.logger.log(`Arena ${record.arenaId} on-chain state: ${OnChainArenaState[onChainState]}`);

    // Determine recovery action based on on-chain state and last known status
    switch (onChainState) {
      case OnChainArenaState.FINISHED:
        // Arena already finished - just mark as completed
        this.logger.log(`Arena ${record.arenaId} already FINISHED on-chain`);
        this.persistence.markCompleted(record.arenaId);
        break;

      case OnChainArenaState.CANCELLED:
        // Arena was cancelled - mark as completed (refunds available)
        this.logger.log(`Arena ${record.arenaId} was CANCELLED on-chain`);
        this.persistence.markCompleted(record.arenaId);
        break;

      case OnChainArenaState.RUNNING:
        // Arena still running - need to check what step we're at
        await this.recoverRunningArena(record);
        break;

      case OnChainArenaState.CREATED:
      case OnChainArenaState.LOCKED:
      case OnChainArenaState.OPEN:
        // Arena not yet started - remove from recovery (event listener will handle it)
        this.logger.log(`Arena ${record.arenaId} not yet started (${OnChainArenaState[onChainState]}), removing from recovery`);
        this.persistence.deleteArena(record.arenaId);
        break;

      default:
        this.logger.warn(`Unknown on-chain state for arena ${record.arenaId}: ${onChainState}`);
        this.persistence.updateStatus(record.arenaId, 'failed', `Unknown on-chain state: ${onChainState}`);
    }
  }

  /**
   * Recover an arena that's still RUNNING on-chain
   */
  private async recoverRunningArena(record: ArenaProcessingRecord): Promise<void> {
    const arenaId = BigInt(record.arenaId);

    // Check if battle result already exists on-chain
    const battleResultExists = await this.checkBattleResultExists(arenaId);

    if (battleResultExists) {
      // Battle result submitted - just need to call distributePrizes
      this.logger.log(`Arena ${record.arenaId}: battle result exists, calling distributePrizes`);

      try {
        const result = await this.writer.distributePrizes(arenaId);
        if (result.success) {
          this.persistence.recordDistributeTx(record.arenaId, result.hash);
          this.persistence.confirmDistributeTx(record.arenaId);
          this.persistence.markCompleted(record.arenaId);
          this.logger.log(`Arena ${record.arenaId}: recovery complete via distributePrizes`);
        } else {
          this.persistence.failDistributeTx(record.arenaId, result.error || 'Unknown error');
        }
      } catch (error) {
        this.logger.error(`Arena ${record.arenaId}: distributePrizes failed`, error);
        this.persistence.updateStatus(record.arenaId, 'failed', (error as Error).message);
      }
    } else {
      // No battle result - check if we have simulation result to resubmit
      if (record.simulationResult) {
        this.logger.log(`Arena ${record.arenaId}: resubmitting battle result from saved simulation`);
        await this.resubmitBattleResult(record);
      } else if (record.matchData) {
        // No simulation result BUT we have match data — re-simulate deterministically
        this.logger.log(`Arena ${record.arenaId}: re-simulating from saved match data (seed + participants)`);
        await this.resimulateAndSubmit(record);
      } else {
        // No simulation result and no match data — try to fetch participants from chain and re-simulate
        this.logger.warn(`Arena ${record.arenaId}: no match data saved, attempting chain-based recovery`);
        await this.resimulateFromChain(record);
      }
    }
  }

  /**
   * Re-simulate match from saved match data (deterministic replay)
   * Uses saved seed + participants to run the exact same simulation synchronously
   */
  private async resimulateAndSubmit(record: ArenaProcessingRecord): Promise<void> {
    if (!record.matchData) {
      throw new Error('No match data available for re-simulation');
    }

    const arenaId = BigInt(record.arenaId);
    const seed = BigInt(record.seed);
    const { configVersion, participants } = record.matchData;

    // Verify config version matches current engine
    if (configVersion !== GAME_CONFIG_VERSION) {
      this.logger.warn(
        `Arena ${record.arenaId}: config version mismatch (saved: ${configVersion}, current: ${GAME_CONFIG_VERSION}). ` +
        'Re-simulation may produce different results. Proceeding anyway.'
      );
    }

    // Transform participants back to game format
    const gameParticipants: ParticipantData[] = participants.map(p => ({
      agentId: BigInt(p.agentId),
      owner: p.owner,
      boostIds: p.boostIds.map(b => BigInt(b)),
    }));

    // Create match and run synchronously (no setInterval, instant)
    const matchId = this.matchService.createMatch(arenaId, seed, gameParticipants);
    const result = await this.matchService.runSynchronousSimulation(matchId);

    this.logger.log(
      `Arena ${record.arenaId}: re-simulation complete. Winner: ${result.winnerId}, ticks: ${result.totalTicks}`
    );

    // Compute result hash
    const resultHash = this.hasher.computeResultHash(
      arenaId,
      seed,
      result.winnerId,
      BigInt(result.totalTicks),
      result.eliminationOrder,
      gameParticipants,
    );

    // Save simulation result for resubmission
    this.persistence.upsertArena({
      arenaId: record.arenaId,
      status: 'submitting',
      simulationResult: {
        winnerId: result.winnerId.toString(),
        winnerOwner: result.winnerOwner,
        totalTicks: result.totalTicks,
        resultHash,
        eliminationOrder: result.eliminationOrder.map(e => ({
          agentId: e.agentId.toString(),
          eliminatedAt: e.eliminatedAt,
          source: e.source,
        })),
      },
    });

    // Submit to chain
    await this.resubmitBattleResult(this.persistence.getArena(record.arenaId)!);
  }

  /**
   * Last-resort recovery: fetch arena data from chain and re-simulate
   * Used when no matchData was persisted (old records from before this feature)
   */
  private async resimulateFromChain(record: ArenaProcessingRecord): Promise<void> {
    const arenaId = BigInt(record.arenaId);

    try {
      // Fetch participants from chain
      const participants = await this.blockchain.getArenaParticipants(arenaId);
      if (participants.length < 2) {
        this.logger.warn(`Arena ${record.arenaId}: only ${participants.length} participants on-chain, cannot re-simulate`);
        this.persistence.updateStatus(record.arenaId, 'failed', 'Not enough participants for re-simulation');
        return;
      }

      // Get seed from persistence (it's always saved when arena starts)
      const seed = BigInt(record.seed);

      // Transform to game format
      const gameParticipants: ParticipantData[] = participants.map(p => ({
        agentId: p.agentId,
        owner: p.owner,
        boostIds: [...p.boostIds],
      }));

      // Save match data for future recoveries
      this.persistence.upsertArena({
        arenaId: record.arenaId,
        matchData: {
          matchId: `recovery_${record.arenaId}_${Date.now()}`,
          configVersion: GAME_CONFIG_VERSION,
          participants: gameParticipants.map(p => ({
            agentId: p.agentId.toString(),
            owner: p.owner,
            boostIds: p.boostIds.map(b => b.toString()),
          })),
        },
      });

      // Now re-simulate using the saved match data path
      await this.resimulateAndSubmit(this.persistence.getArena(record.arenaId)!);
    } catch (error) {
      this.logger.error(`Arena ${record.arenaId}: chain-based recovery failed`, error);
      this.persistence.updateStatus(record.arenaId, 'pending_recovery', (error as Error).message);
    }
  }

  /**
   * Resubmit battle result from saved simulation data
   */
  private async resubmitBattleResult(record: ArenaProcessingRecord): Promise<void> {
    if (!record.simulationResult) {
      throw new Error('No simulation result available for resubmission');
    }

    const arenaId = BigInt(record.arenaId);
    const { winnerId, totalTicks, resultHash } = record.simulationResult;
    const commitRevealEnabled = await this.blockchain.isCommitRevealEnabled();

    try {
      if (commitRevealEnabled) {
        const configuredRevealDelayMs = parseInt(this.config.get<string>('REVEAL_DELAY_MS') || '0', 10);
        const onChainRevealDelayMs = await this.blockchain.getRevealDelayMs();
        const revealDelayMs = Math.max(configuredRevealDelayMs, onChainRevealDelayMs + 5000);
        let salt = record.commitReveal?.salt as `0x${string}` | undefined;
        let commitHash = record.commitReveal?.commitHash as `0x${string}` | undefined;

        if (!salt || !commitHash || record.submitBattleResultTx?.state !== TxState.CONFIRMED) {
          salt = `0x${randomBytes(32).toString('hex')}` as `0x${string}`;
          commitHash = keccak256(
            encodePacked(
              ['uint256', 'uint256', 'uint256', 'bytes32', 'bytes32'],
              [arenaId, BigInt(winnerId), BigInt(totalTicks), resultHash as `0x${string}`, salt],
            ),
          );

          this.persistence.upsertArena({
            arenaId: record.arenaId,
            status: 'committing',
            commitReveal: { salt, commitHash, committedAt: Date.now() },
          });

          const commitResult = await this.writer.commitBattleResult(arenaId, commitHash);
          if (!commitResult.success) {
            this.persistence.failSubmitTx(record.arenaId, commitResult.error || 'Unknown error');
            return;
          }
          this.persistence.recordSubmitTx(record.arenaId, commitResult.hash);
          this.persistence.confirmSubmitTx(record.arenaId);
        }

        this.persistence.updateStatus(record.arenaId, 'waiting_reveal');
        await new Promise(resolve => setTimeout(resolve, revealDelayMs));
        this.persistence.updateStatus(record.arenaId, 'revealing');

        const revealResult = await this.writer.revealAndDistribute(
          arenaId,
          BigInt(winnerId),
          BigInt(totalTicks),
          resultHash as `0x${string}`,
          salt,
        );

        if (revealResult.success) {
          this.persistence.recordDistributeTx(record.arenaId, revealResult.hash);
          this.persistence.confirmDistributeTx(record.arenaId);
          this.persistence.markCompleted(record.arenaId);
          this.logger.log(`Arena ${record.arenaId}: commit/reveal recovery complete`);
        } else {
          this.persistence.failDistributeTx(record.arenaId, revealResult.error || 'Unknown error');
        }
        return;
      }

      // Submit battle result
      const submitResult = await this.writer.submitBattleResult(
        arenaId,
        BigInt(winnerId),
        BigInt(totalTicks),
        resultHash as `0x${string}`,
      );

      if (submitResult.success) {
        this.persistence.recordSubmitTx(record.arenaId, submitResult.hash);
        this.persistence.confirmSubmitTx(record.arenaId);
        this.persistence.updateStatus(record.arenaId, 'distributing');

        // Now distribute prizes
        const distributeResult = await this.writer.distributePrizes(arenaId);
        if (distributeResult.success) {
          this.persistence.recordDistributeTx(record.arenaId, distributeResult.hash);
          this.persistence.confirmDistributeTx(record.arenaId);
          this.persistence.markCompleted(record.arenaId);
          this.logger.log(`Arena ${record.arenaId}: full recovery complete`);
        } else {
          this.persistence.failDistributeTx(record.arenaId, distributeResult.error || 'Unknown error');
        }
      } else {
        // Check if error is "BattleAlreadyExecuted" - means result already on-chain
        if (submitResult.error?.includes('BattleAlreadyExecuted')) {
          this.logger.log(`Arena ${record.arenaId}: battle already executed, calling distributePrizes`);
          const distributeResult = await this.writer.distributePrizes(arenaId);
          if (distributeResult.success) {
            this.persistence.recordDistributeTx(record.arenaId, distributeResult.hash);
            this.persistence.confirmDistributeTx(record.arenaId);
            this.persistence.markCompleted(record.arenaId);
          }
        } else {
          this.persistence.failSubmitTx(record.arenaId, submitResult.error || 'Unknown error');
        }
      }
    } catch (error) {
      this.logger.error(`Arena ${record.arenaId}: resubmission failed`, error);
      this.persistence.updateStatus(record.arenaId, 'failed', (error as Error).message);
    }
  }

  /**
   * Get arena state from on-chain
   */
  private async getOnChainArenaState(arenaId: bigint): Promise<OnChainArenaState> {
    try {
      const arena = await this.blockchain.getArena(arenaId);
      return arena.state as OnChainArenaState;
    } catch (error) {
      this.logger.error(`Failed to get on-chain state for arena ${arenaId}`, error);
      throw error;
    }
  }

  /**
   * Check if battle result exists on-chain
   */
  private async checkBattleResultExists(arenaId: bigint): Promise<boolean> {
    try {
      const result = await this.blockchain.getBattleResult(arenaId);
      // If executedAt > 0, result exists
      return result.executedAt > 0n;
    } catch (error) {
      // If error, assume no result exists
      this.logger.debug(`No battle result found for arena ${arenaId}`);
      return false;
    }
  }

  /**
   * Manual recovery trigger (for admin/debugging)
   */
  async triggerRecovery(arenaId?: string): Promise<void> {
    if (arenaId) {
      const record = this.persistence.getArena(arenaId);
      if (record) {
        await this.recoverArena(record);
      } else {
        this.logger.warn(`Arena ${arenaId} not found in persistence`);
      }
    } else {
      await this.runRecovery();
    }
  }

  /**
   * Get recovery status report
   */
  getRecoveryStatus(): {
    totalArenas: number;
    statusCounts: Record<string, number>;
    pendingRecovery: ArenaProcessingRecord[];
  } {
    return {
      totalArenas: this.persistence.getAllArenas().length,
      statusCounts: this.persistence.getStatusCounts(),
      pendingRecovery: this.persistence.getArenasNeedingRecovery(),
    };
  }
}
