/**
 * WebSocket Stress Test - Simula 200 clientes conectando e recebendo ticks
 *
 * Uso: npx ts-node src/stress-test/websocket-stress.ts
 */

import { io, Socket } from 'socket.io-client';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';
const NUM_CLIENTS = 200;
const TEST_DURATION_MS = 60_000; // 1 minuto
const RAMP_UP_MS = 10_000; // 10 segundos pra subir todos

interface ClientStats {
  id: number;
  connected: boolean;
  ticksReceived: number;
  errors: number;
  latencies: number[];
  lastTickTime: number;
}

interface TestResults {
  totalClients: number;
  connectedClients: number;
  failedConnections: number;
  totalTicksReceived: number;
  avgTicksPerClient: number;
  avgLatency: number;
  p95Latency: number;
  p99Latency: number;
  maxLatency: number;
  tickRatePerSecond: number;
  memoryUsageMB: number;
  errors: string[];
}

class WebSocketStressTest {
  private clients: Map<number, Socket> = new Map();
  private stats: Map<number, ClientStats> = new Map();
  private errors: string[] = [];
  private startTime: number = 0;
  private matchId: string = 'stress-test-match';

  async run(): Promise<TestResults> {
    console.log(`\n🚀 Starting WebSocket Stress Test`);
    console.log(`   Server: ${SERVER_URL}`);
    console.log(`   Clients: ${NUM_CLIENTS}`);
    console.log(`   Duration: ${TEST_DURATION_MS / 1000}s`);
    console.log(`   Ramp-up: ${RAMP_UP_MS / 1000}s\n`);

    this.startTime = Date.now();

    // Ramp up clients gradually
    await this.rampUpClients();

    // Wait for test duration
    console.log(`\n⏳ Running test for ${TEST_DURATION_MS / 1000} seconds...`);
    await this.runTestPhase();

    // Collect results
    const results = this.collectResults();

    // Cleanup
    await this.cleanup();

    return results;
  }

  private async rampUpClients(): Promise<void> {
    const delayBetweenClients = RAMP_UP_MS / NUM_CLIENTS;

    console.log(`📈 Ramping up ${NUM_CLIENTS} clients...`);

    for (let i = 0; i < NUM_CLIENTS; i++) {
      this.createClient(i);

      if (i % 20 === 0) {
        const connected = Array.from(this.stats.values()).filter(s => s.connected).length;
        console.log(`   Connected: ${connected}/${i + 1}`);
      }

      await this.sleep(delayBetweenClients);
    }

    // Wait a bit for all connections to stabilize
    await this.sleep(2000);

    const connected = Array.from(this.stats.values()).filter(s => s.connected).length;
    console.log(`\n✅ Ramp-up complete: ${connected}/${NUM_CLIENTS} connected`);
  }

  private createClient(id: number): void {
    const stats: ClientStats = {
      id,
      connected: false,
      ticksReceived: 0,
      errors: 0,
      latencies: [],
      lastTickTime: 0,
    };
    this.stats.set(id, stats);

    try {
      const socket = io(SERVER_URL, {
        transports: ['websocket'],
        reconnection: false,
        timeout: 10000,
      });

      socket.on('connect', () => {
        stats.connected = true;
        // Subscribe to spectate
        socket.emit('spectate', { matchId: this.matchId });
      });

      socket.on('disconnect', () => {
        stats.connected = false;
      });

      socket.on('connect_error', (err) => {
        stats.errors++;
        this.errors.push(`Client ${id}: ${err.message}`);
      });

      socket.on('tick', (data: any) => {
        const now = Date.now();
        stats.ticksReceived++;

        if (stats.lastTickTime > 0) {
          const latency = now - stats.lastTickTime;
          stats.latencies.push(latency);

          // Keep only last 100 latencies to avoid memory bloat
          if (stats.latencies.length > 100) {
            stats.latencies.shift();
          }
        }
        stats.lastTickTime = now;
      });

      socket.on('match_state', () => {
        stats.ticksReceived++;
      });

      socket.on('error', (err: any) => {
        stats.errors++;
        this.errors.push(`Client ${id}: ${err}`);
      });

      this.clients.set(id, socket);
    } catch (err: any) {
      stats.errors++;
      this.errors.push(`Client ${id} creation failed: ${err.message}`);
    }
  }

