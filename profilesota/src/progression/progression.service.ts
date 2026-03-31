import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { BetResolvedEvent } from '../stats/stats.service';

@Injectable()
export class ProgressionService {
  private readonly logger = new Logger(ProgressionService.name);

  constructor(private readonly prisma: PrismaService, private readonly events: EventEmitter2) {}

  @OnEvent('bet.resolved', { async: true })
  async handleBetXp(event: BetResolvedEvent) {
    await new Promise((r) => setTimeout(r, 50));
    let xpGain = 10;
    if (event.won) {
      xpGain += 25;
      const stats = await this.prisma.userStats.findUnique({
        where: { userId: event.userId }, select: { currentStreak: true },
      });
      if (stats && stats.currentStreak >= 3) xpGain += 10;
    }

    const updated = await this.prisma.userStats.update({
      where: { userId: event.userId }, data: { xp: { increment: xpGain } },
    });

    const newLevel = this.calculateLevel(updated.xp);
    if (newLevel > updated.level) {
      await this.prisma.userStats.update({ where: { userId: event.userId }, data: { level: newLevel } });
      this.logger.log(`Level up! User ${event.userId}: ${updated.level} → ${newLevel}`);
      this.events.emit('user.level_up', {
        userId: event.userId, oldLevel: updated.level, newLevel, totalXp: updated.xp,
      });
    }
  }

  calculateLevel(xp: number): number {
    let level = 1;
    while (level < 100) {
      if (xp < this.xpForLevel(level + 1)) break;
      level++;
    }
    return level;
  }

  xpForLevel(level: number): number {
    if (level <= 1) return 0;
    return Math.floor(100 * Math.pow(level, 1.5));
  }

  getLevelsConfig() {
    const config = [];
    for (let level = 1; level <= 100; level++) {
      config.push({ level, xpRequired: this.xpForLevel(level), xpToNext: this.xpForLevel(level + 1) - this.xpForLevel(level) });
    }
    return config;
  }
}
