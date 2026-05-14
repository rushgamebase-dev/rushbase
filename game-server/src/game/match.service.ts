// ============================================
// MATCH SERVICE - Manages active matches
// Engine v2 with Strategy Template support
// ============================================

import { Injectable, Logger } from '@nestjs/common';
import { GameEngine, createDefaultConfig } from './engine-v2';
import { Agent, MatchStatus, ParticipantData, ParticipantDataV2, StrategyTemplate, TickUpdate } from './types';
import { AiService } from '../ai/ai.service';

// Simulation result for blockchain integration
export interface SimulationResult {
  winnerId: bigint;
  winnerAgentId: string;
  winnerOwner: string;
  totalTicks: number;
  eliminationOrder: EliminationRecord[];
  finalState: {
    arenaId: string;
    seed: string;
    tick: number;
    winnerId: string | null;
    agents: Array<{
      agentId: string;
      owner: string;
      eliminatedAt?: number;
      kills: number;
    }>;
  };
}

export interface EliminationRecord {
  agentId: bigint;
  eliminatedAt: number;
  eliminatedBy?: string;
  source: 'zone' | 'combat';
}

interface ActiveMatch {
  engine: GameEngine;
  interval: NodeJS.Timeout | null;
  subscribers: Set<string>;
  lastUpdate: TickUpdate | null;
  arenaId: bigint;
  seed: bigint;
  participants: ParticipantDataV2[];
}

@Injectable()
export class MatchService {
  private readonly logger = new Logger(MatchService.name);
  private matches: Map<string, ActiveMatch> = new Map();
  private tickCallbacks: Map<string, (update: TickUpdate) => void> = new Map();

  constructor(private readonly aiService: AiService) {}

  createMatch(
    arenaId: bigint,
    seed: bigint,
    participants: ParticipantData[],
    options?: {
      inlineTemplates?: Map<string, StrategyTemplate>;
      names?: Map<string, string>;
      metadata?: Record<string, any>;
    },
  ): string {
    const matchId = `match_${arenaId}_${Date.now()}`;
    const config = createDefaultConfig(arenaId, seed);

    // Kill switch: ENABLE_STRATEGY_TEMPLATES env var (default: true)
    // Set to "false" to disable all strategy templates without redeploy
    const templatesEnabled = process.env.ENABLE_STRATEGY_TEMPLATES !== 'false';

    // Upgrade participants with strategy templates from AiService
    // Priority: inline template > AiService stored > none
    const v2Participants: ParticipantDataV2[] = participants.map(p => {
      const agentKey = p.agentId.toString();
      const inlineTemplate = options?.inlineTemplates?.get(agentKey);
      const stored = (!inlineTemplate && templatesEnabled)
        ? this.aiService.getTemplate(arenaId.toString(), agentKey)
        : null;
      return {
        agentId: p.agentId,
        owner: p.owner,
        boostIds: [...p.boostIds],
        strategyTemplate: inlineTemplate ?? stored?.template,
        name: options?.names?.get(agentKey),
      };
    });

    if (!templatesEnabled && !options?.inlineTemplates) {
      this.logger.warn(`Strategy templates DISABLED by kill switch (ENABLE_STRATEGY_TEMPLATES=false)`);
    }

    const templatesFound = v2Participants.filter(p => p.strategyTemplate).length;
    if (templatesFound > 0) {
      this.logger.log(`Match ${matchId}: ${templatesFound}/${v2Participants.length} agents have custom strategies`);
    }

    const engine = new GameEngine(config, v2Participants);

    const match: ActiveMatch = {
      engine,
      interval: null,
      subscribers: new Set(),
      lastUpdate: null,
      arenaId,
      seed,
      participants: v2Participants,
    };

    // Store metadata for tournament discovery
    if (options?.metadata) {
      (match as any).metadata = options.metadata;
    }

    this.matches.set(matchId, match);
    this.logger.log(`Match ${matchId} created with ${participants.length} participants (engine v2)`);

    return matchId;
  }

  startMatch(matchId: string): boolean {
    const match = this.matches.get(matchId);
    if (!match) {
      this.logger.warn(`Match ${matchId} not found`);
      return false;
    }

    if (match.engine.getStatus() !== MatchStatus.WAITING) {
      this.logger.warn(`Match ${matchId} already started`);
      return false;
    }

    match.engine.start();

    // Start the game loop
    const tickRate = 20; // 20 ticks per second = 50ms per tick
    match.interval = setInterval(() => {
      this.processTick(matchId);
    }, 1000 / tickRate);

    this.logger.log(`Match ${matchId} started`);
    return true;
  }

