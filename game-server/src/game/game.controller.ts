// ============================================
// GAME CONTROLLER - REST API for match management
// ============================================

import { Controller, Get, Post, Param, Body, Query, Logger, UseGuards, OnModuleInit, NotFoundException } from '@nestjs/common';
import { AdminGuard } from '../common/guards/admin.guard';
import { MatchService } from './match.service';
import { GameGateway } from './game.gateway';
import { LeaderboardService, SortBy } from './leaderboard.service';
import { ParticipantData, StrategyTemplate } from './types';
import { ArenaPersistenceService } from '../arena/arena-persistence.service';
import { ResultHasherService } from '../arena/result-hasher.service';
import { BlockchainService } from '../blockchain/blockchain.service';
import { ArenaOrchestratorService } from '../arena/arena-orchestrator.service';
import { ArenaScannerService } from '../arena/arena-scanner.service';
import { ArenaStoreService } from '../arena/arena-store.service';
import { EventListenerService } from '../blockchain/event-listener.service';
import { VRFTriggerService } from '../arena/vrf-trigger.service';
import { ContractWriterService } from '../blockchain/contract-writer.service';
import { ArenaLedgerService } from '../arena-ledger/arena-ledger.service';
import { XPService } from './xp.service';
import Redis from 'ioredis';

@Controller('game')
export class GameController implements OnModuleInit {
  private readonly logger = new Logger(GameController.name);

  // Singleton demo match — one global loop, all users spectate the same match
  private demoMatchId: string | null = null;
  private demoRestarting = false;

  // Tournament state — set by orchestrator, read by frontend
  private tournamentMatchId: string | null = null;
  private tournamentMetadata: Record<string, any> | null = null;

  // Tournament chat — in-memory + Redis persistence (survives restarts)
  private tournamentChat: Array<{
    name: string;
    message: string;
    type: 'trash_talk' | 'reaction' | 'spectator';
    timestamp: number;
    round?: string;
  }> = [];
  private redis: Redis | null = null;
  private static readonly CHAT_REDIS_KEY = 'rushroyale:tournament:chat';
  private static readonly META_REDIS_KEY = 'rushroyale:tournament:meta';

  constructor(
    private matchService: MatchService,
    private gameGateway: GameGateway,
    private leaderboardService: LeaderboardService,
    private persistence: ArenaPersistenceService,
    private hasher: ResultHasherService,
    private blockchain: BlockchainService,
    private orchestrator: ArenaOrchestratorService,
    private scanner: ArenaScannerService,
    private arenaStore: ArenaStoreService,
    private eventListener: EventListenerService,
    private vrfTrigger: VRFTriggerService,
    private contractWriter: ContractWriterService,
    private ledger: ArenaLedgerService,
    private xpService: XPService,
  ) {}

  async onModuleInit() {
    // Connect to Redis for chat + tournament state persistence
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      try {
        this.redis = new Redis(redisUrl);
        this.redis.on('error', (err) => this.logger.error('Redis error:', err.message));
        await this.redis.ping();
        this.logger.log('Tournament Redis persistence connected');

        // Restore chat from Redis
        const chatData = await this.redis.get(GameController.CHAT_REDIS_KEY);
        if (chatData) {
          this.tournamentChat = JSON.parse(chatData);
          this.logger.log(`Restored ${this.tournamentChat.length} tournament chat messages from Redis`);
        }

        // Restore tournament metadata from Redis
        const metaData = await this.redis.get(GameController.META_REDIS_KEY);
        if (metaData) {
          const meta = JSON.parse(metaData);
          this.tournamentMetadata = meta.metadata || null;
          // Don't restore matchId — match is dead after restart, orchestrator will set new one
          this.logger.log('Restored tournament metadata from Redis');
        }
      } catch (err) {
        this.logger.warn('Redis unavailable for tournament persistence:', err);
        this.redis = null;
      }
    }

