// ============================================
// ARENA SCANNER SERVICE - Auto-lock arenas that are ready
// ============================================

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BlockchainService, ArenaData } from '../blockchain/blockchain.service';
import { ContractWriterService } from '../blockchain/contract-writer.service';

// Arena state enum (matches contract)
enum ArenaState {
  CREATED = 0,
  OPEN = 1,
  LOCKED = 2,
  RUNNING = 3,
  FINISHED = 4,
  CANCELLED = 5,
}

@Injectable()
export class ArenaScannerService implements OnModuleInit {
  private readonly logger = new Logger(ArenaScannerService.name);

  // Track arenas we're currently locking to avoid double-locking
  private lockingArenas: Set<string> = new Set();

  // Track arenas we've already attempted to cancel (cooldown)
  private cancellingArenas: Set<string> = new Set();

  // Number of recent arenas to scan each cycle
  private readonly SCAN_BATCH_SIZE = 50;

  // Minimum time buffer after registration end (in seconds)
  private readonly LOCK_BUFFER_SECONDS = 10;

  private isEnabled = true; // ENABLED FOR TESTING
  private lastScanTime = 0;

  constructor(
    private blockchain: BlockchainService,
    private writer: ContractWriterService,
  ) {}

  async onModuleInit() {
    // Initial scan on startup (with delay to let other services initialize)
    setTimeout(() => {
      this.scanAndLockArenas();
    }, 5000);
  }

  /**
   * Cron job to scan for arenas ready to be locked
   * Runs every 30 seconds
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async handleCron(): Promise<void> {
    if (!this.isEnabled) return;
    await this.scanAndLockArenas();
  }

  /**
   * Main scanning logic
   */
  async scanAndLockArenas(): Promise<void> {
    // Prevent overlapping scans
    if (Date.now() - this.lastScanTime < 10000) {
      return;
    }
    this.lastScanTime = Date.now();

    try {
      const totalArenas = await this.blockchain.getTotalArenas();

      if (totalArenas === 0n) {
        this.logger.debug('No arenas to scan');
        return;
      }

      // Calculate range to scan (most recent arenas)
      const startId = totalArenas > BigInt(this.SCAN_BATCH_SIZE)
        ? totalArenas - BigInt(this.SCAN_BATCH_SIZE) + 1n
        : 1n;
      const count = Number(totalArenas - startId + 1n);

      this.logger.debug(`Scanning arenas ${startId} to ${totalArenas} (${count} arenas)`);

      // Fetch arenas
      const arenas = await this.blockchain.getMultipleArenas(startId, count);

      // Filter for arenas ready to lock
      const now = BigInt(Math.floor(Date.now() / 1000));
      const readyArenas = arenas.filter((arena) => this.isReadyForLock(arena, now));

      if (readyArenas.length === 0) {
        this.logger.debug('No arenas ready for locking');
        return;
      }

      this.logger.log(`Found ${readyArenas.length} arena(s) ready for locking`);

      // Lock each ready arena
      for (const arena of readyArenas) {
        await this.lockArena(arena);
      }
    } catch (error) {
      this.logger.error('Error scanning arenas', error);
    }
  }

  /**
   * Check if an arena is ready to be locked
   */
  private isReadyForLock(arena: ArenaData, now: bigint): boolean {
    // Must be in OPEN state
    if (arena.state !== ArenaState.OPEN) {
      return false;
    }

    // Not currently being locked
    if (this.lockingArenas.has(arena.arenaId.toString())) {
      return false;
    }

    // Calculate participant count from prize pool
    // participantCount = prizePool / entryFee (each participant adds entryFee to pool)
    const participantCount = arena.entryFee > 0n
      ? arena.prizePool / arena.entryFee
      : 0n;

    // CASE 1: Arena is FULL - lock immediately regardless of registration time
    if (participantCount >= arena.maxPlayers) {
      this.logger.log(
        `Arena ${arena.arenaId} is FULL (${participantCount}/${arena.maxPlayers}) - locking immediately!`,
      );
      return true;
    }

    // CASE 2: Registration has ended (with buffer) - check if minimum players reached
    const registrationEndWithBuffer = arena.registrationEnd + BigInt(this.LOCK_BUFFER_SECONDS);
    if (now >= registrationEndWithBuffer) {
      // Contract will validate minPlayers - if not enough, lock will fail
      return true;
    }

    return false;
  }

