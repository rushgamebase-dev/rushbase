import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { BetResolvedEvent } from '../stats/stats.service';

// Maps badge trigger field names to UserStats column names
const TRIGGER_TO_STAT: Record<string, string> = {
  totalBets: 'totalBets',
  totalWins: 'totalWins',
  totalLosses: 'totalLosses',
  totalVolume: 'totalVolume',
  totalPnl: 'totalPnl',
  bestStreak: 'bestStreak',
  currentStreak: 'currentStreak',
  marketsParticipated: 'marketsParticipated',
};

@Injectable()
export class BadgeEngineService {
  private readonly logger = new Logger(BadgeEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  @OnEvent('bet.resolved', { async: true })
  async evaluateBadges(event: BetResolvedEvent) {
    // Wait a tick so stats are updated first
    await new Promise((r) => setTimeout(r, 100));

    const stats = await this.prisma.userStats.findUnique({
      where: { userId: event.userId },
    });

    if (!stats) return;

    // Determine which triggers changed based on the event
    const changedTriggers = ['totalBets'];
    if (event.won) {
      changedTriggers.push('totalWins', 'bestStreak', 'currentStreak');
    } else {
      changedTriggers.push('totalLosses');
    }
    changedTriggers.push('totalVolume', 'totalPnl');

    // Find badges that match changed triggers and aren't yet earned
    const earnedBadgeIds = await this.prisma.userBadge.findMany({
      where: { userId: event.userId },
      select: { badgeId: true },
    });
    const earnedSet = new Set(earnedBadgeIds.map((ub) => ub.badgeId));

    const candidates = await this.prisma.badge.findMany({
      where: {
        trigger: { in: changedTriggers },
        isActive: true,
      },
    });

    for (const badge of candidates) {
      if (earnedSet.has(badge.id)) continue;

      const statField = TRIGGER_TO_STAT[badge.trigger];
      if (!statField) continue;

      const currentValue = Number((stats as any)[statField] ?? 0);
      const threshold = Number(badge.threshold);

      if (currentValue >= threshold) {
        // Unlock badge
        await this.prisma.userBadge.create({
          data: {
            userId: event.userId,
            badgeId: badge.id,
          },
        });

        // Grant XP from badge
        if (badge.xpReward > 0) {
          await this.prisma.userStats.update({
            where: { userId: event.userId },
            data: { xp: { increment: badge.xpReward } },
          });
        }

        this.logger.log(
          `Badge unlocked: ${badge.slug} for user ${event.userId}`,
        );

        this.events.emit('badge.unlocked', {
          userId: event.userId,
          badgeSlug: badge.slug,
          badgeName: badge.name,
          xpReward: badge.xpReward,
        });
      }
    }
  }
}
