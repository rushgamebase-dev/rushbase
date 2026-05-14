import { Controller, Get } from '@nestjs/common';
import { execSync } from 'child_process';

@Controller()
export class HealthController {
  private readonly version: string;
  private readonly commitHash: string;
  private readonly startTime: Date;

  constructor() {
    this.startTime = new Date();
    try {
      this.commitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    } catch {
      this.commitHash = process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) || 'unknown';
    }
    this.version = '1.0.0';
  }

  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'rush-royale-server',
      version: this.version,
      commit: this.commitHash,
      uptime: Math.floor((Date.now() - this.startTime.getTime()) / 1000),
      timestamp: new Date().toISOString(),
    };
  }
}
