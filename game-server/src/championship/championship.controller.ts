// ============================================
// CHAMPIONSHIP CONTROLLER - REST endpoints
// ============================================

import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Logger,
  BadRequestException,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminGuard } from '../common/guards/admin.guard';
import { ChampionshipService } from './championship.service';
import { ChampionshipOrchestratorService } from './championship-orchestrator.service';
import { TwitterVerificationService } from './twitter-verification.service';
import { GameGateway } from '../game/game.gateway';

@Controller('championship')
export class ChampionshipController {
  private readonly logger = new Logger(ChampionshipController.name);

  constructor(
    private readonly service: ChampionshipService,
    private readonly orchestrator: ChampionshipOrchestratorService,
    private readonly twitterVerification: TwitterVerificationService,
    private readonly gateway: GameGateway,
  ) {}

  // ============================================
  // PUBLIC ENDPOINTS
  // ============================================

  @Get()
  async getActiveChampionship() {
    const championship = await this.service.getActiveChampionship();
    if (!championship) {
      return { active: false };
    }

    return {
      active: true,
      id: championship.id,
      name: championship.name,
      status: championship.status,
      maxPlayers: championship.maxPlayers,
      currentRound: championship.currentRound,
      totalRounds: championship.totalRounds,
      prizeInfo: championship.prizeInfo,
      playerCount: championship.participants.length,
      createdAt: championship.createdAt,
      startedAt: championship.startedAt,
      finishedAt: championship.finishedAt,
      participants: championship.participants.map((p, i) => ({
        rank: i + 1,
        wallet: p.wallet,
        displayName: p.displayName,
        virtualAgentId: p.virtualAgentId,
        shipNumber: p.shipNumber,
        totalPoints: p.totalPoints,
        totalKills: p.totalKills,
        totalFirsts: p.totalFirsts,
        bestMatchScore: p.bestMatchScore,
        matchesPlayed: p.matchesPlayed,
        hasStrategy: !!p.strategy,
        trophyTokenId: p.trophyTokenId,
        trophyTxHash: p.trophyTxHash,
      })),
      rounds: championship.rounds.map(r => ({
        roundNumber: r.roundNumber,
        status: r.status,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        matchCount: r.matches.length,
        matches: r.matches.map(m => ({
          matchIndex: m.matchIndex,
          status: m.status,
          engineMatchId: m.engineMatchId,
          participantIds: JSON.parse(m.participantIds),
          totalTicks: m.totalTicks,
          results: m.results.map(res => ({
            participantId: res.participantId,
            placement: res.placement,
            kills: res.kills,
            pointsEarned: res.pointsEarned,
          })),
        })),
      })),
    };
  }

  @Get(':id/standings')
  async getStandings(@Param('id') id: string) {
    const standings = await this.service.getStandings(id);
    if (!standings.length) throw new NotFoundException('Championship not found');

    return {
      championshipId: id,
      standings: standings.map((s, i) => ({
        rank: i + 1,
        wallet: s.wallet,
        displayName: s.displayName,
        virtualAgentId: s.virtualAgentId,
        shipNumber: s.shipNumber,
        totalPoints: s.totalPoints,
        totalKills: s.totalKills,
        totalFirsts: s.totalFirsts,
        bestMatchScore: s.bestMatchScore,
        matchesPlayed: s.matchesPlayed,
      })),
    };
  }

  @Get(':id/round/:num')
  async getRoundDetails(
    @Param('id') id: string,
    @Param('num') num: string,
  ) {
    const roundNumber = parseInt(num, 10);
    if (isNaN(roundNumber)) throw new BadRequestException('Invalid round number');

    const round = await this.service.getRoundDetails(id, roundNumber);
    if (!round) throw new NotFoundException('Round not found');

    return round;
  }

  @Get('me')
  async getMyRegistration(
    @Query('wallet') wallet: string,
  ) {
    if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      throw new BadRequestException('Invalid wallet address');
    }

    const championship = await this.service.getActiveChampionship();
    if (!championship) return { registered: false };

    const registration = await this.service.getMyRegistration(championship.id, wallet);
    if (!registration) return { registered: false, championshipId: championship.id };

