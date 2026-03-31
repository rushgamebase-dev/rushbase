import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BadgesService {
  constructor(private readonly prisma: PrismaService) {}

  async getAllBadges() {
    const badges = await this.prisma.badge.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
    return badges.map((b) => ({
      id: b.id, slug: b.slug, name: b.name, description: b.description,
      imageUrl: b.imageUrl, category: b.category, rarity: b.rarity, sortOrder: b.sortOrder,
    }));
  }

  async getUserBadges(userId: string) {
    const [allBadges, userBadges] = await Promise.all([
      this.prisma.badge.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.userBadge.findMany({ where: { userId }, include: { badge: true } }),
    ]);
    const earnedMap = new Map(userBadges.map((ub) => [ub.badgeId, ub]));
    return allBadges.map((badge) => {
      const earned = earnedMap.get(badge.id);
      return {
        id: badge.id, slug: badge.slug, name: badge.name, description: badge.description,
        imageUrl: badge.imageUrl, category: badge.category, rarity: badge.rarity,
        earnedAt: earned?.earnedAt || null, displayed: earned?.displayed ?? false, isEarned: !!earned,
      };
    });
  }

  async toggleBadgeDisplay(userId: string, badgeId: string) {
    const ub = await this.prisma.userBadge.findUnique({ where: { userId_badgeId: { userId, badgeId } } });
    if (!ub) throw new NotFoundException('Badge not earned');
    const updated = await this.prisma.userBadge.update({
      where: { userId_badgeId: { userId, badgeId } }, data: { displayed: !ub.displayed },
    });
    return { displayed: updated.displayed };
  }

  async grantBadge(userId: string, badgeSlug: string, grantedBy?: string) {
    const badge = await this.prisma.badge.findUnique({ where: { slug: badgeSlug } });
    if (!badge) throw new NotFoundException('Badge not found');
    const existing = await this.prisma.userBadge.findUnique({
      where: { userId_badgeId: { userId, badgeId: badge.id } },
    });
    if (existing) return { alreadyEarned: true };
    await this.prisma.userBadge.create({ data: { userId, badgeId: badge.id } });
    if (badge.xpReward > 0) {
      await this.prisma.userStats.update({ where: { userId }, data: { xp: { increment: badge.xpReward } } });
    }
    return { granted: true, badge: badge.slug };
  }
}
