import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SiweMessage } from 'siwe';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from '../common/decorators/current-user.decorator';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async generateNonce(wallet: string): Promise<string> {
    const nonce = randomBytes(16).toString('hex');
    const walletLower = wallet.toLowerCase();

    // Clean up expired nonces for this wallet
    await this.prisma.siweNonce.deleteMany({
      where: {
        wallet: walletLower,
        expiresAt: { lt: new Date() },
      },
    });

    await this.prisma.siweNonce.create({
      data: {
        nonce,
        wallet: walletLower,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
      },
    });

    return nonce;
  }

  async verify(
    message: string,
    signature: string,
  ): Promise<{ jwt: string; user: { id: string; wallet: string; isNew: boolean } }> {
    const siweMessage = new SiweMessage(message);

    let fields: SiweMessage;
    try {
      const result = await siweMessage.verify({ signature });
      fields = result.data;
    } catch {
      throw new UnauthorizedException('Invalid signature');
    }

    const walletLower = fields.address.toLowerCase();

    // Validate nonce
    const nonceRecord = await this.prisma.siweNonce.findFirst({
      where: {
        nonce: fields.nonce,
        wallet: walletLower,
        used: false,
        expiresAt: { gt: new Date() },
      },
    });

    if (!nonceRecord) {
      throw new UnauthorizedException('Invalid or expired nonce');
    }

    // Mark nonce as used
    await this.prisma.siweNonce.update({
      where: { nonce: nonceRecord.nonce },
      data: { used: true },
    });

    // Find or create user
    let isNew = false;
    let user = await this.prisma.user.findUnique({
      where: { wallet: walletLower },
    });

    if (!user) {
      isNew = true;
      user = await this.prisma.user.create({
        data: {
          wallet: walletLower,
          profile: { create: {} },
          stats: { create: {} },
          settings: { create: {} },
        },
      });
    }

    // Update last seen
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastSeenAt: new Date() },
    });

    // Issue JWT
    const payload: JwtPayload = { sub: user.id, wallet: walletLower };
    const jwt = this.jwtService.sign(payload);

    return {
      jwt,
      user: { id: user.id, wallet: walletLower, isNew },
    };
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        stats: true,
        labels: true,
        settings: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return user;
  }
}
