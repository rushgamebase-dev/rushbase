// ============================================
// AI SERVICE - Strategy template storage & validation
// ============================================

import { Injectable, Logger, OnModuleInit, BadRequestException } from '@nestjs/common';
import Redis from 'ioredis';
import { randomBytes } from 'crypto';
import { StrategyTemplate, DEFAULT_STRATEGY_TEMPLATE } from '../game/types';
import { PrismaClient } from '@prisma/client';

const REDIS_TEMPLATES_KEY = 'rushroyale:strategy_templates';
const NONCE_PREFIX = 'rushroyale:ai_nonce:';
const NONCE_TTL = 300; // 5 minutes

// Template keyed by "arenaId:agentId"
interface StoredTemplate {
  arenaId: string;
  agentId: string;
  owner: string;
  template: StrategyTemplate;
  submittedAt: number;
}

@Injectable()
export class AiService implements OnModuleInit {
  private readonly logger = new Logger(AiService.name);
  private redis: Redis | null = null;
  private prisma: PrismaClient;

  // In-memory storage (keyed by "arenaId:agentId")
  private templates: Map<string, StoredTemplate> = new Map();

  async onModuleInit() {
    await this.connectRedis();
    await this.loadTemplates();
    this.prisma = new PrismaClient();
    this.logger.log(`AiService initialized with ${this.templates.size} templates`);
  }

  private async connectRedis(): Promise<void> {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      this.logger.warn('REDIS_URL not set - strategy templates will not persist across restarts');
      return;
    }

