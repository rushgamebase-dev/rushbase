import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { BetResolvedEvent } from '../stats/stats.service';

interface MarketResolvedPayload {
  marketAddress: string;
  actualCount: number;
  winningRangeIndex: number;
  threshold: number;
  description?: string;
  bets: Array<{
    user: string;
    rangeIndex: number;
    rangeLabel?: string;
    amount: string;
    txHash: string;
    claimed: boolean;
    claimAmount?: string;
  }>;
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(private readonly prisma: PrismaService, private readonly events: EventEmitter2) {}

  async handleMarketResolved(payload: MarketResolvedPayload) {
    this.logger.log(`Processing market ${payload.marketAddress} with ${payload.bets.length} bets`);
    let processed = 0, skipped = 0;

    for (const bet of payload.bets) {
      const walletLower = bet.user.toLowerCase();
      let user = await this.prisma.user.findUnique({ where: { wallet: walletLower } });
      if (!user) {
        user = await this.prisma.user.create({
          data: { wallet: walletLower, profile: { create: {} }, stats: { create: {} }, settings: { create: {} } },
        });
        this.logger.log(`Auto-created user for wallet ${walletLower}`);
      }

      const won = bet.rangeIndex === payload.winningRangeIndex;
      const claimAmount = bet.claimed && bet.claimAmount ? bet.claimAmount : null;
      const pnl = won && claimAmount
        ? (parseFloat(claimAmount) - parseFloat(bet.amount)).toString()
        : (-parseFloat(bet.amount)).toString();

      const event: BetResolvedEvent = {
        userId: user.id, wallet: walletLower, marketAddress: payload.marketAddress,
        rangeIndex: bet.rangeIndex, rangeLabel: bet.rangeLabel || `Range ${bet.rangeIndex}`,
        amount: bet.amount, txHash: bet.txHash, won, claimAmount, pnl,
        actualCount: payload.actualCount, threshold: payload.threshold,
        marketDesc: payload.description || '',
      };

      try { this.events.emit('bet.resolved', event); processed++; }
      catch (err) { this.logger.warn(`Failed to process bet ${bet.txHash}: ${err}`); skipped++; }
    }

    this.logger.log(`Market ${payload.marketAddress}: ${processed} processed, ${skipped} skipped`);
    return { processed, skipped };
  }
}
