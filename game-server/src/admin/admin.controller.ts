import {
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { AdminGuard } from '../common/guards/admin.guard';
import { GameGateway } from '../game/game.gateway';
import { MatchService } from '../game/match.service';
import { LeaderboardService } from '../game/leaderboard.service';
import { ArenaStoreService } from '../arena/arena-store.service';
import { ArenaPersistenceService } from '../arena/arena-persistence.service';
import { ArenaOrchestratorService } from '../arena/arena-orchestrator.service';
import { VRFTriggerService } from '../arena/vrf-trigger.service';
import { ArenaScannerService } from '../arena/arena-scanner.service';
import { ArenaLedgerService } from '../arena-ledger/arena-ledger.service';
import { BlockchainService } from '../blockchain/blockchain.service';
import { EventListenerService } from '../blockchain/event-listener.service';
import { ContractWriterService } from '../blockchain/contract-writer.service';
import { PrismaService } from '../arena-ledger/prisma.service';
import { RedisLockService } from '../common/redis/redis.service';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  private readonly logger = new Logger(AdminController.name);
  private readonly startTime = Date.now();

  constructor(
    private readonly gateway: GameGateway,
    private readonly matchService: MatchService,
    private readonly leaderboard: LeaderboardService,
    private readonly arenaStore: ArenaStoreService,
    private readonly persistence: ArenaPersistenceService,
    private readonly orchestrator: ArenaOrchestratorService,
    private readonly vrfTrigger: VRFTriggerService,
    private readonly scanner: ArenaScannerService,
    private readonly ledger: ArenaLedgerService,
    private readonly blockchain: BlockchainService,
    private readonly eventListener: EventListenerService,
    private readonly writer: ContractWriterService,
    private readonly prisma: PrismaService,
    private readonly redisLock: RedisLockService,
  ) {}

  // ==========================================
  // GET /admin/dashboard — Overview
  // ==========================================
  @Get('dashboard')
  async getDashboard() {
    // Executor balance
    let executorBalance = '0';
    let lowBalance = true;
    try {
      const publicClient = this.blockchain.getPublicClient();
      const balance = await publicClient.getBalance({
        address: this.blockchain.getExecutorAddress(),
      });
      executorBalance = (Number(balance) / 1e18).toFixed(6);
      lowBalance = parseFloat(executorBalance) < 0.01;
    } catch {}

    // WebSocket connections
    let wsConnections = 0;
    let wsGlobal = 0;
    try {
      const allSockets = await this.gateway.server.fetchSockets();
      wsConnections = allSockets.length;
      wsGlobal = await this.gateway.getGlobalSubscriberCount();
    } catch {}

    // Arena counts from persistence
    const arenaCounts = this.persistence.getStatusCounts();

    // Active processing
    const activeProcessing = this.orchestrator.getActiveProcessing();

    // Scanner status
    const scannerStatus = this.scanner.getStatus();

    // Active matches
    const activeMatches = this.matchService.getActiveMatches();

    // Ledger stats
    const ledgerStats = await this.ledger.getStats();

    // Leaderboard stats
    const leaderboardStats = this.leaderboard.getStats();

    return {
      system: {
        uptime: Math.floor((Date.now() - this.startTime) / 1000),
        commit: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) || 'unknown',
        timestamp: new Date().toISOString(),
      },
      executor: {
        address: this.blockchain.getExecutorAddress(),
        balance: `${executorBalance} ETH`,
        balanceRaw: executorBalance,
        lowBalance,
      },
      websocket: {
        totalConnections: wsConnections,
        globalSubscribers: wsGlobal,
      },
      arenas: {
        statusCounts: arenaCounts,
        activeProcessing: activeProcessing.map((a) => ({
          arenaId: a.arenaId.toString(),
          status: a.status,
          startedAt: a.startedAt,
        })),
      },
      scanner: scannerStatus,
      matches: {
        active: activeMatches.length,
        ids: activeMatches,
      },
      ledger: ledgerStats,
      leaderboard: leaderboardStats,
    };
  }

  // ==========================================
  // GET /admin/arenas/stuck — VRF failed + stuck processing
  // ==========================================
  @Get('arenas/stuck')
  async getStuckArenas() {
    // VRF failed arenas
    const vrfFailed = this.vrfTrigger.getFailedArenas();

    // Stuck processing (active for >5min)
    const activeProcessing = this.orchestrator.getActiveProcessing();
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    const stuckProcessing = activeProcessing
      .filter((a) => a.startedAt < fiveMinAgo)
      .map((a) => ({
        arenaId: a.arenaId.toString(),
        status: a.status,
        startedAt: a.startedAt,
        stuckForSeconds: Math.floor((Date.now() - a.startedAt) / 1000),
      }));

    // Recently cancelled arenas (from DB)
    const recentCancelled = await this.prisma.arenaRecord.findMany({
      where: { state: 'cancelled' },
      orderBy: { finishedAt: 'desc' },
      take: 10,
      select: {
        arenaId: true,
        tier: true,
        cancelTxHash: true,
        finishedAt: true,
        totalParticipants: true,
        prizePool: true,
      },
    });

    return {
      vrfFailed,
      stuckProcessing,
      recentCancelled,
    };
  }

  // ==========================================
  // GET /admin/refunds/pending — Cancelled arenas with refund status
  // ==========================================
  @Get('refunds/pending')
  async getPendingRefunds() {
    const cancelledArenas = await this.prisma.arenaRecord.findMany({
      where: { state: 'cancelled' },
      include: {
        participants: true,
        events: { where: { eventType: 'RefundClaimed' } },
      },
      orderBy: { finishedAt: 'desc' },
      take: 50,
    });

    return cancelledArenas.map((arena) => {
      const refundEvents = arena.events;
      // Parse refund event data to get agentIds that claimed
      const claimedAgentIds = new Set<string>();
      for (const evt of refundEvents) {
        try {
          const data = JSON.parse(evt.data);
          if (data.agentId) claimedAgentIds.add(data.agentId.toString());
        } catch {}
      }

      const participants = arena.participants.map((p) => ({
        agentId: p.agentId,
        owner: p.owner,
        claimed: claimedAgentIds.has(p.agentId),
      }));

      return {
        arenaId: arena.arenaId,
        tier: arena.tier,
        entryFee: arena.entryFee,
        prizePool: arena.prizePool,
        cancelTxHash: arena.cancelTxHash,
        cancelledAt: arena.finishedAt,
        totalParticipants: arena.participants.length,
        totalClaimed: claimedAgentIds.size,
        totalUnclaimed: arena.participants.length - claimedAgentIds.size,
        participants,
      };
    });
  }

  // ==========================================
  // GET /admin/arenas/all — Paginated arena list (admin sees everything)
  // ==========================================
  @Get('arenas/all')
  async getAllArenas(
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
    @Query('state') state?: string,
  ) {
    const limit = Math.min(parseInt(limitStr || '50', 10) || 50, 200);
    const offset = parseInt(offsetStr || '0', 10) || 0;

    const where: Record<string, unknown> = {};
    if (state) where.state = state;

    const [arenas, total] = await Promise.all([
      this.prisma.arenaRecord.findMany({
        where,
        include: { participants: true },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.arenaRecord.count({ where }),
    ]);

    return {
      arenas: arenas.map((a) => ({
        arenaId: a.arenaId,
        tier: a.tier,
        state: a.state,
        battleState: a.battleState,
        entryFee: a.entryFee,
        prizePool: a.prizePool,
        minPlayers: a.minPlayers,
        maxPlayers: a.maxPlayers,
        totalParticipants: a.participants.length,
        participants: a.participants.map((p) => ({
          agentId: p.agentId,
          owner: p.owner,
        })),
        winnerId: a.winnerId,
        winnerOwner: a.winnerOwner,
        seed: a.seed,
        vrfRequestId: a.vrfRequestId,
        createTxHash: a.createTxHash,
        lockTxHash: a.lockTxHash,
        battleTxHash: a.battleTxHash,
        prizeTxHash: a.prizeTxHash,
        cancelTxHash: a.cancelTxHash,
        createdAt: a.createdAt,
        lockedAt: a.lockedAt,
        startedAt: a.startedAt,
        finishedAt: a.finishedAt,
      })),
      total,
      limit,
      offset,
    };
  }

  // ==========================================
  // POST /admin/actions/trigger-vrf
  // ==========================================
  @Post('actions/trigger-vrf')
  async triggerVRF(@Query('arenaId') arenaIdStr: string) {
    const arenaId = this.parseArenaId(arenaIdStr);
    this.logger.warn(`Admin triggered VRF for arena ${arenaId}`);
    const success = await this.vrfTrigger.triggerVRF(arenaId);
    return { arenaId: arenaId.toString(), success };
  }

  // ==========================================
  // POST /admin/actions/cancel-arena
  // ==========================================
  @Post('actions/cancel-arena')
  async cancelArena(@Query('arenaId') arenaIdStr: string) {
    const arenaId = this.parseArenaId(arenaIdStr);
    this.logger.warn(`Admin cancelled arena ${arenaId}`);
    const result = await this.writer.cancelArena(arenaId);
    return { arenaId: arenaId.toString(), txHash: result.hash, success: result.success };
  }

  // ==========================================
  // POST /admin/actions/trigger-battle
  // ==========================================
  @Post('actions/trigger-battle')
  async triggerBattle(@Query('arenaId') arenaIdStr: string) {
    const arenaId = this.parseArenaId(arenaIdStr);
    this.logger.warn(`Admin triggered battle for arena ${arenaId}`);

    // Get seed from chain
    const arena = await this.blockchain.getArena(arenaId);
    if (!arena.seed || arena.seed === 0n) {
      throw new BadRequestException(`Arena ${arenaId} has no seed (VRF not fulfilled)`);
    }

    // Clear stale data before reprocessing (handles contract upgrades)
    this.persistence.deleteArena(arenaId.toString());
    this.orchestrator.clearProcessingState(arenaId.toString());

    // Fire async — don't await the full battle
    this.orchestrator.triggerManualProcessing(arenaId, arena.seed).catch((err) => {
      this.logger.error(`Manual battle trigger failed for arena ${arenaId}: ${err.message}`);
    });

    return { arenaId: arenaId.toString(), status: 'battle_triggered' };
  }

  // ==========================================
  // POST /admin/actions/reindex
  // ==========================================
  @Post('actions/reindex')
  async reindex(@Query('fromBlock') fromBlockStr: string) {
    if (!fromBlockStr) throw new BadRequestException('fromBlock query param required');
    const fromBlock = BigInt(fromBlockStr);
    this.logger.warn(`Admin triggered reindex from block ${fromBlock}`);

    this.eventListener.reindexFromBlock(fromBlock).catch((err) => {
      this.logger.error(`Reindex failed: ${err.message}`);
    });

    return { status: 'reindex_started', fromBlock: fromBlock.toString() };
  }

  // ==========================================
  // POST /admin/actions/full-reset — Nuclear reset after contract upgrade
  // ==========================================
  @Post('actions/full-reset')
  async fullReset(@Query('fromBlock') fromBlockStr: string) {
    if (!fromBlockStr) throw new BadRequestException('fromBlock query param required');
    const fromBlock = BigInt(fromBlockStr);
    this.logger.warn(`FULL RESET triggered from block ${fromBlock}`);

    // 1. Clear file-based persistence (old arena processing records)
    this.persistence.clearAll();

    // 2. Clear orchestrator in-memory state
    for (const arena of this.orchestrator.getActiveProcessing()) {
      this.orchestrator.clearProcessingState(arena.arenaId);
    }

    // 3. Clear Redis arena locks
    const locksCleared = await this.redisLock.clearArenaLocks();

    // 4. Clear gateway cached match results
    this.gateway.clearAllMatchEndResults();

    // 5. Clear ArenaStore in-memory state
    this.arenaStore.clear();

    // 6. Trigger reindex (clears PostgreSQL + re-backfills from specified block)
    this.eventListener.reindexFromBlock(fromBlock).catch((err) => {
      this.logger.error(`Full reset reindex failed: ${err.message}`);
    });

    return {
      status: 'full_reset_started',
      fromBlock: fromBlock.toString(),
      persistenceCleared: true,
      locksCleared,
      reindexStarted: true,
    };
  }

  // ==========================================
  // POST /admin/actions/refresh-leaderboard
  // ==========================================
  @Post('actions/refresh-leaderboard')
  async refreshLeaderboard() {
    this.logger.warn('Admin triggered leaderboard refresh');
    this.leaderboard.refreshAll().catch((err) => {
      this.logger.error(`Leaderboard refresh failed: ${err.message}`);
    });
    return { status: 'refresh_started' };
  }

  // ==========================================
  // Helper
  // ==========================================
  private parseArenaId(arenaIdStr: string): bigint {
    if (!arenaIdStr) throw new BadRequestException('arenaId query param required');
    try {
      return BigInt(arenaIdStr);
    } catch {
      throw new BadRequestException(`Invalid arenaId: ${arenaIdStr}`);
    }
  }
}
