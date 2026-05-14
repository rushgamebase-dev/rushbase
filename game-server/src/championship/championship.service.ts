// ============================================
// CHAMPIONSHIP SERVICE - Registration, strategy, standings
// ============================================

import { Injectable, Logger, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../arena-ledger/prisma.service';
import { keccak256, toHex, verifyMessage } from 'viem';
import { randomBytes, createHash } from 'crypto';
import Redis from 'ioredis';

const NONCE_PREFIX = 'rushroyale:championship_nonce:';
const NONCE_TTL = 300; // 5 minutes

// Points per placement in 4-player FFA
const PLACEMENT_POINTS: Record<number, number> = {
  1: 10,
  2: 6,
  3: 3,
  4: 1,
};

@Injectable()
export class ChampionshipService {
  private readonly logger = new Logger(ChampionshipService.name);
  private redis: Redis | null = null;

  constructor(private readonly prisma: PrismaService) {
    this.connectRedis();
  }

  private async connectRedis(): Promise<void> {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) return;
    try {
      this.redis = new Redis(redisUrl);
      this.redis.on('error', () => {});
    } catch {}
  }

  // ============================================
  // NONCE
  // ============================================

  async generateNonce(address: string): Promise<string> {
    const nonce = randomBytes(16).toString('hex');
    if (this.redis) {
      await this.redis.set(`${NONCE_PREFIX}${address.toLowerCase()}`, nonce, 'EX', NONCE_TTL);
    }
    return nonce;
  }

  async consumeNonce(address: string, nonce: string): Promise<boolean> {
    if (!this.redis) return true; // No Redis = skip nonce validation
    const key = `${NONCE_PREFIX}${address.toLowerCase()}`;
    const stored = await this.redis.get(key);
    if (stored !== nonce) return false;
    await this.redis.del(key);
    return true;
  }

  async verifyWalletSignature(address: string, signature: string, nonce: string): Promise<void> {
    if (!signature || !nonce) {
      throw new BadRequestException('Signature and nonce are required');
    }

    const valid = await this.consumeNonce(address, nonce);
    if (!valid) {
      throw new BadRequestException('Invalid or expired nonce');
    }

    const message = `Rush Royale Championship: ${nonce}`;
    try {
      const isValid = await verifyMessage({
        address: address as `0x${string}`,
        message,
        signature: signature as `0x${string}`,
      });
      if (!isValid) throw new BadRequestException('Invalid signature');
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Signature verification failed');
    }
  }

  // ============================================
  // CHAMPIONSHIP CRUD
  // ============================================

  async createChampionship(name: string, prizeInfo?: string, totalRounds?: number, maxPlayers?: number) {
    const masterSeed = randomBytes(32).toString('hex');
    return this.prisma.championship.create({
      data: {
        name,
        prizeInfo,
        totalRounds: totalRounds ?? 30,
        maxPlayers: maxPlayers ?? 32,
        masterSeed,
      },
    });
  }

  async getActiveChampionship() {
    // Return the most recent non-CANCELLED championship
    const championship = await this.prisma.championship.findFirst({
      where: { status: { not: 'CANCELLED' } },
      orderBy: { createdAt: 'desc' },
      include: {
        participants: {
          orderBy: [
            { totalPoints: 'desc' },
            { totalKills: 'desc' },
            { totalFirsts: 'desc' },
            { bestMatchScore: 'desc' },
          ],
        },
        rounds: {
          orderBy: { roundNumber: 'asc' },
          include: {
            matches: {
              orderBy: { matchIndex: 'asc' },
              include: { results: true },
            },
          },
        },
      },
    });
    return championship;
  }

  async getChampionshipById(id: string) {
    return this.prisma.championship.findUnique({
      where: { id },
      include: {
        participants: {
          orderBy: [
            { totalPoints: 'desc' },
            { totalKills: 'desc' },
            { totalFirsts: 'desc' },
            { bestMatchScore: 'desc' },
          ],
        },
        rounds: {
          orderBy: { roundNumber: 'asc' },
          include: {
            matches: {
              orderBy: { matchIndex: 'asc' },
              include: { results: true },
            },
          },
        },
      },
    });
  }

  // ============================================
  // REGISTRATION
  // ============================================

  async register(championshipId: string, wallet: string, displayName?: string) {
    const championship = await this.prisma.championship.findUnique({
      where: { id: championshipId },
      include: { participants: true },
    });

    if (!championship) throw new NotFoundException('Championship not found');
    if (championship.status !== 'REGISTRATION') {
      throw new BadRequestException('Championship is not accepting registrations');
    }
    if (championship.participants.length >= championship.maxPlayers) {
      throw new BadRequestException('Championship is full');
    }

    // Check duplicate
    const existing = championship.participants.find(
      p => p.wallet.toLowerCase() === wallet.toLowerCase(),
    );
    if (existing) throw new ConflictException('Already registered');

    // Assign virtualAgentId and ship
    const virtualAgentId = 10001 + championship.participants.length;
    const walletHash = keccak256(toHex(wallet.toLowerCase()));
    const shipNumber = (parseInt(walletHash.slice(2, 10), 16) % 20) + 1;

    const participant = await this.prisma.championshipParticipant.create({
      data: {
        championshipId,
        wallet: wallet.toLowerCase(),
        displayName: displayName || `Player ${virtualAgentId - 10000}`,
        virtualAgentId,
        shipNumber,
      },
    });

    this.logger.log(`Registered ${wallet} as agent ${virtualAgentId} ship ${shipNumber} in championship ${championshipId}`);
    return participant;
  }

  // ============================================
  // STRATEGY
  // ============================================

  async updateStrategy(championshipId: string, wallet: string, strategy: any) {
    const participant = await this.prisma.championshipParticipant.findUnique({
      where: {
        championshipId_wallet: {
          championshipId,
          wallet: wallet.toLowerCase(),
        },
      },
    });

    if (!participant) throw new NotFoundException('Not registered');

    // Validate the strategy template structure
    const validated = this.validateTemplate(strategy);

    return this.prisma.championshipParticipant.update({
      where: { id: participant.id },
      data: { strategy: JSON.stringify(validated) },
    });
  }

  validateTemplate(template: any): any {
    if (!template || typeof template !== 'object') {
      throw new BadRequestException('Invalid strategy template');
    }

    const clamp = (val: any, min: number, max: number) => {
      const n = Number(val);
      if (isNaN(n)) return (min + max) / 2;
      return Math.max(min, Math.min(max, n));
    };

    const validPositioning = ['center', 'edge', 'roamer'];
    const validTarget = ['weakest', 'closest', 'threat'];
    const validUltimate = ['early', 'opportunistic', 'late'];

    return {
      aggressiveness: clamp(template.aggressiveness, 0, 1),
      riskTolerance: clamp(template.riskTolerance, 0, 1),
      positioningBias: validPositioning.includes(template.positioningBias)
        ? template.positioningBias : 'roamer',
      targetPriority: validTarget.includes(template.targetPriority)
        ? template.targetPriority : 'closest',
      ultimatePolicy: validUltimate.includes(template.ultimatePolicy)
        ? template.ultimatePolicy : 'opportunistic',
      evasionSkill: clamp(template.evasionSkill ?? 0.5, 0, 1),
      shotAccuracy: clamp(template.shotAccuracy ?? 0.5, 0, 1),
      triggerDiscipline: clamp(template.triggerDiscipline ?? 0.5, 0, 1),
      pursuitTenacity: clamp(template.pursuitTenacity ?? 0.5, 0, 1),
      strafeCadence: clamp(template.strafeCadence ?? 0.5, 0, 1),
    };
  }

  // ============================================
  // STANDINGS
  // ============================================

  async getStandings(championshipId: string) {
    return this.prisma.championshipParticipant.findMany({
      where: { championshipId },
      orderBy: [
        { totalPoints: 'desc' },
        { totalKills: 'desc' },
        { totalFirsts: 'desc' },
        { bestMatchScore: 'desc' },
      ],
    });
  }

  async getMyRegistration(championshipId: string, wallet: string) {
    return this.prisma.championshipParticipant.findUnique({
      where: {
        championshipId_wallet: {
          championshipId,
          wallet: wallet.toLowerCase(),
        },
      },
    });
  }

  async getRoundDetails(championshipId: string, roundNumber: number) {
    return this.prisma.championshipRound.findUnique({
      where: {
        championshipId_roundNumber: { championshipId, roundNumber },
      },
      include: {
        matches: {
          orderBy: { matchIndex: 'asc' },
          include: { results: { include: { participant: true } } },
        },
      },
    });
  }

  async cancelChampionship(championshipId: string) {
    return this.prisma.championship.update({
      where: { id: championshipId },
      data: { status: 'CANCELLED', finishedAt: new Date() },
    });
  }

  // ============================================
  // TROPHY METADATA
  // ============================================

  async getTrophyMetadata(championshipId: string, rank: number) {
    const championship = await this.prisma.championship.findUnique({
      where: { id: championshipId },
    });
    if (!championship) return null;

    const standings = await this.getStandings(championshipId);
    const participant = standings[rank - 1];
    if (!participant) return null;

    const rankLabel = rank === 1 ? '1st' : rank === 2 ? '2nd' : '3rd';
    const awardedTimestamp = championship.finishedAt
      ? Math.floor(championship.finishedAt.getTime() / 1000)
      : Math.floor(Date.now() / 1000);

    return {
      name: `Rush Royale Champion - ${rankLabel} Place`,
      description: `Soulbound trophy for finishing ${rankLabel} in ${championship.name}. ${participant.totalPoints} points, ${participant.totalKills} kills across ${championship.totalRounds} Swiss rounds.`,
      image: `${process.env.FRONTEND_URL || 'https://www.rushgame.vip'}/images/ships/ship-${participant.shipNumber}.png`,
      external_url: `${process.env.FRONTEND_URL || 'https://www.rushgame.vip'}/arenas/championship`,
      attributes: [
        { trait_type: 'Rank', value: rank },
        { trait_type: 'Championship', value: championship.name },
        { trait_type: 'Points', value: participant.totalPoints },
        { trait_type: 'Kills', value: participant.totalKills },
        { trait_type: '1st Places', value: participant.totalFirsts },
        { trait_type: 'Ship', value: participant.shipNumber },
        { display_type: 'date', trait_type: 'Awarded', value: awardedTimestamp },
      ],
    };
  }

  // ============================================
  // SCORING
  // ============================================

  static calculatePoints(placement: number, kills: number): number {
    return (PLACEMENT_POINTS[placement] || 0) + kills;
  }
}
