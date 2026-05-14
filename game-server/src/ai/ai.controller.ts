// ============================================
// AI CONTROLLER - Rush Royale Strategy Endpoints
// ============================================
//
// Endpoints for AI agents AND human players to:
// - Submit strategy templates before battles
// - Get battle replay analysis
// - Get opponent analysis
// - Get strategy presets

import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Logger,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { verifyMessage } from 'viem';
import { AiService } from './ai.service';

interface SubmitStrategyDto {
  arenaId: string;
  agentId: string;
  owner: string;     // wallet address
  template: {
    aggressiveness: number;
    riskTolerance: number;
    positioningBias: string;
    targetPriority: string;
    ultimatePolicy: string;
  };
  signature: string;
  nonce: string;
}

@Controller('ai')
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(private readonly aiService: AiService) {}

  /**
   * Verify wallet signature for strategy mutations.
   * Message format: "Rush Royale AI: {nonce}"
   */
  private async verifyWalletSignature(
    address: string,
    signature: string,
    nonce: string,
  ): Promise<void> {
    if (!signature || !nonce) {
      throw new UnauthorizedException('Signature and nonce are required');
    }

    const valid = await this.aiService.consumeNonce(address, nonce);
    if (!valid) {
      throw new UnauthorizedException('Invalid or expired nonce');
    }

    const message = `Rush Royale AI: ${nonce}`;
    try {
      const isValid = await verifyMessage({
        address: address as `0x${string}`,
        message,
        signature: signature as `0x${string}`,
      });

      if (!isValid) {
        throw new UnauthorizedException('Invalid signature');
      }
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Signature verification failed');
    }
  }

  // ============================================
  // NONCE (for signature auth)
  // ============================================

  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @Get('nonce/:address')
  async getNonce(@Param('address') address: string) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new BadRequestException('Invalid wallet address');
    }

    const nonce = await this.aiService.generateNonce(address);
    return { nonce };
  }

  // ============================================
  // RECOMMENDED ARENAS (for bots)
  // ============================================

  /**
   * Get open arenas ranked by suitability for bots.
   * Sorted by fill rate (most filled first), then by time remaining.
   */
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @Get('arenas/recommended')
  async getRecommendedArenas(
    @Query('tier') tier?: string,
    @Query('maxFee') maxFee?: string,
  ) {
    return this.aiService.getRecommendedArenas(tier, maxFee);
  }

  // ============================================
  // STRATEGY TEMPLATE
  // ============================================

  /**
   * Submit strategy template for an agent in an arena.
   * Requires wallet signature proving ownership.
   * Template is immutable once submitted (cannot be changed).
   */
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @Post('strategy')
  async submitStrategy(@Body() dto: SubmitStrategyDto) {
    // Validate address
    if (!dto.owner || !/^0x[a-fA-F0-9]{40}$/.test(dto.owner)) {
      throw new BadRequestException('Invalid wallet address');
    }

    if (!dto.arenaId) {
      throw new BadRequestException('arenaId is required');
    }

    if (!dto.agentId) {
      throw new BadRequestException('agentId is required');
    }

    // Verify wallet signature
    await this.verifyWalletSignature(dto.owner, dto.signature, dto.nonce);

    // Validate template structure
    const validatedTemplate = this.aiService.validateTemplate(dto.template);

    // Submit (will throw if already exists)
    const stored = await this.aiService.submitTemplate(
      dto.arenaId,
      dto.agentId,
      dto.owner,
      validatedTemplate,
    );

    this.logger.log(`Strategy submitted: arena=${dto.arenaId} agent=${dto.agentId} by ${dto.owner}`);

    return {
      success: true,
      arenaId: stored.arenaId,
      agentId: stored.agentId,
      template: stored.template,
      submittedAt: stored.submittedAt,
    };
  }

  /**
   * Get submitted strategy template for an agent in an arena.
   */
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  @Get('strategy/:arenaId/:agentId')
  getStrategy(
    @Param('arenaId') arenaId: string,
    @Param('agentId') agentId: string,
  ) {
    const stored = this.aiService.getTemplate(arenaId, agentId);

    if (!stored) {
      return {
        arenaId,
        agentId,
        template: null,
        message: 'No strategy template submitted. Default will be used.',
      };
    }

    return {
      arenaId: stored.arenaId,
      agentId: stored.agentId,
      template: stored.template,
      submittedAt: stored.submittedAt,
    };
  }

  /**
   * Get all submitted templates for an arena.
   */
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  @Get('strategy/:arenaId')
  getArenaStrategies(@Param('arenaId') arenaId: string) {
    const templates = this.aiService.getTemplatesForArena(arenaId);

    return {
      arenaId,
      count: templates.length,
      templates: templates.map(t => ({
        agentId: t.agentId,
        owner: t.owner,
        template: t.template,
        submittedAt: t.submittedAt,
      })),
    };
  }

  // ============================================
  // PRESETS (for frontend dropdown / bot reference)
  // ============================================

  @Get('presets')
  getPresets() {
    return this.aiService.getPresets();
  }

  // ============================================
  // REPLAY ANALYSIS
  // ============================================

  /**
   * Get structured battle replay data optimized for AI analysis.
   * Includes: elimination order, damage sources, zone deaths, kill timings.
   */
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @Get('replay/:arenaId')
  async getReplay(@Param('arenaId') arenaId: string) {
    const replay = await this.aiService.getReplayAnalysis(arenaId);

    if (!replay) {
      throw new NotFoundException(`Arena ${arenaId} not found`);
    }

    return replay;
  }

  // ============================================
  // OPPONENT ANALYSIS
  // ============================================

  /**
   * Get stats for all participants in an arena.
   * Includes: winRate, battles, recentPerformance, estimatedThreatLevel.
   */
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @Get('opponents/:arenaId')
  async getOpponents(@Param('arenaId') arenaId: string) {
    const analysis = await this.aiService.getOpponentAnalysis(arenaId);

    if (!analysis) {
      throw new NotFoundException(`Arena ${arenaId} not found`);
    }

    return analysis;
  }
}
