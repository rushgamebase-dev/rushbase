import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

type LeaderboardCategory = 'volume' | 'pnl' | 'wins' | 'streak';

const CATEGORY_FIELD: Record<LeaderboardCategory, string> = {
  volume: 'totalVolume',
  pnl: 'totalPnl',
  wins: 'totalWins',
  streak: 'bestStreak',
};

@Injectable()
export class LeaderboardService {
  private readonly logger = new Logger(LeaderboardService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async refreshLeaderboards() {
    for (const category of Object.keys(CATEGORY_FIELD) as LeaderboardCategory[]) {
      await this.refreshCategory(category);
    }
    this.logger.log('Leaderboard snapshots refreshed');
  }

  private async refreshCategory(category: LeaderboardCategory) {
    const field = CATEGORY_FIELD[category];
    const orderBy: any = { [field]: 'desc' };

    const topStats = await this.prisma.userStats.findMany({
      where: { totalBets: { gt: 0 } },
      orderBy,
      take: 100,
      include: {
        user: {
          include: {
            profile: { select: { handle: true, displayName: true, avatarUrl: true } },
            labels: { select: { label: true, color: true, icon: true } },
          },
        },
      },
    });

    const entries = topStats.map((s, i) => ({
      rank: i + 1,
      userId: s.userId,
      wallet: s.user.wallet,
      handle: s.user.profile?.handle || null,
      displayName: s.user.profile?.displayName || null,
      avatarUrl: s.user.profile?.avatarUrl || null,
      level: s.level,
      value: (s as any)[field]?.toString() || '0',
      labels: s.user.labels,
    }));

    await this.prisma.leaderboardSnapshot.create({
      data: {
        category,
        entries: entries as any,
      },
    });

    // Keep only last 24 snapshots per category (2 hours of history)
    const old = await this.prisma.leaderboardSnapshot.findMany({
      where: { category },
      orderBy: { createdAt: 'desc' },
      skip: 24,
      select: { id: true },
    });

    if (old.length > 0) {
      await this.prisma.leaderboardSnapshot.deleteMany({
        where: { id: { in: old.map((o) => o.id) } },
      });
    }
  }

  async getLeaderboard(category: string, page: number = 1, pageSize: number = 25) {
    const validCategory = CATEGORY_FIELD[category as LeaderboardCategory]
      ? category
      : 'volume';

    const snapshot = await this.prisma.leaderboardSnapshot.findFirst({
      where: { category: validCategory },
      orderBy: { createdAt: 'desc' },
    });

    if (!snapshot) {
      return { items: [], total: 0, page, pageSize, hasMore: false, category: validCategory };
    }

    const allEntries = snapshot.entries as any[];
    const start = (page - 1) * pageSize;
    const items = allEntries.slice(start, start + pageSize);

    return {
      items,
      total: allEntries.length,
      page,
      pageSize,
      hasMore: start + pageSize < allEntries.length,
      category: validCategory,
      updatedAt: snapshot.createdAt,
    };
  }
}
