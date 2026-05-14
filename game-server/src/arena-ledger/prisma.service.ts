import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// Append connection pool params to DATABASE_URL if not already present
if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('connect_timeout')) {
  const sep = process.env.DATABASE_URL.includes('?') ? '&' : '?';
  process.env.DATABASE_URL += `${sep}connect_timeout=20&pool_timeout=20&connection_limit=20`;
}

const HEARTBEAT_INTERVAL = 15_000; // Ping DB every 15s
const RECONNECT_DELAY = 3_000;
const MAX_RECONNECT_FAILURES = 3; // After 3 failed reconnects, crash so Railway auto-restarts

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private consecutiveFailures = 0;
  private reconnectAttempts = 0;

  constructor() {
    super({
      log: ['error', 'warn'],
    });
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Database connected successfully');
      this.startHeartbeat();
    } catch (error) {
      this.logger.error('Failed to connect to database:', error);
      throw error; // Fail fast — don't start server with broken DB
    }
  }

  async onModuleDestroy() {
    this.stopHeartbeat();
    await this.$disconnect();
  }

  private startHeartbeat() {
    this.heartbeatTimer = setInterval(async () => {
      try {
        await this.$queryRaw`SELECT 1`;
        if (this.consecutiveFailures > 0) {
          this.logger.log(`Database heartbeat recovered after ${this.consecutiveFailures} failures`);
        }
        this.consecutiveFailures = 0;
      } catch (error) {
        this.consecutiveFailures++;
        this.logger.error(`Database heartbeat failed (${this.consecutiveFailures}x): ${(error as Error).message}`);

        if (this.consecutiveFailures >= 2) {
          this.logger.warn('2 consecutive heartbeat failures — reconnecting Prisma pool');
          await this.reconnect();
        }
      }
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async reconnect() {
    try {
      await this.$disconnect();
    } catch {
      // ignore disconnect errors
    }

    await new Promise((r) => setTimeout(r, RECONNECT_DELAY));

    try {
      await this.$connect();
      this.consecutiveFailures = 0;
      this.reconnectAttempts = 0;
      this.logger.log('Database reconnected successfully');
    } catch (error) {
      this.reconnectAttempts++;
      this.logger.error(`Database reconnect failed (${this.reconnectAttempts}/${MAX_RECONNECT_FAILURES}): ${(error as Error).message}`);

      if (this.reconnectAttempts >= MAX_RECONNECT_FAILURES) {
        this.logger.error(`${MAX_RECONNECT_FAILURES} reconnect attempts failed — crashing for Railway auto-restart`);
        process.exit(1);
      }
    }
  }
}
