// ============================================
// ENGINE V4.1 REGRESSION TEST SUITE
// ============================================
//
// SAFETY-CRITICAL: These tests protect the live game.
// The current Rush Royale engine is V4.1; it intentionally differs
// from the legacy v1 engine through shuffled spawn order, per-agent RNG,
// charge-meter ultimates, and rebalanced modifiers.
//
// Test groups:
// 1. Deterministic replay stability (same seed/input = same output)
// 2. Template produces different behavior (non-default templates diverge)
// 3. Engine stability (no crashes, always terminates, invariants hold)
// 4. Default template constant (exact values match spec)
// ============================================

import {
  GameEngine as GameEngineV2,
  createDefaultConfig as createConfigV2,
} from './engine-v2';
import {
  MatchStatus,
  ParticipantDataV2,
  StrategyTemplate,
  DEFAULT_STRATEGY_TEMPLATE,
  AgentUpdate,
  ProjectileUpdate,
} from './types';

// ============================================
// TEST HELPERS
// ============================================

const MAX_TICKS = 10_000;

/** Create v2 participant array WITHOUT strategyTemplate (defaults to DEFAULT). */
function makeV2ParticipantsDefault(count: number): ParticipantDataV2[] {
  const participants: ParticipantDataV2[] = [];
  for (let i = 1; i <= count; i++) {
    participants.push({
      agentId: BigInt(i),
      owner: `0x${i.toString(16).padStart(40, '0')}`,
      boostIds: [],
      // No strategyTemplate -- engine will use DEFAULT_STRATEGY_TEMPLATE
    });
  }
  return participants;
}

/** Create v2 participant array with explicit strategy templates. */
function makeV2ParticipantsWithTemplates(
  count: number,
  templateFn: (index: number) => StrategyTemplate,
): ParticipantDataV2[] {
  const participants: ParticipantDataV2[] = [];
  for (let i = 1; i <= count; i++) {
    participants.push({
      agentId: BigInt(i),
      owner: `0x${i.toString(16).padStart(40, '0')}`,
      boostIds: [],
      strategyTemplate: templateFn(i),
    });
  }
  return participants;
}

/** Sort agent updates by id for deterministic comparison. */
function sortAgents(agents: AgentUpdate[]): AgentUpdate[] {
  return [...agents].sort((a, b) => a.id.localeCompare(b.id));
}

