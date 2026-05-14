// ============================================
// XP SERVICE - Awards XP from simulation results
// ============================================

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../arena-ledger/prisma.service';
import {
  calculateXPBreakdown,
  calculateLevelProgress,
  calculateLevel,
} from './xp.config';

interface SimulationAgent {
  agentId: string;
  owner: string;
  eliminatedAt?: number;
  kills: number;
}

interface SimulationData {
  agents: SimulationAgent[];
  eliminationOrder?: Array<{
    agentId: string;
    eliminatedAt: number;
    eliminatedBy?: string;
    source: string;
  }>;
  totalTicks?: number;
  totalParticipants?: number;
}

@Injectable()
export class XPService implements OnModuleInit {
  private readonly logger = new Logger(XPService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    // Run recovery scan on startup — award XP for any arenas with simulationData but no XPTransaction
    try {
      await this.recoverMissingXP();
    } catch (error) {
      this.logger.error('XP recovery scan failed', error);
    }
  }

  @OnEvent('arena.simulation_complete')
  async onSimulationComplete(payload: {
    arenaId: string;
    simulationData: string;
  }) {
    try {
      const simData: SimulationData = JSON.parse(payload.simulationData);
      await this.awardXPForArena(payload.arenaId, simData);
    } catch (error) {
      this.logger.error(
        `Failed to award XP for arena ${payload.arenaId}: ${(error as Error).message}`,
      );
    }
  }

  async awardXPForArena(arenaId: string, simData: SimulationData) {
    if (!simData.agents || simData.agents.length === 0) {
      this.logger.warn(`No agents in simulation data for arena ${arenaId}`);
      return;
    }

    // Calculate placements from eliminatedAt sort (higher = survived longer = better)
    const sorted = [...simData.agents].sort((a, b) => {
      const aElim = a.eliminatedAt ?? Infinity;
      const bElim = b.eliminatedAt ?? Infinity;
      return bElim - aElim;
    });

    const placements = new Map<string, number>();
    sorted.forEach((agent, idx) => {
      placements.set(agent.agentId, idx + 1);
    });

    // Build all XP awards
    const awards: Array<{
      agentId: string;
      xpGained: number;
      breakdown: string;
    }> = [];

    for (const agent of simData.agents) {
      const placement = placements.get(agent.agentId) || sorted.length;
      const breakdown = calculateXPBreakdown(agent.kills || 0, placement);

      awards.push({
        agentId: agent.agentId,
        xpGained: breakdown.total,
        breakdown: JSON.stringify({
          participation: breakdown.participation,
          kills: breakdown.kills,
          placement: breakdown.placement,
        }),
      });
    }

    // Atomic transaction: create XPTransactions + upsert AgentXP totals
    try {
      await this.prisma.$transaction(async (tx) => {
        for (const award of awards) {
          // Ensure AgentXP row exists
          await tx.agentXP.upsert({
            where: { agentId: award.agentId },
            create: { agentId: award.agentId, totalXP: 0, level: 1 },
            update: {},
          });

          // Create XPTransaction (idempotent via unique constraint)
          await tx.xPTransaction.create({
            data: {
              arenaId,
              agentId: award.agentId,
              xpGained: award.xpGained,
              breakdown: award.breakdown,
            },
          });

          // Update AgentXP totals
          const agentXP = await tx.agentXP.update({
            where: { agentId: award.agentId },
            data: {
              totalXP: { increment: award.xpGained },
            },
          });

          // Recalculate level
          const newLevel = calculateLevel(agentXP.totalXP);
          if (newLevel !== agentXP.level) {
            await tx.agentXP.update({
              where: { agentId: award.agentId },
              data: { level: newLevel },
            });
          }
        }
      });

      this.logger.log(
        `Awarded XP for arena ${arenaId}: ${awards.length} agents, total ${awards.reduce((s, a) => s + a.xpGained, 0)} XP`,
      );
    } catch (error: any) {
      // P2002 = unique constraint violation → already awarded (idempotent)
      if (error?.code === 'P2002') {
        this.logger.log(`XP already awarded for arena ${arenaId} (idempotent skip)`);
        return;
      }
      throw error;
    }
  }

  async getAgentXP(agentId: string) {
    const agentXP = await this.prisma.agentXP.findUnique({
      where: { agentId },
      include: {
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!agentXP) {
      const progress = calculateLevelProgress(0);
      return {
        agentId,
        totalXP: 0,
        ...progress,
        recentMatches: [],
      };
    }

    const progress = calculateLevelProgress(agentXP.totalXP);

    return {
      agentId,
      totalXP: agentXP.totalXP,
      ...progress,
      recentMatches: agentXP.transactions.map((t) => ({
        arenaId: t.arenaId,
        xpGained: t.xpGained,
        breakdown: JSON.parse(t.breakdown),
        createdAt: t.createdAt,
      })),
    };
  }

  private async recoverMissingXP() {
    // Find arenas with simulationData that have no XPTransactions
    const arenasWithSim = await this.prisma.arenaRecord.findMany({
      where: {
        simulationData: { not: null },
        state: 'finished',
      },
      select: { arenaId: true, simulationData: true },
    });

    if (arenasWithSim.length === 0) return;

    // Find which arenas already have XP transactions
    const existingTxArenas = await this.prisma.xPTransaction.findMany({
      select: { arenaId: true },
      distinct: ['arenaId'],
    });
    const existingSet = new Set(existingTxArenas.map((t) => t.arenaId));

    const missing = arenasWithSim.filter((a) => !existingSet.has(a.arenaId));

    if (missing.length === 0) {
      this.logger.log('XP recovery: no missing arenas found');
      return;
    }

    this.logger.log(`XP recovery: found ${missing.length} arenas without XP awards`);

    for (const arena of missing) {
      try {
        const simData: SimulationData = JSON.parse(arena.simulationData!);
        await this.awardXPForArena(arena.arenaId, simData);
      } catch (error) {
        this.logger.error(
          `XP recovery failed for arena ${arena.arenaId}: ${(error as Error).message}`,
        );
      }
    }
  }
}
