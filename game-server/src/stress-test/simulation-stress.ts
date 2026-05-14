/**
 * Battle Simulation Stress Test - Testa simulação com 200 agentes
 *
 * Uso: npx ts-node src/stress-test/simulation-stress.ts
 */

// Simula a lógica de batalha sem precisar do servidor rodando

interface Agent {
  id: string;
  x: number;
  y: number;
  health: number;
  maxHealth: number;
  isAlive: boolean;
  rotation: number;
  velocityX: number;
  velocityY: number;
  lastShot: number;
  target: string | null;
}

interface Projectile {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  damage: number;
  createdAt: number;
}

interface SimulationStats {
  totalAgents: number;
  ticksProcessed: number;
  avgTickTimeMs: number;
  maxTickTimeMs: number;
  minTickTimeMs: number;
  p95TickTimeMs: number;
  totalProjectilesFired: number;
  peakProjectiles: number;
  memoryUsageMB: number;
  simulationTimeMs: number;
  realTimeRatio: number;
}

const CONFIG = {
  NUM_AGENTS: 200,
  ARENA_RADIUS: 1000,
  TICK_RATE: 20, // ticks per second
  MAX_TICKS: 2000, // ~100 seconds of battle
  AGENT_SPEED: 3,
  PROJECTILE_SPEED: 8,
  PROJECTILE_DAMAGE: 15,
  FIRE_RATE_MS: 500,
  AGENT_RADIUS: 15,
  PROJECTILE_RADIUS: 5,
  ZONE_SHRINK_RATE: 0.5,
};

class BattleSimulation {
  private agents: Map<string, Agent> = new Map();
  private projectiles: Map<string, Projectile> = new Map();
  private currentTick = 0;
  private arenaRadius = CONFIG.ARENA_RADIUS;
  private projectileCounter = 0;
  private tickTimes: number[] = [];
  private totalProjectilesFired = 0;
  private peakProjectiles = 0;

  run(): SimulationStats {
    console.log(`\n🎮 Starting Battle Simulation Stress Test`);
    console.log(`   Agents: ${CONFIG.NUM_AGENTS}`);
    console.log(`   Arena: ${CONFIG.ARENA_RADIUS}px radius`);
    console.log(`   Max Ticks: ${CONFIG.MAX_TICKS}`);
    console.log(`   Tick Rate: ${CONFIG.TICK_RATE}/s\n`);

    // Initialize agents
    this.initializeAgents();

    const startTime = Date.now();
    let lastReport = startTime;
    let aliveCount = CONFIG.NUM_AGENTS;

    // Main simulation loop
    while (this.currentTick < CONFIG.MAX_TICKS && aliveCount > 1) {
      const tickStart = performance.now();

      // Process tick
      this.processTick();

      const tickTime = performance.now() - tickStart;
      this.tickTimes.push(tickTime);

      // Track peak projectiles
      if (this.projectiles.size > this.peakProjectiles) {
        this.peakProjectiles = this.projectiles.size;
      }

      // Count alive
      aliveCount = Array.from(this.agents.values()).filter(a => a.isAlive).length;

      // Progress report every 500 ticks
      if (this.currentTick % 500 === 0) {
        const elapsed = Date.now() - startTime;
        const avgTick = this.tickTimes.slice(-100).reduce((a, b) => a + b, 0) / Math.min(100, this.tickTimes.length);
        console.log(
          `   [Tick ${this.currentTick}] Alive: ${aliveCount} | ` +
          `Projectiles: ${this.projectiles.size} | ` +
          `Avg tick: ${avgTick.toFixed(2)}ms | ` +
          `Arena: ${this.arenaRadius.toFixed(0)}px`
        );
      }

      this.currentTick++;
    }

    const totalTime = Date.now() - startTime;
    const expectedTime = (this.currentTick / CONFIG.TICK_RATE) * 1000;

    return this.collectStats(totalTime, expectedTime);
  }

  private initializeAgents(): void {
    for (let i = 0; i < CONFIG.NUM_AGENTS; i++) {
      // Spawn in a circle
      const angle = (i / CONFIG.NUM_AGENTS) * Math.PI * 2;
      const distance = CONFIG.ARENA_RADIUS * 0.8;

      const agent: Agent = {
        id: `agent-${i}`,
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
        health: 100,
        maxHealth: 100,
        isAlive: true,
        rotation: angle + Math.PI, // Face center
        velocityX: 0,
        velocityY: 0,
        lastShot: 0,
        target: null,
      };

      this.agents.set(agent.id, agent);
    }
  }

