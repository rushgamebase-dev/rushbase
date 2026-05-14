// ============================================
// ARENA PERSISTENCE SERVICE - Persists arena processing state for recovery
// ============================================

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Transaction state for tracking on-chain submissions
 */
export enum TxState {
  PENDING = 'PENDING',       // Tx submitted, waiting confirmation
  CONFIRMED = 'CONFIRMED',   // Tx confirmed on-chain
  FAILED = 'FAILED',         // Tx failed or reverted
  UNKNOWN = 'UNKNOWN',       // State unknown (needs recovery check)
}

/**
 * Arena processing record for persistence
 */
export interface ArenaProcessingRecord {
  arenaId: string;
  seed: string;
  status: 'simulating' | 'committing' | 'waiting_reveal' | 'revealing' | 'submitting' | 'distributing' | 'completed' | 'failed' | 'pending_recovery';
  startedAt: number;
  updatedAt: number;

  // Match data for recovery (persisted when match starts)
  matchData?: {
    matchId: string;
    configVersion: string;
    participants: Array<{
      agentId: string;
      owner: string;
      boostIds: string[];
    }>;
  };

  // Simulation result (if available)
  simulationResult?: {
    winnerId: string;
    winnerOwner: string;
    totalTicks: number;
    resultHash: string;
    eliminationOrder: Array<{
      agentId: string;
      eliminatedAt: number;
      source: string;
    }>;
  };

  // Transaction tracking
  submitBattleResultTx?: {
    hash: string;
    state: TxState;
    submittedAt: number;
    confirmedAt?: number;
    error?: string;
  };

  distributePrizesTx?: {
    hash: string;
    state: TxState;
    submittedAt: number;
    confirmedAt?: number;
    error?: string;
  };

  // Error tracking
  lastError?: string;
  retryCount: number;
}

/**
 * Persistence file structure
 */
interface PersistenceData {
  version: number;
  lastUpdated: number;
  arenas: Record<string, ArenaProcessingRecord>;
}

@Injectable()
export class ArenaPersistenceService implements OnModuleInit {
  private readonly logger = new Logger(ArenaPersistenceService.name);
  private readonly DATA_DIR = path.join(process.cwd(), 'data');
  private readonly PERSISTENCE_FILE = path.join(this.DATA_DIR, 'arena-processing.json');
  private readonly PERSISTENCE_VERSION = 1;

  private data: PersistenceData = {
    version: this.PERSISTENCE_VERSION,
    lastUpdated: Date.now(),
    arenas: {},
  };

  private saveDebounceTimer: NodeJS.Timeout | null = null;
  private readonly SAVE_DEBOUNCE_MS = 1000; // Debounce saves by 1 second

  async onModuleInit(): Promise<void> {
    await this.ensureDataDir();
    await this.loadFromDisk();
    this.logger.log(`Arena persistence initialized. ${Object.keys(this.data.arenas).length} records loaded.`);
  }

  /**
   * Ensure data directory exists
   */
  private async ensureDataDir(): Promise<void> {
    if (!fs.existsSync(this.DATA_DIR)) {
      fs.mkdirSync(this.DATA_DIR, { recursive: true });
      this.logger.log(`Created data directory: ${this.DATA_DIR}`);
    }
  }

  /**
   * Load persistence data from disk
   */
  private async loadFromDisk(): Promise<void> {
    try {
      if (fs.existsSync(this.PERSISTENCE_FILE)) {
        const content = fs.readFileSync(this.PERSISTENCE_FILE, 'utf-8');
        const loaded = JSON.parse(content) as PersistenceData;

        // Version check
        if (loaded.version !== this.PERSISTENCE_VERSION) {
          this.logger.warn(`Persistence version mismatch. Expected ${this.PERSISTENCE_VERSION}, got ${loaded.version}. Migrating...`);
          // Future: add migration logic here
        }

        this.data = loaded;
        this.logger.log(`Loaded ${Object.keys(this.data.arenas).length} arena records from disk`);
      }
    } catch (error) {
      this.logger.error('Failed to load persistence file, starting fresh', error);
      this.data = {
        version: this.PERSISTENCE_VERSION,
        lastUpdated: Date.now(),
        arenas: {},
      };
    }
  }

