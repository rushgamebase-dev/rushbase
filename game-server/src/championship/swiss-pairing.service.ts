// ============================================
// SWISS PAIRING SERVICE - Tournament pairing algorithm
// ============================================

import { Injectable, Logger } from '@nestjs/common';

export interface PairingPlayer {
  participantId: string;
  virtualAgentId: number;
  totalPoints: number;
  totalKills: number;
}

export interface PairingGroup {
  participantIds: string[];
  virtualAgentIds: number[];
}

@Injectable()
export class SwissPairingService {
  private readonly logger = new Logger(SwissPairingService.name);

  /**
   * Generate Swiss pairings for a round of 4-player FFA matches.
   * @param players Sorted by totalPoints DESC, totalKills DESC
   * @param opponentHistory Map of participantId -> Set of participantIds they've already faced
   * @returns Array of groups (each group = 4 players for one match)
   */
  generatePairings(
    players: PairingPlayer[],
    opponentHistory: Map<string, Set<string>>,
  ): PairingGroup[] {
    // Sort players by score (DESC), then kills (DESC)
    const sorted = [...players].sort((a, b) => {
      if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
      return b.totalKills - a.totalKills;
    });

    const groupSize = 4;
    const numGroups = Math.ceil(sorted.length / groupSize);

    // Initial grouping: divide into pods of 4 by rank
    const groups: PairingPlayer[][] = [];
    for (let i = 0; i < numGroups; i++) {
      groups.push(sorted.slice(i * groupSize, (i + 1) * groupSize));
    }

    // Handle incomplete last group (if not exactly divisible by 4)
    // Pad with players from the previous group if needed
    const lastGroup = groups[groups.length - 1];
    if (lastGroup.length < groupSize && groups.length > 1) {
      // Move players from second-to-last group to fill
      while (lastGroup.length < groupSize && groups[groups.length - 2].length > groupSize) {
        lastGroup.unshift(groups[groups.length - 2].pop()!);
      }
    }

    // Try to resolve repeat opponents by swapping between adjacent pods
    for (let attempt = 0; attempt < 3; attempt++) {
      let swapped = false;
      for (let g = 0; g < groups.length; g++) {
        if (this.hasRepeatOpponents(groups[g], opponentHistory)) {
          // Try swapping the lowest-ranked player with next pod's highest
          if (g + 1 < groups.length) {
            const swapIdx = groups[g].length - 1;
            const targetIdx = 0;
            // Swap
            const temp = groups[g][swapIdx];
            groups[g][swapIdx] = groups[g + 1][targetIdx];
            groups[g + 1][targetIdx] = temp;
            swapped = true;
          }
        }
      }
      if (!swapped) break;
    }

    // Convert to PairingGroup format
    return groups
      .filter(g => g.length === groupSize) // Only full groups
      .map(g => ({
        participantIds: g.map(p => p.participantId),
        virtualAgentIds: g.map(p => p.virtualAgentId),
      }));
  }

  private hasRepeatOpponents(
    group: PairingPlayer[],
    history: Map<string, Set<string>>,
  ): boolean {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const faced = history.get(group[i].participantId);
        if (faced?.has(group[j].participantId)) {
          return true;
        }
      }
    }
    return false;
  }
}
