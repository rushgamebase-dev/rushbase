// ============================================
// EVENT LISTENER SERVICE - Backfill + Live Watch
// ============================================
// CRITICAL: This service now properly indexes ALL historical events
// on startup before starting the live watcher. This ensures no
// arenas are "lost" after restarts.

import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject, forwardRef } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BlockchainService, ABIS } from './blockchain.service';
import { RETRY_CONFIG, CONTRACT_ADDRESSES } from '../config/contracts.config';
import { ArenaStoreService, ChainEvent } from '../arena/arena-store.service';
import { GameGateway } from '../game/game.gateway';
import { ArenaScannerService } from '../arena/arena-scanner.service';
import { PrismaService } from '../arena-ledger/prisma.service';
import { parseAbiItem, type Log } from 'viem';

// Event payload types for internal use (string format for cross-module compatibility)
export interface ArenaStartedEvent {
  arenaId: string;
  seed: string;
  blockNumber: number;
  txHash: string;
}

export interface ArenaLockedEvent {
  arenaId: string;
  participantCount: number;
  vrfRequestId: string;
  blockNumber: number;
  txHash: string;
}

// Deployment block for ArenaManager contract (saves indexing time)
// Updated after V2 proxy upgrade on 2026-02-11
const ARENA_MANAGER_DEPLOYMENT_BLOCK = BigInt(
  process.env.ARENA_MANAGER_DEPLOYMENT_BLOCK || '41995553'
);