  private processTick(): void {
    const now = this.currentTick * (1000 / CONFIG.TICK_RATE);

    // Shrink zone
    if (this.currentTick > 200) {
      this.arenaRadius = Math.max(50, this.arenaRadius - CONFIG.ZONE_SHRINK_RATE);
    }

    // Update each agent
    for (const agent of this.agents.values()) {
      if (!agent.isAlive) continue;

      // Find nearest enemy
      this.updateAgentTarget(agent);

      // Move towards/away from target
      this.updateAgentMovement(agent);

      // Fire at target
      this.updateAgentFiring(agent, now);

      // Zone damage
      this.applyZoneDamage(agent);
    }

    // Update projectiles
    this.updateProjectiles();

    // Check collisions
    this.checkCollisions();

    // Remove dead projectiles
    this.cleanupProjectiles();
  }

  private updateAgentTarget(agent: Agent): void {
    let nearestDist = Infinity;
    let nearestId: string | null = null;

    for (const other of this.agents.values()) {
      if (other.id === agent.id || !other.isAlive) continue;

      const dist = this.distance(agent.x, agent.y, other.x, other.y);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestId = other.id;
      }
    }

    agent.target = nearestId;
  }

  private updateAgentMovement(agent: Agent): void {
    if (!agent.target) return;

    const target = this.agents.get(agent.target);
    if (!target) return;

    const dx = target.x - agent.x;
    const dy = target.y - agent.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 0) {
      // Move towards target if far, strafe if close
      const optimalRange = 150;
      const moveDir = dist > optimalRange ? 1 : -0.5;

      agent.velocityX = (dx / dist) * CONFIG.AGENT_SPEED * moveDir;
      agent.velocityY = (dy / dist) * CONFIG.AGENT_SPEED * moveDir;

      // Add some randomness for strafing
      agent.velocityX += (Math.random() - 0.5) * 2;
      agent.velocityY += (Math.random() - 0.5) * 2;
    }

    // Apply velocity
    agent.x += agent.velocityX;
    agent.y += agent.velocityY;

    // Update rotation to face target
    agent.rotation = Math.atan2(dy, dx);

    // Keep in arena
    const distFromCenter = Math.sqrt(agent.x * agent.x + agent.y * agent.y);
    if (distFromCenter > this.arenaRadius - CONFIG.AGENT_RADIUS) {
      const scale = (this.arenaRadius - CONFIG.AGENT_RADIUS) / distFromCenter;
      agent.x *= scale;
      agent.y *= scale;
    }
  }

  private updateAgentFiring(agent: Agent, now: number): void {
    if (!agent.target) return;
    if (now - agent.lastShot < CONFIG.FIRE_RATE_MS) return;

    const target = this.agents.get(agent.target);
    if (!target) return;

    const dx = target.x - agent.x;
    const dy = target.y - agent.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 300) return; // Out of range

    // Fire projectile
    const projectile: Projectile = {
      id: `proj-${this.projectileCounter++}`,
      ownerId: agent.id,
      x: agent.x,
      y: agent.y,
      velocityX: (dx / dist) * CONFIG.PROJECTILE_SPEED,
      velocityY: (dy / dist) * CONFIG.PROJECTILE_SPEED,
      damage: CONFIG.PROJECTILE_DAMAGE,
      createdAt: now,
    };

    this.projectiles.set(projectile.id, projectile);
    agent.lastShot = now;
    this.totalProjectilesFired++;
  }

  private applyZoneDamage(agent: Agent): void {
    const dist = Math.sqrt(agent.x * agent.x + agent.y * agent.y);
    if (dist > this.arenaRadius) {
      const damage = (dist - this.arenaRadius) * 0.1;
      agent.health -= damage;
      if (agent.health <= 0) {
        agent.isAlive = false;
      }
    }
  }

  private updateProjectiles(): void {
    for (const proj of this.projectiles.values()) {
      proj.x += proj.velocityX;
      proj.y += proj.velocityY;
    }
  }

  private checkCollisions(): void {
    for (const proj of this.projectiles.values()) {
      for (const agent of this.agents.values()) {
        if (!agent.isAlive) continue;
        if (agent.id === proj.ownerId) continue;

        const dist = this.distance(proj.x, proj.y, agent.x, agent.y);
        if (dist < CONFIG.AGENT_RADIUS + CONFIG.PROJECTILE_RADIUS) {
          // Hit!
          agent.health -= proj.damage;
          if (agent.health <= 0) {
            agent.isAlive = false;
          }
          // Mark for removal
          this.projectiles.delete(proj.id);
          break;
        }
      }
    }
  }

  private cleanupProjectiles(): void {
    // Remove projectiles that are out of bounds or too old
    for (const [id, proj] of this.projectiles.entries()) {
      const dist = Math.sqrt(proj.x * proj.x + proj.y * proj.y);
      if (dist > CONFIG.ARENA_RADIUS * 1.5) {
        this.projectiles.delete(id);
      }
    }
  }

  private distance(x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private collectStats(totalTimeMs: number, expectedTimeMs: number): SimulationStats {
    this.tickTimes.sort((a, b) => a - b);

    const p95Index = Math.floor(this.tickTimes.length * 0.95);
    const memUsage = process.memoryUsage();

    return {
      totalAgents: CONFIG.NUM_AGENTS,
      ticksProcessed: this.currentTick,
      avgTickTimeMs: this.tickTimes.reduce((a, b) => a + b, 0) / this.tickTimes.length,
      maxTickTimeMs: this.tickTimes[this.tickTimes.length - 1],
      minTickTimeMs: this.tickTimes[0],
      p95TickTimeMs: this.tickTimes[p95Index],
      totalProjectilesFired: this.totalProjectilesFired,
      peakProjectiles: this.peakProjectiles,
      memoryUsageMB: Math.round(memUsage.heapUsed / 1024 / 1024),
      simulationTimeMs: totalTimeMs,
      realTimeRatio: expectedTimeMs / totalTimeMs,
    };
  }
}

