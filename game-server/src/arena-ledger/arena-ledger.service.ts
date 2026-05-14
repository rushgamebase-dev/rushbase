// ============================================
// ARENA LEDGER SERVICE - Persistent indexing for transparency
// ============================================
// All battles are executed on-chain.
// This is a read-only index built from public blockchain events.

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { createPublicClient, http } from 'viem';
import { PrismaService } from './prisma.service';
import { ArenaSnapshot, ChainEvent } from '../arena/arena-store.service';
import { Prisma } from '@prisma/client';
import { GAME_CONFIG_VERSION } from '../game/engine-v2';
import { CHAIN, CONTRACT_ADDRESSES } from '../config/contracts.config';
import ArenaManagerAbi from '../blockchain/abis/ArenaManager.json';

// Base chain explorer
const BASE_EXPLORER = 'https://basescan.org';

export interface LedgerArenaDetail {
  arenaId: string;
  chainId: number;
  tier: string;
  entryFee: string;
  minPlayers: number;
  maxPlayers: number;
  creator: string;
  state: string;

  // VRF Proof
  vrfRequestId: string | null;
  vrfRequestTxHash: string | null;
  seed: string | null;

  // Battle Result
  winnerId: string | null;
  winnerOwner: string | null;
  resultHash: string | null;
  totalParticipants: number;
  gameConfigVersion: string | null;

  // Prizes
  prizePool: string;
  prizeAmount: string | null;

  // On-chain proofs (links)
  proofs: {
    createTx: string | null;
    lockTx: string | null;
    vrfTx: string | null;
    battleTx: string | null;
    prizeTx: string | null;
    cancelTx: string | null;
  };

  // Timestamps
  createdAt: Date;
  lockedAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;

  // Participants
  participants: Array<{
    agentId: string;
    owner: string;
    joinTxHash: string | null;
  }>;

  // Event timeline
  events: Array<{
    type: string;
    txHash: string;
    blockNumber: number;
    timestamp: Date;
    explorerLink: string;
  }>;
}

export interface LedgerStats {
  totalArenas: number;
  totalFinished: number;
  totalCancelled: number;
  totalPrizePool: string;
  totalPlayers: number;
  avgPlayersPerArena: number;
  avgPrizePool: string;
}

@Injectable()
export class ArenaLedgerService implements OnModuleInit {
  private readonly logger = new Logger(ArenaLedgerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    // Initialize global stats if not exists
    await this.prisma.ledgerStats.upsert({
      where: { id: 'global' },
      create: { id: 'global' },
      update: {},
    });

    this.logger.log('Arena Ledger Service initialized');
  }

  // ============================================
  // EVENT LISTENERS - Index on-chain events
  // ============================================

  @OnEvent('arena.created')
  async onArenaCreated(payload: {
    arenaId: string;
    creator: string;
    entryFee: string;
    minPlayers: number;
    maxPlayers: number;
    tier: string;
    blockNumber: number;
    txHash: string;
    blockTimestamp: Date; // SOURCE OF TRUTH - from blockchain
  }) {
    try {
      await this.prisma.arenaRecord.upsert({
        where: { arenaId: payload.arenaId },
        create: {
          arenaId: payload.arenaId,
          tier: payload.tier || 'BRONZE',
          entryFee: payload.entryFee,
          minPlayers: payload.minPlayers,
          maxPlayers: payload.maxPlayers,
          creator: payload.creator,
          state: 'open',
          createTxHash: payload.txHash,
          createBlock: payload.blockNumber,
          createdAt: payload.blockTimestamp, // Use block.timestamp, NOT new Date()
        },
        update: {
          state: 'open',
          createTxHash: payload.txHash,
          createBlock: payload.blockNumber,
        },
      });

      await this.addEvent(payload.arenaId, 'ArenaCreated', payload.txHash, payload.blockNumber, payload, payload.blockTimestamp);
      this.logger.log(`Indexed ArenaCreated: ${payload.arenaId}`);
    } catch (error) {
      this.logger.error(`Failed to index ArenaCreated: ${error.message}`);
    }
  }

