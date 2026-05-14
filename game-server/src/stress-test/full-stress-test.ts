/**
 * Full System Stress Test
 *
 * Testa o sistema completo:
 * 1. Simulação com 200 agentes
 * 2. Serialização de ticks
 * 3. Estimativa de broadcast
 *
 * Uso: npx ts-node src/stress-test/full-stress-test.ts
 */

interface Agent {
  id: string;
  agentId: string;
  owner: string;
  x: number;
  y: number;
  health: number;
  maxHealth: number;
  isAlive: boolean;
  rotation: number;
  color: string;
  skinId: string;
}

interface Projectile {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  rotation: number;
  type: string;
}

interface TickPayload {
  tick: number;
  agents: Agent[];
  projectiles: Projectile[];
  arenaRadius: number;
  phase: string;
  timestamp: number;
}

const CONFIG = {
  NUM_AGENTS: 200,
  NUM_CLIENTS: 200,
  NUM_TICKS: 1000,
  TICK_RATE: 20,
  PROJECTILES_PER_TICK: 50, // avg active projectiles
};

class FullStressTest {
  private agents: Agent[] = [];
  private projectiles: Projectile[] = [];

  run(): void {
    console.log(`\n🔥 FULL SYSTEM STRESS TEST`);
    console.log(`${'='.repeat(60)}`);
    console.log(`   Agents: ${CONFIG.NUM_AGENTS}`);
    console.log(`   Simulated Clients: ${CONFIG.NUM_CLIENTS}`);
    console.log(`   Ticks to simulate: ${CONFIG.NUM_TICKS}`);
    console.log(`${'='.repeat(60)}\n`);

    // Initialize test data
    this.initializeAgents();
    this.initializeProjectiles();

    // Test 1: Simulation performance
    console.log(`📊 Test 1: Simulation Performance`);
    const simResults = this.testSimulation();

    // Test 2: JSON serialization
    console.log(`\n📊 Test 2: JSON Serialization`);
    const serResults = this.testSerialization();

    // Test 3: Memory estimation
    console.log(`\n📊 Test 3: Memory & Bandwidth Estimation`);
    const memResults = this.testMemoryBandwidth();

    // Summary
    this.printSummary(simResults, serResults, memResults);
  }

  private initializeAgents(): void {
    for (let i = 0; i < CONFIG.NUM_AGENTS; i++) {
      const angle = (i / CONFIG.NUM_AGENTS) * Math.PI * 2;
      this.agents.push({
        id: `match-agent-${i}`,
        agentId: `${i + 1}`,
        owner: `0x${i.toString(16).padStart(40, '0')}`,
        x: Math.cos(angle) * 800,
        y: Math.sin(angle) * 800,
        health: 100,
        maxHealth: 100,
        isAlive: true,
        rotation: angle,
        color: `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')}`,
        skinId: 'default',
      });
    }
  }

  private initializeProjectiles(): void {
    for (let i = 0; i < CONFIG.PROJECTILES_PER_TICK; i++) {
      this.projectiles.push({
        id: `proj-${i}`,
        ownerId: `match-agent-${i % CONFIG.NUM_AGENTS}`,
        x: Math.random() * 1600 - 800,
        y: Math.random() * 1600 - 800,
        rotation: Math.random() * Math.PI * 2,
        type: 'standard',
      });
    }
  }

  private testSimulation(): { avgMs: number; p95Ms: number; maxMs: number } {
    const times: number[] = [];

    for (let tick = 0; tick < CONFIG.NUM_TICKS; tick++) {
      const start = performance.now();

      // Simulate agent updates
      for (const agent of this.agents) {
        if (!agent.isAlive) continue;

        // Movement
        agent.x += (Math.random() - 0.5) * 6;
        agent.y += (Math.random() - 0.5) * 6;
        agent.rotation += (Math.random() - 0.5) * 0.2;

        // Targeting (simplified N^2 check)
        let nearestDist = Infinity;
        for (const other of this.agents) {
          if (other.id === agent.id || !other.isAlive) continue;
          const dist = Math.hypot(other.x - agent.x, other.y - agent.y);
          if (dist < nearestDist) nearestDist = dist;
        }

        // Damage check
        if (Math.random() < 0.01) {
          agent.health -= 10;
          if (agent.health <= 0) agent.isAlive = false;
        }
      }

      // Update projectiles
      for (const proj of this.projectiles) {
        proj.x += Math.cos(proj.rotation) * 8;
        proj.y += Math.sin(proj.rotation) * 8;
      }

      times.push(performance.now() - start);
    }

    times.sort((a, b) => a - b);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const p95 = times[Math.floor(times.length * 0.95)];
    const max = times[times.length - 1];

    console.log(`   Avg tick time:  ${avg.toFixed(3)}ms`);
    console.log(`   P95 tick time:  ${p95.toFixed(3)}ms`);
    console.log(`   Max tick time:  ${max.toFixed(3)}ms`);
    console.log(`   Target:         ${(1000 / CONFIG.TICK_RATE).toFixed(1)}ms`);

    return { avgMs: avg, p95Ms: p95, maxMs: max };
  }

  private testSerialization(): { avgMs: number; payloadSize: number } {
    const times: number[] = [];
    let totalSize = 0;

    // Reset agents to alive for this test
    this.agents.forEach(a => { a.isAlive = true; a.health = 100; });

    for (let tick = 0; tick < 100; tick++) {
      const payload: TickPayload = {
        tick,
        agents: this.agents,
        projectiles: this.projectiles,
        arenaRadius: 1000 - tick,
        phase: 'combat',
        timestamp: Date.now(),
      };

      const start = performance.now();
      const json = JSON.stringify(payload);
      times.push(performance.now() - start);

      totalSize += json.length;
    }

    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    const avgSize = totalSize / 100;

    console.log(`   Avg serialize time: ${avgTime.toFixed(3)}ms`);
    console.log(`   Payload size:       ${(avgSize / 1024).toFixed(1)}KB`);
    console.log(`   Per second:         ${((avgSize * CONFIG.TICK_RATE) / 1024).toFixed(1)}KB/s per client`);

    return { avgMs: avgTime, payloadSize: avgSize };
  }