function printResults(stats: SimulationStats): void {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 SIMULATION STRESS TEST RESULTS`);
  console.log(`${'='.repeat(60)}\n`);

  console.log(`Simulation:`);
  console.log(`  Total Agents:       ${stats.totalAgents}`);
  console.log(`  Ticks Processed:    ${stats.ticksProcessed}`);
  console.log(`  Total Time:         ${(stats.simulationTimeMs / 1000).toFixed(2)}s`);
  console.log(`  Real-time Ratio:    ${stats.realTimeRatio.toFixed(2)}x`);

  console.log(`\nTick Performance:`);
  console.log(`  Average:            ${stats.avgTickTimeMs.toFixed(3)}ms`);
  console.log(`  P95:                ${stats.p95TickTimeMs.toFixed(3)}ms`);
  console.log(`  Max:                ${stats.maxTickTimeMs.toFixed(3)}ms`);
  console.log(`  Min:                ${stats.minTickTimeMs.toFixed(3)}ms`);

  const targetTickTime = 1000 / CONFIG.TICK_RATE; // 50ms for 20 ticks/sec
  console.log(`  Target (${CONFIG.TICK_RATE} TPS):     ${targetTickTime.toFixed(1)}ms`);

  console.log(`\nProjectiles:`);
  console.log(`  Total Fired:        ${stats.totalProjectilesFired}`);
  console.log(`  Peak Active:        ${stats.peakProjectiles}`);

  console.log(`\nMemory:`);
  console.log(`  Heap Used:          ${stats.memoryUsageMB}MB`);

  // Verdict
  console.log(`\n${'='.repeat(60)}`);
  const canRunRealtime = stats.realTimeRatio >= 1.0;
  const ticksOk = stats.p95TickTimeMs < targetTickTime;

  if (canRunRealtime && ticksOk) {
    console.log(`✅ PASSED - Can simulate ${stats.totalAgents} agents in real-time`);
    console.log(`   Running ${stats.realTimeRatio.toFixed(1)}x faster than real-time`);
  } else {
    console.log(`❌ FAILED - Cannot maintain real-time simulation`);
    if (!canRunRealtime) {
      console.log(`   - Simulation too slow: ${stats.realTimeRatio.toFixed(2)}x (need ≥1.0x)`);
    }
    if (!ticksOk) {
      console.log(`   - Tick time too high: P95=${stats.p95TickTimeMs.toFixed(2)}ms (target: <${targetTickTime}ms)`);
    }
  }
  console.log(`${'='.repeat(60)}\n`);
}

// Run
const sim = new BattleSimulation();
const stats = sim.run();
printResults(stats);