  @OnEvent('arena.agent_joined')
  async onAgentJoined(payload: {
    arenaId: string;
    agentId: string;
    owner: string;
    blockNumber: number;
    txHash: string;
    blockTimestamp: Date;
  }) {
    try {
      // Upsert participant
      await this.prisma.participantRecord.upsert({
        where: {
          arenaId_agentId: {
            arenaId: payload.arenaId,
            agentId: payload.agentId,
          },
        },
        create: {
          arenaId: payload.arenaId,
          agentId: payload.agentId,
          owner: payload.owner,
          joinTxHash: payload.txHash,
          joinBlock: payload.blockNumber,
        },
        update: {},
      });

      // Update participant count
      const count = await this.prisma.participantRecord.count({
        where: { arenaId: payload.arenaId },
      });

      await this.prisma.arenaRecord.update({
        where: { arenaId: payload.arenaId },
        data: { totalParticipants: count },
      });

      this.logger.log(`Indexed AgentJoined: arena=${payload.arenaId}, agent=${payload.agentId}`);
    } catch (error) {
      this.logger.error(`Failed to index AgentJoined: ${error.message}`);
    }
  }

  @OnEvent('arena.locked')
  async onArenaLocked(payload: {
    arenaId: string;
    participantCount: number;
    vrfRequestId: string;
    blockNumber: number;
    txHash: string;
    blockTimestamp: Date;
  }) {
    try {
      // Get current arena to calculate prize pool
      const arena = await this.prisma.arenaRecord.findUnique({
        where: { arenaId: payload.arenaId },
      });

      // Calculate prize pool = entryFee * participantCount
      let prizePool = '0';
      if (arena && arena.entryFee) {
        try {
          prizePool = (BigInt(arena.entryFee) * BigInt(payload.participantCount)).toString();
        } catch (e) {
          this.logger.warn(`Failed to calculate prizePool: ${e.message}`);
        }
      }

      await this.prisma.arenaRecord.update({
        where: { arenaId: payload.arenaId },
        data: {
          state: 'locked',
          // Note: vrfRequestId from ArenaLocked may be 0, the real one comes from VRFRequested event
          lockTxHash: payload.txHash,
          lockBlock: payload.blockNumber,
          totalParticipants: payload.participantCount,
          prizePool,
          lockedAt: payload.blockTimestamp, // Use block.timestamp, NOT new Date()
        },
      });

      await this.addEvent(payload.arenaId, 'ArenaLocked', payload.txHash, payload.blockNumber, payload, payload.blockTimestamp);
      this.logger.log(`Indexed ArenaLocked: ${payload.arenaId}, prizePool=${prizePool}`);
    } catch (error) {
      this.logger.error(`Failed to index ArenaLocked: ${error.message}`);
    }
  }

  @OnEvent('arena.vrf_requested')
  async onVRFRequested(payload: {
    arenaId: string;
    vrfRequestId: string;
    blockNumber: number;
    txHash: string;
    blockTimestamp: Date;
  }) {
    try {
      await this.prisma.arenaRecord.update({
        where: { arenaId: payload.arenaId },
        data: {
          vrfRequestId: payload.vrfRequestId,
          vrfRequestTxHash: payload.txHash,
          vrfRequestBlock: payload.blockNumber,
        },
      });

      await this.addEvent(payload.arenaId, 'VRFRequested', payload.txHash, payload.blockNumber, payload, payload.blockTimestamp);
      this.logger.log(`Indexed VRFRequested: ${payload.arenaId}, requestId=${payload.vrfRequestId}`);
    } catch (error) {
      this.logger.error(`Failed to index VRFRequested: ${error.message}`);
    }
  }

  @OnEvent('arena.started')
  async onArenaStarted(payload: {
    arenaId: string;
    seed: string;
    blockNumber: number;
    txHash: string;
    blockTimestamp: Date;
  }) {
    try {
      // Guard: don't regress battleState if orchestrator already finished (COMPLETE/SETTLED)
      const existing = await this.prisma.arenaRecord.findUnique({
        where: { arenaId: payload.arenaId },
        select: { battleState: true },
      });
      const alreadyDone = existing?.battleState === 'COMPLETE' || existing?.battleState === 'SETTLED';

      await this.prisma.arenaRecord.update({
        where: { arenaId: payload.arenaId },
        data: {
          state: alreadyDone ? undefined : 'running',
          battleState: alreadyDone ? undefined : 'SIMULATING',
          seed: payload.seed,
          gameConfigVersion: GAME_CONFIG_VERSION, // Save for replay compatibility
          startedAt: payload.blockTimestamp, // Use block.timestamp, NOT new Date()
        },
      });

      await this.addEvent(payload.arenaId, 'ArenaStarted', payload.txHash, payload.blockNumber, payload, payload.blockTimestamp);
      this.logger.log(`Indexed ArenaStarted: ${payload.arenaId} with config v${GAME_CONFIG_VERSION}`);
    } catch (error) {
      this.logger.error(`Failed to index ArenaStarted: ${error.message}`);
    }
  }

