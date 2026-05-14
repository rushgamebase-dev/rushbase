import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://www.rushgame.vip';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

// Arena open/close animation (202602070052.mp4)
const ARENA_VIDEO_FILE_ID =
  'BAACAgEAAyEGAATcQAABTgACArpphrrWglpAvmtfiBtMVNex9CdMaQACEQoAAveVOUS4Lrf4lkHcszoE';

// Winner announcement animation (Robot_Victory_Royale_Esports_Commercial)
const WINNER_VIDEO_FILE_ID =
  'BAACAgEAAyEGAATcQAABTgACAr5phrsylldgT4TlgOQuM4TpuKFLaQACEwoAAveVOURyhet5eYMv2ToE';

// CHAMPION CROWNED fires at simulation_complete — same instant as battleState: COMPLETE.
// No separate prizes_distributed message needed.

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly sentTxHashes = new Set<string>();

  @OnEvent('arena.created.live')
  async onArenaCreated(payload: {
    arenaId: string;
    entryFee: string;
    minPlayers: number;
    maxPlayers: number;
    tier: string;
    txHash: string;
  }) {
    if (this.isDuplicate(payload.txHash)) return;

    const entryEth = (Number(payload.entryFee) / 1e18).toFixed(4);
    const arenaUrl = `${FRONTEND_URL}/arenas/${payload.arenaId}`;

    const text =
      `<b>ARENA #${payload.arenaId}</b>  —  Registration Open\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `Entry Fee     <b>${entryEth} ETH</b>\n` +
      `Players        ${payload.minPlayers}–${payload.maxPlayers}\n` +
      `Tier              ${payload.tier}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `<a href="${arenaUrl}">Join Arena</a>`;

    await this.sendAnimation(ARENA_VIDEO_FILE_ID, text);
  }

  @OnEvent('arena.locked.live')
  async onArenaLocked(payload: {
    arenaId: string;
    participantCount: number;
    txHash: string;
  }) {
    if (this.isDuplicate(payload.txHash)) return;

    const text =
      `<b>ARENA #${payload.arenaId}</b>  —  Registration Closed\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `${payload.participantCount} players locked in.\n` +
      `Battle starting now.`;

    await this.sendAnimation(ARENA_VIDEO_FILE_ID, text);
  }

  @OnEvent('arena.simulation_complete')
  async onBattleComplete(payload: {
    arenaId: string;
    simulationData: string;
    winnerId?: string;
    winnerOwner?: string;
    prizePool?: string;
  }) {
    // CHAMPION CROWNED fires immediately when simulation ends — don't wait for on-chain
    const arenaUrl = `${FRONTEND_URL}/arenas/${payload.arenaId}`;

    const agentLine = payload.winnerId
      ? `Agent          <b>#${payload.winnerId}</b>\n`
      : '';

    const shortWallet = payload.winnerOwner
      ? `${payload.winnerOwner.slice(0, 6)}...${payload.winnerOwner.slice(-4)}`
      : '';
    const walletLine = shortWallet
      ? `Winner        <code>${shortWallet}</code>\n`
      : '';

    // Estimate prize: prizePool * 95% (5% protocol fee)
    let prizeLine = '';
    if (payload.prizePool && payload.prizePool !== '0') {
      const pool = BigInt(payload.prizePool);
      const prize = pool * 95n / 100n;
      const prizeEth = (Number(prize) / 1e18).toFixed(4);
      prizeLine = `Prize            <b>~${prizeEth} ETH</b>\n`;
    }

    const text =
      `<b>ARENA #${payload.arenaId}</b>  —  CHAMPION CROWNED\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      agentLine +
      walletLine +
      prizeLine +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `<a href="${arenaUrl}">Watch Replay</a>`;

    await this.sendAnimation(WINNER_VIDEO_FILE_ID, text);
  }

  // prizes_distributed: no separate Telegram message needed.
  // CHAMPION CROWNED already fires at simulation_complete with winner + prize estimate.

  private isDuplicate(txHash: string): boolean {
    if (this.sentTxHashes.has(txHash)) return true;
    this.sentTxHashes.add(txHash);
    // Cap memory — keep last 500
    if (this.sentTxHashes.size > 500) {
      const first = this.sentTxHashes.values().next().value;
      if (first) this.sentTxHashes.delete(first);
    }
    return false;
  }

  private async sendAnimation(fileId: string, caption: string): Promise<void> {
    if (!BOT_TOKEN || !CHAT_ID) {
      this.logger.warn('Telegram not configured (missing BOT_TOKEN or CHAT_ID)');
      return;
    }

    try {
      const res = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/sendAnimation`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: CHAT_ID,
            animation: fileId,
            caption,
            parse_mode: 'HTML',
          }),
        },
      );

      if (!res.ok) {
        const err = await res.text();
        this.logger.error(`Telegram send failed: ${res.status} ${err}`);
      }
    } catch (error) {
      this.logger.error(`Telegram send error: ${error.message}`);
    }
  }

}
