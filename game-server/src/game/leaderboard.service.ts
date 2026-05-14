// ============================================
// LEADERBOARD SERVICE - Agent rankings from DB
// ============================================

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../arena-ledger/prisma.service';

export type SortBy = 'wins' | 'battles' | 'winrate';

export interface LeaderboardEntry {
  rank: number;
  agentId: string;
  owner: string;
  wins: number;
  battles: number;
  winRate: number;
}

export interface LeaderboardResponse {
  leaderboard: LeaderboardEntry[];
  totalAgents: number;
  lastUpdated: number;
}

interface AgentStats {
  agentId: string;
  owner: string;
  wins: number;
  battles: number;
}

@Injectable()
export class LeaderboardService implements OnModuleInit {
  private readonly logger = new Logger(LeaderboardService.name);

  // In-memory cache
  private agentCache: Map<string, AgentStats> = new Map();
  private sortedByWins: LeaderboardEntry[] = [];
  private sortedByBattles: LeaderboardEntry[] = [];
  private sortedByWinrate: LeaderboardEntry[] = [];
  private lastUpdated: number = 0;
  private totalAgents: number = 0;
  private isRefreshing: boolean = false;

  // Refresh settings
  private readonly REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    this.logger.log('LeaderboardService initializing (DB-backed)...');
    await this.refreshAll();

    setInterval(() => {
      this.refreshAll().catch((err) => {
        this.logger.error('Periodic refresh failed', err);
      });
    }, this.REFRESH_INTERVAL_MS);
  }

  /**
   * Get leaderboard with sorting and pagination
   */
  getLeaderboard(limit: number = 100, sortBy: SortBy = 'wins'): LeaderboardResponse {
    let sorted: LeaderboardEntry[];

    switch (sortBy) {
      case 'battles':
        sorted = this.sortedByBattles;
        break;
      case 'winrate':
        sorted = this.sortedByWinrate;
        break;
      case 'wins':
      default:
        sorted = this.sortedByWins;
    }

    return {
      leaderboard: sorted.slice(0, limit),
      totalAgents: this.totalAgents,
      lastUpdated: this.lastUpdated,
    };
  }

  /**
   * Get top N agents (for WebSocket broadcast)
   */
  getTopAgents(limit: number = 10): LeaderboardEntry[] {
    return this.sortedByWins.slice(0, limit);
  }

  /**
   * Refresh a specific agent (called when arena finishes)
   */
  async refreshAgent(agentId: bigint): Promise<void> {
    await this.refreshAll();
  }

  /**
   * Refresh multiple agents at once (after arena with multiple participants)
   */
  async refreshAgents(agentIds: bigint[]): Promise<void> {
    await this.refreshAll();
  }

  /**
   * Full refresh from database (ledger)
   */
  async refreshAll(): Promise<void> {
    if (this.isRefreshing) {
      this.logger.warn('Refresh already in progress, skipping');
      return;
    }

    this.isRefreshing = true;

    try {
      // Count battles per agent from finished arenas
      const battleCounts = await this.prisma.participantRecord.groupBy({
        by: ['agentId'],
        _count: { agentId: true },
        where: {
          arena: { state: 'finished' },
        },
      });

      // Count wins per agent from finished arenas
      const winCounts = await this.prisma.arenaRecord.groupBy({
        by: ['winnerId'],
        _count: { winnerId: true },
        where: {
          state: 'finished',
          winnerId: { not: null },
        },
      });

      // Get owner for each agent (most recent participation)
      const agentOwners = await this.prisma.participantRecord.findMany({
        where: {
          arena: { state: 'finished' },
        },
        select: {
          agentId: true,
          owner: true,
        },
        distinct: ['agentId'],
        orderBy: {
          arena: { finishedAt: 'desc' },
        },
      });

      // Build maps
      const winsMap = new Map<string, number>();
      for (const w of winCounts) {
        if (w.winnerId) {
          winsMap.set(w.winnerId, w._count.winnerId);
        }
      }

      const ownerMap = new Map<string, string>();
      for (const ao of agentOwners) {
        ownerMap.set(ao.agentId, ao.owner);
      }

      // Build cache
      const newCache = new Map<string, AgentStats>();

      for (const bc of battleCounts) {
        const agentId = bc.agentId;
        const battles = bc._count.agentId;
        const wins = winsMap.get(agentId) || 0;
        const owner = ownerMap.get(agentId) || '0x0';

        newCache.set(agentId, {
          agentId,
          owner,
          wins,
          battles,
        });
      }

      this.agentCache = newCache;
      this.totalAgents = newCache.size;
      this.rebuildSortedLists();
      this.lastUpdated = Date.now();

      this.logger.log(`Leaderboard refreshed from DB: ${this.agentCache.size} agents`);
    } catch (error) {
      this.logger.error('Failed to refresh leaderboard from DB', error);
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * Rebuild sorted lists from cache
   */
  private rebuildSortedLists(): void {
    const entries: LeaderboardEntry[] = [];

    for (const [_, agent] of this.agentCache) {
      const winRate = agent.battles > 0
        ? Math.round((agent.wins / agent.battles) * 10000) / 100
        : 0;

      entries.push({
        rank: 0,
        agentId: agent.agentId,
        owner: agent.owner,
        wins: agent.wins,
        battles: agent.battles,
        winRate,
      });
    }

    // Sort by wins (secondary: winRate)
    this.sortedByWins = [...entries]
      .sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        return b.winRate - a.winRate;
      })
      .map((entry, index) => ({ ...entry, rank: index + 1 }));

    // Sort by battles (secondary: wins)
    this.sortedByBattles = [...entries]
      .sort((a, b) => {
        if (b.battles !== a.battles) return b.battles - a.battles;
        return b.wins - a.wins;
      })
      .map((entry, index) => ({ ...entry, rank: index + 1 }));

    // Sort by winRate (minimum 3 battles to qualify, secondary: battles)
    this.sortedByWinrate = [...entries]
      .filter((e) => e.battles >= 3)
      .sort((a, b) => {
        if (b.winRate !== a.winRate) return b.winRate - a.winRate;
        return b.battles - a.battles;
      })
      .map((entry, index) => ({ ...entry, rank: index + 1 }));
  }

  /**
   * Get stats for health check
   */
  getStats(): {
    cachedAgents: number;
    totalAgents: number;
    lastUpdated: number;
    isRefreshing: boolean;
  } {
    return {
      cachedAgents: this.agentCache.size,
      totalAgents: this.totalAgents,
      lastUpdated: this.lastUpdated,
      isRefreshing: this.isRefreshing,
    };
  }
}