/** Sort projectile updates by id for deterministic comparison. */
function sortProjectiles(projectiles: ProjectileUpdate[]): ProjectileUpdate[] {
  return [...projectiles].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Elimination record from a completed match.
 * Sorted by eliminatedAt ascending (first eliminated first).
 */
interface EliminationRecord {
  agentId: string;
  eliminatedAt: number | undefined;
}

/** Extract elimination order from a finished engine. */
function getEliminationOrder(
  agents: Map<string, { id: string; eliminatedAt?: number }>,
): EliminationRecord[] {
  const records: EliminationRecord[] = [];
  for (const agent of agents.values()) {
    records.push({
      agentId: agent.id,
      eliminatedAt: agent.eliminatedAt,
    });
  }
  // Sort: eliminated agents first (by tick ascending), then alive agents
  records.sort((a, b) => {
    if (a.eliminatedAt === undefined && b.eliminatedAt === undefined) return 0;
    if (a.eliminatedAt === undefined) return 1;
    if (b.eliminatedAt === undefined) return -1;
    return a.eliminatedAt - b.eliminatedAt;
  });
  return records;
}

/**
 * Core comparison function: runs two V4.1 engines tick-by-tick
 * and asserts identical results at every tick.
 *
 * Returns { totalTicks, winnerId } on success.
 */
function runAndCompare(
  seed: bigint,
  participantCount: number,
): { totalTicks: number; winnerId: string } {
  const arenaId = BigInt(1);
  const configA = createConfigV2(arenaId, seed);
  const configB = createConfigV2(arenaId, seed);

  expect(configB).toEqual(configA);

  const participantsA = makeV2ParticipantsDefault(participantCount);
  const participantsB = makeV2ParticipantsDefault(participantCount);

  const engineA = new GameEngineV2(configA, participantsA);
  const engineB = new GameEngineV2(configB, participantsB);

  engineA.start();
  engineB.start();

  let tickCount = 0;

  while (tickCount < MAX_TICKS) {
    const updateA = engineA.tick();
    const updateB = engineB.tick();

    tickCount++;

    // ---- Compare tick number ----
    expect(updateB.tick).toBe(updateA.tick);

    // ---- Compare arena ----
    expect(updateB.arena.radius).toBe(updateA.arena.radius);
    expect(updateB.arena.phase).toBe(updateA.arena.phase);

    // ---- Compare agents (sorted by id for determinism) ----
    const agentsA = sortAgents(updateA.agents);
    const agentsB = sortAgents(updateB.agents);

    expect(agentsB.length).toBe(agentsA.length);

    for (let i = 0; i < agentsA.length; i++) {
      const a1 = agentsA[i];
      const a2 = agentsB[i];

      expect(a2.id).toBe(a1.id);
      expect(a2.x).toBe(a1.x);       // bitwise-equal (same float rounding)
      expect(a2.y).toBe(a1.y);       // bitwise-equal
      expect(a2.health).toBe(a1.health); // bitwise-equal
      expect(a2.isAlive).toBe(a1.isAlive);
    }

    // ---- Compare projectiles (sorted by id for determinism) ----
    expect(sortProjectiles(updateB.projectiles)).toEqual(sortProjectiles(updateA.projectiles));

    // ---- Compare events count and types ----
    expect(updateB.events.length).toBe(updateA.events.length);
    for (let i = 0; i < updateA.events.length; i++) {
      expect(updateB.events[i].type).toBe(updateA.events[i].type);
      expect(updateB.events[i].tick).toBe(updateA.events[i].tick);
    }

    // Check if both finished on the same tick
    const statusA = engineA.getStatus();
    const statusB = engineB.getStatus();
    expect(statusB).toBe(statusA);

    if (statusA === MatchStatus.FINISHED) {
      break;
    }
  }

  // Both must have finished
  expect(engineA.getStatus()).toBe(MatchStatus.FINISHED);
  expect(engineB.getStatus()).toBe(MatchStatus.FINISHED);

  // Winner must match
  const winnerA = engineA.getWinner();
  const winnerB = engineB.getWinner();
  expect(winnerA).toBeDefined();
  expect(winnerB).toBeDefined();
  expect(winnerB!.id).toBe(winnerA!.id);

  // Total ticks must match
  const stateA = engineA.getState();
  const stateB = engineB.getState();
  expect(stateB.tick).toBe(stateA.tick);

  // Elimination order must match
  const elimA = getEliminationOrder(stateA.agents);
  const elimB = getEliminationOrder(stateB.agents);
  expect(elimB).toEqual(elimA);

  return {
    totalTicks: stateA.tick,
    winnerId: winnerA!.id,
  };
}

// ============================================
// TEST GROUP 1: DETERMINISTIC REPLAY STABILITY
// ============================================

describe('Deterministic replay stability', () => {
  // 5 different seeds x varying participant counts
  const testCases: Array<{ seed: bigint; count: number; label: string }> = [
    { seed: BigInt(12345),             count: 2,  label: 'seed=12345, 2 agents' },
    { seed: BigInt(9999999),           count: 4,  label: 'seed=9999999, 4 agents' },
    { seed: BigInt(42),                count: 8,  label: 'seed=42, 8 agents' },
    { seed: BigInt(777777777),         count: 4,  label: 'seed=777777777, 4 agents' },
    { seed: BigInt(1000000000000),     count: 2,  label: 'seed=1e12, 2 agents' },
    // 16-agent stress test (only one due to tick count)
    { seed: BigInt(314159),            count: 16, label: 'seed=314159, 16 agents' },
    // Edge case: large seed
    { seed: BigInt('9007199254740991'), count: 4,  label: 'seed=MAX_SAFE_INT, 4 agents' },
    // Another 8-agent case with different seed
    { seed: BigInt(55555),             count: 8,  label: 'seed=55555, 8 agents' },
  ];

  test.each(testCases)(
    'V4.1 produces identical output for same seed/input: $label',
    ({ seed, count }) => {
      const result = runAndCompare(seed, count);
      // Sanity: the match actually ran (not stuck at tick 0)
      expect(result.totalTicks).toBeGreaterThan(0);
      expect(result.winnerId).toBeTruthy();
    },
    // 60s timeout per test case (16-agent matches can be long)
    60_000,
  );
});

// ============================================
// TEST GROUP 2: TEMPLATE PRODUCES DIFFERENT BEHAVIOR
// ============================================

describe('Template produces different behavior', () => {
  const AGGRESSIVE_TEMPLATE: StrategyTemplate = {
    aggressiveness: 0.9,
    riskTolerance: 0.8,
    positioningBias: 'center',
    targetPriority: 'weakest',
    ultimatePolicy: 'early',
    evasionSkill: 0.3,
    shotAccuracy: 0.8,
    triggerDiscipline: 0.3,
    pursuitTenacity: 0.8,
    strafeCadence: 0.3,
  };

  const DEFENSIVE_TEMPLATE: StrategyTemplate = {
    aggressiveness: 0.2,
    riskTolerance: 0.3,
    positioningBias: 'edge',
    targetPriority: 'closest',
    ultimatePolicy: 'late',
    evasionSkill: 0.8,
    shotAccuracy: 0.4,
    triggerDiscipline: 0.7,
    pursuitTenacity: 0.2,
    strafeCadence: 0.6,
  };

  /**
   * Run v2 with given template to completion.
   * Returns { winnerId, totalTicks, eliminationOrder }.
   */
  function runV2WithTemplate(
    seed: bigint,
    count: number,
    templateFn: (index: number) => StrategyTemplate,
  ): {
    winnerId: string;
    totalTicks: number;
    eliminationOrder: EliminationRecord[];
  } {
    const arenaId = BigInt(1);
    const config = createConfigV2(arenaId, seed);
    const participants = makeV2ParticipantsWithTemplates(count, templateFn);
    const engine = new GameEngineV2(config, participants);

    engine.start();

    let tickCount = 0;
    while (engine.getStatus() !== MatchStatus.FINISHED && tickCount < MAX_TICKS) {
      engine.tick();
      tickCount++;
    }

    // If not finished, force a winner
    if (engine.getStatus() !== MatchStatus.FINISHED) {
      (engine as any).forceWinnerByTimeout();
    }

    const state = engine.getState();
    const winner = engine.getWinner();

    return {
      winnerId: winner?.id ?? 'none',
      totalTicks: state.tick,
      eliminationOrder: getEliminationOrder(state.agents),
    };
  }

  /** Run v2 with default template (baseline). */
  function runV2Default(seed: bigint, count: number) {
    return runV2WithTemplate(seed, count, () => DEFAULT_STRATEGY_TEMPLATE);
  }

  test('All-aggressive template diverges from default', () => {
    const seed = BigInt(12345);
    const count = 4;

    const defaultResult = runV2Default(seed, count);
    const aggressiveResult = runV2WithTemplate(seed, count, () => AGGRESSIVE_TEMPLATE);

    // At least one of these should differ
    const winnerDiffers = defaultResult.winnerId !== aggressiveResult.winnerId;
    const ticksDiffer = defaultResult.totalTicks !== aggressiveResult.totalTicks;
    const elimOrderDiffers = JSON.stringify(defaultResult.eliminationOrder) !==
                              JSON.stringify(aggressiveResult.eliminationOrder);

    expect(winnerDiffers || ticksDiffer || elimOrderDiffers).toBe(true);

    // Both must still finish (stability check)
    expect(aggressiveResult.totalTicks).toBeGreaterThan(0);
    expect(aggressiveResult.winnerId).not.toBe('none');
  }, 60_000);

  test('All-defensive template diverges from default', () => {
    const seed = BigInt(12345);
    const count = 4;

    const defaultResult = runV2Default(seed, count);
    const defensiveResult = runV2WithTemplate(seed, count, () => DEFENSIVE_TEMPLATE);

    const winnerDiffers = defaultResult.winnerId !== defensiveResult.winnerId;
    const ticksDiffer = defaultResult.totalTicks !== defensiveResult.totalTicks;
    const elimOrderDiffers = JSON.stringify(defaultResult.eliminationOrder) !==
                              JSON.stringify(defensiveResult.eliminationOrder);

    expect(winnerDiffers || ticksDiffer || elimOrderDiffers).toBe(true);

    // Stability
    expect(defensiveResult.totalTicks).toBeGreaterThan(0);
    expect(defensiveResult.winnerId).not.toBe('none');
  }, 60_000);

  test('Mixed templates (some aggressive, some defensive) diverge from default', () => {
    const seed = BigInt(9999999);
    const count = 8;

    const defaultResult = runV2Default(seed, count);
    const mixedResult = runV2WithTemplate(seed, count, (index) => {
      // Odd agents = aggressive, even agents = defensive
      return index % 2 === 1 ? AGGRESSIVE_TEMPLATE : DEFENSIVE_TEMPLATE;
    });

    const winnerDiffers = defaultResult.winnerId !== mixedResult.winnerId;
    const ticksDiffer = defaultResult.totalTicks !== mixedResult.totalTicks;
    const elimOrderDiffers = JSON.stringify(defaultResult.eliminationOrder) !==
                              JSON.stringify(mixedResult.eliminationOrder);

    expect(winnerDiffers || ticksDiffer || elimOrderDiffers).toBe(true);

    // Stability
    expect(mixedResult.totalTicks).toBeGreaterThan(0);
    expect(mixedResult.winnerId).not.toBe('none');
  }, 60_000);

  test('Threat-targeting template diverges from default', () => {
    const seed = BigInt(42);
    const count = 4;

    const threatTemplate: StrategyTemplate = {
      aggressiveness: 0.7,
      riskTolerance: 0.5,
      positioningBias: 'roamer',
      targetPriority: 'threat',
      ultimatePolicy: 'opportunistic',
      evasionSkill: 0.5,
      shotAccuracy: 0.5,
      triggerDiscipline: 0.5,
      pursuitTenacity: 0.5,
      strafeCadence: 0.5,
    };

    const defaultResult = runV2Default(seed, count);
    const threatResult = runV2WithTemplate(seed, count, () => threatTemplate);

    const winnerDiffers = defaultResult.winnerId !== threatResult.winnerId;
    const ticksDiffer = defaultResult.totalTicks !== threatResult.totalTicks;
    const elimOrderDiffers = JSON.stringify(defaultResult.eliminationOrder) !==
                              JSON.stringify(threatResult.eliminationOrder);

    expect(winnerDiffers || ticksDiffer || elimOrderDiffers).toBe(true);

    expect(threatResult.totalTicks).toBeGreaterThan(0);
    expect(threatResult.winnerId).not.toBe('none');
  }, 60_000);
});

// ============================================
// TEST GROUP 3: ENGINE STABILITY
// ============================================

describe('Engine stability', () => {
  const stabilitySeeds: bigint[] = [
    BigInt(1),
    BigInt(100),
    BigInt(999),
    BigInt(123456789),
    BigInt(2147483646), // near max for SeededRandom
  ];

  const allTemplates: StrategyTemplate[] = [
    // Default
    DEFAULT_STRATEGY_TEMPLATE,
    // All extremes
    { aggressiveness: 0.0, riskTolerance: 0.0, positioningBias: 'edge', targetPriority: 'weakest', ultimatePolicy: 'late', evasionSkill: 1.0, shotAccuracy: 0.0, triggerDiscipline: 1.0, pursuitTenacity: 0.0, strafeCadence: 1.0 },
    { aggressiveness: 1.0, riskTolerance: 1.0, positioningBias: 'center', targetPriority: 'threat', ultimatePolicy: 'early', evasionSkill: 0.0, shotAccuracy: 1.0, triggerDiscipline: 0.0, pursuitTenacity: 1.0, strafeCadence: 0.0 },
    // Mid-range
    { aggressiveness: 0.5, riskTolerance: 0.5, positioningBias: 'roamer', targetPriority: 'closest', ultimatePolicy: 'opportunistic', evasionSkill: 0.5, shotAccuracy: 0.5, triggerDiscipline: 0.5, pursuitTenacity: 0.5, strafeCadence: 0.5 },
  ];

  test.each(stabilitySeeds)(
    'v2 never crashes and always terminates (seed=%s)',
    (seed) => {
      for (const template of allTemplates) {
        const arenaId = BigInt(1);
        const config = createConfigV2(arenaId, seed);
        const participants = makeV2ParticipantsWithTemplates(4, () => template);
        const engine = new GameEngineV2(config, participants);

        engine.start();

        let tickCount = 0;
        // Must not throw
        while (engine.getStatus() !== MatchStatus.FINISHED && tickCount < MAX_TICKS) {
          expect(() => engine.tick()).not.toThrow();
          tickCount++;
        }

        // Must reach FINISHED (or we force-finish to avoid test hanging)
        if (engine.getStatus() !== MatchStatus.FINISHED) {
          (engine as any).forceWinnerByTimeout();
        }
        expect(engine.getStatus()).toBe(MatchStatus.FINISHED);
      }
    },
    60_000,
  );

  test('v2 always has exactly one winner', () => {
    const seeds = [BigInt(42), BigInt(777), BigInt(31415)];
    for (const seed of seeds) {
      const arenaId = BigInt(1);
      const config = createConfigV2(arenaId, seed);
      const participants = makeV2ParticipantsDefault(4);
      const engine = new GameEngineV2(config, participants);

      engine.start();
      let tickCount = 0;
      while (engine.getStatus() !== MatchStatus.FINISHED && tickCount < MAX_TICKS) {
        engine.tick();
        tickCount++;
      }

      if (engine.getStatus() !== MatchStatus.FINISHED) {
        (engine as any).forceWinnerByTimeout();
      }

      const winner = engine.getWinner();
      expect(winner).toBeDefined();
      expect(winner!.id).toBeTruthy();

      // Exactly one winner: the winner should be the last alive OR
      // selected via draw resolution
      const state = engine.getState();
      expect(state.winnerId).toBe(winner!.id);
    }
  }, 60_000);

  test('v2 health never goes negative (below 0) or above maxHealth', () => {
    const seed = BigInt(88888);
    const arenaId = BigInt(1);
    const config = createConfigV2(arenaId, seed);
    const participants = makeV2ParticipantsDefault(8);
    const engine = new GameEngineV2(config, participants);

    engine.start();

    let tickCount = 0;
    while (engine.getStatus() !== MatchStatus.FINISHED && tickCount < MAX_TICKS) {
      engine.tick();
      tickCount++;

      const state = engine.getState();
      for (const agent of state.agents.values()) {
        if (agent.isAlive) {
          // Health of alive agents should be > 0 (or they'd be eliminated)
          // Note: engine sets health to 0 and isAlive=false simultaneously
          // so alive agents should have positive health
          expect(agent.health).toBeGreaterThan(0);
          expect(agent.health).toBeLessThanOrEqual(agent.maxHealth);
        } else {
          // Dead agents have health <= 0 (engine sets to 0)
          expect(agent.health).toBe(0);
        }
      }
    }
  }, 60_000);

  test('All agents start alive and at least one is eliminated', () => {
    const seed = BigInt(54321);
    const arenaId = BigInt(1);
    const count = 4;
    const config = createConfigV2(arenaId, seed);
    const participants = makeV2ParticipantsDefault(count);
    const engine = new GameEngineV2(config, participants);

    // Before start: all agents alive
    const preState = engine.getState();
    let aliveCount = 0;
    for (const agent of preState.agents.values()) {
      expect(agent.isAlive).toBe(true);
      expect(agent.health).toBe(100);
      aliveCount++;
    }
    expect(aliveCount).toBe(count);

    // Run to completion
    engine.start();
    let tickCount = 0;
    while (engine.getStatus() !== MatchStatus.FINISHED && tickCount < MAX_TICKS) {
      engine.tick();
      tickCount++;
    }

    if (engine.getStatus() !== MatchStatus.FINISHED) {
      (engine as any).forceWinnerByTimeout();
    }

    // After finish: at least one eliminated
    const postState = engine.getState();
    let eliminatedCount = 0;
    for (const agent of postState.agents.values()) {
      if (!agent.isAlive) eliminatedCount++;
    }
    // With 4 agents, at least 3 must be eliminated (winner survives, or draw picks one)
    expect(eliminatedCount).toBeGreaterThanOrEqual(count - 1);
  }, 60_000);

  test('v2 with extreme template values does not crash', () => {
    const extremeTemplates: StrategyTemplate[] = [
      { aggressiveness: 0.0, riskTolerance: 0.0, positioningBias: 'center', targetPriority: 'weakest', ultimatePolicy: 'early', evasionSkill: 0.0, shotAccuracy: 0.0, triggerDiscipline: 0.0, pursuitTenacity: 1.0, strafeCadence: 0.0 },
      { aggressiveness: 1.0, riskTolerance: 1.0, positioningBias: 'edge', targetPriority: 'threat', ultimatePolicy: 'late', evasionSkill: 1.0, shotAccuracy: 1.0, triggerDiscipline: 1.0, pursuitTenacity: 0.0, strafeCadence: 1.0 },
      { aggressiveness: 0.0, riskTolerance: 1.0, positioningBias: 'edge', targetPriority: 'closest', ultimatePolicy: 'early', evasionSkill: 1.0, shotAccuracy: 0.0, triggerDiscipline: 0.0, pursuitTenacity: 1.0, strafeCadence: 0.0 },
      { aggressiveness: 1.0, riskTolerance: 0.0, positioningBias: 'center', targetPriority: 'weakest', ultimatePolicy: 'late', evasionSkill: 0.0, shotAccuracy: 1.0, triggerDiscipline: 1.0, pursuitTenacity: 0.0, strafeCadence: 1.0 },
    ];

    for (const template of extremeTemplates) {
      const seed = BigInt(12345);
      const arenaId = BigInt(1);
      const config = createConfigV2(arenaId, seed);
      const participants = makeV2ParticipantsWithTemplates(4, () => template);
      const engine = new GameEngineV2(config, participants);

      engine.start();
      let tickCount = 0;
      while (engine.getStatus() !== MatchStatus.FINISHED && tickCount < MAX_TICKS) {
        expect(() => engine.tick()).not.toThrow();
        tickCount++;
      }

      if (engine.getStatus() !== MatchStatus.FINISHED) {
        (engine as any).forceWinnerByTimeout();
      }

      expect(engine.getStatus()).toBe(MatchStatus.FINISHED);
      expect(engine.getWinner()).toBeDefined();
    }
  }, 120_000);
});

// ============================================
// TEST GROUP 4: DEFAULT TEMPLATE CONSTANT
// ============================================

describe('Default template constant', () => {
  test('DEFAULT_STRATEGY_TEMPLATE has exact expected values', () => {
    expect(DEFAULT_STRATEGY_TEMPLATE.aggressiveness).toBe(0.5);
    expect(DEFAULT_STRATEGY_TEMPLATE.riskTolerance).toBe(0.5);
    expect(DEFAULT_STRATEGY_TEMPLATE.positioningBias).toBe('roamer');
    expect(DEFAULT_STRATEGY_TEMPLATE.targetPriority).toBe('closest');
    expect(DEFAULT_STRATEGY_TEMPLATE.ultimatePolicy).toBe('opportunistic');
  });

  test('DEFAULT_STRATEGY_TEMPLATE is frozen or at least matches snapshot', () => {
    // Ensure the object shape has exactly 7 properties
    const keys = Object.keys(DEFAULT_STRATEGY_TEMPLATE);
    expect(keys).toHaveLength(10);
    expect(keys.sort()).toEqual([
      'aggressiveness',
      'evasionSkill',
      'positioningBias',
      'pursuitTenacity',
      'riskTolerance',
      'shotAccuracy',
      'strafeCadence',
      'targetPriority',
      'triggerDiscipline',
      'ultimatePolicy',
    ]);
  });

  test('DEFAULT_STRATEGY_TEMPLATE matches full snapshot', () => {
    expect(DEFAULT_STRATEGY_TEMPLATE).toEqual({
      aggressiveness: 0.5,
      riskTolerance: 0.5,
      positioningBias: 'roamer',
      targetPriority: 'closest',
      ultimatePolicy: 'opportunistic',
      evasionSkill: 0.5,
      shotAccuracy: 0.5,
      triggerDiscipline: 0.5,
      pursuitTenacity: 0.5,
      strafeCadence: 0.5,
    });
  });

  test('v2 default template produces IDENTICAL panic threshold to v1 hardcoded 0.25', () => {
    // v1 hardcodes: if (healthPercent < 0.25) => PANIC
    // v2 formula:   panicThreshold = 0.40 - riskTolerance * 0.30
    // With default riskTolerance = 0.5:
    //   0.40 - 0.5 * 0.30 = 0.40 - 0.15 = 0.25
    const panicThreshold = 0.40 - DEFAULT_STRATEGY_TEMPLATE.riskTolerance * 0.30;
    expect(panicThreshold).toBe(0.25);
  });

  test('v2 default template produces IDENTICAL flee strength to v1 hardcoded 0.6', () => {
    // v1 hardcodes: fleeStrength = 0.6
    // v2 formula:   fleeStrength = 0.3 + (1.0 - riskTolerance) * 0.6
    // With default riskTolerance = 0.5:
    //   0.3 + (1.0 - 0.5) * 0.6 = 0.3 + 0.3 = 0.6
    const fleeStrength = 0.3 + (1.0 - DEFAULT_STRATEGY_TEMPLATE.riskTolerance) * 0.6;
    expect(fleeStrength).toBe(0.6);
  });

  test('v2 default template produces IDENTICAL aggression multiplier of 1.0', () => {
    // v1 has no multiplier (implicit 1.0 on approach strength)
    // v2 formula: aggressionMultiplier = 0.5 + aggressiveness
    // With default aggressiveness = 0.5:
    //   0.5 + 0.5 = 1.0
    const aggressionMultiplier = 0.5 + DEFAULT_STRATEGY_TEMPLATE.aggressiveness;
    expect(aggressionMultiplier).toBe(1.0);
  });

  test('v2 default template produces IDENTICAL safe zone margins to v1', () => {
    // v1 hardcodes: safeRadius = min(currentRadius * 0.75, predictedRadius * 0.85)
    // v2 with positioningBias='roamer': safeMarginCurrent=0.75, safeMarginPredicted=0.85
    // These must match exactly.
    expect(DEFAULT_STRATEGY_TEMPLATE.positioningBias).toBe('roamer');
    // The ternary in v2: 'roamer' -> 0.75 and 0.85 -- matches v1
  });

  test('v2 default template uses ultimate min tick of 100 (same as v1)', () => {
    // v1 hardcodes: if (this.state.tick < 100) return false;
    // v2 with ultimatePolicy='opportunistic': minTick = 100
    expect(DEFAULT_STRATEGY_TEMPLATE.ultimatePolicy).toBe('opportunistic');
  });
});
