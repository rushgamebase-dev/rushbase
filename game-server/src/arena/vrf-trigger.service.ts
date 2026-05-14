// ============================================
// VRF TRIGGER SERVICE - Auto-request randomness when arena locks
// ============================================
// CRITICAL: This service must be STATE-DRIVEN, not event-driven.
// The recovery cron is the source of truth, not the event listener.
// If BattleEngine has insufficient funds, retries continue indefinitely
// until the balance is replenished.

import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { BlockchainService } from '../blockchain/blockchain.service';
import { ContractWriterService } from '../blockchain/contract-writer.service';
import { ArenaLockedEvent } from '../blockchain/event-listener.service';
import { GameGateway } from '../game/game.gateway';
import { ArenaWebSocketUpdate } from '../game/types';
import { RedisLockService } from '../common/redis/redis.service';

// Arena state enum (matches contract)
enum ArenaState {
  CREATED = 0,
  OPEN = 1,
  LOCKED = 2,
  RUNNING = 3,
  FINISHED = 4,
  CANCELLED = 5,
}

// Failure types - temporary failures don't count toward max attempts
enum FailureType {
  TEMPORARY = 'temporary', // Insufficient funds, rate limit - will retry
  PERMANENT = 'permanent', // Contract revert, invalid state - stop trying
}

// Minimum balance warning threshold (in wei) - warn if below 0.001 ETH
const LOW_BALANCE_THRESHOLD = 1000000000000000n; // 0.001 ETH

// Auto-cancel arenas stuck LOCKED for longer than this (15 minutes)
const AUTO_CANCEL_TIMEOUT_S = 15 * 60;

// Scan range for recovery cron (last N arenas)
const RECOVERY_SCAN_RANGE = 50;

// Max permanent-failure attempts before auto-cancel
const MAX_PERMANENT_ATTEMPTS = 10;

@Injectable()
export class VRFTriggerService {
  private readonly logger = new Logger(VRFTriggerService.name);

  // Track arenas we're processing to avoid double-triggering
  private processingArenas: Set<string> = new Set();

  // Track arenas that failed VRF for recovery
  private failedArenas: Map<string, {
    attempts: number;
    lastAttempt: number;
    firstAttempt: number;
    lastError?: string;
    failureType?: FailureType;
  }> = new Map();

  // Track low balance warnings to avoid spam
  private lastLowBalanceWarning = 0;

  constructor(
    private blockchain: BlockchainService,
    private writer: ContractWriterService,
    @Inject(forwardRef(() => GameGateway))
    private gateway: GameGateway,
    private redisLock: RedisLockService,
  ) {}