    return {
      registered: true,
      championshipId: championship.id,
      participantId: registration.id,
      wallet: registration.wallet,
      displayName: registration.displayName,
      virtualAgentId: registration.virtualAgentId,
      shipNumber: registration.shipNumber,
      totalPoints: registration.totalPoints,
      totalKills: registration.totalKills,
      totalFirsts: registration.totalFirsts,
      bestMatchScore: registration.bestMatchScore,
      matchesPlayed: registration.matchesPlayed,
      hasStrategy: !!registration.strategy,
    };
  }

  // ============================================
  // TROPHY METADATA (consumed by NFT marketplaces)
  // ============================================

  @Get('trophy/:championshipId/:rank')
  async getTrophyMetadata(
    @Param('championshipId') championshipId: string,
    @Param('rank') rank: string,
  ) {
    const rankNum = parseInt(rank, 10);
    if (isNaN(rankNum) || rankNum < 1 || rankNum > 3) {
      throw new BadRequestException('Rank must be 1, 2, or 3');
    }

    const metadata = await this.service.getTrophyMetadata(championshipId, rankNum);
    if (!metadata) throw new NotFoundException('Trophy metadata not found');

    return metadata;
  }

  // ============================================
  // TWITTER VERIFICATION
  // ============================================

  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @Get('twitter/code/:address')
  async getTwitterCode(@Param('address') address: string) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new BadRequestException('Invalid wallet address');
    }

    const code = this.twitterVerification.generateCode(address);
    const tweetUrl = this.twitterVerification.buildTweetUrl(code);
    const status = await this.twitterVerification.isVerified(address);

    return { code, tweetUrl, verified: status.verified, twitterEnabled: this.twitterVerification.isEnabled };
  }

  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post('twitter/verify')
  async verifyTwitter(@Body() body: { wallet: string }) {
    if (!body.wallet || !/^0x[a-fA-F0-9]{40}$/.test(body.wallet)) {
      throw new BadRequestException('Invalid wallet address');
    }

    const result = await this.twitterVerification.verifyTweet(body.wallet);
    return result;
  }

  // ============================================
  // NONCE
  // ============================================

  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @Get('nonce/:address')
  async getNonce(@Param('address') address: string) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new BadRequestException('Invalid wallet address');
    }
    const nonce = await this.service.generateNonce(address);
    return { nonce };
  }

  // ============================================
  // REGISTRATION
  // ============================================

  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('register')
  async register(
    @Body() body: {
      wallet: string;
      signature: string;
      nonce: string;
      displayName?: string;
    },
  ) {
    if (!body.wallet || !/^0x[a-fA-F0-9]{40}$/.test(body.wallet)) {
      throw new BadRequestException('Invalid wallet address');
    }

    // Twitter verification gate
    const twitterStatus = await this.twitterVerification.isVerified(body.wallet);
    if (!twitterStatus.verified) {
      throw new BadRequestException('Twitter verification required');
    }

    // Verify signature
    await this.service.verifyWalletSignature(body.wallet, body.signature, body.nonce);

    // Get active championship
    const championship = await this.service.getActiveChampionship();
    if (!championship) throw new NotFoundException('No active championship');

    const participant = await this.service.register(
      championship.id,
      body.wallet,
      body.displayName,
    );

    // Broadcast registration
    this.gateway.broadcastChampionshipUpdate(championship.id, 'player_registered', {
      championshipId: championship.id,
      wallet: participant.wallet,
      displayName: participant.displayName,
      shipNumber: participant.shipNumber,
      virtualAgentId: participant.virtualAgentId,
      playerCount: championship.participants.length + 1,
      maxPlayers: championship.maxPlayers,
    });

    this.logger.log(`Player registered: ${body.wallet} as ${participant.displayName}`);

    return {
      success: true,
      participantId: participant.id,
      virtualAgentId: participant.virtualAgentId,
      shipNumber: participant.shipNumber,
      displayName: participant.displayName,
    };
  }

  // ============================================
  // STRATEGY
  // ============================================

  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @Post('strategy')
  async updateStrategy(
    @Body() body: {
      wallet: string;
      signature: string;
      nonce: string;
      template: any;
    },
  ) {
    if (!body.wallet || !/^0x[a-fA-F0-9]{40}$/.test(body.wallet)) {
      throw new BadRequestException('Invalid wallet address');
    }

    await this.service.verifyWalletSignature(body.wallet, body.signature, body.nonce);

    const championship = await this.service.getActiveChampionship();
    if (!championship) throw new NotFoundException('No active championship');

    const updated = await this.service.updateStrategy(
      championship.id,
      body.wallet,
      body.template,
    );

    return {
      success: true,
      participantId: updated.id,
      strategy: JSON.parse(updated.strategy!),
    };
  }

  // ============================================
  // ADMIN ENDPOINTS
  // ============================================

  @Post('admin/create')
  @UseGuards(AdminGuard)
  async createChampionship(
    @Body() body: {
      name: string;
      prizeInfo?: string;
      totalRounds?: number;
      maxPlayers?: number;
    },
  ) {
    if (!body.name) throw new BadRequestException('name is required');

    const championship = await this.service.createChampionship(
      body.name,
      body.prizeInfo,
      body.totalRounds,
      body.maxPlayers,
    );

    this.logger.log(`Championship created: ${championship.id} "${championship.name}"`);
    return championship;
  }

  @Post('admin/start')
  @UseGuards(AdminGuard)
  async startChampionship(@Body() body: { id?: string }) {
    let championshipId = body.id;

    if (!championshipId) {
      const active = await this.service.getActiveChampionship();
      if (!active) throw new NotFoundException('No championship found');
      championshipId = active.id;
    }

    // Start asynchronously
    this.orchestrator.startChampionship(championshipId).catch(err => {
      this.logger.error(`Championship start failed: ${err.message}`);
    });

    return { success: true, message: 'Championship starting...' };
  }

  @Post('admin/pause')
  @UseGuards(AdminGuard)
  async pauseChampionship() {
    this.orchestrator.pause();
    return { success: true, message: 'Championship paused' };
  }

  @Post('admin/resume')
  @UseGuards(AdminGuard)
  async resumeChampionship() {
    this.orchestrator.resume();
    return { success: true, message: 'Championship resumed' };
  }

  @Post('admin/cancel')
  @UseGuards(AdminGuard)
  async cancelChampionship(@Body() body: { id?: string }) {
    let championshipId = body.id;

    if (!championshipId) {
      const active = await this.service.getActiveChampionship();
      if (!active) throw new NotFoundException('No championship found');
      championshipId = active.id;
    }

    await this.service.cancelChampionship(championshipId);

    return { success: true, message: 'Championship cancelled' };
  }
}
