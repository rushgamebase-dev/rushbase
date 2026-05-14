// ============================================
// PROFILE CONTROLLER - REST API for profiles
// ============================================

import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Logger,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  UnauthorizedException,
  Res,
  NotFoundException,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { verifyMessage } from 'viem';
import { ProfileService } from './profile.service';
import { UpdateProfileDto } from './types';
import { BlockchainService } from '../blockchain/blockchain.service';

// Multer file type
interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Controller('profile')
export class ProfileController {
  private readonly logger = new Logger(ProfileController.name);

  constructor(
    private readonly profileService: ProfileService,
    private readonly blockchainService: BlockchainService,
  ) {}

  /**
   * Verify wallet signature for profile mutations.
   * Message format: "Rush Royale: Sign to update profile\nNonce: {nonce}"
   */
  private async verifyWalletSignature(
    address: string,
    signature: string,
    nonce: string,
  ): Promise<void> {
    if (!signature || !nonce) {
      throw new UnauthorizedException('Signature and nonce are required');
    }

    // Consume nonce (one-time use)
    const valid = await this.profileService.consumeNonce(address, nonce);
    if (!valid) {
      throw new UnauthorizedException('Invalid or expired nonce');
    }

    // Verify signature
    const message = `Rush Royale: Sign to update profile\nNonce: ${nonce}`;
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
  // DIAGNOSTICS - Check Redis status (must be before :address)
  // ============================================

  @Get('diagnostics')
  getDiagnostics() {
    return this.profileService.getDiagnostics();
  }

  // ============================================
  // NONCE ENDPOINT (must be before :address)
  // ============================================

  @Get('nonce/:address')
  async getNonce(@Param('address') address: string) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new BadRequestException('Invalid wallet address');
    }

    const nonce = await this.profileService.generateNonce(address);
    return { nonce };
  }

  // ============================================
  // GET PROFILE
  // ============================================

  @Get(':address')
  getProfile(@Param('address') address: string) {
    const profile = this.profileService.getProfile(address);

    if (!profile) {
      // Return default profile structure for unknown addresses
      return {
        address: address.toLowerCase(),
        displayName: `Pilot_${address.slice(2, 8)}`,
        bio: '',
        hasAvatar: false,
        createdAt: null,
        updatedAt: null,
        isNew: true,
      };
    }

    // Don't send base64 in JSON - use hasAvatar flag instead
    return {
      ...profile,
      hasAvatar: !!profile.avatarUrl,
      avatarUrl: undefined, // Remove base64 from response
    };
  }

  // ============================================
  // SERVE AVATAR AS IMAGE (not base64 in JSON)
  // ============================================

  @Get('avatar/:address')
  async serveAvatar(
    @Param('address') address: string,
    @Res() res: Response,
  ) {
    const avatarData = this.profileService.getAvatarData(address);

    if (!avatarData) {
      throw new NotFoundException('Avatar not found');
    }

    // avatarData is "data:image/jpeg;base64,..."
    const matches = avatarData.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) {
      throw new NotFoundException('Invalid avatar data');
    }

    const mimeType = matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');

    res.set({
      'Content-Type': mimeType,
      'Content-Length': buffer.length,
      'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
    });

    res.send(buffer);
  }

  // ============================================
  // UPDATE PROFILE
  // ============================================

  @Post('update')
  async updateProfile(@Body() dto: UpdateProfileDto) {
    if (!dto.address) {
      throw new BadRequestException('Address is required');
    }

    // Basic address validation
    if (!/^0x[a-fA-F0-9]{40}$/.test(dto.address)) {
      throw new BadRequestException('Invalid wallet address');
    }

    // Wallet signature verification
    await this.verifyWalletSignature(dto.address, dto.signature, dto.nonce);

    const profile = await this.profileService.createOrUpdateProfile(dto);

    this.logger.log(`Profile updated: ${dto.address}`);

    return {
      success: true,
      profile,
    };
  }

  // ============================================
  // UPLOAD AVATAR
  // ============================================

  @Post('avatar')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAvatar(
    @UploadedFile() file: MulterFile,
    @Body('address') address: string,
    @Body('signature') signature: string,
    @Body('nonce') nonce: string,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    if (!address) {
      throw new BadRequestException('Address is required');
    }

    // Basic address validation
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new BadRequestException('Invalid wallet address');
    }

    // Wallet signature verification
    await this.verifyWalletSignature(address, signature, nonce);

    const avatarUrl = await this.profileService.saveAvatar(
      address,
      file.buffer,
      file.mimetype,
    );

    this.logger.log(`Avatar uploaded for ${address}`);

    return {
      success: true,
      avatarUrl,
    };
  }

  // ============================================
  // PUBLIC PROFILE - Unified payload for visitors
  // ============================================

  @Get('public/:address')
  async getPublicProfile(@Param('address') address: string) {
    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new BadRequestException('Invalid wallet address');
    }

    const normalizedAddress = address.toLowerCase() as `0x${string}`;

    // Get profile data
    const profile = this.profileService.getProfile(normalizedAddress);

    // Get agents from blockchain
    let agents: Array<{
      agentId: string;
      wins: number;
      battles: number;
      winRate: number;
      isActive: boolean;
    }> = [];
    let totalWins = 0;
    let totalBattles = 0;

    try {
      const agentIds = await this.blockchainService.getAgentsByOwner(normalizedAddress);

      if (agentIds.length > 0) {
        const agentsDetails = await this.blockchainService.getAgentsDetails(agentIds);

        agents = agentsDetails
          .map((agent) => {
            const wins = Number(agent.totalWins);
            const battles = Number(agent.totalBattles);
            totalWins += wins;
            totalBattles += battles;

            return {
              agentId: agent.agentId.toString(),
              wins,
              battles,
              winRate: battles > 0 ? Math.round((wins / battles) * 100) : 0,
              isActive: agent.isActive,
            };
          })
          // Sort by wins descending, take top 5
          .sort((a, b) => b.wins - a.wins)
          .slice(0, 5);
      }
    } catch (error) {
      this.logger.warn(`Failed to fetch agents for ${normalizedAddress}:`, error);
      // Continue without agents data
    }

    const winRate = totalBattles > 0 ? Math.round((totalWins / totalBattles) * 100) : 0;

    return {
      address: normalizedAddress,
      displayName: profile?.displayName || `Pilot_${normalizedAddress.slice(2, 8)}`,
      bio: profile?.bio || '',
      hasAvatar: !!profile?.avatarUrl,
      createdAt: profile?.createdAt || null,
      stats: {
        totalWins,
        totalBattles,
        winRate,
        totalAgents: agents.length,
      },
      topAgents: agents,
    };
  }

  // ============================================
  // LIST ALL PROFILES (for leaderboard integration)
  // ============================================

  @Get()
  getAllProfiles() {
    const profiles = this.profileService.getAllProfiles();
    return {
      total: profiles.length,
      profiles,
    };
  }

}