  /**
   * Recovery cron - check for stuck locked arenas every 60 seconds
   * If an arena is LOCKED on-chain with vrfRequestId=0, retry VRF request
   *
   * KEY DESIGN: This is STATE-DRIVEN recovery.
   * - Temporary failures (insufficient funds) retry INDEFINITELY
   * - Unknown errors default to TEMPORARY (safe default)
   * - Only explicitly known permanent errors (ArenaNotLocked, UnauthorizedCaller) stop retrying
   * - Auto-cancels arenas stuck >15 min to return funds to participants
   * - Balance check BEFORE attempting VRF to avoid wasted gas
   */
  @Cron('*/60 * * * * *')
  async recoverStuckArenas(): Promise<void> {
    try {
      const totalArenas = await this.blockchain.getTotalArenas();
      if (totalArenas === 0n) return;

      // Check BattleEngine balance FIRST - no point trying if broke
      const balanceCheck = await this.checkBattleEngineBalance();
      if (!balanceCheck.sufficient) {
        // Log warning once per 5 minutes
        if (Date.now() - this.lastLowBalanceWarning > 300000) {
          this.logger.error(
            `[CRITICAL] BattleEngine has insufficient funds for VRF! ` +
            `Balance: ${balanceCheck.balance} ETH, Need: ${balanceCheck.vrfCost} ETH. ` +
            `Deposit ETH to ${this.blockchain.battleEngineAddress}`,
          );
          this.lastLowBalanceWarning = Date.now();
        }
        // Don't waste gas trying - but still check for auto-cancel candidates
      }

      // Warn if balance is low (but still sufficient)
      if (balanceCheck.sufficient && balanceCheck.lowBalance && Date.now() - this.lastLowBalanceWarning > 300000) {
        this.logger.warn(
          `[Warning] BattleEngine balance is low: ${balanceCheck.balance} ETH. ` +
          `Consider depositing more to ${this.blockchain.battleEngineAddress}`,
        );
        this.lastLowBalanceWarning = Date.now();
      }

      // Scan recent arenas (last RECOVERY_SCAN_RANGE)
      const startId = totalArenas > BigInt(RECOVERY_SCAN_RANGE) ? totalArenas - BigInt(RECOVERY_SCAN_RANGE) + 1n : 1n;
      const count = Number(totalArenas - startId + 1n);
      const arenas = await this.blockchain.getMultipleArenas(startId, count);

      const nowSeconds = Math.floor(Date.now() / 1000);

      for (const arena of arenas) {
        const arenaKey = arena.arenaId.toString();

        // === WATCHDOG: LOCKED with vrfRequestId > 0 but no seed (VRF callback never arrived) ===
        if (arena.state === ArenaState.LOCKED && arena.vrfRequestId > 0n && arena.seed === 0n) {
          const failInfo = this.failedArenas.get(arenaKey);
          // Only alert once per 5 minutes
          if (!failInfo || Date.now() - failInfo.lastAttempt > 300000) {
            this.logger.error(
              `[WATCHDOG] Arena ${arenaKey} has VRF request ${arena.vrfRequestId} but no seed! ` +
              `Chainlink callback may have failed. Manual investigation needed.`,
            );
            this.failedArenas.set(arenaKey, {
              attempts: failInfo?.attempts ?? 0,
              lastAttempt: Date.now(),
              firstAttempt: failInfo?.firstAttempt ?? Date.now(),
              lastError: 'VRF callback not delivered',
              failureType: FailureType.PERMANENT,
            });
          }
          continue;
        }

        // Only process LOCKED arenas with no VRF request
        if (arena.state !== ArenaState.LOCKED || arena.vrfRequestId > 0n) {
          // Clear from failed tracking if no longer stuck
          this.failedArenas.delete(arenaKey);
          continue;
        }

        // Skip if already being processed (check both in-memory and Redis)
        if (this.processingArenas.has(arenaKey)) continue;
        if (await this.redisLock.isLocked(`lock:vrf:${arenaKey}`)) continue;

        // === AUTO-CANCEL: Arena stuck too long ===
        const lockedDuration = nowSeconds - Number(arena.registrationEnd);
        const failInfo = this.failedArenas.get(arenaKey);

        if (lockedDuration > AUTO_CANCEL_TIMEOUT_S ||
            (failInfo && failInfo.failureType === FailureType.PERMANENT && failInfo.attempts >= MAX_PERMANENT_ATTEMPTS)) {
          this.logger.warn(
            `[AUTO-CANCEL] Arena ${arenaKey} stuck LOCKED for ${lockedDuration}s ` +
            `(attempts: ${failInfo?.attempts ?? 0}, lastError: ${failInfo?.lastError}). Auto-cancelling...`,
          );
          await this.autoCancelArena(arenaKey, BigInt(arenaKey));
          continue;
        }

        // Check retry limits
        if (failInfo) {
          // Wait at least 30 seconds between retries
          if (Date.now() - failInfo.lastAttempt < 30000) continue;
        }

        // Skip VRF attempt if balance insufficient (but still let auto-cancel above run)
        if (!balanceCheck.sufficient) continue;

        this.logger.warn(
          `[Recovery] Arena ${arenaKey} is LOCKED with no VRF request ` +
          `(attempt ${(failInfo?.attempts ?? 0) + 1}, type: ${failInfo?.failureType || 'new'}). Retrying...`,
        );

        await this.requestVRFForArena(arenaKey, BigInt(arenaKey));
      }
    } catch (error) {
      this.logger.error('[Recovery] Failed to scan for stuck arenas', error);
    }
  }

