// ============================================
// CHAMPIONSHIP ORCHESTRATOR - Match execution loop
// ============================================

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../arena-ledger/prisma.service';
import { MatchService, SimulationResult } from '../game/match.service';
import { GameGateway } from '../game/game.gateway';
import { SwissPairingService, PairingPlayer } from './swiss-pairing.service';
import { ChampionshipService } from './championship.service';
import { ContractWriterService } from '../blockchain/contract-writer.service';
import { createHash } from 'crypto';
import { StrategyTemplate, DEFAULT_STRATEGY_TEMPLATE } from '../game/types';

@Injectable()
export class ChampionshipOrchestratorService implements OnModuleInit {
  private readonly logger = new Logger(ChampionshipOrchestratorService.name);
  private running = false;
  private paused = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly matchService: MatchService,
    private readonly gateway: GameGateway,
    private readonly swissPairing: SwissPairingService,
    private readonly championshipService: ChampionshipService,
    private readonly contractWriter: ContractWriterService,
  ) {}

  async onModuleInit() {
    // Recovery: check for ACTIVE championship with unfinished rounds
    const active = await this.prisma.championship.findFirst({
      where: { status: 'ACTIVE' },
    });
    if (active) {
      this.logger.warn(`Found ACTIVE championship ${active.id} — resuming...`);
      this.startChampionship(active.id).catch(err => {
        this.logger.error(`Failed to resume championship: ${err.message}`);
      });
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  isPaused(): boolean {
    return this.paused;
  }

  pause() {
    this.paused = true;
    this.logger.log('Championship paused');
  }

  resume() {
    this.paused = false;
    this.logger.log('Championship resumed');
  }

  async startChampionship(championshipId: string): Promise<void> {
    if (this.running) {
      throw new Error('A championship is already running');
    }

    const championship = await this.prisma.championship.findUnique({
      where: { id: championshipId },
      include: { participants: true },
    });

    if (!championship) throw new Error('Championship not found');
    if (championship.participants.length < 4) {
      throw new Error('Need at least 4 participants');
    }

    // Mark as ACTIVE
    await this.prisma.championship.update({
      where: { id: championshipId },
      data: { status: 'ACTIVE', startedAt: new Date() },
    });

    this.running = true;
    this.paused = false;

    // Broadcast start
    this.broadcastUpdate(championshipId, 'championship_started', {
      championshipId,
      totalRounds: championship.totalRounds,
      playerCount: championship.participants.length,
    });

    try {
      await this.runAllRounds(championshipId, championship.totalRounds, championship.masterSeed!);
    } catch (error) {
      this.logger.error(`Championship ${championshipId} error: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async runAllRounds(championshipId: string, totalRounds: number, masterSeed: string): Promise<void> {
    // Find where to resume from
    const existingRounds = await this.prisma.championshipRound.findMany({
      where: { championshipId },
      orderBy: { roundNumber: 'asc' },
    });

    const lastFinishedRound = existingRounds
      .filter(r => r.status === 'FINISHED')
      .reduce((max, r) => Math.max(max, r.roundNumber), 0);

    const startRound = lastFinishedRound + 1;

    for (let round = startRound; round <= totalRounds; round++) {
      // Wait while paused
      while (this.paused) {
        await this.sleep(1000);
      }

      await this.runRound(championshipId, round, masterSeed);

      // Update currentRound
      await this.prisma.championship.update({
        where: { id: championshipId },
        data: { currentRound: round },
      });

      // Delay between rounds (unless last round)
      if (round < totalRounds) {
        const championship = await this.prisma.championship.findUnique({
          where: { id: championshipId },
        });
        const delay = championship?.roundDelayMs ?? 15000;
        this.logger.log(`Round ${round} complete. Waiting ${delay}ms before next round...`);
        await this.sleep(delay);
      }
    }

    // Championship finished
    await this.prisma.championship.update({
      where: { id: championshipId },
      data: { status: 'FINISHED', finishedAt: new Date() },
    });

    const standings = await this.championshipService.getStandings(championshipId);
    this.broadcastUpdate(championshipId, 'championship_finished', {
      championshipId,
      standings: standings.map((s, i) => ({
        rank: i + 1,
        wallet: s.wallet,
        displayName: s.displayName,
        shipNumber: s.shipNumber,
        totalPoints: s.totalPoints,
        totalKills: s.totalKills,
        totalFirsts: s.totalFirsts,
      })),
    });

    this.logger.log(`Championship ${championshipId} FINISHED! Winner: ${standings[0]?.displayName}`);

    // Mint soulbound trophies for top 3
    await this.mintTrophies(championshipId, standings);
  }

  private async mintTrophies(championshipId: string, standings: any[]): Promise<void> {
    const gameServerUrl = process.env.GAME_SERVER_URL || 'https://game.rushgame.vip';
    const trophyAddress = process.env.CHAMPIONSHIP_TROPHY_ADDRESS;

    if (!trophyAddress || trophyAddress === '0x0000000000000000000000000000000000000000') {
      this.logger.warn('CHAMPIONSHIP_TROPHY_ADDRESS not set — skipping trophy minting');
      return;
    }

    const top3 = standings.slice(0, 3);
    const trophyResults: Array<{ rank: number; wallet: string; tokenId: number; txHash: string }> = [];

    for (let i = 0; i < top3.length; i++) {
      const rank = i + 1;
      const participant = top3[i];
      const uri = `${gameServerUrl}/championship/trophy/${championshipId}/${rank}`;

      try {
        const { hash, tokenId } = await this.contractWriter.mintTrophy(participant.wallet, uri);

        // Save to DB
        await this.prisma.championshipParticipant.update({
          where: { id: participant.id },
          data: { trophyTokenId: tokenId, trophyTxHash: hash },
        });

        trophyResults.push({ rank, wallet: participant.wallet, tokenId, txHash: hash });
        this.logger.log(`Minted soulbound trophy #${tokenId} to ${participant.wallet} (rank ${rank})`);
      } catch (error) {
        this.logger.error(`Failed to mint trophy for rank ${rank} (${participant.wallet}): ${(error as Error).message}`);
      }
    }

    if (trophyResults.length > 0) {
      this.broadcastUpdate(championshipId, 'trophies_minted', {
        championshipId,
        trophies: trophyResults,
      });
    }
  }

  private async runRound(championshipId: string, roundNumber: number, masterSeed: string): Promise<void> {
    this.logger.log(`Starting round ${roundNumber} for championship ${championshipId}`);

    // Get current standings
    const participants = await this.prisma.championshipParticipant.findMany({
      where: { championshipId },
      orderBy: [{ totalPoints: 'desc' }, { totalKills: 'desc' }],
    });

    // Build opponent history
    const opponentHistory = await this.buildOpponentHistory(championshipId);

    // Generate Swiss pairings
    const players: PairingPlayer[] = participants.map(p => ({
      participantId: p.id,
      virtualAgentId: p.virtualAgentId,
      totalPoints: p.totalPoints,
      totalKills: p.totalKills,
    }));

    const groups = this.swissPairing.generatePairings(players, opponentHistory);
    this.logger.log(`Round ${roundNumber}: ${groups.length} matches generated`);

    // Create or find round
    let round = await this.prisma.championshipRound.findUnique({
      where: { championshipId_roundNumber: { championshipId, roundNumber } },
    });

    if (!round) {
      round = await this.prisma.championshipRound.create({
        data: {
          championshipId,
          roundNumber,
          status: 'ACTIVE',
          startedAt: new Date(),
        },
      });
    } else if (round.status === 'PENDING') {
      round = await this.prisma.championshipRound.update({
        where: { id: round.id },
        data: { status: 'ACTIVE', startedAt: new Date() },
      });
    }

    // Create match rows
    for (let i = 0; i < groups.length; i++) {
      const seed = this.deriveSeed(masterSeed, roundNumber, i);
      const existing = await this.prisma.championshipMatch.findUnique({
        where: { roundId_matchIndex: { roundId: round.id, matchIndex: i } },
      });
      if (!existing) {
        await this.prisma.championshipMatch.create({
          data: {
            roundId: round.id,
            matchIndex: i,
            seed,
            participantIds: JSON.stringify(groups[i].virtualAgentIds),
            status: 'PENDING',
          },
        });
      }
    }

    // Broadcast round start
    this.broadcastUpdate(championshipId, 'round_started', {
      championshipId,
      roundNumber,
      matchCount: groups.length,
    });

    // Run matches sequentially
    const matches = await this.prisma.championshipMatch.findMany({
      where: { roundId: round.id },
      orderBy: { matchIndex: 'asc' },
    });

    for (const match of matches) {
      if (match.status === 'FINISHED') continue; // Skip already finished (recovery)

      while (this.paused) {
        await this.sleep(1000);
      }

      await this.runMatch(championshipId, round.id, match, participants);

      // Delay between matches
      const championship = await this.prisma.championship.findUnique({
        where: { id: championshipId },
      });
      const delay = championship?.matchDelayMs ?? 5000;
      if (match.matchIndex < matches.length - 1) {
        await this.sleep(delay);
      }
    }

    // Finalize round
    await this.prisma.championshipRound.update({
      where: { id: round.id },
      data: { status: 'FINISHED', finishedAt: new Date() },
    });

    const standings = await this.championshipService.getStandings(championshipId);
    this.broadcastUpdate(championshipId, 'round_finished', {
      championshipId,
      roundNumber,
      standings: standings.map((s, i) => ({
        rank: i + 1,
        wallet: s.wallet,
        displayName: s.displayName,
        shipNumber: s.shipNumber,
        totalPoints: s.totalPoints,
        totalKills: s.totalKills,
        totalFirsts: s.totalFirsts,
        matchesPlayed: s.matchesPlayed,
      })),
    });

    this.logger.log(`Round ${roundNumber} finished`);
  }

  private async runMatch(
    championshipId: string,
    roundId: string,
    match: any,
    allParticipants: any[],
  ): Promise<void> {
    const virtualAgentIds: number[] = JSON.parse(match.participantIds);
    const matchParticipants = virtualAgentIds.map(vid =>
      allParticipants.find(p => p.virtualAgentId === vid)!,
    );

    this.logger.log(`Running match ${match.matchIndex}: agents [${virtualAgentIds.join(', ')}]`);

    // Update match status
    await this.prisma.championshipMatch.update({
      where: { id: match.id },
      data: { status: 'RUNNING', startedAt: new Date() },
    });

    // Build participants for MatchService
    const arenaId = BigInt(match.matchIndex + 90000 + Date.now() % 10000);
    const seed = BigInt('0x' + match.seed);

    const participants = matchParticipants.map(p => ({
      agentId: BigInt(p.virtualAgentId),
      owner: p.wallet,
      boostIds: [] as bigint[],
    }));

    // Build inline templates
    const inlineTemplates = new Map<string, StrategyTemplate>();
    const names = new Map<string, string>();
    for (const p of matchParticipants) {
      const key = p.virtualAgentId.toString();
      names.set(key, p.displayName || `Player ${p.virtualAgentId - 10000}`);
      if (p.strategy) {
        try {
          inlineTemplates.set(key, JSON.parse(p.strategy));
        } catch {}
      }
    }

    // Create and run match via MatchService
    const engineMatchId = this.matchService.createMatch(arenaId, seed, participants, {
      inlineTemplates: inlineTemplates.size > 0 ? inlineTemplates : undefined,
      names,
    });

    // Update with engineMatchId
    await this.prisma.championshipMatch.update({
      where: { id: match.id },
      data: { engineMatchId },
    });

    // Wire tick broadcast
    this.matchService.onTick(engineMatchId, (update) => {
      this.gateway.broadcastTick(engineMatchId, update);
    });

    // Broadcast match started
    this.broadcastUpdate(championshipId, 'championship_match_started', {
      championshipId,
      roundId,
      matchId: match.id,
      matchIndex: match.matchIndex,
      engineMatchId,
      participants: matchParticipants.map(p => ({
        participantId: p.id,
        virtualAgentId: p.virtualAgentId,
        displayName: p.displayName,
        shipNumber: p.shipNumber,
        wallet: p.wallet,
      })),
    });

    // Run the simulation
    let result: SimulationResult;
    try {
      result = await this.matchService.runRealTimeSimulation(engineMatchId);
    } catch (error) {
      this.logger.error(`Match ${match.id} error: ${(error as Error).message}`);
      await this.prisma.championshipMatch.update({
        where: { id: match.id },
        data: { status: 'ERROR', finishedAt: new Date() },
      });
      return;
    }

    // Process results
    await this.processMatchResults(match.id, matchParticipants, result);

    // Update match status
    await this.prisma.championshipMatch.update({
      where: { id: match.id },
      data: {
        status: 'FINISHED',
        finishedAt: new Date(),
        totalTicks: result.totalTicks,
      },
    });

    // Broadcast match finished with updated standings
    const standings = await this.championshipService.getStandings(championshipId);
    const matchResults = await this.prisma.championshipMatchResult.findMany({
      where: { matchId: match.id },
      include: { participant: true },
      orderBy: { placement: 'asc' },
    });

    this.broadcastUpdate(championshipId, 'match_finished', {
      championshipId,
      matchId: match.id,
      matchIndex: match.matchIndex,
      engineMatchId,
      results: matchResults.map(r => ({
        participantId: r.participantId,
        displayName: r.participant.displayName,
        shipNumber: r.participant.shipNumber,
        placement: r.placement,
        kills: r.kills,
        pointsEarned: r.pointsEarned,
      })),
      standings: standings.slice(0, 10).map((s, i) => ({
        rank: i + 1,
        displayName: s.displayName,
        shipNumber: s.shipNumber,
        totalPoints: s.totalPoints,
        totalKills: s.totalKills,
      })),
    });

    // Also broadcast match_end for spectators
    this.gateway.broadcastMatchEnd(engineMatchId, {
      arenaId: arenaId.toString(),
      winnerId: result.winnerAgentId,
      winnerOwner: result.winnerOwner,
      totalTicks: result.totalTicks,
      agents: result.finalState.agents,
    });

    this.logger.log(`Match ${match.matchIndex} finished: winner=${result.winnerAgentId}, ticks=${result.totalTicks}`);
  }

  private async processMatchResults(
    matchId: string,
    matchParticipants: any[],
    result: SimulationResult,
  ): Promise<void> {
    // Build placement from elimination order + winner
    // Winner = 1st, last eliminated = 2nd, etc.
    const agents = result.finalState.agents;
    const sorted = [...agents].sort((a, b) => {
      // Alive agents first (winner), then by eliminatedAt DESC
      if (a.eliminatedAt === undefined && b.eliminatedAt !== undefined) return -1;
      if (b.eliminatedAt === undefined && a.eliminatedAt !== undefined) return 1;
      if (a.eliminatedAt !== undefined && b.eliminatedAt !== undefined) {
        return b.eliminatedAt - a.eliminatedAt; // Later elimination = better placement
      }
      return 0;
    });

    for (let i = 0; i < sorted.length; i++) {
      const agent = sorted[i];
      const placement = i + 1;
      const participant = matchParticipants.find(
        p => p.virtualAgentId.toString() === agent.agentId,
      );
      if (!participant) continue;

      const kills = agent.kills || 0;
      const pointsEarned = ChampionshipService.calculatePoints(placement, kills);

      // Create match result
      await this.prisma.championshipMatchResult.create({
        data: {
          matchId,
          participantId: participant.id,
          placement,
          kills,
          pointsEarned,
          eliminatedAt: agent.eliminatedAt,
          eliminatedBy: result.eliminationOrder.find(
            e => e.agentId.toString() === agent.agentId,
          )?.eliminatedBy,
        },
      });

      // Update cumulative stats
      const matchScore = pointsEarned;
      await this.prisma.championshipParticipant.update({
        where: { id: participant.id },
        data: {
          totalPoints: { increment: pointsEarned },
          totalKills: { increment: kills },
          totalFirsts: { increment: placement === 1 ? 1 : 0 },
          matchesPlayed: { increment: 1 },
          bestMatchScore: participant.bestMatchScore < matchScore
            ? matchScore
            : undefined,
        },
      });
    }
  }

  private async buildOpponentHistory(championshipId: string): Promise<Map<string, Set<string>>> {
    const history = new Map<string, Set<string>>();

    const results = await this.prisma.championshipMatchResult.findMany({
      where: {
        match: {
          round: { championshipId },
        },
      },
      select: { matchId: true, participantId: true },
    });

    // Group by matchId
    const matchGroups = new Map<string, string[]>();
    for (const r of results) {
      if (!matchGroups.has(r.matchId)) matchGroups.set(r.matchId, []);
      matchGroups.get(r.matchId)!.push(r.participantId);
    }

    // Cross-reference: all players in same match have faced each other
    for (const [, pids] of matchGroups) {
      for (const pid of pids) {
        if (!history.has(pid)) history.set(pid, new Set());
        for (const other of pids) {
          if (other !== pid) history.get(pid)!.add(other);
        }
      }
    }

    return history;
  }

  private deriveSeed(masterSeed: string, round: number, matchIndex: number): string {
    return createHash('sha256')
      .update(`${masterSeed}:r${round}:m${matchIndex}`)
      .digest('hex')
      .slice(0, 16);
  }

  private broadcastUpdate(championshipId: string, type: string, data: any) {
    this.gateway.broadcastChampionshipUpdate(championshipId, type, data);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
