import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';

export interface BetResolvedEvent {
  userId: string;
  wallet: string;
  marketAddress: string;
  rangeIndex: number;
  rangeLabel: string;
  amount: string;
  txHash: string;
  won: boolean;
  claimAmount: string | null;
  pnl: string;
  actualCount: number;
  threshold: number;
  marketDesc: string;
}

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  @OnEvent('bet.resolved')
  async handleBetResolved(event: BetResolvedEvent) {
    const amount = new Decimal(event.amount);
    const pnl = new Decimal(event.pnl);
    const claimAmount = event.claimAmount ? new Decimal(event.claimAmount) : null;

    const existingBet = await this.prisma.bet.findUnique({
      where: {
        marketAddress_userId_txHash: {
          marketAddress: event.marketAddress.toLowerCase(),
          userId: event.userId,
          txHash: event.txHash,
        },
      },
    });

    if (existingBet) return;

    await this.prisma.$transaction(async (tx) => {
      await tx.bet.create({
        data: {
          userId: event.userId,
          marketAddress: event.marketAddress.toLowerCase(),
          marketDesc: event.marketDesc,
          rangeIndex: event.rangeIndex,
          rangeLabel: event.rangeLabel,
          amount, txHash: event.txHash,
          outcome: event.won ? 'WON' : 'LOST',
          claimAmount, pnl,
          actualCount: event.actualCount,
          threshold: event.threshold,
          resolvedAt: new Date(),
        },
      });

      const currentStats = await tx.userStats.findUnique({ where: { userId: event.userId } });
      if (!currentStats) return;

      const newStreak = event.won ? currentStats.currentStreak + 1 : 0;
      const newBestStreak = Math.max(currentStats.bestStreak, newStreak);
      const newBiggestWin = event.won && pnl.gt(currentStats.biggestWin) ? pnl : currentStats.biggestWin;

      await tx.userStats.update({
        where: { userId: event.userId },
        data: {
          totalBets: { increment: 1 },
          totalWins: event.won ? { increment: 1 } : undefined,
          totalLosses: event.won ? undefined : { increment: 1 },
          totalVolume: { increment: amount },
          totalPnl: { increment: pnl },
          currentStreak: newStreak,
          bestStreak: newBestStreak,
          biggestWin: newBiggestWin,
        },
      });
    });
  }

  async getStats(userId: string) {
    const stats = await this.prisma.userStats.findUnique({ where: { userId } });
    if (!stats) return null;

    const winRate = stats.totalWins + stats.totalLosses > 0
      ? stats.totalWins / (stats.totalWins + stats.totalLosses) : 0;

    return {
      totalBets: stats.totalBets, totalWins: stats.totalWins, totalLosses: stats.totalLosses, winRate,
      totalVolume: stats.totalVolume.toString(), totalPnl: stats.totalPnl.toString(),
      biggestWin: stats.biggestWin.toString(), currentStreak: stats.currentStreak,
      bestStreak: stats.bestStreak, marketsParticipated: stats.marketsParticipated,
      xp: stats.xp, level: stats.level,
    };
  }

  async getBetHistory(userId: string, page: number = 1, pageSize: number = 20, status?: string) {
    const where: any = { userId };
    if (status && status !== 'all') where.outcome = status.toUpperCase();

    const [items, total] = await Promise.all([
      this.prisma.bet.findMany({
        where, orderBy: { placedAt: 'desc' },
        skip: (page - 1) * pageSize, take: pageSize,
      }),
      this.prisma.bet.count({ where }),
    ]);

    return {
      items: items.map((bet) => ({
        id: bet.id, marketAddress: bet.marketAddress, marketDesc: bet.marketDesc,
        rangeIndex: bet.rangeIndex, rangeLabel: bet.rangeLabel,
        amount: bet.amount.toString(), txHash: bet.txHash, outcome: bet.outcome,
        claimAmount: bet.claimAmount?.toString() || null, pnl: bet.pnl?.toString() || null,
        actualCount: bet.actualCount, threshold: bet.threshold,
        placedAt: bet.placedAt, resolvedAt: bet.resolvedAt,
      })),
      total, page, pageSize, hasMore: page * pageSize < total,
    };
  }
}