  /**
   * Lock a specific arena
   */
  private async lockArena(arena: ArenaData): Promise<void> {
    const arenaKey = arena.arenaId.toString();

    if (this.lockingArenas.has(arenaKey)) {
      return;
    }

    this.lockingArenas.add(arenaKey);

    try {
      this.logger.log(`Locking arena ${arena.arenaId}...`);

      const result = await this.writer.lockArena(arena.arenaId);

      if (result.success) {
        this.logger.log(
          `Arena ${arena.arenaId} locked successfully: txHash=${result.hash}`,
        );
      } else {
        this.logger.warn(
          `Failed to lock arena ${arena.arenaId}: ${result.error}`,
        );
      }
    } catch (error) {
      // Log but don't throw - this could be expected if min players not reached
      const errorMessage = (error as Error).message;

      if (errorMessage.includes('MinPlayersNotReached')) {
        this.logger.warn(
          `Arena ${arena.arenaId} cannot be locked: minimum players not reached. Auto-cancelling...`,
        );
        await this.cancelExpiredArena(arena);
      } else if (errorMessage.includes('ArenaNotOpen')) {
        this.logger.debug(`Arena ${arena.arenaId} is no longer in OPEN state`);
      } else {
        this.logger.error(`Error locking arena ${arena.arenaId}`, error);
      }
    } finally {
      // Remove from locking set after a delay
      setTimeout(() => {
        this.lockingArenas.delete(arenaKey);
      }, 60000); // 1 minute cooldown
    }
  }

  /**
   * Cancel an expired arena that failed to meet minimum players
   */
  private async cancelExpiredArena(arena: ArenaData): Promise<void> {
    const arenaKey = arena.arenaId.toString();

    if (this.cancellingArenas.has(arenaKey)) {
      return;
    }

    this.cancellingArenas.add(arenaKey);

    try {
      const result = await this.writer.cancelArena(arena.arenaId);

      if (result.success) {
        this.logger.log(
          `Arena ${arena.arenaId} cancelled (expired, min players not reached): txHash=${result.hash}`,
        );
      } else {
        this.logger.warn(`Failed to cancel arena ${arena.arenaId}: ${result.error}`);
      }
    } catch (error) {
      this.logger.error(`Error cancelling arena ${arena.arenaId}`, error);
    } finally {
      // 5 minute cooldown before retrying cancel
      setTimeout(() => {
        this.cancellingArenas.delete(arenaKey);
      }, 5 * 60 * 1000);
    }
  }

  /**
   * Enable/disable the scanner
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    this.logger.log(`Arena scanner ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Manual trigger for testing
   */
  async triggerScan(): Promise<void> {
    this.lastScanTime = 0; // Reset to allow immediate scan
    await this.scanAndLockArenas();
  }

  /**
   * Get current status
   */
  getStatus(): { isEnabled: boolean; lockingArenas: string[] } {
    return {
      isEnabled: this.isEnabled,
      lockingArenas: Array.from(this.lockingArenas),
    };
  }

  /**
   * Instantly lock an arena if it's full
   * Called by EventListenerService when AgentJoinedArena is detected
   * Returns true if lock was triggered, false otherwise
   */
  async lockArenaIfFull(arenaId: bigint): Promise<boolean> {
    const arenaKey = arenaId.toString();

    // Prevent concurrent lock attempts
    if (this.lockingArenas.has(arenaKey)) {
      this.logger.debug(`[Instant Lock] Arena ${arenaId} already being locked`);
      return false;
    }

    try {
      const arena = await this.blockchain.getArena(arenaId);

      // Must be in OPEN state
      if (arena.state !== ArenaState.OPEN) {
        return false;
      }

      // Calculate participant count
      const participantCount = arena.entryFee > 0n
        ? arena.prizePool / arena.entryFee
        : 0n;

      // Check if full
      if (participantCount >= arena.maxPlayers) {
        this.logger.log(
          `[Instant Lock] Arena ${arenaId} is FULL (${participantCount}/${arena.maxPlayers}) - locking NOW!`,
        );
        await this.lockArena(arena);
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error(`[Instant Lock] Failed to check arena ${arenaId}`, error);
      return false;
    }
  }
}