  /**
   * Check BattleEngine balance and compare to VRF cost
   */
  private async checkBattleEngineBalance(): Promise<{
    sufficient: boolean;
    lowBalance: boolean;
    balance: string;
    vrfCost: string;
  }> {
    try {
      const [balance, vrfCost] = await Promise.all([
        this.blockchain.getBattleEngineBalance(),
        this.blockchain.estimateVRFCost(),
      ]);

      const balanceEth = (Number(balance) / 1e18).toFixed(6);
      const vrfCostEth = (Number(vrfCost) / 1e18).toFixed(6);

      return {
        sufficient: balance >= vrfCost,
        lowBalance: balance < LOW_BALANCE_THRESHOLD,
        balance: balanceEth,
        vrfCost: vrfCostEth,
      };
    } catch (error) {
      this.logger.warn('Failed to check BattleEngine balance, proceeding anyway', error);
      return { sufficient: true, lowBalance: false, balance: 'unknown', vrfCost: 'unknown' };
    }
  }

  /**
   * Handle ArenaLocked event - automatically request VRF
   */
  @OnEvent('arena.locked')
  async handleArenaLocked(event: ArenaLockedEvent): Promise<void> {
    const { arenaId, participantCount, vrfRequestId } = event;
    const arenaKey = arenaId;
    const vrfRequestIdBigInt = BigInt(vrfRequestId);

    // Broadcast arena locked event (always, regardless of VRF status)
    this.broadcastArenaEvent(arenaKey, 'arena_locked', {
      participantCount,
      vrfRequestId,
    });

    // If vrfRequestId is already set (non-zero), VRF was already requested
    if (vrfRequestIdBigInt > 0n) {
      this.logger.log(`Arena ${arenaId} already has VRF request: ${vrfRequestId}`);
      return;
    }

    // CRITICAL: Atomic distributed lock to prevent race condition between
    // event handler and recovery cron. Redis SETNX is atomic — only one wins.
    const lockKey = `lock:vrf:${arenaKey}`;
    const acquired = await this.redisLock.acquireLock(lockKey, 30); // 30s TTL
    if (!acquired) {
      this.logger.warn(`Arena ${arenaId} VRF already being processed (Redis lock)`);
      return;
    }
    this.processingArenas.add(arenaKey);

    try {
      // Pre-flight: check BattleEngine balance before even trying
      const balanceCheck = await this.checkBattleEngineBalance();
      if (!balanceCheck.sufficient) {
        this.logger.error(
          `[VRF] BattleEngine balance too low for VRF on arena ${arenaId}: ` +
          `${balanceCheck.balance} ETH < ${balanceCheck.vrfCost} ETH. Will retry via cron.`,
        );
        this.trackFailure(arenaKey, `Insufficient BattleEngine balance: ${balanceCheck.balance} ETH`);
        return;
      }

      this.logger.log(
        `Arena ${arenaId} locked with ${participantCount} participants. Triggering VRF...`,
      );

      await this.requestVRFForArena(arenaKey, BigInt(arenaId));
    } catch (error) {
      this.logger.error(`[VRF] handleArenaLocked error for arena ${arenaId}:`, error);
    } finally {
      // Release lock after a cooldown (requestVRFForArena also manages this,
      // but we need a fallback in case we returned early above)
      setTimeout(async () => {
        this.processingArenas.delete(arenaKey);
        await this.redisLock.releaseLock(lockKey);
      }, 10000);
    }
  }