  @OnEvent('arena.simulation_complete')
  async onSimulationComplete(payload: {
    arenaId: string;
    simulationData: string;
  }) {
    // Non-critical backup: revealAt is now written synchronously by the orchestrator
    // BEFORE this event fires. This listener only persists simulationData if needed.
    const { arenaId, simulationData } = payload;

    try {
      const existing = await this.prisma.arenaRecord.findUnique({
        where: { arenaId },
        select: { revealAt: true, simulationData: true },
      });

      if (!existing) {
        this.logger.warn(`[anti-spoiler] ledger backup: arena ${arenaId} record not found (orchestrator should have created it)`);
        return;
      }

      // If orchestrator already wrote everything, nothing to do
      if (existing.revealAt && existing.simulationData) {
        this.logger.debug(`[anti-spoiler] ledger backup: arena ${arenaId} already has revealAt + simulationData, skipping`);
        return;
      }

      // Write simulationData if missing (revealAt should already be set by orchestrator)
      if (!existing.simulationData) {
        await this.prisma.arenaRecord.update({
          where: { arenaId },
          data: { simulationData },
        });
        this.logger.log(`[anti-spoiler] ledger backup: wrote simulationData for arena ${arenaId}`);
      }
    } catch (error) {
      this.logger.error(`[anti-spoiler] ledger backup failed for arena ${arenaId}: ${error.message}`);
    }
  }

  @OnEvent('arena.battle_executed')
  async onBattleExecuted(payload: {
    arenaId: string;
    winnerId: string;
    resultHash: string;
    blockNumber: number;
    txHash: string;
    blockTimestamp: Date;
  }) {
    try {
      await this.prisma.arenaRecord.update({
        where: { arenaId: payload.arenaId },
        data: {
          winnerId: payload.winnerId,
          resultHash: payload.resultHash,
          battleTxHash: payload.txHash,
          battleBlock: payload.blockNumber,
        },
      });

      await this.addEvent(payload.arenaId, 'BattleExecuted', payload.txHash, payload.blockNumber, payload, payload.blockTimestamp);
      this.logger.log(`Indexed BattleExecuted: ${payload.arenaId}, winner=${payload.winnerId}`);
    } catch (error) {
      this.logger.error(`Failed to index BattleExecuted: ${error.message}`);
    }
  }

  @OnEvent('arena.prizes_distributed')
  async onPrizesDistributed(payload: {
    arenaId: string;
    winner: string;
    amount: string;
    blockNumber: number;
    txHash: string;
    blockTimestamp: Date;
  }) {
    try {
      // Check if orchestrator has set revealAt (it runs simulation before on-chain submission).
      // Chain events can arrive before orchestrator finishes if simulation takes longer than
      // on-chain tx processing. Set fallback revealAt to protect anti-spoiler gate.
      const existing = await this.prisma.arenaRecord.findUnique({
        where: { arenaId: payload.arenaId },
        select: { revealAt: true },
      });
      const FALLBACK_REVEAL_MS = 180_000; // 3 min — generous fallback for slow simulations
      // Only set fallback revealAt for recent events (not historical backfill).
      // During backfill, blockTimestamp is hours/days old — no need for anti-spoiler delay.
      const isRecentEvent = (Date.now() - payload.blockTimestamp.getTime()) < 300_000; // 5 min
      const needsRevealAt = !existing?.revealAt && isRecentEvent;

      await this.prisma.arenaRecord.update({
        where: { arenaId: payload.arenaId },
        data: {
          state: 'finished',
          battleState: 'SETTLED',
          ...(needsRevealAt && { revealAt: new Date(Date.now() + FALLBACK_REVEAL_MS) }),
          winnerOwner: payload.winner,
          prizeAmount: payload.amount,
          prizeTxHash: payload.txHash,
          prizeBlock: payload.blockNumber,
          finishedAt: payload.blockTimestamp, // Use block.timestamp, NOT new Date()
        },
      });

      if (needsRevealAt) {
        this.logger.warn(`[anti-spoiler] Set fallback revealAt for arena ${payload.arenaId} (orchestrator hasn't written it yet)`);
      }

      await this.addEvent(payload.arenaId, 'PrizesDistributed', payload.txHash, payload.blockNumber, payload, payload.blockTimestamp);
      await this.updateGlobalStats();
      this.logger.log(`Indexed PrizesDistributed: ${payload.arenaId}`);
    } catch (error) {
      this.logger.error(`Failed to index PrizesDistributed: ${error.message}`);
    }
  }