    try {
      this.redis = new Redis(redisUrl);
      this.redis.on('error', (err) => {
        this.logger.error('Redis connection error:', err);
      });
      this.logger.log('AI service connected to Redis');
    } catch (error) {
      this.logger.error('Failed to connect to Redis:', error);
    }
  }

  private async loadTemplates(): Promise<void> {
    try {
      if (this.redis) {
        const data = await this.redis.get(REDIS_TEMPLATES_KEY);
        if (data) {
          const parsed: Record<string, StoredTemplate> = JSON.parse(data);
          this.templates = new Map(Object.entries(parsed));
          this.logger.log(`Loaded ${this.templates.size} strategy templates from Redis`);
        }
      }
    } catch (error) {
      this.logger.error('Failed to load templates from Redis:', error);
    }
  }

  private async saveTemplates(): Promise<void> {
    try {
      if (this.redis) {
        const obj = Object.fromEntries(this.templates);
        await this.redis.set(REDIS_TEMPLATES_KEY, JSON.stringify(obj));
      }
    } catch (error) {
      this.logger.error('Failed to save templates to Redis:', error);
    }
  }

  // ============================================
  // NONCE MANAGEMENT (separate from profile nonces)
  // ============================================

  async generateNonce(address: string): Promise<string> {
    const nonce = randomBytes(16).toString('hex');
    const key = `${NONCE_PREFIX}${address.toLowerCase()}`;

    if (this.redis) {
      await this.redis.set(key, nonce, 'EX', NONCE_TTL);
    } else {
      // In-memory fallback
      (this as any)._nonces = (this as any)._nonces || {};
      (this as any)._nonces[key] = { nonce, expires: Date.now() + NONCE_TTL * 1000 };
    }

    return nonce;
  }

  async consumeNonce(address: string, nonce: string): Promise<boolean> {
    const key = `${NONCE_PREFIX}${address.toLowerCase()}`;

    if (this.redis) {
      const stored = await this.redis.get(key);
      if (!stored || stored !== nonce) return false;
      await this.redis.del(key);
      return true;
    } else {
      const store = (this as any)._nonces || {};
      const entry = store[key];
      if (!entry || entry.nonce !== nonce || entry.expires < Date.now()) return false;
      delete store[key];
      return true;
    }
  }

  // ============================================
  // STRATEGY TEMPLATE CRUD
  // ============================================

  validateTemplate(template: any): StrategyTemplate {
    if (!template || typeof template !== 'object') {
      throw new BadRequestException('Template is required and must be an object');
    }

    const { aggressiveness, riskTolerance, positioningBias, targetPriority, ultimatePolicy } = template;

    // Validate aggressiveness
    if (typeof aggressiveness !== 'number' || aggressiveness < 0 || aggressiveness > 1) {
      throw new BadRequestException('aggressiveness must be a number between 0.0 and 1.0');
    }

    // Validate riskTolerance
    if (typeof riskTolerance !== 'number' || riskTolerance < 0 || riskTolerance > 1) {
      throw new BadRequestException('riskTolerance must be a number between 0.0 and 1.0');
    }

    // Validate positioningBias
    const validPositions = ['center', 'edge', 'roamer'];
    if (!validPositions.includes(positioningBias)) {
      throw new BadRequestException(`positioningBias must be one of: ${validPositions.join(', ')}`);
    }

    // Validate targetPriority
    const validTargets = ['weakest', 'closest', 'threat'];
    if (!validTargets.includes(targetPriority)) {
      throw new BadRequestException(`targetPriority must be one of: ${validTargets.join(', ')}`);
    }

    // Validate ultimatePolicy
    const validPolicies = ['early', 'opportunistic', 'late'];
    if (!validPolicies.includes(ultimatePolicy)) {
      throw new BadRequestException(`ultimatePolicy must be one of: ${validPolicies.join(', ')}`);
    }

    // evasionSkill + shotAccuracy: optional, default 0.5 (backward-compatible)
    const evasionSkill = template.evasionSkill !== undefined
      ? Number(template.evasionSkill) : 0.5;
    const shotAccuracy = template.shotAccuracy !== undefined
      ? Number(template.shotAccuracy) : 0.5;

    if (typeof evasionSkill !== 'number' || isNaN(evasionSkill) || evasionSkill < 0 || evasionSkill > 1) {
      throw new BadRequestException('evasionSkill must be a number between 0.0 and 1.0');
    }
    if (typeof shotAccuracy !== 'number' || isNaN(shotAccuracy) || shotAccuracy < 0 || shotAccuracy > 1) {
      throw new BadRequestException('shotAccuracy must be a number between 0.0 and 1.0');
    }

    // triggerDiscipline, pursuitTenacity, strafeCadence: optional, default 0.5 (backward-compatible)
    const triggerDiscipline = template.triggerDiscipline !== undefined
      ? Number(template.triggerDiscipline) : 0.5;
    const pursuitTenacity = template.pursuitTenacity !== undefined
      ? Number(template.pursuitTenacity) : 0.5;
    const strafeCadence = template.strafeCadence !== undefined
      ? Number(template.strafeCadence) : 0.5;

    if (typeof triggerDiscipline !== 'number' || isNaN(triggerDiscipline) || triggerDiscipline < 0 || triggerDiscipline > 1) {
      throw new BadRequestException('triggerDiscipline must be a number between 0.0 and 1.0');
    }
    if (typeof pursuitTenacity !== 'number' || isNaN(pursuitTenacity) || pursuitTenacity < 0 || pursuitTenacity > 1) {
      throw new BadRequestException('pursuitTenacity must be a number between 0.0 and 1.0');
    }
    if (typeof strafeCadence !== 'number' || isNaN(strafeCadence) || strafeCadence < 0 || strafeCadence > 1) {
      throw new BadRequestException('strafeCadence must be a number between 0.0 and 1.0');
    }

    return {
      aggressiveness,
      riskTolerance,
      positioningBias,
      targetPriority,
      ultimatePolicy,
      evasionSkill,
      shotAccuracy,
      triggerDiscipline,
      pursuitTenacity,
      strafeCadence,
    };
  }

  async submitTemplate(
    arenaId: string,
    agentId: string,
    owner: string,
    template: StrategyTemplate,
  ): Promise<StoredTemplate> {
    const key = `${arenaId}:${agentId}`;

    // Check if already submitted for this arena
    if (this.templates.has(key)) {
      throw new BadRequestException(
        `Strategy already committed for agent ${agentId} in arena ${arenaId}. Cannot change after submission.`,
      );
    }

    const stored: StoredTemplate = {
      arenaId,
      agentId,
      owner: owner.toLowerCase(),
      template,
      submittedAt: Date.now(),
    };

    this.templates.set(key, stored);
    await this.saveTemplates();

    this.logger.log(
      `Strategy template submitted: arena=${arenaId} agent=${agentId} ` +
      `aggr=${template.aggressiveness} risk=${template.riskTolerance} ` +
      `pos=${template.positioningBias} target=${template.targetPriority} ult=${template.ultimatePolicy}`,
    );

    return stored;
  }

  getTemplate(arenaId: string, agentId: string): StoredTemplate | null {
    return this.templates.get(`${arenaId}:${agentId}`) ?? null;
  }

  getTemplatesForArena(arenaId: string): StoredTemplate[] {
    const results: StoredTemplate[] = [];
    for (const [key, stored] of this.templates) {
      if (key.startsWith(`${arenaId}:`)) {
        results.push(stored);
      }
    }
    return results;
  }

  // ============================================
  // REPLAY ANALYSIS (structured for AI consumption)
  // ============================================

  async getReplayAnalysis(arenaId: string): Promise<any> {
    const arena = await this.prisma.arenaRecord.findUnique({
      where: { arenaId },
      include: { participants: true },
    });

    if (!arena) return null;
    if (arena.state !== 'finished') {
      throw new BadRequestException('Arena has not finished yet');
    }

    // Parse simulation data
    let simulationData: any = null;
    if (arena.simulationData) {
      try {
        simulationData = JSON.parse(arena.simulationData);
      } catch {
        // ignore parse errors
      }
    }

    return {
      arenaId: arena.arenaId,
      tier: arena.tier,
      seed: arena.seed,
      winnerId: arena.winnerId,
      winnerOwner: arena.winnerOwner,
      totalParticipants: arena.totalParticipants,
      gameConfigVersion: arena.gameConfigVersion,
      participants: arena.participants.map(p => ({
        agentId: p.agentId,
        owner: p.owner,
        eliminated: p.eliminated,
        eliminationRound: p.eliminationRound,
      })),
      simulation: simulationData ? {
        kills: simulationData.kills || {},
        eliminationOrder: simulationData.eliminationOrder || [],
        totalTicks: simulationData.totalTicks,
      } : null,
      finishedAt: arena.finishedAt?.toISOString() ?? null,
    };
  }

  // ============================================
  // OPPONENT ANALYSIS
  // ============================================

  async getOpponentAnalysis(arenaId: string): Promise<any> {
    const arena = await this.prisma.arenaRecord.findUnique({
      where: { arenaId },
      include: { participants: true },
    });

    if (!arena) return null;

    // For each participant, get their historical stats
    const opponents = await Promise.all(
      arena.participants.map(async (p) => {
        // Count wins and battles from ArenaRecord
        const [wins, battles] = await Promise.all([
          this.prisma.arenaRecord.count({
            where: { winnerId: p.agentId, state: 'finished' },
          }),
          this.prisma.participantRecord.count({
            where: {
              agentId: p.agentId,
              arena: { state: 'finished' },
            },
          }),
        ]);

        // Get recent results (last 5)
        const recentArenas = await this.prisma.participantRecord.findMany({
          where: {
            agentId: p.agentId,
            arena: { state: 'finished' },
          },
          include: {
            arena: {
              select: {
                arenaId: true,
                winnerId: true,
                tier: true,
                finishedAt: true,
              },
            },
          },
          orderBy: { arena: { finishedAt: 'desc' } },
          take: 5,
        });

        const recentResults = recentArenas.map(r => ({
          arenaId: r.arena.arenaId,
          won: r.arena.winnerId === p.agentId,
          tier: r.arena.tier,
        }));

        const winRate = battles > 0 ? Math.round((wins / battles) * 100) : 0;

        // Estimate threat level
        let threatLevel: string;
        if (winRate > 70 && battles > 20) threatLevel = 'EXTREME';
        else if (winRate > 50 && battles > 10) threatLevel = 'HIGH';
        else if (winRate > 30) threatLevel = 'MEDIUM';
        else if (battles < 5) threatLevel = 'UNKNOWN';
        else threatLevel = 'LOW';

        return {
          agentId: p.agentId,
          owner: p.owner,
          stats: { wins, battles, winRate },
          recentResults,
          threatLevel,
        };
      }),
    );

    return {
      arenaId: arena.arenaId,
      tier: arena.tier,
      state: arena.state,
      entryFee: arena.entryFee,
      maxPlayers: arena.maxPlayers,
      totalParticipants: arena.totalParticipants,
      opponents,
    };
  }

  // ============================================
  // RECOMMENDED ARENAS (for bots)
  // ============================================

  async getRecommendedArenas(tier?: string, maxFee?: string): Promise<any[]> {
    const where: any = { state: 'open' };
    if (tier) {
      where.tier = tier.toUpperCase();
    }

    const arenas = await this.prisma.arenaRecord.findMany({
      where,
      include: { participants: { select: { agentId: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const ranked = arenas
      .map(a => {
        const currentPlayers = a.participants.length;
        const maxPlayers = a.maxPlayers ?? 10;
        const fillRate = maxPlayers > 0 ? currentPlayers / maxPlayers : 0;
        const spotsLeft = maxPlayers - currentPlayers;

        return {
          arenaId: a.arenaId,
          tier: a.tier,
          entryFee: a.entryFee || '0',
          currentPlayers,
          maxPlayers,
          spotsLeft,
          fillRate: Math.round(fillRate * 100),
          prizePool: a.prizePool || '0',
          createdAt: a.createdAt.toISOString(),
        };
      })
      .filter(a => {
        if (a.spotsLeft <= 0) return false;
        if (maxFee) {
          try {
            const maxFeeWei = BigInt(Math.round(parseFloat(maxFee) * 1e18));
            if (BigInt(a.entryFee) > maxFeeWei) return false;
          } catch { /* ignore bad parse */ }
        }
        return true;
      })
      // Sort: highest fill rate first (almost full = about to start), then newest
      .sort((a, b) => b.fillRate - a.fillRate || b.createdAt.localeCompare(a.createdAt));

    return ranked;
  }

  // ============================================
  // PRESETS (convenience for frontend)
  // ============================================

  getPresets(): Record<string, { template: StrategyTemplate; description: string }> {
    return {
      glass_cannon: {
        template: {
          aggressiveness: 0.9,
          riskTolerance: 0.8,
          positioningBias: 'center',
          targetPriority: 'weakest',
          ultimatePolicy: 'early',
          evasionSkill: 0.3,
          shotAccuracy: 0.8,
          triggerDiscipline: 0.3,
          pursuitTenacity: 0.8,
          strafeCadence: 0.3,
        },
        description: 'High risk, high reward. Finishes fast or dies fast.',
      },
      predator: {
        template: {
          aggressiveness: 0.6,
          riskTolerance: 0.5,
          positioningBias: 'roamer',
          targetPriority: 'weakest',
          ultimatePolicy: 'opportunistic',
          evasionSkill: 0.5,
          shotAccuracy: 0.7,
          triggerDiscipline: 0.6,
          pursuitTenacity: 0.7,
          strafeCadence: 0.5,
        },
        description: 'Hunts wounded targets. Patient but lethal.',
      },
      edge_survivor: {
        template: {
          aggressiveness: 0.2,
          riskTolerance: 0.3,
          positioningBias: 'edge',
          targetPriority: 'closest',
          ultimatePolicy: 'late',
          evasionSkill: 0.8,
          shotAccuracy: 0.4,
          triggerDiscipline: 0.7,
          pursuitTenacity: 0.2,
          strafeCadence: 0.6,
        },
        description: 'Outlasts everyone. Lets the zone do the work.',
      },
      controller: {
        template: {
          aggressiveness: 0.5,
          riskTolerance: 0.4,
          positioningBias: 'center',
          targetPriority: 'threat',
          ultimatePolicy: 'opportunistic',
          evasionSkill: 0.6,
          shotAccuracy: 0.6,
          triggerDiscipline: 0.5,
          pursuitTenacity: 0.5,
          strafeCadence: 0.5,
        },
        description: 'Removes the biggest threats. Enables favorable endgame.',
      },
      balanced: {
        template: { ...DEFAULT_STRATEGY_TEMPLATE },
        description: 'Safe default. Adaptable to any situation.',
      },
    };
  }
}