@Injectable()
export class EventListenerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventListenerService.name);

  // Unwatch functions for cleanup
  private unwatchers: Array<() => void> = [];
  private reconnectAttempts = 0;
  private isShuttingDown = false;
  private isBackfillComplete = false;

  // Block timestamp cache to avoid repeated RPC calls
  // Key: blockNumber, Value: Date (block.timestamp converted)
  private blockTimestampCache: Map<number, Date> = new Map();

  constructor(
    private blockchain: BlockchainService,
    private eventEmitter: EventEmitter2,
    private arenaStore: ArenaStoreService,
    @Inject(forwardRef(() => GameGateway))
    private gateway: GameGateway,
    @Inject(forwardRef(() => ArenaScannerService))
    private arenaScanner: ArenaScannerService,
    private prisma: PrismaService,
  ) {}

  async onModuleInit() {
    // Run backfill in background to not block server startup
    // This allows health checks to pass while indexing happens
    this.backfillAndStartListening().catch((err) => {
      this.logger.error('Failed to initialize event indexer', err);
    });
  }

  async onModuleDestroy() {
    this.isShuttingDown = true;
    this.stopListening();
  }

  // ============================================
  // BACKFILL + START LISTENING (MAIN ENTRY)
  // ============================================

  private async backfillAndStartListening(): Promise<void> {
    try {
      this.logger.log('='.repeat(60));
      this.logger.log('STARTING EVENT INDEXER WITH HISTORICAL BACKFILL');
      this.logger.log('='.repeat(60));

      // Step 0: Hydrate ArenaStore from PostgreSQL (instant, no RPC calls)
      // This ensures data is immediately available even if RPC backfill fails
      try {
        const dbArenas = await this.prisma.arenaRecord.findMany({
          include: {
            participants: true,
            events: { orderBy: { blockNumber: 'asc' } },
          },
        });

        if (dbArenas.length > 0) {
          const hydrated = this.arenaStore.hydrateFromDatabase(dbArenas);
          this.logger.log(`[Hydration] Restored ${hydrated} arenas from PostgreSQL`);
        } else {
          this.logger.log('[Hydration] No arenas in PostgreSQL yet');
        }
      } catch (hydrateError) {
        this.logger.warn('[Hydration] Failed to hydrate from PostgreSQL, will rely on RPC backfill', hydrateError);
      }

      // Step 1: Get or create checkpoint (with retry)
      let checkpoint: { lastBlockNumber: bigint };
      try {
        checkpoint = await this.getOrCreateCheckpoint();
        this.logger.log(`Checkpoint loaded: lastBlock=${checkpoint.lastBlockNumber}`);
      } catch (dbError) {
        this.logger.warn('Could not load checkpoint, starting from deployment block', dbError);
        checkpoint = { lastBlockNumber: 0n };
      }

      // Step 2: Get current block
      const publicClient = this.blockchain.getPublicClient();
      const currentBlock = await publicClient.getBlockNumber();
      this.logger.log(`Current chain block: ${currentBlock}`);

      // Step 3: Determine from which block to start
      const fromBlock = checkpoint.lastBlockNumber > 0n
        ? checkpoint.lastBlockNumber + 1n
        : ARENA_MANAGER_DEPLOYMENT_BLOCK;

      // Step 4: Backfill if needed
      if (fromBlock < currentBlock) {
        this.logger.log(`Backfilling events from block ${fromBlock} to ${currentBlock}...`);
        try {
          await this.backfillHistoricalEvents(fromBlock, currentBlock);
          this.logger.log('Backfill complete!');
        } catch (backfillError) {
          this.logger.error('Backfill failed, continuing with live watcher (data already hydrated from DB)', backfillError);
        }
      } else {
        this.logger.log('No backfill needed - checkpoint is up to date');
      }

      this.isBackfillComplete = true;

      // Step 5: Start live watchers
      await this.startListening();

      this.logger.log('='.repeat(60));
      this.logger.log('EVENT INDEXER FULLY OPERATIONAL');
      this.logger.log(`Indexed arenas: ${this.arenaStore.getAllArenaIds().length}`);
      this.logger.log('='.repeat(60));
    } catch (error) {
      this.logger.error('Failed to initialize event indexer', error);
      // Still try to start live listeners even if backfill failed
      try {
        await this.startListening();
        this.logger.warn('Started live listeners without backfill');
      } catch (listenerError) {
        this.logger.error('Failed to start live listeners', listenerError);
        this.scheduleReconnect();
      }
    }
  }

  // ============================================
  // CHECKPOINT MANAGEMENT
  // ============================================

  private async getOrCreateCheckpoint(): Promise<{ lastBlockNumber: bigint }> {
    let checkpoint = await this.prisma.indexerCheckpoint.findUnique({
      where: { id: 'main' },
    });

    if (!checkpoint) {
      checkpoint = await this.prisma.indexerCheckpoint.create({
        data: {
          id: 'main',
          lastBlockNumber: '0',
          contractAddress: CONTRACT_ADDRESSES.ARENA_MANAGER,
          chainId: 8453,
        },
      });
      this.logger.log('Created new indexer checkpoint');
    }

    return {
      lastBlockNumber: BigInt(checkpoint.lastBlockNumber),
    };
  }

  private async updateCheckpoint(blockNumber: bigint): Promise<void> {
    await this.prisma.indexerCheckpoint.update({
      where: { id: 'main' },
      data: {
        lastBlockNumber: blockNumber.toString(),
        updatedAt: new Date(),
      },
    });
  }

  // ============================================
  // BLOCK TIMESTAMP CACHE
  // ============================================

  /**
   * Get block timestamp with caching.
   * Critical for transparency: we MUST use block.timestamp, NOT server time.
   */
  private async getBlockTimestamp(blockNumber: number): Promise<Date> {
    // Check cache first
    const cached = this.blockTimestampCache.get(blockNumber);
    if (cached) {
      return cached;
    }

    // Fetch from chain
    const publicClient = this.blockchain.getPublicClient();
    const block = await publicClient.getBlock({ blockNumber: BigInt(blockNumber) });
    const timestamp = new Date(Number(block.timestamp) * 1000);

    // Cache it
    this.blockTimestampCache.set(blockNumber, timestamp);

    // Prune cache if too large (keep last 10000 blocks)
    if (this.blockTimestampCache.size > 10000) {
      const keys = Array.from(this.blockTimestampCache.keys()).sort((a, b) => a - b);
      for (let i = 0; i < 1000; i++) {
        this.blockTimestampCache.delete(keys[i]);
      }
    }

    return timestamp;
  }

  // ============================================
  // HISTORICAL BACKFILL
  // ============================================

  private async backfillHistoricalEvents(fromBlock: bigint, toBlock: bigint): Promise<void> {
    // Process in chunks to avoid RPC limits
    const CHUNK_SIZE = 10000n;
    let currentFrom = fromBlock;

    while (currentFrom <= toBlock) {
      const currentTo = currentFrom + CHUNK_SIZE > toBlock ? toBlock : currentFrom + CHUNK_SIZE;

      this.logger.log(`Processing blocks ${currentFrom} to ${currentTo}...`);

      try {
        await this.processBackfillChunk(currentFrom, currentTo);
        await this.updateCheckpoint(currentTo);
      } catch (error) {
        this.logger.error(`Error processing chunk ${currentFrom}-${currentTo}`, error);

        // Wait 3s then retry the same chunk once
        await new Promise(resolve => setTimeout(resolve, 3000));
        this.logger.warn(`Retrying chunk ${currentFrom}-${currentTo}...`);
        try {
          await this.processBackfillChunk(currentFrom, currentTo);
          await this.updateCheckpoint(currentTo);
        } catch (retryError) {
          this.logger.error(`Retry failed for chunk ${currentFrom}-${currentTo}, skipping (data available from DB hydration)`, retryError);
        }
      }

      currentFrom = currentTo + 1n;
    }
  }

  /**
   * Process a single backfill chunk - fetch events from chain and process them
   */
  private async processBackfillChunk(fromBlock: bigint, toBlock: bigint): Promise<void> {
    const publicClient = this.blockchain.getPublicClient();
    const arenaManagerAddress = this.blockchain.arenaManagerAddress;
    const battleEngineAddress = this.blockchain.battleEngineAddress;

    // Fetch ArenaManager events using getContractEvents (auto-decodes)
    const arenaCreatedEvents = await publicClient.getContractEvents({
      address: arenaManagerAddress,
      abi: ABIS.ArenaManager,
      eventName: 'ArenaCreated',
      fromBlock,
      toBlock,
    });

    const agentJoinedEvents = await publicClient.getContractEvents({
      address: arenaManagerAddress,
      abi: ABIS.ArenaManager,
      eventName: 'AgentJoinedArena',
      fromBlock,
      toBlock,
    });

    const arenaLockedEvents = await publicClient.getContractEvents({
      address: arenaManagerAddress,
      abi: ABIS.ArenaManager,
      eventName: 'ArenaLocked',
      fromBlock,
      toBlock,
    });

    const arenaStartedEvents = await publicClient.getContractEvents({
      address: arenaManagerAddress,
      abi: ABIS.ArenaManager,
      eventName: 'ArenaStarted',
      fromBlock,
      toBlock,
    });

    const arenaCancelledEvents = await publicClient.getContractEvents({
      address: arenaManagerAddress,
      abi: ABIS.ArenaManager,
      eventName: 'ArenaCancelled',
      fromBlock,
      toBlock,
    });

    const refundClaimedEvents = await publicClient.getContractEvents({
      address: arenaManagerAddress,
      abi: ABIS.ArenaManager,
      eventName: 'RefundClaimed',
      fromBlock,
      toBlock,
    });

    // Fetch BattleEngine events
    const vrfRequestedEvents = await publicClient.getContractEvents({
      address: battleEngineAddress,
      abi: ABIS.BattleEngine,
      eventName: 'VRFRequested',
      fromBlock,
      toBlock,
    });

    const battleExecutedEvents = await publicClient.getContractEvents({
      address: battleEngineAddress,
      abi: ABIS.BattleEngine,
      eventName: 'BattleExecuted',
      fromBlock,
      toBlock,
    });

    const prizesDistributedEvents = await publicClient.getContractEvents({
      address: battleEngineAddress,
      abi: ABIS.BattleEngine,
      eventName: 'PayoutDistributed',
      fromBlock,
      toBlock,
    });

    // Commit-reveal events (V2 contracts)
    const battleRevealedEvents = await publicClient.getContractEvents({
      address: battleEngineAddress,
      abi: ABIS.BattleEngine,
      eventName: 'BattleResultRevealed',
      fromBlock,
      toBlock,
    });

    const arenaFinishedEvents = await publicClient.getContractEvents({
      address: arenaManagerAddress,
      abi: ABIS.ArenaManager,
      eventName: 'ArenaFinished',
      fromBlock,
      toBlock,
    });

    // Tag each event with its type and combine
    const taggedEvents = [
      ...arenaCreatedEvents.map(e => ({ ...e, _eventName: 'ArenaCreated' })),
      ...agentJoinedEvents.map(e => ({ ...e, _eventName: 'AgentJoinedArena' })),
      ...arenaLockedEvents.map(e => ({ ...e, _eventName: 'ArenaLocked' })),
      ...arenaStartedEvents.map(e => ({ ...e, _eventName: 'ArenaStarted' })),
      ...arenaCancelledEvents.map(e => ({ ...e, _eventName: 'ArenaCancelled' })),
      ...refundClaimedEvents.map(e => ({ ...e, _eventName: 'RefundClaimed' })),
      ...vrfRequestedEvents.map(e => ({ ...e, _eventName: 'VRFRequested' })),
      ...battleExecutedEvents.map(e => ({ ...e, _eventName: 'BattleExecuted' })),
      ...battleRevealedEvents.map(e => ({ ...e, _eventName: 'BattleResultRevealed' })),
      ...prizesDistributedEvents.map(e => ({ ...e, _eventName: 'PayoutDistributed' })),
      ...arenaFinishedEvents.map(e => ({ ...e, _eventName: 'ArenaFinished' })),
    ];

    // Sort by block number and log index
    taggedEvents.sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) {
        return Number(a.blockNumber) - Number(b.blockNumber);
      }
      return Number(a.logIndex) - Number(b.logIndex);
    });

    this.logger.log(`Found ${taggedEvents.length} events in this chunk`);

    // Process each event
    for (const event of taggedEvents) {
      try {
        await this.processDecodedLog(
          { eventName: (event as any)._eventName, args: event.args },
          event,
          false, // don't broadcast during backfill
        );
      } catch (err) {
        this.logger.warn(`Failed to process ${(event as any)._eventName} at block ${event.blockNumber}`, err);
      }
    }
  }

  private async processDecodedLog(
    decoded: { eventName: string; args: any },
    log: any,
    shouldBroadcast: boolean,
  ): Promise<void> {
    const { eventName, args } = decoded;

    // Get block timestamp - this is the SOURCE OF TRUTH for transparency
    const blockTimestamp = await this.getBlockTimestamp(Number(log.blockNumber));

    switch (eventName) {
      case 'ArenaCreated':
        await this.handleArenaCreatedInternal(args, log, shouldBroadcast, blockTimestamp);
        break;
      case 'AgentJoinedArena':
        await this.handleAgentJoinedInternal(args, log, shouldBroadcast, blockTimestamp);
        break;
      case 'ArenaLocked':
        await this.handleArenaLockedInternal(args, log, shouldBroadcast, blockTimestamp);
        break;
      case 'ArenaCancelled':
        await this.handleArenaCancelledInternal(args, log, shouldBroadcast, blockTimestamp);
        break;
      case 'RefundClaimed':
        await this.handleRefundClaimedInternal(args, log, shouldBroadcast, blockTimestamp);
        break;
      case 'ArenaStarted':
        await this.handleArenaStartedInternal(args, log, shouldBroadcast, blockTimestamp);
        break;
      case 'VRFRequested':
        await this.handleVRFRequestedInternal(args, log, shouldBroadcast, blockTimestamp);
        break;
      case 'BattleExecuted':
      case 'BattleResultRevealed': // Commit-reveal path emits this instead of BattleExecuted
        await this.handleBattleExecutedInternal(args, log, shouldBroadcast, blockTimestamp);
        break;
      case 'PayoutDistributed':
        await this.handlePrizesDistributedInternal(args, log, shouldBroadcast, blockTimestamp);
        break;
      case 'ArenaFinished':
        await this.handleArenaFinishedInternal(args, log, shouldBroadcast, blockTimestamp);
        break;
      default:
        this.logger.debug(`Unknown event: ${eventName}`);
    }
  }

  // ============================================
  // LIVE EVENT LISTENING
  // ============================================

  private async startListening(): Promise<void> {
    try {
      const publicClient = this.blockchain.getPublicClient();
      const arenaManagerAddress = this.blockchain.arenaManagerAddress;
      const battleEngineAddress = this.blockchain.battleEngineAddress;

      this.logger.log('Starting live event watchers...');

      // ============================================
      // ARENA MANAGER EVENTS
      // ============================================

      // ArenaCreated
      this.unwatchers.push(
        publicClient.watchContractEvent({
          address: arenaManagerAddress,
          abi: ABIS.ArenaManager,
          eventName: 'ArenaCreated',
          onLogs: (logs) => logs.forEach((log) => this.handleArenaCreated(log)),
          onError: (error) => this.handleConnectionError(error),
        }),
      );

      // AgentJoinedArena
      this.unwatchers.push(
        publicClient.watchContractEvent({
          address: arenaManagerAddress,
          abi: ABIS.ArenaManager,
          eventName: 'AgentJoinedArena',
          onLogs: (logs) => logs.forEach((log) => this.handleAgentJoined(log)),
          onError: (error) => this.handleConnectionError(error),
        }),
      );

      // ArenaLocked
      this.unwatchers.push(
        publicClient.watchContractEvent({
          address: arenaManagerAddress,
          abi: ABIS.ArenaManager,
          eventName: 'ArenaLocked',
          onLogs: (logs) => logs.forEach((log) => this.handleArenaLocked(log)),
          onError: (error) => this.handleConnectionError(error),
        }),
      );

      // ArenaCancelled
      this.unwatchers.push(
        publicClient.watchContractEvent({
          address: arenaManagerAddress,
          abi: ABIS.ArenaManager,
          eventName: 'ArenaCancelled',
          onLogs: (logs) => logs.forEach((log) => this.handleArenaCancelled(log)),
          onError: (error) => this.handleConnectionError(error),
        }),
      );

      // RefundClaimed
      this.unwatchers.push(
        publicClient.watchContractEvent({
          address: arenaManagerAddress,
          abi: ABIS.ArenaManager,
          eventName: 'RefundClaimed',
          onLogs: (logs) => logs.forEach((log) => this.handleRefundClaimed(log)),
          onError: (error) => this.handleConnectionError(error),
        }),
      );

      // ArenaStarted (VRF callback delivers this)
      this.unwatchers.push(
        publicClient.watchContractEvent({
          address: arenaManagerAddress,
          abi: ABIS.ArenaManager,
          eventName: 'ArenaStarted',
          onLogs: (logs) => logs.forEach((log) => this.handleArenaStarted(log)),
          onError: (error) => this.handleConnectionError(error),
        }),
      );

      // ============================================
      // BATTLE ENGINE EVENTS
      // ============================================

      // VRFRequested
      this.unwatchers.push(
        publicClient.watchContractEvent({
          address: battleEngineAddress,
          abi: ABIS.BattleEngine,
          eventName: 'VRFRequested',
          onLogs: (logs) => logs.forEach((log) => this.handleVRFRequested(log)),
          onError: (error) => this.handleConnectionError(error),
        }),
      );

      // BattleExecuted
      this.unwatchers.push(
        publicClient.watchContractEvent({
          address: battleEngineAddress,
          abi: ABIS.BattleEngine,
          eventName: 'BattleExecuted',
          onLogs: (logs) => logs.forEach((log) => this.handleBattleExecuted(log)),
          onError: (error) => this.handleConnectionError(error),
        }),
      );

      // PayoutDistributed
      this.unwatchers.push(
        publicClient.watchContractEvent({
          address: battleEngineAddress,
          abi: ABIS.BattleEngine,
          eventName: 'PayoutDistributed',
          onLogs: (logs) => logs.forEach((log) => this.handlePrizesDistributed(log)),
          onError: (error) => this.handleConnectionError(error),
        }),
      );

      // BattleResultRevealed (commit-reveal path — same data as BattleExecuted)
      this.unwatchers.push(
        publicClient.watchContractEvent({
          address: battleEngineAddress,
          abi: ABIS.BattleEngine,
          eventName: 'BattleResultRevealed',
          onLogs: (logs) => logs.forEach((log) => this.handleBattleExecuted(log)),
          onError: (error) => this.handleConnectionError(error),
        }),
      );

      // ArenaFinished (emitted by ArenaManager when prizes distributed)
      this.unwatchers.push(
        publicClient.watchContractEvent({
          address: arenaManagerAddress,
          abi: ABIS.ArenaManager,
          eventName: 'ArenaFinished',
          onLogs: (logs) => logs.forEach((log) => this.handleArenaFinished(log)),
          onError: (error) => this.handleConnectionError(error),
        }),
      );

      this.reconnectAttempts = 0;
      this.logger.log(`Listening for ${this.unwatchers.length} live event types`);
    } catch (error) {
      this.logger.error('Failed to start event listeners', error);
      this.scheduleReconnect();
    }
  }

  private stopListening(): void {
    for (const unwatch of this.unwatchers) {
      try {
        unwatch();
      } catch (e) {
        // Ignore errors during cleanup
      }
    }
    this.unwatchers = [];
    this.logger.log('All event listeners stopped');
  }

  // ============================================
  // INTERNAL HANDLERS (used by both backfill and live)
  // ============================================

  private async handleArenaCreatedInternal(args: any, log: any, shouldBroadcast: boolean, blockTimestamp: Date): Promise<void> {
    const { arenaId, creator, entryFee, minPlayers, maxPlayers } = args;
    const arenaIdStr = arenaId.toString();

    this.logger.log(`ArenaCreated: arenaId=${arenaIdStr}, creator=${creator}${shouldBroadcast ? '' : ' (backfill)'}`);

    // Store in arena store
    const event = this.arenaStore.handleArenaCreated(
      arenaIdStr,
      creator,
      entryFee.toString(),
      Number(minPlayers),
      Number(maxPlayers),
      Number(log.blockNumber),
      log.transactionHash,
      Number(log.logIndex || 0),
    );

    if (shouldBroadcast) {
      this.broadcastGlobal(event);
      this.broadcastToArena(arenaIdStr, event);
    }

    // Emit for ledger indexing - blockTimestamp is SOURCE OF TRUTH
    const createdPayload = {
      arenaId: arenaIdStr,
      creator,
      entryFee: entryFee.toString(),
      minPlayers: Number(minPlayers),
      maxPlayers: Number(maxPlayers),
      tier: this.getTierFromEntryFee(entryFee),
      blockNumber: Number(log.blockNumber),
      txHash: log.transactionHash,
      blockTimestamp, // SOURCE OF TRUTH - from blockchain
    };
    this.eventEmitter.emit('arena.created', createdPayload);
    if (shouldBroadcast) this.eventEmitter.emit('arena.created.live', createdPayload);
  }

  private getTierFromEntryFee(entryFee: bigint): string {
    const eth = Number(entryFee) / 1e18;
    if (eth <= 0.005) return 'BRONZE';
    if (eth <= 0.02) return 'SILVER';
    if (eth <= 0.1) return 'GOLD';
    return 'DIAMOND';
  }

  private async handleAgentJoinedInternal(args: any, log: any, shouldBroadcast: boolean, blockTimestamp: Date): Promise<void> {
    const { arenaId, agentId, owner } = args;
    const arenaIdStr = arenaId.toString();

    this.logger.log(`AgentJoinedArena: arenaId=${arenaIdStr}, agentId=${agentId}${shouldBroadcast ? '' : ' (backfill)'}`);

    // Store in arena store
    const event = this.arenaStore.handleAgentJoined(
      arenaIdStr,
      agentId.toString(),
      owner,
      Number(log.blockNumber),
      log.transactionHash,
      Number(log.logIndex || 0),
    );

    if (shouldBroadcast) {
      this.broadcastGlobal(event);
      this.broadcastToArena(arenaIdStr, event);

      // Check if arena is now full and trigger instant lock
      const snapshot = this.arenaStore.getSnapshot(arenaIdStr);
      if (snapshot && snapshot.maxPlayers && snapshot.participantCount >= snapshot.maxPlayers) {
        this.logger.log(`Arena ${arenaIdStr} is FULL (${snapshot.participantCount}/${snapshot.maxPlayers}) - broadcasting arena_full`);

        const fullEvent: ChainEvent = {
          type: 'arena_full',
          arenaId: arenaIdStr,
          blockNumber: Number(log.blockNumber),
          txHash: log.transactionHash,
          logIndex: Number(log.logIndex || 0),
          timestamp: blockTimestamp.getTime(),
          data: {
            participantCount: snapshot.participantCount,
            maxPlayers: snapshot.maxPlayers,
          },
        };
        this.broadcastGlobal(fullEvent);
        this.broadcastToArena(arenaIdStr, fullEvent);

        // Trigger instant lock via scanner
        this.arenaScanner.lockArenaIfFull(arenaId).catch((err) => {
          this.logger.error(`Failed to instant lock arena ${arenaIdStr}`, err);
        });
      }
    }

    // Emit for ledger indexing
    this.eventEmitter.emit('arena.agent_joined', {
      arenaId: arenaIdStr,
      agentId: agentId.toString(),
      owner,
      blockNumber: Number(log.blockNumber),
      txHash: log.transactionHash,
      blockTimestamp,
    });
  }

  private async handleArenaLockedInternal(args: any, log: any, shouldBroadcast: boolean, blockTimestamp: Date): Promise<void> {
    const { arenaId, participantCount, vrfRequestId } = args;
    const arenaIdStr = arenaId.toString();

    this.logger.log(`ArenaLocked: arenaId=${arenaIdStr}, participants=${participantCount}${shouldBroadcast ? '' : ' (backfill)'}`);

    const event = this.arenaStore.handleArenaLocked(
      arenaIdStr,
      Number(participantCount),
      vrfRequestId.toString(),
      Number(log.blockNumber),
      log.transactionHash,
      Number(log.logIndex || 0),
    );

    if (shouldBroadcast) {
      this.broadcastGlobal(event);
      this.broadcastToArena(arenaIdStr, event);
    }

    const lockedPayload = {
      arenaId: arenaIdStr,
      participantCount: Number(participantCount),
      vrfRequestId: vrfRequestId.toString(),
      blockNumber: Number(log.blockNumber),
      txHash: log.transactionHash,
      blockTimestamp,
    };
    this.eventEmitter.emit('arena.locked', lockedPayload);
    if (shouldBroadcast) this.eventEmitter.emit('arena.locked.live', lockedPayload);
  }

  private async handleVRFRequestedInternal(args: any, log: any, shouldBroadcast: boolean, blockTimestamp: Date): Promise<void> {
    const { arenaId, requestId } = args;
    const arenaIdStr = arenaId.toString();

    this.logger.log(`VRFRequested: arenaId=${arenaIdStr}, requestId=${requestId}${shouldBroadcast ? '' : ' (backfill)'}`);

    const event = this.arenaStore.handleVRFRequested(
      arenaIdStr,
      requestId.toString(),
      Number(log.blockNumber),
      log.transactionHash,
      Number(log.logIndex || 0),
    );

    if (shouldBroadcast) {
      this.broadcastToArena(arenaIdStr, event);
    }

    this.eventEmitter.emit('arena.vrf_requested', {
      arenaId: arenaIdStr,
      vrfRequestId: requestId.toString(),
      blockNumber: Number(log.blockNumber),
      txHash: log.transactionHash,
      blockTimestamp,
    });
  }

  private async handleArenaStartedInternal(args: any, log: any, shouldBroadcast: boolean, blockTimestamp: Date): Promise<void> {
    const { arenaId, seed } = args;
    const arenaIdStr = arenaId.toString();

    this.logger.log(`ArenaStarted: arenaId=${arenaIdStr}, seed=${seed}${shouldBroadcast ? '' : ' (backfill)'}`);

    const event = this.arenaStore.handleArenaStarted(
      arenaIdStr,
      seed.toString(),
      Number(log.blockNumber),
      log.transactionHash,
      Number(log.logIndex || 0),
    );

    if (shouldBroadcast) {
      this.broadcastGlobal(event);
      this.broadcastToArena(arenaIdStr, event);
    }

    const startedPayload = {
      arenaId: arenaIdStr,
      seed: seed.toString(),
      blockNumber: Number(log.blockNumber),
      txHash: log.transactionHash,
      blockTimestamp,
    };
    this.eventEmitter.emit('arena.started', startedPayload);
    if (shouldBroadcast) this.eventEmitter.emit('arena.started.live', startedPayload);
  }

  private async handleBattleExecutedInternal(args: any, log: any, shouldBroadcast: boolean, blockTimestamp: Date): Promise<void> {
    const { arenaId, winnerId, resultHash } = args;
    const arenaIdStr = arenaId.toString();

    this.logger.log(`BattleExecuted: arenaId=${arenaIdStr}, winnerId=${winnerId}${shouldBroadcast ? '' : ' (backfill)'}`);

    const event = this.arenaStore.handleBattleExecuted(
      arenaIdStr,
      winnerId.toString(),
      resultHash,
      Number(log.blockNumber),
      log.transactionHash,
      Number(log.logIndex || 0),
    );

    if (shouldBroadcast) {
      this.broadcastGlobal(event);
      this.broadcastToArena(arenaIdStr, event);
    }

    this.eventEmitter.emit('arena.battle_executed', {
      arenaId: arenaIdStr,
      winnerId: winnerId.toString(),
      resultHash,
      blockNumber: Number(log.blockNumber),
      txHash: log.transactionHash,
      blockTimestamp,
    });
  }

  private async handlePrizesDistributedInternal(args: any, log: any, shouldBroadcast: boolean, blockTimestamp: Date): Promise<void> {
    // PayoutDistributed(arenaId, winnerId, winner, prizeAmount, protocolFee)
    const { arenaId, winnerId, winner, prizeAmount } = args;
    const arenaIdStr = arenaId.toString();

    this.logger.log(`PayoutDistributed: arenaId=${arenaIdStr}, winner=${winner}${shouldBroadcast ? '' : ' (backfill)'}`);

    const event = this.arenaStore.handlePrizesDistributed(
      arenaIdStr,
      winner,
      prizeAmount.toString(),
      Number(log.blockNumber),
      log.transactionHash,
      Number(log.logIndex || 0),
    );

    if (shouldBroadcast) {
      this.broadcastGlobal(event);
      const snapshot = this.arenaStore.getSnapshot(arenaIdStr);
      if (snapshot) {
        this.broadcastToArena(arenaIdStr, {
          ...event,
          type: 'arena_finished',
          data: {
            ...event.data,
            artifacts: snapshot.artifacts,
          },
        });
      } else {
        this.broadcastToArena(arenaIdStr, event);
      }
    }

    this.eventEmitter.emit('arena.prizes_distributed', {
      arenaId: arenaIdStr,
      winnerId: winnerId.toString(),
      winner,
      amount: prizeAmount.toString(),
      blockNumber: Number(log.blockNumber),
      txHash: log.transactionHash,
      blockTimestamp,
    });
  }

  private async handleArenaFinishedInternal(args: any, log: any, shouldBroadcast: boolean, blockTimestamp: Date): Promise<void> {
    // ArenaFinished(uint256 indexed arenaId, uint256 indexed winnerId, uint256 prizeAmount)
    const { arenaId, winnerId, prizeAmount } = args;
    const arenaIdStr = arenaId.toString();

    this.logger.log(`ArenaFinished: arenaId=${arenaIdStr}, winnerId=${winnerId}, prize=${prizeAmount}${shouldBroadcast ? '' : ' (backfill)'}`);

    // Emit as prizes_distributed for the ledger (ArenaFinished is the ArenaManager's confirmation)
    this.eventEmitter.emit('arena.finished', {
      arenaId: arenaIdStr,
      winnerId: winnerId.toString(),
      prizeAmount: prizeAmount.toString(),
      blockNumber: Number(log.blockNumber),
      txHash: log.transactionHash,
      blockTimestamp,
    });

    if (shouldBroadcast) {
      this.broadcastGlobal({
        type: 'prizes_distributed',
        arenaId: arenaIdStr,
        blockNumber: Number(log.blockNumber),
        txHash: log.transactionHash,
        logIndex: Number(log.logIndex || 0),
        timestamp: blockTimestamp.getTime(),
        data: { winnerId: winnerId.toString(), prizeAmount: prizeAmount.toString() },
      });
    }
  }

  private async handleArenaCancelledInternal(args: any, log: any, shouldBroadcast: boolean, blockTimestamp: Date): Promise<void> {
    const { arenaId } = args;
    const arenaIdStr = arenaId.toString();

    this.logger.log(`ArenaCancelled: arenaId=${arenaIdStr}${shouldBroadcast ? '' : ' (backfill)'}`);

    const event = this.arenaStore.handleArenaCancelled(
      arenaIdStr,
      Number(log.blockNumber),
      log.transactionHash,
      Number(log.logIndex || 0),
    );

    if (shouldBroadcast) {
      this.broadcastGlobal(event);
      this.broadcastToArena(arenaIdStr, event);
    }

    this.eventEmitter.emit('arena.cancelled', {
      arenaId: arenaIdStr,
      blockNumber: Number(log.blockNumber),
      txHash: log.transactionHash,
      blockTimestamp,
    });
  }

  private async handleRefundClaimedInternal(args: any, log: any, shouldBroadcast: boolean, blockTimestamp: Date): Promise<void> {
    const { arenaId, agentId, owner, amount } = args;
    const arenaIdStr = arenaId.toString();

    this.logger.log(`RefundClaimed: arenaId=${arenaIdStr}, agentId=${agentId}, owner=${owner}${shouldBroadcast ? '' : ' (backfill)'}`);

    const event: ChainEvent = {
      type: 'refund_claimed',
      arenaId: arenaIdStr,
      blockNumber: Number(log.blockNumber),
      txHash: log.transactionHash,
      logIndex: Number(log.logIndex || 0),
      timestamp: blockTimestamp.getTime(),
      data: {
        agentId: agentId.toString(),
        owner,
        amount: amount.toString(),
      },
    };

    if (shouldBroadcast) {
      this.broadcastGlobal(event);
      this.broadcastToArena(arenaIdStr, event);
    }

    // Emit for ledger indexing
    this.eventEmitter.emit('arena.refund_claimed', {
      arenaId: arenaIdStr,
      agentId: agentId.toString(),
      owner,
      amount: amount.toString(),
      blockNumber: Number(log.blockNumber),
      txHash: log.transactionHash,
      blockTimestamp,
    });
  }

  // ============================================
  // LIVE EVENT HANDLERS (wrappers)
  // All live handlers must fetch blockTimestamp for transparency
  // ============================================

  private async handleArenaCreated(log: any): Promise<void> {
    try {
      const blockTimestamp = await this.getBlockTimestamp(Number(log.blockNumber));
      await this.handleArenaCreatedInternal(log.args, log, true, blockTimestamp);
      await this.updateCheckpoint(BigInt(log.blockNumber));
    } catch (error) {
      this.logger.error('Failed to process ArenaCreated event', error);
    }
  }

  private async handleAgentJoined(log: any): Promise<void> {
    try {
      const blockTimestamp = await this.getBlockTimestamp(Number(log.blockNumber));
      await this.handleAgentJoinedInternal(log.args, log, true, blockTimestamp);
      await this.updateCheckpoint(BigInt(log.blockNumber));
    } catch (error) {
      this.logger.error('Failed to process AgentJoinedArena event', error);
    }
  }

  private async handleArenaLocked(log: any): Promise<void> {
    try {
      const blockTimestamp = await this.getBlockTimestamp(Number(log.blockNumber));
      await this.handleArenaLockedInternal(log.args, log, true, blockTimestamp);
      await this.updateCheckpoint(BigInt(log.blockNumber));
    } catch (error) {
      this.logger.error('Failed to process ArenaLocked event', error);
    }
  }

  private async handleVRFRequested(log: any): Promise<void> {
    try {
      const blockTimestamp = await this.getBlockTimestamp(Number(log.blockNumber));
      await this.handleVRFRequestedInternal(log.args, log, true, blockTimestamp);
      await this.updateCheckpoint(BigInt(log.blockNumber));
    } catch (error) {
      this.logger.error('Failed to process VRFRequested event', error);
    }
  }

  private async handleArenaStarted(log: any): Promise<void> {
    try {
      const blockTimestamp = await this.getBlockTimestamp(Number(log.blockNumber));
      await this.handleArenaStartedInternal(log.args, log, true, blockTimestamp);
      await this.updateCheckpoint(BigInt(log.blockNumber));
    } catch (error) {
      this.logger.error('Failed to process ArenaStarted event', error);
    }
  }

  private async handleBattleExecuted(log: any): Promise<void> {
    try {
      const blockTimestamp = await this.getBlockTimestamp(Number(log.blockNumber));
      await this.handleBattleExecutedInternal(log.args, log, true, blockTimestamp);
      await this.updateCheckpoint(BigInt(log.blockNumber));
    } catch (error) {
      this.logger.error('Failed to process BattleExecuted event', error);
    }
  }

  private async handlePrizesDistributed(log: any): Promise<void> {
    try {
      const blockTimestamp = await this.getBlockTimestamp(Number(log.blockNumber));
      await this.handlePrizesDistributedInternal(log.args, log, true, blockTimestamp);
      await this.updateCheckpoint(BigInt(log.blockNumber));
    } catch (error) {
      this.logger.error('Failed to process PayoutDistributed event', error);
    }
  }

  private async handleArenaFinished(log: any): Promise<void> {
    try {
      const blockTimestamp = await this.getBlockTimestamp(Number(log.blockNumber));
      await this.handleArenaFinishedInternal(log.args, log, true, blockTimestamp);
      await this.updateCheckpoint(BigInt(log.blockNumber));
    } catch (error) {
      this.logger.error('Failed to process ArenaFinished event', error);
    }
  }

  private async handleArenaCancelled(log: any): Promise<void> {
    try {
      const blockTimestamp = await this.getBlockTimestamp(Number(log.blockNumber));
      await this.handleArenaCancelledInternal(log.args, log, true, blockTimestamp);
      await this.updateCheckpoint(BigInt(log.blockNumber));
    } catch (error) {
      this.logger.error('Failed to process ArenaCancelled event', error);
    }
  }

  private async handleRefundClaimed(log: any): Promise<void> {
    try {
      const blockTimestamp = await this.getBlockTimestamp(Number(log.blockNumber));
      await this.handleRefundClaimedInternal(log.args, log, true, blockTimestamp);
      await this.updateCheckpoint(BigInt(log.blockNumber));
    } catch (error) {
      this.logger.error('Failed to process RefundClaimed event', error);
    }
  }

  // ============================================
  // BROADCAST HELPERS
  // ============================================

  private broadcastGlobal(event: ChainEvent): void {
    try {
      this.logger.log(`[WS] broadcastGlobal type=${event.type} arenaId=${event.arenaId}`);
      this.gateway.broadcastGlobal(event);
    } catch (error) {
      this.logger.warn(`Failed to broadcast global event ${event.type}`, error);
    }
  }

  private broadcastToArena(arenaId: string, event: ChainEvent): void {
    try {
      this.gateway.broadcastArenaEvent(arenaId, event);
    } catch (error) {
      this.logger.warn(`Failed to broadcast to arena ${arenaId}`, error);
    }
  }

  // ============================================
  // ERROR HANDLING
  // ============================================

  private handleConnectionError(error: Error): void {
    this.logger.error('Event listener connection error', error);

    if (!this.isShuttingDown) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.isShuttingDown) return;

    const backoff = Math.min(
      RETRY_CONFIG.INITIAL_BACKOFF_MS *
        Math.pow(RETRY_CONFIG.BACKOFF_MULTIPLIER, this.reconnectAttempts),
      RETRY_CONFIG.MAX_BACKOFF_MS,
    );

    this.reconnectAttempts++;

    this.logger.warn(`Scheduling reconnect attempt ${this.reconnectAttempts} in ${backoff}ms`);

    setTimeout(async () => {
      if (!this.isShuttingDown) {
        this.stopListening();
        await this.backfillAndStartListening();
      }
    }, backoff);
  }

  // ============================================
  // PUBLIC API
  // ============================================

  /**
   * Check if backfill is complete
   */
  isReady(): boolean {
    return this.isBackfillComplete;
  }

  /**
   * Get indexed arena count
   */
  getIndexedArenaCount(): number {
    return this.arenaStore.getAllArenaIds().length;
  }

  /**
   * Manual reindex (for admin use)
   * Cleans ALL ledger data and reprocesses from specified block
   * with correct block.timestamps from chain
   */
  async reindexFromBlock(fromBlock: bigint): Promise<void> {
    this.logger.warn(`Manual reindex requested from block ${fromBlock}`);

    // 1. Clear ALL ledger tables (clean slate)
    this.logger.warn('Clearing ALL ledger tables for clean reindex...');
    await this.prisma.arenaEvent.deleteMany({});
    await this.prisma.participantRecord.deleteMany({});
    await this.prisma.arenaRecord.deleteMany({});
    await this.prisma.ledgerStats.update({
      where: { id: 'global' },
      data: {
        totalArenas: 0,
        totalFinished: 0,
        totalCancelled: 0,
        totalPrizePool: '0',
        totalPlayers: 0,
      },
    });
    this.logger.warn('Ledger tables cleared');

    // 2. Reset checkpoint
    await this.prisma.indexerCheckpoint.update({
      where: { id: 'main' },
      data: { lastBlockNumber: (fromBlock - 1n).toString() },
    });

    // 3. Clear block timestamp cache
    this.blockTimestampCache.clear();

    // 4. Clear arena store
    this.arenaStore.clear();

    // 5. Stop current listeners
    this.stopListening();

    // 6. Restart with backfill (will reprocess everything with correct block.timestamps)
    await this.backfillAndStartListening();
  }

  // ============================================
  // MANUAL METHODS FOR TESTING
  // ============================================

  async emitTestEvent(arenaId: bigint, seed: bigint): Promise<void> {
    const internalEvent = {
      arenaId: arenaId.toString(),
      seed: seed.toString(),
      blockNumber: 0,
      txHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      blockTimestamp: new Date(), // Test events use server time
    };
    this.eventEmitter.emit('arena.started', internalEvent);
    this.logger.log(`Test event emitted: arenaId=${arenaId}, seed=${seed}`);
  }
}