  /**
   * Core VRF request logic with proper error tracking
   */
  private async requestVRFForArena(arenaKey: string, arenaIdBigInt: bigint): Promise<boolean> {
    // Idempotent add — caller may have already claimed the lock (handleArenaLocked does).
    // The cron path checks processingArenas before calling, so this is just a safety net.
    const lockKey = `lock:vrf:${arenaKey}`;
    // Try to acquire if not already held (cron path). handleArenaLocked already acquired.
    await this.redisLock.acquireLock(lockKey, 30);
    this.processingArenas.add(arenaKey);

    try {
      // Verify arena state before requesting
      const arena = await this.blockchain.getArena(arenaIdBigInt);

      if (arena.state !== ArenaState.LOCKED) {
        this.logger.warn(
          `Arena ${arenaKey} state is ${arena.state}, expected LOCKED (2). Skipping VRF.`,
        );
        this.failedArenas.delete(arenaKey);
        return false;
      }

      // Check if VRF was already requested (double-check on-chain)
      if (arena.vrfRequestId > 0n) {
        this.logger.log(`Arena ${arenaKey} already has on-chain VRF request: ${arena.vrfRequestId}`);
        this.failedArenas.delete(arenaKey);
        return true;
      }

      // Log diagnostic info
      const nowSeconds = Math.floor(Date.now() / 1000);
      this.logger.log(
        `[VRF] Arena ${arenaKey}: state=LOCKED, registrationEnd=${arena.registrationEnd}, ` +
        `delta=${nowSeconds - Number(arena.registrationEnd)}s`,
      );

      // Request VRF randomness (uses VRF-specific circuit breaker)
      const result = await this.writer.requestRandomness(arenaIdBigInt);

      if (result.success) {
        this.logger.log(
          `VRF requested for arena ${arenaKey}: txHash=${result.hash}`,
        );
        this.failedArenas.delete(arenaKey);

        // Broadcast VRF requested event
        this.broadcastArenaEvent(arenaKey, 'vrf_requested', {
          txHash: result.hash,
        });
        return true;
      } else {
        const errorMsg = result.error || 'VRF request failed';

        // InvalidVRFRequest means VRF was already requested by another code path
        // (race condition between event handler and cron). This is actually success —
        // do NOT broadcast arena_error to scare users.
        if (this.isAlreadyRequestedError(errorMsg)) {
          this.logger.log(
            `[VRF] Arena ${arenaKey}: VRF already requested (race condition resolved). No error.`,
          );
          this.failedArenas.delete(arenaKey);
          return true;
        }

        this.logger.error(
          `VRF request FAILED for arena ${arenaKey}: ${errorMsg}`,
        );
        this.trackFailure(arenaKey, errorMsg);

        // Only broadcast real errors to frontend, not race-condition artifacts
        this.broadcastArenaEvent(arenaKey, 'arena_error', {
          error: errorMsg,
        });
        return false;
      }
    } catch (error) {
      const errorMsg = (error as Error).message;

      // Same check for thrown errors (viem throws instead of returning error)
      if (this.isAlreadyRequestedError(errorMsg)) {
        this.logger.log(
          `[VRF] Arena ${arenaKey}: VRF already requested (race condition resolved). No error.`,
        );
        this.failedArenas.delete(arenaKey);
        return true;
      }

      this.logger.error(
        `VRF request THREW for arena ${arenaKey}: ${errorMsg}`,
        (error as Error).stack,
      );
      this.trackFailure(arenaKey, errorMsg);

      this.broadcastArenaEvent(arenaKey, 'arena_error', {
        error: errorMsg,
      });
      return false;
    } finally {
      // Remove from processing after a short delay + release Redis lock
      setTimeout(async () => {
        this.processingArenas.delete(arenaKey);
        await this.redisLock.releaseLock(lockKey);
      }, 10000); // 10 second cooldown
    }
  }