    // Start the singleton demo loop after services are ready
    setTimeout(() => this.startDemoLoop(), 5000);
  }

  private startDemoLoop(): void {
    if (this.demoRestarting) return;
    this.demoRestarting = true;

    const arenaId = BigInt(Date.now());
    const seed = BigInt(Math.floor(Math.random() * 1000000));

    const demoParticipants: ParticipantData[] = [];
    const AGENT_COUNT = 25;

    for (let i = 0; i < AGENT_COUNT; i++) {
      demoParticipants.push({
        agentId: BigInt(i + 1),
        owner: `0x${(i + 1).toString().padStart(40, '0')}`,
        boostIds: i % 5 === 0 ? [BigInt(0)] : [],
      });
    }

    const matchId = this.matchService.createMatch(arenaId, seed, demoParticipants);
    this.demoMatchId = matchId;

    this.matchService.onTick(matchId, (update) => {
      this.gameGateway.broadcastTick(matchId, update);

      if (update.events.some((e) => e.type === 'match_end')) {
        const endEvent = update.events.find((e) => e.type === 'match_end');
        this.gameGateway.broadcastMatchEnd(matchId, endEvent?.data);

        // Auto-restart after 5 seconds
        this.demoRestarting = false;
        setTimeout(() => this.startDemoLoop(), 5000);
      }
    });

    setTimeout(() => {
      this.matchService.startMatch(matchId);
      this.demoRestarting = false;
    }, 2000);

    this.logger.log(`Demo loop started: ${matchId}`);
  }

  // ============================================
  // HEALTH / STATUS ENDPOINTS
  // ============================================

  @Get('health')
  async getHealth() {
    try {
      // Check blockchain connection
      const blockchainConnected = await this.blockchain.checkConnection();

      // Get executor balance (for VRF costs)
      let executorBalance = '0';
      try {
        const publicClient = this.blockchain.getPublicClient();
        const balance = await publicClient.getBalance({
          address: this.blockchain.getExecutorAddress(),
        });
        executorBalance = (Number(balance) / 1e18).toFixed(6);
      } catch {
        // Executor not configured
      }

      // Get active processing
      const activeProcessing = this.orchestrator.getActiveProcessing();
      const scannerStatus = this.scanner.getStatus();

      // Get arena counts
      const arenaCounts = this.persistence.getStatusCounts();

      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        blockchain: {
          connected: blockchainConnected,
          executorBalance: `${executorBalance} ETH`,
          lowBalance: parseFloat(executorBalance) < 0.01,
        },
        matches: {
          active: this.matchService.getActiveMatches().length,
        },
        arenas: {
          processing: activeProcessing.length,
          processingDetails: activeProcessing.map((a) => ({
            arenaId: a.arenaId.toString(),
            status: a.status,
            matchId: a.matchId,
          })),
          statusCounts: arenaCounts,
        },
        scanner: {
          enabled: scannerStatus.isEnabled,
          currentlyLocking: scannerStatus.lockingArenas.length,
        },
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: (error as Error).message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  // ============================================
  // LEADERBOARD ENDPOINT
  // ============================================

  @Get('leaderboard')
  getLeaderboard(
    @Query('limit') limitStr?: string,
    @Query('sortBy') sortBy?: string,
  ) {
    const limit = limitStr ? parseInt(limitStr, 10) : 100;
    const validLimit = Math.min(Math.max(1, limit), 500);

    const validSortBy: SortBy =
      sortBy === 'battles' || sortBy === 'winrate'
        ? sortBy
        : 'wins';

    const result = this.leaderboardService.getLeaderboard(validLimit, validSortBy);

    return {
      ...result,
      sortBy: validSortBy,
    };
  }

  @Post('leaderboard/refresh')
  @UseGuards(AdminGuard)
  async refreshLeaderboard() {
    await this.leaderboardService.refreshAll();
    const stats = this.leaderboardService.getStats();
    return {
      success: true,
      message: 'Leaderboard refresh initiated',
      stats,
    };
  }

  // ============================================
  // XP ENDPOINT
  // ============================================

  @Get('agent/:agentId/xp')
  async getAgentXP(@Param('agentId') agentId: string) {
    try {
      return await this.xpService.getAgentXP(agentId);
    } catch (error) {
      this.logger.error(`Failed to get XP for agent ${agentId}`, error);
      return {
        agentId,
        totalXP: 0,
        level: 1,
        progress: 0,
        xpToNext: 200,
        currentLevelXP: 0,
        nextLevelXP: 200,
        recentMatches: [],
      };
    }
  }

  @Get('matches')
  getActiveMatches() {
    return {
      matches: this.matchService.getActiveMatches(),
    };
  }

  @Get('match/:matchId')
  getMatchState(@Param('matchId') matchId: string) {
    const state = this.matchService.getMatchState(matchId);
    if (!state) {
      throw new NotFoundException('Match not found');
    }
    return state;
  }

  @Get('demo')
  getDemoMatch() {
    // Singleton demo — returns the current running demo matchId, never creates a new engine
    return {
      matchId: this.demoMatchId,
    };
  }

  // ============================================
  // TOURNAMENT ENDPOINTS
  // ============================================

  @Get('tournament')
  getTournament() {
    return {
      matchId: this.tournamentMatchId,
      metadata: this.tournamentMetadata,
      active: this.tournamentMatchId !== null,
    };
  }

  @Post('tournament/set-active')
  setTournamentActive(
    @Body() body: { matchId: string | null; metadata?: Record<string, any> },
  ) {
    this.tournamentMatchId = body.matchId;
    if (body.metadata) {
      this.tournamentMetadata = body.metadata;
    }
    this.persistTournamentMeta();
    this.logger.log(`Tournament active match set: ${body.matchId}`);

    // Push-notify all connected clients instantly (skips 1.5-3s poll delay)
    if (body.matchId) {
      this.gameGateway.broadcastTournamentMatchReady(body.matchId, this.tournamentMetadata || {});
    }

    return { success: true, matchId: this.tournamentMatchId };
  }

  @Get('tournament/chat')
  getTournamentChat(@Query('since') sinceStr?: string) {
    const since = sinceStr ? parseInt(sinceStr, 10) : 0;
    const messages = this.tournamentChat.filter((msg) => msg.timestamp > since);
    return { messages };
  }

  @Post('tournament/chat')
  postTournamentChat(
    @Body()
    body:
      | { name: string; message: string; type: string; round?: string }
      | { messages: Array<{ name: string; message: string; type: string; round?: string }> },
  ) {
    const now = Date.now();

    // Check if batch or single message
    if ('messages' in body && Array.isArray(body.messages)) {
      // Batch insert
      for (const msg of body.messages) {
        this.tournamentChat.push({
          name: msg.name,
          message: msg.message,
          type: msg.type as 'trash_talk' | 'reaction' | 'spectator',
          timestamp: now,
          round: msg.round,
        });
      }
    } else {
      // Single message
      const msg = body as { name: string; message: string; type: string; round?: string };
      this.tournamentChat.push({
        name: msg.name,
        message: msg.message,
        type: msg.type as 'trash_talk' | 'reaction' | 'spectator',
        timestamp: now,
        round: msg.round,
      });
    }

    // Keep only last 100 messages
    if (this.tournamentChat.length > 100) {
      this.tournamentChat = this.tournamentChat.slice(-100);
    }

    // Persist to Redis (fire-and-forget — don't block response)
    this.persistChat();

    return { success: true, totalMessages: this.tournamentChat.length };
  }

  @Post('tournament/chat/clear')
  clearTournamentChat() {
    const previousCount = this.tournamentChat.length;
    this.tournamentChat = [];
    this.persistChat();
    this.logger.log(`Tournament chat cleared (${previousCount} messages removed)`);
    return { success: true, cleared: previousCount };
  }

  private persistChat(): void {
    if (!this.redis) return;
    this.redis.set(GameController.CHAT_REDIS_KEY, JSON.stringify(this.tournamentChat)).catch(
      (err) => this.logger.warn('Failed to persist chat to Redis:', err.message),
    );
  }

  private persistTournamentMeta(): void {
    if (!this.redis) return;
    this.redis.set(GameController.META_REDIS_KEY, JSON.stringify({
      matchId: this.tournamentMatchId,
      metadata: this.tournamentMetadata,
    })).catch(
      (err) => this.logger.warn('Failed to persist tournament meta to Redis:', err.message),
    );
  }

  @Post('match')
  createMatch(
    @Body()
    body: {
      arenaId: string;
      seed: string;
      participants: Array<{
        agentId: string;
        owner: string;
        boostIds: string[];
        strategyTemplate?: StrategyTemplate;
        name?: string;
      }>;
      metadata?: Record<string, any>;
    },
  ) {
    const arenaId = BigInt(body.arenaId);
    const seed = BigInt(body.seed);
    const participants: ParticipantData[] = body.participants.map((p) => ({
      agentId: BigInt(p.agentId),
      owner: p.owner,
      boostIds: p.boostIds.map((id) => BigInt(id)),
    }));

    // Build inline templates and names maps from request body
    const inlineTemplates = new Map<string, StrategyTemplate>();
    const names = new Map<string, string>();
    for (const p of body.participants) {
      if (p.strategyTemplate) {
        inlineTemplates.set(p.agentId, p.strategyTemplate);
      }
      if (p.name) {
        names.set(p.agentId, p.name);
      }
    }

    const matchId = this.matchService.createMatch(arenaId, seed, participants, {
      inlineTemplates: inlineTemplates.size > 0 ? inlineTemplates : undefined,
      names: names.size > 0 ? names : undefined,
      metadata: body.metadata,
    });

    // Setup tick broadcasting
    this.matchService.onTick(matchId, (update) => {
      this.gameGateway.broadcastTick(matchId, update);

      if (update.events.some((e) => e.type === 'match_end')) {
        const endEvent = update.events.find((e) => e.type === 'match_end');
        this.gameGateway.broadcastMatchEnd(matchId, endEvent?.data);
      }
    });

    return { matchId };
  }

  @Post('match/:matchId/start')
  startMatch(@Param('matchId') matchId: string) {
    const success = this.matchService.startMatch(matchId);
    return { success };
  }

  // ============================================
  // MATCH STATUS ENDPOINT (HTTP fallback for lost WebSocket events)
  // ============================================

  @Get('arena/:arenaId/match-status')
  getArenaMatchStatus(@Param('arenaId') arenaId: string) {
    // 1. Match still in memory? (active OR recently finished, kept for 60s)
    const matchId = this.matchService.getMatchByArena(BigInt(arenaId));
    if (matchId) {
      if (this.matchService.isMatchActive(matchId)) {
        return { status: 'RUNNING', matchId };
      }
      // Finished but still in memory
      const state = this.matchService.getMatchState(matchId);
      if (state?.status === 'FINISHED' && state.agents) {
        const winner = state.agents.find((a: any) => a.isAlive) || state.agents[0];
        return {
          status: 'FINISHED',
          arenaId,
          winnerId: winner?.agentId,
          winnerOwner: winner?.owner,
          totalTicks: state.tick,
        };
      }
    }

    // 2. Stored match_end in gateway?
    const matchEnd = this.gameGateway.getMatchEndByArena(arenaId);
    if (matchEnd) {
      return { status: 'FINISHED', ...matchEnd };
    }

    // 3. Persistence record?
    const record = this.persistence.getArena(arenaId);
    if (record?.simulationResult) {
      return {
        status: 'FINISHED',
        arenaId,
        winnerId: record.simulationResult.winnerId,
        winnerOwner: record.simulationResult.winnerOwner,
        totalTicks: record.simulationResult.totalTicks,
      };
    }

    return { status: 'NOT_FOUND' };
  }

  // ============================================
  // DETERMINISTIC REVEAL ENDPOINT (Anti-Spoiler)
  // ============================================

  /**
   * Returns the deterministic reveal timestamp for an arena.
   * Frontend MUST NOT show FINISHED or winner before revealAt.
   * GET /game/arena/:arenaId/reveal
   */
  @Get('arena/:arenaId/reveal')
  async getArenaReveal(@Param('arenaId') arenaId: string) {
    const arena = await this.ledger.getArenaReveal(arenaId);
    if (!arena) {
      return { status: 'NOT_FOUND', arenaId };
    }

    const now = Date.now();
    const revealAt = arena.revealAt ? new Date(arena.revealAt).getTime() : null;
    const status = !revealAt ? 'NO_REVEAL' : now >= revealAt ? 'REVEALED' : 'PENDING_REVEAL';

    return {
      arenaId,
      revealAt: revealAt ?? null,
      matchId: arena.matchId ?? null,
      battleState: arena.battleState ?? null,
      winnerId: arena.winnerId ?? null,
      winnerOwner: arena.winnerOwner ?? null,
      status,
    };
  }

  // ============================================
  // CANONICAL POST-MATCH ENDPOINT
  // ============================================

  /**
   * Canonical post-match data for VictoryScreen.
   * Combines PostgreSQL (permanent), simulationData JSON, persistence.json, and gateway in-memory.
   * GET /game/arena/:arenaId/final
   */
  @Get('arena/:arenaId/final')
  async getArenaFinal(@Param('arenaId') arenaId: string) {
    try {
      // 1. PostgreSQL (permanent source of truth)
      const dbRecord = await this.ledger.getArenaDetailRaw(arenaId);

      if (!dbRecord) {
        // Fallback: check persistence.json (24h) or gateway in-memory (5min)
        const persisted = this.persistence.getArena(arenaId);
        const gatewayEnd = this.gameGateway.getMatchEndByArena(arenaId);

        if (!persisted && !gatewayEnd) {
          return { status: 'NOT_FOUND', arenaId };
        }

        // Build response from volatile sources
        const winnerId = persisted?.simulationResult?.winnerId || gatewayEnd?.winnerId;
        if (!winnerId) {
          return { status: 'RUNNING', arenaId };
        }

        return {
          status: 'FINISHED',
          arenaId,
          winner: {
            agentId: winnerId,
            owner: persisted?.simulationResult?.winnerOwner || gatewayEnd?.winnerOwner || null,
            kills: 0,
          },
          match: {
            totalTicks: persisted?.simulationResult?.totalTicks || gatewayEnd?.totalTicks || 0,
            durationSeconds: Math.floor((persisted?.simulationResult?.totalTicks || gatewayEnd?.totalTicks || 0) / 20),
            totalParticipants: 0,
          },
          prize: { status: 'pending' as const, pool: null, amount: null, txHash: null },
          participants: [],
        };
      }

      // 2. Parse simulationData if available
      let simData: {
        agents?: Array<{ agentId: string; owner: string; eliminatedAt?: number; kills: number }>;
        eliminationOrder?: Array<{ agentId: string; eliminatedAt: number; eliminatedBy?: string; source: string }>;
        totalTicks?: number;
        totalParticipants?: number;
      } | null = null;

      if (dbRecord.simulationData) {
        try {
          simData = JSON.parse(dbRecord.simulationData);
        } catch {
          this.logger.warn(`Failed to parse simulationData for arena ${arenaId}`);
        }
      }

      // 3. Determine status
      const hasWinner = !!dbRecord.winnerId;
      const hasPrizeTx = !!dbRecord.prizeTxHash;
      const status = !hasWinner ? 'RUNNING' : 'FINISHED';

      // 4. Prize status
      const prizeStatus = (dbRecord.prizeAmount && dbRecord.prizeTxHash) ? 'confirmed' :
                          hasWinner ? 'pending' : 'pending';

      // 5. Build winner info
      const winnerKills = simData?.agents?.find(a => a.agentId === dbRecord.winnerId)?.kills ?? 0;

      // 6. Build participants with placements
      const participants = this.buildParticipants(dbRecord, simData);

      return {
        status,
        arenaId,
        winner: hasWinner ? {
          agentId: dbRecord.winnerId,
          owner: dbRecord.winnerOwner,
          kills: winnerKills,
        } : null,
        match: {
          totalTicks: simData?.totalTicks ?? 0,
          durationSeconds: Math.floor((simData?.totalTicks ?? 0) / 20),
          totalParticipants: simData?.totalParticipants ?? dbRecord.totalParticipants,
        },
        prize: {
          status: prizeStatus,
          pool: dbRecord.prizePool,
          amount: dbRecord.prizeAmount || null,
          txHash: dbRecord.prizeTxHash || null,
        },
        participants,
      };
    } catch (error) {
      this.logger.error(`Failed to get final data for arena ${arenaId}`, error);
      return { status: 'NOT_FOUND', arenaId, error: (error as Error).message };
    }
  }

  private buildParticipants(
    dbRecord: any,
    simData: any | null,
  ): Array<{
    agentId: string;
    owner: string;
    kills: number;
    eliminatedAt: number | null;
    eliminatedBy: string | null;
    source: string | null;
    placement: number;
  }> {
    if (!simData?.agents) return [];

    const agents = simData.agents as Array<{ agentId: string; owner: string; eliminatedAt?: number; kills: number }>;
    const elimOrder = (simData.eliminationOrder || []) as Array<{ agentId: string; eliminatedAt: number; eliminatedBy?: string; source: string }>;

    // Build a map of elimination details
    const elimMap = new Map<string, { eliminatedAt: number; eliminatedBy?: string; source: string }>();
    for (const e of elimOrder) {
      elimMap.set(e.agentId, e);
    }

    // Sort by placement: winner first, then reverse elimination order (last eliminated = 2nd place)
    const sorted = [...agents].sort((a, b) => {
      const aElim = a.eliminatedAt ?? Infinity;
      const bElim = b.eliminatedAt ?? Infinity;
      return bElim - aElim; // Higher eliminatedAt = survived longer = better placement
    });

    return sorted.map((agent, idx) => {
      const elim = elimMap.get(agent.agentId);
      return {
        agentId: agent.agentId,
        owner: agent.owner,
        kills: agent.kills || 0,
        eliminatedAt: elim?.eliminatedAt ?? null,
        eliminatedBy: elim?.eliminatedBy ?? null,
        source: elim?.source ?? null,
        placement: idx + 1,
      };
    });
  }

  // ============================================
  // AUDIT / REPLAY ENDPOINTS
  // ============================================

  /**
   * Get battle result data for replay/verification
   * This includes eliminationOrder which is NOT stored on-chain
   *
   * On-chain data: arenaId, seed, winnerId, totalRounds, resultHash
   * Off-chain data: eliminationOrder, participants with boosts
   */
  @Get('arena/:arenaId/result')
  getArenaResult(@Param('arenaId') arenaId: string) {
    const record = this.persistence.getArena(arenaId);

    if (!record) {
      return {
        error: 'Arena not found in local storage',
        note: 'Arena data is stored locally for 24 hours after completion. For older arenas, check on-chain events.',
      };
    }

    if (!record.simulationResult) {
      return {
        error: 'No simulation result available',
        status: record.status,
      };
    }

    return {
      arenaId,
      seed: record.seed,
      status: record.status,
      simulationResult: record.simulationResult,
      transactions: {
        submitBattleResult: record.submitBattleResultTx,
        distributePrizes: record.distributePrizesTx,
      },
      replayInstructions: {
        note: 'To verify this result, replay the simulation with the provided seed and participants',
        steps: [
          '1. Fetch participants from AgentJoinedArena events for this arenaId',
          '2. Create simulation with (arenaId, seed, participants)',
          '3. Run synchronous simulation',
          '4. Compare resultHash with on-chain value from BattleExecuted event',
        ],
      },
    };
  }

  /**
   * Get arena snapshot with all blockchain artifacts and recent events
   * This is the "explorer-grade" endpoint for full transparency
   */
  @Get('arena/:arenaId/snapshot')
  getArenaSnapshot(@Param('arenaId') arenaId: string) {
    const snapshot = this.arenaStore.getSnapshot(arenaId);

    if (!snapshot) {
      return {
        arenaId,
        state: 'unknown',
        artifacts: { arenaId },
        recentEvents: [],
        participantCount: 0,
        participants: [],
        updatedAt: Date.now(),
        note: 'No on-chain events recorded for this arena yet',
      };
    }

    // Merge with persistence data if available, but only expose winner for finished arenas
    const record = this.persistence.getArena(arenaId);
    if (record?.simulationResult && snapshot.state === 'finished') {
      snapshot.artifacts.winnerId = record.simulationResult.winnerId?.toString();
      snapshot.artifacts.winnerOwner = record.simulationResult.winnerOwner;
    }

    return {
      ...snapshot,
      explorerLinks: {
        arena: `https://basescan.org/address/${this.blockchain.arenaManagerAddress}`,
        createTx: snapshot.artifacts.createTxHash
          ? `https://basescan.org/tx/${snapshot.artifacts.createTxHash}`
          : null,
        lockTx: snapshot.artifacts.lockTxHash
          ? `https://basescan.org/tx/${snapshot.artifacts.lockTxHash}`
          : null,
        vrfRequestTx: snapshot.artifacts.vrfRequestTxHash
          ? `https://basescan.org/tx/${snapshot.artifacts.vrfRequestTxHash}`
          : null,
        battleResultTx: snapshot.artifacts.battleResultTxHash
          ? `https://basescan.org/tx/${snapshot.artifacts.battleResultTxHash}`
          : null,
        prizesDistributedTx: snapshot.artifacts.prizesDistributedTxHash
          ? `https://basescan.org/tx/${snapshot.artifacts.prizesDistributedTxHash}`
          : null,
        winner: snapshot.artifacts.winnerOwner
          ? `https://basescan.org/address/${snapshot.artifacts.winnerOwner}`
          : null,
      },
    };
  }

  /**
   * Verify a result hash given the inputs
   * This allows anyone to verify that a battle result is correct
   */
  @Post('verify')
  verifyResult(
    @Body()
    body: {
      arenaId: string;
      seed: string;
      winnerId: string;
      totalRounds: number;
      expectedHash: string;
      participants: Array<{
        agentId: string;
        owner: string;
        boostIds: string[];
      }>;
      eliminationOrder: Array<{
        agentId: string;
        eliminatedAt: number;
        source: string;
      }>;
    },
  ) {
    try {
      const arenaId = BigInt(body.arenaId);
      const seed = BigInt(body.seed);
      const winnerId = BigInt(body.winnerId);
      const totalRounds = BigInt(body.totalRounds);

      const participants: ParticipantData[] = body.participants.map((p) => ({
        agentId: BigInt(p.agentId),
        owner: p.owner,
        boostIds: p.boostIds.map((id) => BigInt(id)),
      }));

      const eliminationOrder = body.eliminationOrder.map((e) => ({
        agentId: BigInt(e.agentId),
        eliminatedAt: e.eliminatedAt,
        source: e.source as 'zone' | 'combat',
      }));

      const computedHash = this.hasher.computeResultHash(
        arenaId,
        seed,
        winnerId,
        totalRounds,
        eliminationOrder,
        participants,
      );

      const matches = computedHash.toLowerCase() === body.expectedHash.toLowerCase();

      return {
        valid: matches,
        computedHash,
        expectedHash: body.expectedHash,
        message: matches
          ? 'Hash verification successful - result is valid'
          : 'Hash mismatch - result may be incorrect or inputs differ',
      };
    } catch (error) {
      return {
        valid: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Get all arena records (for admin/debugging)
   */
  @Get('arenas')
  getAllArenas() {
    const arenas = this.persistence.getAllArenas();
    const counts = this.persistence.getStatusCounts();

    return {
      total: arenas.length,
      statusCounts: counts,
      arenas: arenas.map((a) => ({
        arenaId: a.arenaId,
        status: a.status,
        startedAt: a.startedAt,
        updatedAt: a.updatedAt,
        hasResult: !!a.simulationResult,
        retryCount: a.retryCount,
        error: a.lastError,
      })),
    };
  }

  // ============================================
  // ADMIN ENDPOINTS
  // ============================================

  /**
   * Get indexer status
   */
  @Get('admin/indexer/status')
  @UseGuards(AdminGuard)
  getIndexerStatus() {
    return {
      ready: this.eventListener.isReady(),
      indexedArenas: this.eventListener.getIndexedArenaCount(),
      arenaIds: this.arenaStore.getAllArenaIds(),
    };
  }

  /**
   * Trigger manual reindex from a specific block
   * POST /game/admin/reindex?fromBlock=26800000
   */
  @Post('admin/reindex')
  @UseGuards(AdminGuard)
  async triggerReindex(@Query('fromBlock') fromBlockStr?: string) {
    const fromBlock = fromBlockStr ? BigInt(fromBlockStr) : 0n;

    this.logger.warn(`Admin triggered reindex from block ${fromBlock}`);

    // Run in background
    this.eventListener.reindexFromBlock(fromBlock).catch((err) => {
      this.logger.error('Reindex failed', err);
    });

    return {
      status: 'reindex_started',
      fromBlock: fromBlock.toString(),
      message: 'Reindexing started in background. Check /game/admin/indexer/status for progress.',
    };
  }

  /**
   * Manually trigger VRF for a stuck arena
   * POST /game/admin/trigger-vrf?arenaId=19
   */
  @Post('admin/trigger-vrf')
  @UseGuards(AdminGuard)
  async triggerVRF(@Query('arenaId') arenaIdStr: string) {
    if (!arenaIdStr) {
      return { error: 'arenaId query parameter is required' };
    }

    const arenaId = BigInt(arenaIdStr);

    this.logger.warn(`Admin triggered VRF for arena ${arenaId}`);

    // Check if already processing
    if (this.vrfTrigger.isProcessing(arenaId)) {
      return {
        status: 'already_processing',
        arenaId: arenaId.toString(),
        message: 'VRF request is already being processed for this arena',
      };
    }

    // Check arena state first
    try {
      const arena = await this.blockchain.getArena(arenaId);

      if (arena.state !== 2) { // LOCKED = 2
        return {
          error: 'invalid_state',
          arenaId: arenaId.toString(),
          currentState: arena.state,
          message: `Arena must be in LOCKED state (2) to trigger VRF. Current state: ${arena.state}`,
        };
      }

      // Trigger VRF - now returns success/failure
      const success = await this.vrfTrigger.triggerVRF(arenaId);

      if (success) {
        return {
          status: 'vrf_triggered',
          arenaId: arenaId.toString(),
          message: 'VRF request submitted successfully.',
        };
      } else {
        return {
          error: 'vrf_failed',
          arenaId: arenaId.toString(),
          message: 'VRF request failed. Check server logs for details.',
          failedArenas: this.vrfTrigger.getFailedArenas(),
        };
      }
    } catch (error) {
      this.logger.error(`Failed to trigger VRF for arena ${arenaId}`, error);
      return {
        error: 'trigger_failed',
        arenaId: arenaId.toString(),
        message: (error as Error).message,
      };
    }
  }

  /**
   * Get VRF recovery status
   * GET /game/admin/vrf-status
   */
  @Get('admin/vrf-status')
  @UseGuards(AdminGuard)
  getVRFStatus() {
    return {
      failedArenas: this.vrfTrigger.getFailedArenas(),
    };
  }

  /**
   * Cancel an arena and refund participants
   * POST /game/admin/cancel-arena?arenaId=19
   */
  @Post('admin/cancel-arena')
  @UseGuards(AdminGuard)
  async cancelArena(@Query('arenaId') arenaIdStr: string) {
    if (!arenaIdStr) {
      return { error: 'arenaId query parameter is required' };
    }

    const arenaId = BigInt(arenaIdStr);

    this.logger.warn(`Admin cancelling arena ${arenaId}`);

    try {
      const result = await this.contractWriter.cancelArena(arenaId);

      if (result.success) {
        let refundResult;
        try {
          refundResult = await this.contractWriter.bulkRefund(arenaId);
        } catch (refundError) {
          this.logger.error(`Arena ${arenaId} cancelled but bulk refund failed`, refundError);
        }

        return {
          status: refundResult?.success ? 'cancelled_and_refunded' : 'cancelled_refund_pending',
          arenaId: arenaId.toString(),
          txHash: result.hash,
          cancelTxHash: result.hash,
          refundTxHash: refundResult?.hash,
          message: refundResult?.success
            ? 'Arena cancelled and participant refunds were submitted by the executor.'
            : 'Arena cancelled. Bulk refund did not confirm yet; retry bulk-refund.',
          explorerLink: `https://basescan.org/tx/${result.hash}`,
          refundExplorerLink: refundResult?.hash ? `https://basescan.org/tx/${refundResult.hash}` : undefined,
        };
      } else {
        return {
          error: 'cancel_failed',
          arenaId: arenaId.toString(),
          message: result.error || 'Transaction failed',
        };
      }
    } catch (error) {
      this.logger.error(`Failed to cancel arena ${arenaId}`, error);
      return {
        error: 'cancel_failed',
        arenaId: arenaId.toString(),
        message: (error as Error).message,
      };
    }
  }

  /**
   * Manually trigger battle processing for a stuck arena
   * Use when arena is on-chain STARTED (state 3) but backend has no active match
   * POST /game/admin/trigger-battle?arenaId=34
   */
  @Post('admin/trigger-battle')
  @UseGuards(AdminGuard)
  async triggerBattle(@Query('arenaId') arenaIdStr: string) {
    if (!arenaIdStr) {
      return { error: 'arenaId query parameter is required' };
    }

    const arenaId = BigInt(arenaIdStr);

    this.logger.warn(`Admin triggered manual battle processing for arena ${arenaId}`);

    try {
      // Read on-chain state to get seed
      const arena = await this.blockchain.getArena(arenaId);

      if (arena.state !== 3) { // RUNNING = 3 (on-chain enum: CREATED=0, OPEN=1, LOCKED=2, RUNNING=3)
        return {
          error: 'invalid_state',
          arenaId: arenaId.toString(),
          currentState: arena.state,
          message: `Arena must be in STARTED state (3) to trigger battle. Current state: ${arena.state}`,
        };
      }

      if (!arena.seed || arena.seed === 0n) {
        return {
          error: 'no_seed',
          arenaId: arenaId.toString(),
          message: 'Arena has no seed set on-chain. Cannot run battle without VRF seed.',
        };
      }

      // Force-clear stale persistence data (handles contract upgrades where arena IDs reset)
      this.persistence.deleteArena(arenaId.toString());
      this.orchestrator.clearProcessingState(arenaId.toString());

      // Trigger manual processing
      this.orchestrator.triggerManualProcessing(arenaId, arena.seed).catch((err) => {
        this.logger.error(`Manual battle processing failed for arena ${arenaId}`, err);
      });

      return {
        status: 'battle_triggered',
        arenaId: arenaId.toString(),
        seed: arena.seed.toString(),
        message: 'Battle processing started. Watch /game/health for progress.',
      };
    } catch (error) {
      this.logger.error(`Failed to trigger battle for arena ${arenaId}`, error);
      return {
        error: 'trigger_failed',
        arenaId: arenaId.toString(),
        message: (error as Error).message,
      };
    }
  }

  /**
   * Bulk refund all unclaimed participants in a cancelled arena
   * POST /game/admin/bulk-refund?arenaId=19
   */
  @Post('admin/bulk-refund')
  @UseGuards(AdminGuard)
  async bulkRefund(@Query('arenaId') arenaIdStr: string) {
    if (!arenaIdStr) {
      return { error: 'arenaId query parameter is required' };
    }

    const arenaId = BigInt(arenaIdStr);

    this.logger.warn(`Admin bulk-refunding arena ${arenaId}`);

    try {
      const result = await this.contractWriter.bulkRefund(arenaId);

      if (result.success) {
        return {
          status: 'bulk_refunded',
          arenaId: arenaId.toString(),
          txHash: result.hash,
          message: 'Bulk refund submitted. The contract paid all unclaimed participants directly.',
          explorerLink: `https://basescan.org/tx/${result.hash}`,
        };
      }

      return {
        error: 'bulk_refund_failed',
        arenaId: arenaId.toString(),
        message: result.error || 'Transaction failed',
      };
    } catch (error) {
      this.logger.error(`Failed to bulk refund arena ${arenaId}`, error);
      return {
        error: 'bulk_refund_failed',
        arenaId: arenaId.toString(),
        message: (error as Error).message,
      };
    }
  }

  /**
   * Bulk-refund a cancelled arena.
   *
   * Kept at the old claim-refund path for admin compatibility. Per-agent
   * claimRefund requires the holder signature, so backend/admin must use
   * bulkRefund and let the contract send refunds to the recorded owners.
   * POST /game/admin/claim-refund?arenaId=19&agentId=7
   */
  @Post('admin/claim-refund')
  @UseGuards(AdminGuard)
  async claimRefund(
    @Query('arenaId') arenaIdStr: string,
    @Query('agentId') agentIdStr: string,
  ) {
    if (!arenaIdStr || !agentIdStr) {
      return { error: 'arenaId and agentId query parameters are required' };
    }

    const arenaId = BigInt(arenaIdStr);
    const agentId = BigInt(agentIdStr);

    this.logger.warn(`Admin bulk-refunding arena=${arenaId} after claim-refund request for agent=${agentId}`);

    try {
      const result = await this.contractWriter.bulkRefund(arenaId);

      if (result.success) {
        return {
          status: 'bulk_refunded',
          arenaId: arenaId.toString(),
          agentId: agentId.toString(),
          txHash: result.hash,
          message: 'Bulk refund submitted. The contract paid all unclaimed participants directly.',
          explorerLink: `https://basescan.org/tx/${result.hash}`,
        };
      } else {
        return {
          error: 'claim_failed',
          message: result.error || 'Transaction failed',
        };
      }
    } catch (error) {
      this.logger.error(`Failed to claim refund`, error);
      return {
        error: 'claim_failed',
        message: (error as Error).message,
      };
    }
  }
}