  @OnEvent('arena.finished')
  async onArenaFinished(payload: {
    arenaId: string;
    winnerId: string;
    prizeAmount: string;
    blockNumber: number;
    txHash: string;
    blockTimestamp: Date;
  }) {
    try {
      // Safety net: ArenaFinished from ArenaManager confirms arena completion.
      // PayoutDistributed usually handles this, but ArenaFinished ensures
      // state='finished' even if PayoutDistributed was missed.
      const existing = await this.prisma.arenaRecord.findUnique({
        where: { arenaId: payload.arenaId },
        select: { state: true, winnerId: true },
      });

      if (!existing) {
        this.logger.warn(`ArenaFinished for unknown arena ${payload.arenaId}`);
        return;
      }

      // Only update if not already finished (idempotent)
      if (existing.state !== 'finished') {
        await this.prisma.arenaRecord.update({
          where: { arenaId: payload.arenaId },
          data: {
            state: 'finished',
            battleState: 'SETTLED',
            winnerId: payload.winnerId,
            prizeAmount: payload.prizeAmount,
            finishedAt: payload.blockTimestamp,
          },
        });
        await this.updateGlobalStats();
        this.logger.log(`Indexed ArenaFinished (safety net): ${payload.arenaId}, winner=${payload.winnerId}`);
      }

      await this.addEvent(payload.arenaId, 'ArenaFinished', payload.txHash, payload.blockNumber, payload, payload.blockTimestamp);
    } catch (error) {
      this.logger.error(`Failed to index ArenaFinished: ${error.message}`);
    }
  }

  @OnEvent('arena.cancelled')
  async onArenaCancelled(payload: {
    arenaId: string;
    blockNumber: number;
    txHash: string;
    blockTimestamp: Date;
  }) {
    try {
      await this.prisma.arenaRecord.update({
        where: { arenaId: payload.arenaId },
        data: {
          state: 'cancelled',
          cancelTxHash: payload.txHash,
          finishedAt: payload.blockTimestamp, // Use block.timestamp, NOT new Date()
        },
      });

      await this.addEvent(payload.arenaId, 'ArenaCancelled', payload.txHash, payload.blockNumber, payload, payload.blockTimestamp);
      await this.updateGlobalStats();
      this.logger.log(`Indexed ArenaCancelled: ${payload.arenaId}`);
    } catch (error) {
      this.logger.error(`Failed to index ArenaCancelled: ${error.message}`);
    }
  }

  @OnEvent('arena.refund_claimed')
  async onRefundClaimed(payload: {
    arenaId: string;
    agentId: string;
    owner: string;
    amount: string;
    blockNumber: number;
    txHash: string;
    blockTimestamp: Date;
  }) {
    try {
      await this.addEvent(payload.arenaId, 'RefundClaimed', payload.txHash, payload.blockNumber, payload, payload.blockTimestamp);
      this.logger.log(`Indexed RefundClaimed: arena=${payload.arenaId}, agent=${payload.agentId}, owner=${payload.owner}`);
    } catch (error) {
      this.logger.error(`Failed to index RefundClaimed: ${error.message}`);
    }
  }

  // ============================================
  // QUERY METHODS
  // ============================================

