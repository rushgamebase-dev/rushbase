import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { Prisma } from '@prisma/client';

// Fields included in public profile responses
const publicProfileInclude = {
  profile: true,
  stats: true,
  labels: true,
  badges: {
    where: { displayed: true },
    include: { badge: true },
    orderBy: { badge: { sortOrder: 'asc' as const } },
  },
} satisfies Prisma.UserInclude;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        stats: true,
        labels: true,
        settings: true,
        badges: {
          include: { badge: true },
          orderBy: { badge: { sortOrder: 'asc' } },
        },
      },
    });

    if (!user) throw new NotFoundException('User not found');
    return this.formatFullProfile(user);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    // Check handle uniqueness if changing
    if (dto.handle) {
      const existing = await this.prisma.userProfile.findUnique({
        where: { handle: dto.handle.toLowerCase() },
      });
      if (existing && existing.userId !== userId) {
        throw new ConflictException('Handle already taken');
      }
    }

    const profile = await this.prisma.userProfile.update({
      where: { userId },
      data: {
        ...(dto.handle !== undefined && { handle: dto.handle.toLowerCase() }),
        ...(dto.displayName !== undefined && { displayName: dto.displayName }),
        ...(dto.bio !== undefined && { bio: dto.bio }),
        ...(dto.avatarUrl !== undefined && { avatarUrl: dto.avatarUrl }),
        ...(dto.isPublic !== undefined && { isPublic: dto.isPublic }),
      },
    });

    return profile;
  }

  async getByHandle(handle: string) {
    const user = await this.prisma.user.findFirst({
      where: { profile: { handle: handle.toLowerCase() } },
      include: publicProfileInclude,
    });

    if (!user) throw new NotFoundException('User not found');
    if (!user.profile?.isPublic) throw new NotFoundException('Profile is private');
    return this.formatPublicProfile(user);
  }

  async getByAddress(address: string) {
    const user = await this.prisma.user.findUnique({
      where: { wallet: address.toLowerCase() },
      include: publicProfileInclude,
    });

    if (!user) throw new NotFoundException('User not found');
    if (!user.profile?.isPublic) throw new NotFoundException('Profile is private');
    return this.formatPublicProfile(user);
  }

  async getCard(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        stats: {
          select: {
            totalBets: true,
            totalWins: true,
            totalLosses: true,
            totalVolume: true,
            totalPnl: true,
            bestStreak: true,
            xp: true,
            level: true,
          },
        },
        labels: true,
        badges: {
          where: { displayed: true },
          include: { badge: true },
          orderBy: { badge: { sortOrder: 'asc' } },
          take: 5,
        },
      },
    });

    if (!user) throw new NotFoundException('User not found');
    return this.formatCardProfile(user);
  }

  async getBatch(addresses: string[]) {
    const normalized = addresses
      .slice(0, 50) // max 50 per batch
      .map((a) => a.toLowerCase());

    const users = await this.prisma.user.findMany({
      where: { wallet: { in: normalized } },
      include: {
        profile: true,
        stats: {
          select: {
            xp: true,
            level: true,
            totalBets: true,
          },
        },
        labels: true,
        badges: {
          where: { displayed: true },
          include: { badge: true },
          orderBy: { badge: { sortOrder: 'asc' } },
          take: 3,
        },
      },
    });

    const result: Record<string, ReturnType<typeof this.formatMiniProfile>> = {};
    for (const user of users) {
      result[user.wallet] = this.formatMiniProfile(user);
    }
    return result;
  }

  async checkHandle(handle: string): Promise<boolean> {
    const existing = await this.prisma.userProfile.findUnique({
      where: { handle: handle.toLowerCase() },
    });
    return !existing;
  }

  // ── Response formatters ────────────────────────────────────────────────

  private formatFullProfile(user: any) {
    const stats = user.stats;
    const winRate =
      stats && stats.totalWins + stats.totalLosses > 0
        ? stats.totalWins / (stats.totalWins + stats.totalLosses)
        : 0;

    return {
      id: user.id,
      wallet: user.wallet,
      createdAt: user.createdAt,
      lastSeenAt: user.lastSeenAt,
      profile: user.profile
        ? {
            handle: user.profile.handle,
            displayName: user.profile.displayName,
            bio: user.profile.bio,
            avatarUrl: user.profile.avatarUrl,
            isPublic: user.profile.isPublic,
          }
        : null,
      stats: stats
        ? {
            totalBets: stats.totalBets,
            totalWins: stats.totalWins,
            totalLosses: stats.totalLosses,
            winRate,
            totalVolume: stats.totalVolume.toString(),
            totalPnl: stats.totalPnl.toString(),
            biggestWin: stats.biggestWin.toString(),
            currentStreak: stats.currentStreak,
            bestStreak: stats.bestStreak,
            marketsParticipated: stats.marketsParticipated,
            xp: stats.xp,
            level: stats.level,
            xpToNextLevel: this.xpForLevel(stats.level + 1) - stats.xp,
          }
        : null,
      labels: (user.labels || []).map((l: any) => ({
        label: l.label,
        color: l.color,
        icon: l.icon,
      })),
      badges: (user.badges || []).map((ub: any) => ({
        slug: ub.badge.slug,
        name: ub.badge.name,
        description: ub.badge.description,
        imageUrl: ub.badge.imageUrl,
        rarity: ub.badge.rarity,
        category: ub.badge.category,
        earnedAt: ub.earnedAt,
        displayed: ub.displayed,
      })),
      settings: user.settings || null,
    };
  }

  private formatPublicProfile(user: any) {
    const full = this.formatFullProfile(user);
    // Strip internal fields
    const { settings, lastSeenAt, ...publicData } = full;
    return publicData;
  }

  private formatCardProfile(user: any) {
    const stats = user.stats;
    const winRate =
      stats && stats.totalWins + stats.totalLosses > 0
        ? stats.totalWins / (stats.totalWins + stats.totalLosses)
        : 0;

    return {
      id: user.id,
      wallet: user.wallet,
      handle: user.profile?.handle || null,
      displayName: user.profile?.displayName || null,
      avatarUrl: user.profile?.avatarUrl || null,
      level: stats?.level || 1,
      xp: stats?.xp || 0,
      xpToNextLevel: stats ? this.xpForLevel(stats.level + 1) - stats.xp : 100,
      totalBets: stats?.totalBets || 0,
      totalVolume: stats?.totalVolume?.toString() || '0',
      totalPnl: stats?.totalPnl?.toString() || '0',
      winRate,
      bestStreak: stats?.bestStreak || 0,
      labels: (user.labels || []).map((l: any) => ({
        label: l.label,
        color: l.color,
        icon: l.icon,
      })),
      badges: (user.badges || []).map((ub: any) => ({
        slug: ub.badge.slug,
        name: ub.badge.name,
        rarity: ub.badge.rarity,
        imageUrl: ub.badge.imageUrl,
      })),
      joinedAt: user.createdAt,
    };
  }

  private formatMiniProfile(user: any) {
    return {
      id: user.id,
      wallet: user.wallet,
      handle: user.profile?.handle || null,
      displayName: user.profile?.displayName || null,
      avatarUrl: user.profile?.avatarUrl || null,
      level: user.stats?.level || 1,
      labels: (user.labels || []).map((l: any) => ({
        label: l.label,
        color: l.color,
        icon: l.icon,
      })),
      badges: (user.badges || []).map((ub: any) => ({
        slug: ub.badge.slug,
        name: ub.badge.name,
        rarity: ub.badge.rarity,
      })),
    };
  }

  private xpForLevel(level: number): number {
    if (level <= 1) return 0;
    return Math.floor(100 * Math.pow(level, 1.5));
  }
}