  /**
   * Check if a VRF error means "already requested" — which is actually success.
   * These errors occur during race conditions between the event handler and cron,
   * and should NOT be broadcast to the frontend as errors.
   */
  private isAlreadyRequestedError(errorMsg: string): boolean {
    const lower = errorMsg.toLowerCase();
    return lower.includes('invalidvrfrequest') || lower.includes('invalid vrf request');
  }

  /**
   * Auto-cancel an arena that has been stuck too long.
   * Cancels on-chain so participants can claim refunds.
   */
  private async autoCancelArena(arenaKey: string, arenaId: bigint): Promise<void> {
    try {
      const result = await this.writer.cancelArena(arenaId);

      if (result.success) {
        this.logger.warn(
          `[AUTO-CANCEL] Arena ${arenaKey} cancelled successfully: txHash=${result.hash}. ` +
          `Participants can claim refunds.`,
        );
        this.failedArenas.delete(arenaKey);

        this.broadcastArenaEvent(arenaKey, 'arena_locked', {
          vrfRequestId: '0',
        });
      } else {
        this.logger.error(
          `[AUTO-CANCEL] Failed to cancel arena ${arenaKey}: ${result.error}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `[AUTO-CANCEL] Exception cancelling arena ${arenaKey}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Track a failed VRF attempt for retry logic
   * Classifies failure as TEMPORARY (keep retrying) or PERMANENT (count toward auto-cancel)
   */
  private trackFailure(arenaKey: string, errorMsg: string): void {
    const existing = this.failedArenas.get(arenaKey);

    // Classify the failure type based on error message
    const failureType = this.classifyFailure(errorMsg);

    this.failedArenas.set(arenaKey, {
      attempts: (existing?.attempts ?? 0) + 1,
      lastAttempt: Date.now(),
      firstAttempt: existing?.firstAttempt ?? Date.now(),
      lastError: errorMsg,
      failureType,
    });
  }

  /**
   * Classify error as temporary (recoverable) or permanent (unrecoverable)
   *
   * DEFAULT IS TEMPORARY — only explicitly known contract errors are permanent.
   * This prevents unknown/transient errors from killing arenas after 5 attempts.
   */
  private classifyFailure(errorMsg: string): FailureType {
    const lowerError = errorMsg.toLowerCase();

    // PERMANENT failures - only known contract-level errors that will never succeed
    const permanentPatterns = [
      'arenanotlocked',
      'arenanotready',
      'unauthorizedcaller',
      'invalidvrfrequest', // VRF already requested on-chain
      'battlealreadyexecuted',
      'invalidstate',
      'arena not found',
    ];

    for (const pattern of permanentPatterns) {
      if (lowerError.includes(pattern)) {
        return FailureType.PERMANENT;
      }
    }

    // Everything else is TEMPORARY — safe default to keep retrying
    // This includes: insufficient funds, reverts without reason, network errors,
    // circuit breaker, gas issues, RPC errors, timeouts, etc.
    return FailureType.TEMPORARY;
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
   * Manual trigger - returns success/failure instead of swallowing errors
   */
  async triggerVRF(arenaId: bigint): Promise<boolean> {
    const arenaKey = arenaId.toString();

    // Clear any previous failure tracking and locks to allow fresh attempt
    this.failedArenas.delete(arenaKey);
    this.processingArenas.delete(arenaKey);
    await this.redisLock.releaseLock(`lock:vrf:${arenaKey}`);

    return this.requestVRFForArena(arenaKey, arenaId);
  }

  /**
   * Check if an arena is currently being processed
   */
  isProcessing(arenaId: bigint): boolean {
    // Synchronous in-memory check (Redis check is async, used in cron)
    return this.processingArenas.has(arenaId.toString());
  }

  /**
   * Get status of failed arenas for diagnostics
   */
  getFailedArenas(): Array<{ arenaId: string; attempts: number; lastAttempt: number; lastError?: string; failureType?: string }> {
    return Array.from(this.failedArenas.entries()).map(([arenaId, info]) => ({
      arenaId,
      ...info,
    }));
  }
}