  private async runTestPhase(): Promise<void> {
    const endTime = Date.now() + TEST_DURATION_MS;
    let lastReport = Date.now();

    while (Date.now() < endTime) {
      await this.sleep(1000);

      // Progress report every 10 seconds
      if (Date.now() - lastReport >= 10000) {
        const connected = Array.from(this.stats.values()).filter(s => s.connected).length;
        const totalTicks = Array.from(this.stats.values()).reduce((sum, s) => sum + s.ticksReceived, 0);
        const elapsed = (Date.now() - this.startTime) / 1000;
        const tickRate = totalTicks / elapsed;

        console.log(`   [${Math.round(elapsed)}s] Connected: ${connected} | Ticks: ${totalTicks} | Rate: ${tickRate.toFixed(1)}/s`);
        lastReport = Date.now();
      }
    }
  }

  private collectResults(): TestResults {
    const statsArray = Array.from(this.stats.values());
    const connected = statsArray.filter(s => s.connected).length;
    const totalTicks = statsArray.reduce((sum, s) => sum + s.ticksReceived, 0);

    // Collect all latencies
    const allLatencies: number[] = [];
    statsArray.forEach(s => allLatencies.push(...s.latencies));
    allLatencies.sort((a, b) => a - b);

    const avgLatency = allLatencies.length > 0
      ? allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length
      : 0;

    const p95Index = Math.floor(allLatencies.length * 0.95);
    const p99Index = Math.floor(allLatencies.length * 0.99);

    const elapsed = (Date.now() - this.startTime) / 1000;
    const memUsage = process.memoryUsage();

    return {
      totalClients: NUM_CLIENTS,
      connectedClients: connected,
      failedConnections: NUM_CLIENTS - connected,
      totalTicksReceived: totalTicks,
      avgTicksPerClient: totalTicks / NUM_CLIENTS,
      avgLatency: Math.round(avgLatency),
      p95Latency: allLatencies[p95Index] || 0,
      p99Latency: allLatencies[p99Index] || 0,
      maxLatency: allLatencies[allLatencies.length - 1] || 0,
      tickRatePerSecond: totalTicks / elapsed,
      memoryUsageMB: Math.round(memUsage.heapUsed / 1024 / 1024),
      errors: this.errors.slice(0, 10), // First 10 errors
    };
  }

  private async cleanup(): Promise<void> {
    console.log(`\n🧹 Cleaning up ${this.clients.size} connections...`);

    for (const socket of this.clients.values()) {
      socket.disconnect();
    }
    this.clients.clear();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Print results
function printResults(results: TestResults): void {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 STRESS TEST RESULTS`);
  console.log(`${'='.repeat(60)}\n`);

  console.log(`Connections:`);
  console.log(`  Total Clients:      ${results.totalClients}`);
  console.log(`  Connected:          ${results.connectedClients}`);
  console.log(`  Failed:             ${results.failedConnections}`);
  console.log(`  Success Rate:       ${((results.connectedClients / results.totalClients) * 100).toFixed(1)}%`);

  console.log(`\nThroughput:`);
  console.log(`  Total Ticks:        ${results.totalTicksReceived}`);
  console.log(`  Avg Ticks/Client:   ${results.avgTicksPerClient.toFixed(1)}`);
  console.log(`  Tick Rate:          ${results.tickRatePerSecond.toFixed(1)}/sec`);

  console.log(`\nLatency (between ticks):`);
  console.log(`  Average:            ${results.avgLatency}ms`);
  console.log(`  P95:                ${results.p95Latency}ms`);
  console.log(`  P99:                ${results.p99Latency}ms`);
  console.log(`  Max:                ${results.maxLatency}ms`);

  console.log(`\nResources:`);
  console.log(`  Memory (test):      ${results.memoryUsageMB}MB`);

  if (results.errors.length > 0) {
    console.log(`\n⚠️  Errors (first 10):`);
    results.errors.forEach(e => console.log(`  - ${e}`));
  }

  // Verdict
  console.log(`\n${'='.repeat(60)}`);
  const passed = results.connectedClients >= results.totalClients * 0.95
    && results.p95Latency < 100;

  if (passed) {
    console.log(`✅ PASSED - System can handle ${results.totalClients} concurrent users`);
  } else {
    console.log(`❌ FAILED - Performance issues detected`);
    if (results.connectedClients < results.totalClients * 0.95) {
      console.log(`   - Connection failures: ${results.failedConnections}`);
    }
    if (results.p95Latency >= 100) {
      console.log(`   - High latency: P95 = ${results.p95Latency}ms (target: <100ms)`);
    }
  }
  console.log(`${'='.repeat(60)}\n`);
}

// Run
const test = new WebSocketStressTest();
test.run()
  .then(printResults)
  .catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
  });
