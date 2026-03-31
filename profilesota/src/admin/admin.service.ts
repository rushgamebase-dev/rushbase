import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BadgesService } from '../badges/badges.service';

const ADMIN_WALLETS = (process.env.ADMIN_WALLETS || '')
  .split(',')
  .map((w) => w.trim().toLowerCase())
  .filter(Boolean);

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly badgesService: BadgesService,
  ) {}

  assertAdmin(wallet: string) {
    if (ADMIN_WALLETS.length === 0) {
      throw new ForbiddenException('No admin wallets configured');
    }
    if (!ADMIN_WALLETS.includes(wallet.toLowerCase())) {
      throw new ForbiddenException('Not an admin');
    }
  }

  async grantLabel(
    userId: string,
    label: string,
    grantedBy: string,
    color?: string,
    icon?: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const existing = await this.prisma.userLabel.findUnique({
      where: { userId_label: { userId, label } },
    });
    if (existing) return { alreadyGranted: true };

    const created = await this.prisma.userLabel.create({
      data: { userId, label, color, icon, grantedBy },
    });

    return { granted: true, id: created.id, label };
  }

  async removeLabel(labelId: string) {
    const label = await this.prisma.userLabel.findUnique({
      where: { id: labelId },
    });
    if (!label) throw new NotFoundException('Label not found');

    await this.prisma.userLabel.delete({ where: { id: labelId } });
    return { removed: true };
  }

  async grantBadge(userId: string, badgeSlug: string, grantedBy: string) {
    return this.badgesService.grantBadge(userId, badgeSlug, grantedBy);
  }
}