  async getHistory(options: {
    limit?: number;
    offset?: number;
    tier?: string;
    state?: string;
    creator?: string;
    winner?: string;
    owner?: string;
  }): Promise<{ arenas: any[]; total: number }> {
    const where: Prisma.ArenaRecordWhereInput = {};

    if (options.tier) where.tier = options.tier;
    if (options.state) where.state = options.state;
    if (options.creator) where.creator = options.creator;
    if (options.winner) where.winnerId = options.winner;
    if (options.owner) {
      where.participants = {
        some: { owner: { equals: options.owner, mode: 'insensitive' } },
      };
    }

    const [arenas, total] = await Promise.all([
      this.prisma.arenaRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: options.limit || 50,
        skip: options.offset || 0,
        include: {
          participants: true,
        },
      }),
      this.prisma.arenaRecord.count({ where }),
    ]);

    return {
      arenas: arenas.map((a) => this.formatArenaForList(a)),
      total,
    };
  }

  async getArenaDetail(arenaId: string): Promise<LedgerArenaDetail | null> {
    const arena = await this.prisma.arenaRecord.findUnique({
      where: { arenaId },
      include: {
        participants: true,
        events: {
          orderBy: { blockNumber: 'asc' },
        },
      },
    });

    if (!arena) return null;

    // Use battleState (narrative lifecycle) to determine visibility
    // Only mask during SIMULATING (battle actively running).
    // COMPLETE and SETTLED both reveal results — same source of truth as Telegram CHAMPION CROWNED.
    const bs = arena.battleState;
    const battlePlaying = bs === 'SIMULATING';
    const showResult = !battlePlaying;

    return {
      arenaId: arena.arenaId,
      chainId: arena.chainId,
      tier: arena.tier,
      entryFee: arena.entryFee,
      minPlayers: arena.minPlayers,
      maxPlayers: arena.maxPlayers,
      creator: arena.creator,
      state: battlePlaying ? 'running' : arena.state,

      vrfRequestId: arena.vrfRequestId,
      vrfRequestTxHash: arena.vrfRequestTxHash,
      seed: arena.seed,

      winnerId: showResult ? arena.winnerId : null,
      winnerOwner: showResult ? arena.winnerOwner : null,
      resultHash: showResult ? arena.resultHash : null,
      totalParticipants: arena.totalParticipants,
      gameConfigVersion: arena.gameConfigVersion,

      prizePool: arena.prizePool,
      prizeAmount: showResult ? arena.prizeAmount : null,

      proofs: {
        createTx: arena.createTxHash ? `${BASE_EXPLORER}/tx/${arena.createTxHash}` : null,
        lockTx: arena.lockTxHash ? `${BASE_EXPLORER}/tx/${arena.lockTxHash}` : null,
        vrfTx: arena.vrfRequestTxHash ? `${BASE_EXPLORER}/tx/${arena.vrfRequestTxHash}` : null,
        battleTx: showResult && arena.battleTxHash ? `${BASE_EXPLORER}/tx/${arena.battleTxHash}` : null,
        prizeTx: showResult && arena.prizeTxHash ? `${BASE_EXPLORER}/tx/${arena.prizeTxHash}` : null,
        cancelTx: arena.cancelTxHash ? `${BASE_EXPLORER}/tx/${arena.cancelTxHash}` : null,
      },

      createdAt: arena.createdAt,
      lockedAt: arena.lockedAt,
      startedAt: arena.startedAt,
      finishedAt: showResult ? arena.finishedAt : null,

      participants: arena.participants.map((p) => ({
        agentId: p.agentId,
        owner: p.owner,
        joinTxHash: p.joinTxHash,
      })),

      // Filter out spoiler events (BattleExecuted, PrizesDistributed) while battle is playing
      events: arena.events
        .filter((e) => {
          if (!battlePlaying) return true;
          return !['BattleExecuted', 'PrizesDistributed'].includes(e.eventType);
        })
        .map((e) => ({
          type: e.eventType,
          txHash: e.txHash,
          blockNumber: e.blockNumber,
          timestamp: e.timestamp,
          explorerLink: `${BASE_EXPLORER}/tx/${e.txHash}`,
        })),
    };
  }

  /**
   * Get raw arena record from DB (no spoiler filtering).
   * Used by the canonical /final endpoint.
   */
  async getArenaDetailRaw(arenaId: string) {
    return this.prisma.arenaRecord.findUnique({
      where: { arenaId },
      include: { participants: true },
    });
  }

  /**
   * Lightweight reveal check — only returns revealAt timestamp.
   * Used by GET /game/arena/:arenaId/reveal for deterministic anti-spoiler.
   */
  async getArenaReveal(arenaId: string): Promise<{ revealAt: Date | null; matchId: string | null; battleState: string | null; winnerId: string | null; winnerOwner: string | null } | null> {
    const arena = await this.prisma.arenaRecord.findUnique({
      where: { arenaId },
      select: { revealAt: true, battleState: true, winnerId: true, winnerOwner: true },
    });
    if (!arena) return null;
    // Only reveal winner when battleState authorizes it (COMPLETE/SETTLED)
    const showResult = arena.battleState === 'COMPLETE' || arena.battleState === 'SETTLED';
    return {
      revealAt: arena.revealAt,
      matchId: null,
      battleState: arena.battleState,
      winnerId: showResult ? arena.winnerId : null,
      winnerOwner: showResult ? arena.winnerOwner : null,
    };
  }

  async getStats(): Promise<LedgerStats> {
    const stats = await this.prisma.ledgerStats.findUnique({
      where: { id: 'global' },
    });

    if (!stats) {
      return {
        totalArenas: 0,
        totalFinished: 0,
        totalCancelled: 0,
        totalPrizePool: '0',
        totalPlayers: 0,
        avgPlayersPerArena: 0,
        avgPrizePool: '0',
      };
    }

    const avgPlayers = stats.totalFinished > 0
      ? Math.round(stats.totalPlayers / stats.totalFinished)
      : 0;

    const avgPrize = stats.totalFinished > 0
      ? (BigInt(stats.totalPrizePool) / BigInt(stats.totalFinished)).toString()
      : '0';

    return {
      totalArenas: stats.totalArenas,
      totalFinished: stats.totalFinished,
      totalCancelled: stats.totalCancelled,
      totalPrizePool: stats.totalPrizePool,
      totalPlayers: stats.totalPlayers,
      avgPlayersPerArena: avgPlayers,
      avgPrizePool: avgPrize,
    };
  }

  async getUnclaimedRefunds(ownerAddress: string): Promise<any[]> {
    // Find cancelled arenas where this owner is a participant
    const cancelledArenas = await this.prisma.arenaRecord.findMany({
      where: {
        state: 'cancelled',
        participants: {
          some: { owner: { equals: ownerAddress, mode: 'insensitive' } },
        },
      },
      include: {
        participants: true,
      },
    });

    // Collect DB candidates (owner's participants in cancelled arenas)
    const candidates: Array<{ arenaId: string; agentId: string; entryFee: string; tier: string }> = [];

    for (const arena of cancelledArenas) {
      const ownerParticipants = arena.participants.filter(
        p => p.owner.toLowerCase() === ownerAddress,
      );
      for (const participant of ownerParticipants) {
        candidates.push({
          arenaId: arena.arenaId,
          agentId: participant.agentId,
          entryFee: arena.entryFee,
          tier: arena.tier,
        });
      }
    }

    if (candidates.length === 0) return [];

    // Verify each candidate on-chain via simulateContract.
    // If claimRefund would revert (RefundAlreadyClaimed), filter it out.
    const rpcUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
    const publicClient = createPublicClient({
      chain: CHAIN,
      transport: http(rpcUrl),
    });

    const verified: typeof candidates = [];

    for (const candidate of candidates) {
      try {
        await publicClient.simulateContract({
          address: CONTRACT_ADDRESSES.ARENA_MANAGER,
          abi: ArenaManagerAbi as readonly unknown[],
          functionName: 'claimRefund',
          args: [BigInt(candidate.arenaId), BigInt(candidate.agentId)],
          account: '0x0000000000000000000000000000000000000001' as `0x${string}`,
        });
        // Simulation succeeded — refund is truly available
        verified.push(candidate);
      } catch {
        // Simulation reverted — already claimed or arena state changed
        this.logger.debug(
          `Refund already claimed on-chain: arena=${candidate.arenaId} agent=${candidate.agentId}`,
        );
      }
    }

    return verified;
  }

  async getEarningsByOwner(ownerAddress: string): Promise<{
    totalPrizesWon: string;
    totalEntryFees: string;
    netEarnings: string;
    arenasWon: number;
    arenasPlayed: number;
  }> {
    // Sum prizes won from finished arenas where this wallet was the winner
    const wonArenas = await this.prisma.arenaRecord.findMany({
      where: {
        winnerOwner: { equals: ownerAddress, mode: 'insensitive' },
        state: 'finished',
        prizeAmount: { not: null },
      },
      select: { prizeAmount: true },
    });

    let totalPrizesWon = BigInt(0);
    for (const a of wonArenas) {
      if (a.prizeAmount) totalPrizesWon += BigInt(a.prizeAmount);
    }

    // Sum entry fees from finished arenas this wallet participated in
    const participatedArenas = await this.prisma.arenaRecord.findMany({
      where: {
        state: 'finished',
        participants: {
          some: { owner: { equals: ownerAddress, mode: 'insensitive' } },
        },
      },
      select: { entryFee: true },
    });

    let totalEntryFees = BigInt(0);
    for (const a of participatedArenas) {
      totalEntryFees += BigInt(a.entryFee);
    }

    const netEarnings = totalPrizesWon - totalEntryFees;

    return {
      totalPrizesWon: totalPrizesWon.toString(),
      totalEntryFees: totalEntryFees.toString(),
      netEarnings: netEarnings.toString(),
      arenasWon: wonArenas.length,
      arenasPlayed: participatedArenas.length,
    };
  }

  async getWinnerHistory(winnerId: string, limit = 10): Promise<any[]> {
    const arenas = await this.prisma.arenaRecord.findMany({
      where: { winnerId },
      orderBy: { finishedAt: 'desc' },
      take: limit,
    });

    return arenas.map((a) => this.formatArenaForList(a));
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  private async addEvent(
    arenaId: string,
    eventType: string,
    txHash: string,
    blockNumber: number,
    data: any,
    blockTimestamp: Date, // SOURCE OF TRUTH - from blockchain
  ) {
    // Check for existing event with same arenaId + eventType + txHash
    // The orchestrator emits backup events with blockNumber=0, and the
    // blockchain watcher emits the real event with actual block numbers.
    // If we already have this event, update it with the real block data.
    const existing = await this.prisma.arenaEvent.findFirst({
      where: { arenaId, eventType, txHash },
    });

    if (existing) {
      // Only update if the new data has a real block number (> 0) and existing doesn't
      if (blockNumber > 0 && existing.blockNumber === 0) {
        await this.prisma.arenaEvent.update({
          where: { id: existing.id },
          data: {
            blockNumber,
            timestamp: blockTimestamp,
            data: JSON.stringify(data),
          },
        });
      }
      return; // Skip duplicate
    }

    await this.prisma.arenaEvent.create({
      data: {
        arenaId,
        eventType,
        txHash,
        blockNumber,
        logIndex: 0,
        timestamp: blockTimestamp,
        data: JSON.stringify(data),
      },
    });
  }

  private async updateGlobalStats() {
    const [totalArenas, totalFinished, totalCancelled] = await Promise.all([
      this.prisma.arenaRecord.count(),
      this.prisma.arenaRecord.count({ where: { state: 'finished' } }),
      this.prisma.arenaRecord.count({ where: { state: 'cancelled' } }),
    ]);

    // Sum prize pool from finished arenas
    const finishedArenas = await this.prisma.arenaRecord.findMany({
      where: { state: 'finished', prizeAmount: { not: null } },
      select: { prizeAmount: true, totalParticipants: true },
    });

    let totalPrizePool = BigInt(0);
    let totalPlayers = 0;

    for (const arena of finishedArenas) {
      if (arena.prizeAmount) {
        totalPrizePool += BigInt(arena.prizeAmount);
      }
      totalPlayers += arena.totalParticipants;
    }

    await this.prisma.ledgerStats.update({
      where: { id: 'global' },
      data: {
        totalArenas,
        totalFinished,
        totalCancelled,
        totalPrizePool: totalPrizePool.toString(),
        totalPlayers,
      },
    });
  }

  /**
   * Determine the display state for an arena using battleState (narrative lifecycle).
   * battleState is the source of truth for UX — not the on-chain `state` field.
   *
   * battleState: SIMULATING → COMPLETE → SETTLED
   * on-chain state: running → finished (only when prizes distributed)
   *
   * Show result only when battleState is SETTLED (or null for old arenas + finished).
   */
  private formatArenaForList(arena: any) {
    const bs = arena.battleState;

    // Mask during SIMULATING (battle actively running) or before revealAt (animation still playing).
    // revealAt is set by orchestrator at simulation_complete (now + REVEAL_DELAY_MS).
    // Also mask when chain says finished but orchestrator hasn't set revealAt yet
    // (chain events arrive before simulation completes for slow simulations).
    const pendingReveal = arena.revealAt && new Date() < new Date(arena.revealAt);
    const awaitingOrchestrator = !arena.revealAt && arena.state === 'finished' &&
      (bs === 'COMPLETE' || bs === 'SETTLED') && arena.finishedAt &&
      (Date.now() - new Date(arena.finishedAt).getTime()) < 180_000;
    const shouldMask = bs === 'SIMULATING' || pendingReveal || awaitingOrchestrator;
    const displayState = shouldMask ? 'running' : arena.state;
    const showResult = !shouldMask;

    return {
      arenaId: arena.arenaId,
      tier: arena.tier,
      state: displayState,
      battleState: bs,
      entryFee: arena.entryFee,
      totalParticipants: arena.totalParticipants,
      winnerId: showResult ? arena.winnerId : null,
      winnerOwner: showResult ? arena.winnerOwner : null,
      prizeAmount: showResult ? arena.prizeAmount : null,
      createdAt: arena.createdAt,
      finishedAt: showResult ? arena.finishedAt : null,
      verifyLink: `${BASE_EXPLORER}/tx/${arena.prizeTxHash || arena.createTxHash}`,
    };
  }

  // ============================================
  // MANUAL SYNC (for initial population)
  // ============================================

  async syncFromSnapshot(snapshot: ArenaSnapshot) {
    try {
      const arena = await this.prisma.arenaRecord.upsert({
        where: { arenaId: snapshot.arenaId },
        create: {
          arenaId: snapshot.arenaId,
          tier: 'BRONZE', // Default, should be fetched from contract
          entryFee: '0',
          minPlayers: 2,
          maxPlayers: snapshot.maxPlayers || 10,
          creator: '',
          state: snapshot.state,
          createTxHash: snapshot.artifacts.createTxHash,
          lockTxHash: snapshot.artifacts.lockTxHash,
          vrfRequestId: snapshot.artifacts.vrfRequestId,
          vrfRequestTxHash: snapshot.artifacts.vrfRequestTxHash,
          vrfRequestBlock: snapshot.artifacts.vrfRequestBlockNumber,
          seed: snapshot.artifacts.seed,
          battleTxHash: snapshot.artifacts.battleResultTxHash,
          battleBlock: snapshot.artifacts.battleResultBlockNumber,
          resultHash: snapshot.artifacts.resultHash,
          prizeTxHash: snapshot.artifacts.prizesDistributedTxHash,
          prizeBlock: snapshot.artifacts.prizesDistributedBlockNumber,
          prizeAmount: snapshot.artifacts.prizeAmount,
          winnerId: snapshot.artifacts.winnerId,
          winnerOwner: snapshot.artifacts.winnerOwner,
          cancelTxHash: snapshot.artifacts.cancelTxHash,
          totalParticipants: snapshot.participantCount,
        },
        update: {
          state: snapshot.state,
        },
      });

      // Sync participants
      for (const p of snapshot.participants) {
        await this.prisma.participantRecord.upsert({
          where: {
            arenaId_agentId: {
              arenaId: snapshot.arenaId,
              agentId: p.agentId,
            },
          },
          create: {
            arenaId: snapshot.arenaId,
            agentId: p.agentId,
            owner: p.owner,
            joinTxHash: p.joinTxHash,
          },
          update: {},
        });
      }

      this.logger.log(`Synced arena ${snapshot.arenaId} from snapshot`);
    } catch (error) {
      this.logger.error(`Failed to sync from snapshot: ${error.message}`);
    }
  }
}