  private testMemoryBandwidth(): {
    memoryMB: number;
    bandwidthMbps: number;
    messagesPerSecond: number;
  } {
    // Estimate memory for 200 connected clients
    const clientStateSize = 1024; // 1KB per client connection state
    const agentStateSize = this.agents.length * 200; // ~200 bytes per agent
    const projectileStateSize = CONFIG.PROJECTILES_PER_TICK * 100;
    const bufferSize = 1024 * 1024; // 1MB buffer per client

    const totalMemory = (
      (clientStateSize * CONFIG.NUM_CLIENTS) +
      agentStateSize +
      projectileStateSize +
      (bufferSize * CONFIG.NUM_CLIENTS * 0.1) // 10% buffer utilization
    );

    // Bandwidth: payload * tick_rate * clients
    const payloadSize = 50 * 1024; // ~50KB per tick (estimated)
    const bandwidthBytesPerSec = payloadSize * CONFIG.TICK_RATE * CONFIG.NUM_CLIENTS;
    const bandwidthMbps = (bandwidthBytesPerSec * 8) / (1024 * 1024);

    // Messages per second
    const messagesPerSecond = CONFIG.TICK_RATE * CONFIG.NUM_CLIENTS;

    console.log(`   Estimated RAM:      ${(totalMemory / (1024 * 1024)).toFixed(1)}MB`);
    console.log(`   Bandwidth out:      ${bandwidthMbps.toFixed(1)} Mbps`);
    console.log(`   Messages/sec:       ${messagesPerSecond}`);

    return {
      memoryMB: totalMemory / (1024 * 1024),
      bandwidthMbps,
      messagesPerSecond,
    };
  }

  private printSummary(
    sim: { avgMs: number; p95Ms: number; maxMs: number },
    ser: { avgMs: number; payloadSize: number },
    mem: { memoryMB: number; bandwidthMbps: number; messagesPerSecond: number }
  ): void {
    const targetTickMs = 1000 / CONFIG.TICK_RATE;
    const totalTickTime = sim.avgMs + ser.avgMs;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 STRESS TEST SUMMARY`);
    console.log(`${'='.repeat(60)}\n`);

    console.log(`Performance Budget (per tick @ ${CONFIG.TICK_RATE} TPS):`);
    console.log(`   Available:          ${targetTickMs.toFixed(1)}ms`);
    console.log(`   Simulation:         ${sim.avgMs.toFixed(2)}ms (${((sim.avgMs / targetTickMs) * 100).toFixed(1)}%)`);
    console.log(`   Serialization:      ${ser.avgMs.toFixed(2)}ms (${((ser.avgMs / targetTickMs) * 100).toFixed(1)}%)`);
    console.log(`   Network I/O:        ~${(targetTickMs - totalTickTime).toFixed(1)}ms remaining`);
    console.log(`   Total Used:         ${totalTickTime.toFixed(2)}ms (${((totalTickTime / targetTickMs) * 100).toFixed(1)}%)`);

    console.log(`\nServer Requirements:`);
    console.log(`   RAM:                ${mem.memoryMB.toFixed(0)}MB minimum`);
    console.log(`   Bandwidth:          ${mem.bandwidthMbps.toFixed(0)} Mbps`);
    console.log(`   CPU:                Multi-core recommended for WebSocket I/O`);

    console.log(`\nClient Load:`);
    console.log(`   Data received:      ${((ser.payloadSize * CONFIG.TICK_RATE) / 1024).toFixed(1)}KB/s`);
    console.log(`   Messages received:  ${CONFIG.TICK_RATE}/sec`);

    // Verdict
    console.log(`\n${'='.repeat(60)}`);

    const simOk = sim.p95Ms < targetTickMs * 0.5; // 50% budget for sim
    const serOk = ser.avgMs < targetTickMs * 0.2; // 20% budget for serialization
    const bwOk = mem.bandwidthMbps < 1000; // Less than 1 Gbps

    if (simOk && serOk && bwOk) {
      console.log(`✅ SYSTEM CAN HANDLE ${CONFIG.NUM_AGENTS} AGENTS + ${CONFIG.NUM_CLIENTS} CLIENTS`);
      console.log(`\nRecommendations:`);
      console.log(`   - Railway: Use "Pro" plan for stable performance`);
      console.log(`   - Enable Redis for horizontal scaling (future)`);
      console.log(`   - Monitor CPU usage during peak`);
    } else {
      console.log(`⚠️  POTENTIAL BOTTLENECKS DETECTED`);
      if (!simOk) console.log(`   - Simulation too slow: ${sim.p95Ms.toFixed(2)}ms P95`);
      if (!serOk) console.log(`   - Serialization too slow: ${ser.avgMs.toFixed(2)}ms`);
      if (!bwOk) console.log(`   - Bandwidth too high: ${mem.bandwidthMbps.toFixed(0)} Mbps`);
      console.log(`\nOptimizations needed:`);
      console.log(`   - Consider binary protocol (MessagePack) instead of JSON`);
      console.log(`   - Implement delta updates (only send changes)`);
      console.log(`   - Use spatial partitioning for collision detection`);
    }

    console.log(`${'='.repeat(60)}\n`);
  }
}

// Run
const test = new FullStressTest();
test.run();
