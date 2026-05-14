// ============================================
// RESULT HASHER SERVICE - Generate verifiable hashes
// ============================================

import { Injectable, Logger } from '@nestjs/common';
import { keccak256, encodeAbiParameters, parseAbiParameters } from 'viem';
import { EliminationRecord } from '../game/match.service';
import { ParticipantData } from '../game/types';

/**
 * Participant data for hashing (canonical format)
 */
interface ParticipantHashData {
  agentId: bigint;
  owner: string;
  boostIds: bigint[];
}

@Injectable()
export class ResultHasherService {
  private readonly logger = new Logger(ResultHasherService.name);

  /**
   * Compute a verifiable hash of the simulation result (v2 - includes participants with boosts)
   * This hash can be stored on-chain for dispute resolution and enables full replay verification.
   *
   * Canonical ordering:
   * - Participants are sorted by agentId (ascending)
   * - BoostIds within each participant are sorted (ascending)
   * - Eliminations are in chronological order
   */
  computeResultHash(
    arenaId: bigint,
    seed: bigint,
    winnerId: bigint,
    totalRounds: bigint,
    eliminationOrder: EliminationRecord[],
    participants?: ParticipantData[],
  ): `0x${string}` {
    // Encode elimination order
    const eliminationData = eliminationOrder.map((e) => ({
      agentId: e.agentId,
      eliminatedAt: BigInt(e.eliminatedAt),
    }));

    // If participants provided (v2), include them in the hash
    if (participants && participants.length > 0) {
      return this.computeResultHashV2(
        arenaId,
        seed,
        winnerId,
        totalRounds,
        eliminationData,
        participants,
      );
    }

    // Legacy v1 hash (for backwards compatibility)
    return this.computeResultHashV1(
      arenaId,
      seed,
      winnerId,
      totalRounds,
      eliminationData,
    );
  }

  /**
   * V1 hash (legacy - without participants/boosts)
   */
  private computeResultHashV1(
    arenaId: bigint,
    seed: bigint,
    winnerId: bigint,
    totalRounds: bigint,
    eliminationData: { agentId: bigint; eliminatedAt: bigint }[],
  ): `0x${string}` {
    const encoded = encodeAbiParameters(
      parseAbiParameters('uint256 arenaId, uint256 seed, uint256 winnerId, uint256 totalRounds, (uint256 agentId, uint256 eliminatedAt)[] eliminations'),
      [arenaId, seed, winnerId, totalRounds, eliminationData],
    );

    const hash = keccak256(encoded);

    this.logger.debug(
      `Computed result hash (v1): arenaId=${arenaId}, winnerId=${winnerId}, hash=${hash}`,
    );

    return hash;
  }

  /**
   * V2 hash (with participants and boosts for full auditability)
   */
  private computeResultHashV2(
    arenaId: bigint,
    seed: bigint,
    winnerId: bigint,
    totalRounds: bigint,
    eliminationData: { agentId: bigint; eliminatedAt: bigint }[],
    participants: ParticipantData[],
  ): `0x${string}` {
    // Sort participants by agentId for canonical ordering
    const sortedParticipants = [...participants].sort((a, b) =>
      Number(a.agentId - b.agentId)
    );

    // Prepare participant data with sorted boosts
    const participantData = sortedParticipants.map(p => ({
      agentId: p.agentId,
      owner: p.owner as `0x${string}`,
      // Sort boostIds for canonical ordering
      boostIds: [...p.boostIds].sort((a, b) => Number(a - b)),
    }));

    // Encode with participants
    const encoded = encodeAbiParameters(
      parseAbiParameters(
        'uint256 arenaId, uint256 seed, uint256 winnerId, uint256 totalRounds, ' +
        '(uint256 agentId, address owner, uint256[] boostIds)[] participants, ' +
        '(uint256 agentId, uint256 eliminatedAt)[] eliminations'
      ),
      [arenaId, seed, winnerId, totalRounds, participantData, eliminationData],
    );

    const hash = keccak256(encoded);

    this.logger.debug(
      `Computed result hash (v2): arenaId=${arenaId}, winnerId=${winnerId}, participants=${participants.length}, hash=${hash}`,
    );

    return hash;
  }

  /**
   * Verify a result hash matches the expected data (v2 with participants)
   */
  verifyResultHash(
    hash: `0x${string}`,
    arenaId: bigint,
    seed: bigint,
    winnerId: bigint,
    totalRounds: bigint,
    eliminationOrder: EliminationRecord[],
    participants?: ParticipantData[],
  ): boolean {
    const computedHash = this.computeResultHash(
      arenaId,
      seed,
      winnerId,
      totalRounds,
      eliminationOrder,
      participants,
    );
    return computedHash === hash;
  }

  /**
   * Compute hash for a given set of participants (for verification without elimination)
   * Useful for pre-simulation verification that participants match expected set
   */
  computeParticipantsHash(participants: ParticipantData[]): `0x${string}` {
    const sortedParticipants = [...participants].sort((a, b) =>
      Number(a.agentId - b.agentId)
    );

    const participantData = sortedParticipants.map(p => ({
      agentId: p.agentId,
      owner: p.owner as `0x${string}`,
      boostIds: [...p.boostIds].sort((a, b) => Number(a - b)),
    }));

    const encoded = encodeAbiParameters(
      parseAbiParameters('(uint256 agentId, address owner, uint256[] boostIds)[] participants'),
      [participantData],
    );

    return keccak256(encoded);
  }
}