  private processTick(matchId: string): void {
    const match = this.matches.get(matchId);
    if (!match) return;

    const update = match.engine.tick();
    match.lastUpdate = update;

    // Notify all subscribers
    const callback = this.tickCallbacks.get(matchId);
    if (callback) {
      callback(update);
    }

    // Check if match is finished
    if (match.engine.getStatus() === MatchStatus.FINISHED) {
      this.endMatch(matchId);
    }
  }

  private endMatch(matchId: string): void {
    const match = this.matches.get(matchId);
    if (!match) return;

    if (match.interval) {
      clearInterval(match.interval);
      match.interval = null;
    }

    const winner = match.engine.getWinner();
    this.logger.log(
      `Match ${matchId} ended. Winner: ${winner ? winner.id : 'none'}`,
    );

    // Keep match data for a while for late joiners
    setTimeout(() => {
      this.matches.delete(matchId);
      this.tickCallbacks.delete(matchId);
      this.logger.log(`Match ${matchId} cleaned up`);
    }, 60000); // Keep for 1 minute
  }

  getMatch(matchId: string): ActiveMatch | undefined {
    return this.matches.get(matchId);
  }

  getMatchState(matchId: string): any {
    const match = this.matches.get(matchId);
    if (!match) return null;
    return match.engine.getFullState();
  }

  getMatchByArena(arenaId: bigint): string | undefined {
    for (const [matchId, match] of this.matches) {
      if (match.engine.getState().arenaId === arenaId) {
        return matchId;
      }
    }
    return undefined;
  }

  subscribe(matchId: string, clientId: string): boolean {
    const match = this.matches.get(matchId);
    if (!match) return false;
    match.subscribers.add(clientId);
    return true;
  }

  unsubscribe(matchId: string, clientId: string): void {
    const match = this.matches.get(matchId);
    if (match) {
      match.subscribers.delete(clientId);
    }
  }

  onTick(matchId: string, callback: (update: TickUpdate) => void): void {
    this.tickCallbacks.set(matchId, callback);
  }

  getActiveMatches(): string[] {
    return Array.from(this.matches.keys());
  }

  isMatchActive(matchId: string): boolean {
    const match = this.matches.get(matchId);
    return match?.engine.getStatus() === MatchStatus.RUNNING;
  }

  // =============================================================
  //             REAL-TIME SIMULATION (for live battles)
  // =============================================================

  /**
   * Run simulation in real-time, streaming ticks to spectators.
   * Returns a Promise that resolves when the match finishes.
   * Used for on-chain arenas where users watch live.
   */
  async runRealTimeSimulation(matchId: string): Promise<SimulationResult> {
    const match = this.matches.get(matchId);
    if (!match) {
      throw new Error(`Match ${matchId} not found`);
    }

    if (match.engine.getStatus() !== MatchStatus.WAITING) {
      throw new Error(`Match ${matchId} is not in WAITING state`);
    }

    this.logger.log(`Starting real-time simulation for ${matchId}`);

    return new Promise((resolve, reject) => {
      // Start the match
      match.engine.start();

      // Tick rate: 20 ticks per second = 50ms per tick
      const TICK_RATE = 20;
      const MAX_TICKS = 10000; // Safety limit
      let tickCount = 0;

      match.interval = setInterval(() => {
        try {
          const update = match.engine.tick();
          match.lastUpdate = update;
          tickCount++;

          // Notify all subscribers (for WebSocket streaming)
          const callback = this.tickCallbacks.get(matchId);
          if (callback) {
            callback(update);
          }

          // Check if match is finished
          if (match.engine.getStatus() === MatchStatus.FINISHED) {
            clearInterval(match.interval!);
            match.interval = null;
            resolve(this.extractSimulationResult(matchId, match));
          }

          // Safety timeout
          if (tickCount >= MAX_TICKS) {
            this.logger.warn(`Match ${matchId} hit max tick limit, forcing winner`);
            clearInterval(match.interval!);
            match.interval = null;
            match.engine.forceWinnerByTimeout();
            resolve(this.extractSimulationResult(matchId, match));
          }
        } catch (error) {
          clearInterval(match.interval!);
          match.interval = null;
          reject(error);
        }
      }, 1000 / TICK_RATE);
    });
  }