  /**
   * Save persistence data to disk (debounced)
   */
  private scheduleSave(): void {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }

    this.saveDebounceTimer = setTimeout(() => {
      this.saveToDisk();
    }, this.SAVE_DEBOUNCE_MS);
  }

  /**
   * Immediately save to disk
   */
  private saveToDisk(): void {
    try {
      this.data.lastUpdated = Date.now();
      const content = JSON.stringify(this.data, null, 2);

      // Write to temp file first, then rename (atomic operation)
      const tempFile = `${this.PERSISTENCE_FILE}.tmp`;
      fs.writeFileSync(tempFile, content, 'utf-8');
      fs.renameSync(tempFile, this.PERSISTENCE_FILE);

      this.logger.debug(`Saved ${Object.keys(this.data.arenas).length} arena records to disk`);
    } catch (error) {
      this.logger.error('Failed to save persistence file', error);
    }
  }

  /**
   * Force immediate save (call before shutdown)
   */
  async flushToDisk(): Promise<void> {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }
    this.saveToDisk();
  }

  // ============================================
  // Arena Record Operations
  // ============================================

  /**
   * Create or update an arena processing record
   */
  upsertArena(record: Partial<ArenaProcessingRecord> & { arenaId: string }): ArenaProcessingRecord {
    const existing = this.data.arenas[record.arenaId];

    const updated: ArenaProcessingRecord = {
      ...existing,
      ...record,
      updatedAt: Date.now(),
      retryCount: record.retryCount ?? existing?.retryCount ?? 0,
    };

    this.data.arenas[record.arenaId] = updated;
    this.scheduleSave();

    return updated;
  }

  /**
   * Get arena processing record
   */
  getArena(arenaId: string): ArenaProcessingRecord | undefined {
    return this.data.arenas[arenaId];
  }

  /**
   * Check if arena exists
   */
  hasArena(arenaId: string): boolean {
    return arenaId in this.data.arenas;
  }

  /**
   * Update arena status
   */
  updateStatus(
    arenaId: string,
    status: ArenaProcessingRecord['status'],
    error?: string
  ): void {
    const record = this.data.arenas[arenaId];
    if (record) {
      record.status = status;
      record.updatedAt = Date.now();
      if (error) {
        record.lastError = error;
      }
      this.scheduleSave();
    }
  }

  /**
   * Record submitBattleResult transaction
   */
  recordSubmitTx(arenaId: string, txHash: string): void {
    const record = this.data.arenas[arenaId];
    if (record) {
      record.submitBattleResultTx = {
        hash: txHash,
        state: TxState.PENDING,
        submittedAt: Date.now(),
      };
      record.updatedAt = Date.now();
      this.scheduleSave();
      this.logger.log(`Recorded submitBattleResult tx for arena ${arenaId}: ${txHash}`);
    }
  }

  /**
   * Confirm submitBattleResult transaction
   */
  confirmSubmitTx(arenaId: string): void {
    const record = this.data.arenas[arenaId];
    if (record?.submitBattleResultTx) {
      record.submitBattleResultTx.state = TxState.CONFIRMED;
      record.submitBattleResultTx.confirmedAt = Date.now();
      record.updatedAt = Date.now();
      this.scheduleSave();
    }
  }

  /**
   * Mark submitBattleResult transaction as failed
   */
  failSubmitTx(arenaId: string, error: string): void {
    const record = this.data.arenas[arenaId];
    if (record?.submitBattleResultTx) {
      record.submitBattleResultTx.state = TxState.FAILED;
      record.submitBattleResultTx.error = error;
      record.updatedAt = Date.now();
      this.scheduleSave();
    }
  }

  /**
   * Record distributePrizes transaction
   */
  recordDistributeTx(arenaId: string, txHash: string): void {
    const record = this.data.arenas[arenaId];
    if (record) {
      record.distributePrizesTx = {
        hash: txHash,
        state: TxState.PENDING,
        submittedAt: Date.now(),
      };
      record.updatedAt = Date.now();
      this.scheduleSave();
      this.logger.log(`Recorded distributePrizes tx for arena ${arenaId}: ${txHash}`);
    }
  }

  /**
   * Confirm distributePrizes transaction
   */
  confirmDistributeTx(arenaId: string): void {
    const record = this.data.arenas[arenaId];
    if (record?.distributePrizesTx) {
      record.distributePrizesTx.state = TxState.CONFIRMED;
      record.distributePrizesTx.confirmedAt = Date.now();
      record.updatedAt = Date.now();
      this.scheduleSave();
    }
  }

  /**
   * Mark distributePrizes transaction as failed
   */
  failDistributeTx(arenaId: string, error: string): void {
    const record = this.data.arenas[arenaId];
    if (record?.distributePrizesTx) {
      record.distributePrizesTx.state = TxState.FAILED;
      record.distributePrizesTx.error = error;
      record.updatedAt = Date.now();
      this.scheduleSave();
    }
  }

  /**
   * Mark arena as completed and schedule cleanup
   */
  markCompleted(arenaId: string): void {
    const record = this.data.arenas[arenaId];
    if (record) {
      record.status = 'completed';
      record.updatedAt = Date.now();
      this.scheduleSave();

      // Schedule cleanup after 24 hours (keep for audit trail)
      setTimeout(() => {
        this.deleteArena(arenaId);
      }, 24 * 60 * 60 * 1000);
    }
  }

  /**
   * Delete arena record
   */
  deleteArena(arenaId: string): void {
    if (this.data.arenas[arenaId]) {
      delete this.data.arenas[arenaId];
      this.scheduleSave();
      this.logger.debug(`Deleted arena record: ${arenaId}`);
    }
  }

  /**
   * Clear ALL arena records (used after contract upgrades)
   */
  clearAll(): void {
    const count = Object.keys(this.data.arenas).length;
    this.data.arenas = {};
    this.data.lastUpdated = Date.now();
    this.saveToDisk();
    this.logger.warn(`Cleared all ${count} arena records from persistence`);
  }

  /**
   * Increment retry count
   */
  incrementRetry(arenaId: string): number {
    const record = this.data.arenas[arenaId];
    if (record) {
      record.retryCount = (record.retryCount || 0) + 1;
      record.updatedAt = Date.now();
      this.scheduleSave();
      return record.retryCount;
    }
    return 0;
  }

  // ============================================
  // Recovery Operations
  // ============================================

  /**
   * Get all arenas that need recovery
   * These are arenas that were processing when the server crashed
   */
  getArenasNeedingRecovery(): ArenaProcessingRecord[] {
    const needsRecovery: ArenaProcessingRecord[] = [];

    for (const record of Object.values(this.data.arenas)) {
      // Skip completed or explicitly failed (after max retries)
      if (record.status === 'completed') continue;
      if (record.status === 'failed' && record.retryCount >= 3) continue;

      // These states need recovery:
      // - simulating: crashed during simulation
      // - submitting: crashed during/after submitBattleResult
      // - distributing: crashed during/after distributePrizes
      // - pending_recovery: marked for recovery in previous boot
      needsRecovery.push(record);
    }

    return needsRecovery;
  }

  /**
   * Get arenas with pending transactions that need verification
   */
  getArenasWithPendingTx(): ArenaProcessingRecord[] {
    return Object.values(this.data.arenas).filter(record =>
      record.submitBattleResultTx?.state === TxState.PENDING ||
      record.distributePrizesTx?.state === TxState.PENDING
    );
  }

  /**
   * Get all arena records (for debugging/monitoring)
   */
  getAllArenas(): ArenaProcessingRecord[] {
    return Object.values(this.data.arenas);
  }

  /**
   * Get arena count by status
   */
  getStatusCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const record of Object.values(this.data.arenas)) {
      counts[record.status] = (counts[record.status] || 0) + 1;
    }
    return counts;
  }
}