  /**
   * Extract simulation result from a finished match
   */
  private extractSimulationResult(matchId: string, match: ActiveMatch): SimulationResult {
    const state = match.engine.getState();
    let winner = match.engine.getWinner();

    if (!winner) {
      this.logger.error(`No winner found for match ${matchId} - using emergency fallback`);
      winner = match.engine.forceWinnerByTimeout();
    }

    const agents = state.agents;
    const eliminatedAgents = Array.from(agents.values())
      .filter((a: Agent) => !a.isAlive)
      .sort((a: Agent, b: Agent) => (a.eliminatedAt || 0) - (b.eliminatedAt || 0));

    const eliminationOrder: EliminationRecord[] = eliminatedAgents.map((a: Agent) => ({
      agentId: a.agentId,
      eliminatedAt: a.eliminatedAt || 0,
      eliminatedBy: a.eliminatedBy,
      source: a.lastDamageSource || 'combat',
    }));

    const result: SimulationResult = {
      winnerId: winner.agentId,
      winnerAgentId: winner.id,
      winnerOwner: winner.owner,
      totalTicks: state.tick,
      eliminationOrder,
      finalState: {
        arenaId: state.arenaId.toString(),
        seed: state.seed.toString(),
        tick: state.tick,
        winnerId: state.winnerId || null,
        agents: Array.from(agents.values()).map((a: Agent) => ({
          agentId: a.agentId.toString(),
          owner: a.owner,
          eliminatedAt: a.eliminatedAt,
          kills: a.kills,
        })),
      },
    };

    this.logger.log(
      `Real-time simulation complete: ${matchId}, winner=${winner.id}, ticks=${state.tick}`,
    );

    // Schedule cleanup
    setTimeout(() => {
      this.matches.delete(matchId);
      this.tickCallbacks.delete(matchId);
      this.logger.log(`Match ${matchId} cleaned up`);
    }, 60000);

    return result;
  }

  // =============================================================
  //             SYNCHRONOUS SIMULATION (for testing/fallback)
  // =============================================================

  /**
   * Run a complete simulation synchronously without intervals.
   * Used for testing or when real-time streaming isn't needed.
   */
  async runSynchronousSimulation(matchId: string): Promise<SimulationResult> {
    const match = this.matches.get(matchId);
    if (!match) {
      throw new Error(`Match ${matchId} not found`);
    }

    if (match.engine.getStatus() !== MatchStatus.WAITING) {
      throw new Error(`Match ${matchId} is not in WAITING state`);
    }

    this.logger.log(`Starting synchronous simulation for ${matchId}`);

    // Start the match
    match.engine.start();

    // Run all ticks until finished (with safety limit)
    const MAX_TICKS = 10000; // ~8+ minutes at 20 ticks/sec
    let tickCount = 0;

    while (match.engine.getStatus() === MatchStatus.RUNNING && tickCount < MAX_TICKS) {
      const update = match.engine.tick();
      match.lastUpdate = update;

      // Broadcast tick for spectators
      const callback = this.tickCallbacks.get(matchId);
      if (callback) {
        callback(update);
      }

      tickCount++;
    }

    // Handle MAX_TICKS timeout - force a winner
    if (tickCount >= MAX_TICKS && match.engine.getStatus() === MatchStatus.RUNNING) {
      this.logger.warn(`Match ${matchId} hit max tick limit (${MAX_TICKS}), forcing winner by stats`);
      match.engine.forceWinnerByTimeout();
    }

    // Extract result
    const state = match.engine.getState();
    let winner = match.engine.getWinner();

    // Fallback: if still no winner (shouldn't happen after fixes), determine by stats
    if (!winner) {
      this.logger.error(`No winner found for match ${matchId} after all fixes - using emergency fallback`);
      winner = match.engine.forceWinnerByTimeout();
    }

    // Build elimination order
    const agents = state.agents;
    const eliminatedAgents = Array.from(agents.values())
      .filter((a: Agent) => !a.isAlive)
      .sort((a: Agent, b: Agent) => (a.eliminatedAt || 0) - (b.eliminatedAt || 0));

    const eliminationOrder: EliminationRecord[] = eliminatedAgents.map((a: Agent) => ({
      agentId: a.agentId,
      eliminatedAt: a.eliminatedAt || 0,
      eliminatedBy: a.eliminatedBy,
      source: a.lastDamageSource || 'combat',
    }));

    const result: SimulationResult = {
      winnerId: winner.agentId,
      winnerAgentId: winner.id,
      winnerOwner: winner.owner,
      totalTicks: state.tick,
      eliminationOrder,
      finalState: {
        arenaId: state.arenaId.toString(),
        seed: state.seed.toString(),
        tick: state.tick,
        winnerId: state.winnerId || null,
        agents: Array.from(agents.values()).map((a: Agent) => ({
          agentId: a.agentId.toString(),
          owner: a.owner,
          eliminatedAt: a.eliminatedAt,
          kills: a.kills,
        })),
      },
    };

    this.logger.log(
      `Synchronous simulation complete: ${matchId}, winner=${winner.id}, ticks=${state.tick}`,
    );

    // Schedule cleanup
    setTimeout(() => {
      this.matches.delete(matchId);
      this.tickCallbacks.delete(matchId);
      this.logger.log(`Match ${matchId} cleaned up`);
    }, 60000);

    return result;
  }

}
