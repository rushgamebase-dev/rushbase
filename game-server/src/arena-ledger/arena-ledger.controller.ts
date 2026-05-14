// ============================================
// ARENA LEDGER CONTROLLER - Public API for transparency
// ============================================
// All battles are executed on-chain.
// This page is a read-only index built from public blockchain events.

import { Controller, Get, Param, Query } from '@nestjs/common';
import { ArenaLedgerService, LedgerArenaDetail, LedgerStats } from './arena-ledger.service';

@Controller('ledger')
export class ArenaLedgerController {
  constructor(private readonly ledgerService: ArenaLedgerService) {}

  /**
   * GET /api/ledger
   * Paginated history of all arenas
   */
  @Get()
  async getHistory(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('tier') tier?: string,
    @Query('state') state?: string,
    @Query('creator') creator?: string,
    @Query('winner') winner?: string,
    @Query('owner') owner?: string,
  ): Promise<{
    arenas: any[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const result = await this.ledgerService.getHistory({
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
      tier,
      state,
      creator,
      winner,
      owner,
    });

    return {
      ...result,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    };
  }

  /**
   * GET /api/ledger/stats
   * Aggregated statistics
   */
  @Get('stats')
  async getStats(): Promise<LedgerStats> {
    return this.ledgerService.getStats();
  }

  /**
   * GET /api/ledger/earnings/:address
   * Real ETH earnings for a wallet address
   */
  @Get('earnings/:address')
  async getEarnings(@Param('address') address: string) {
    return this.ledgerService.getEarningsByOwner(address.toLowerCase());
  }

  /**
   * GET /api/ledger/:arenaId
   * Full arena detail with all proofs
   */
  @Get(':arenaId')
  async getArenaDetail(
    @Param('arenaId') arenaId: string,
  ): Promise<LedgerArenaDetail | { error: string }> {
    const detail = await this.ledgerService.getArenaDetail(arenaId);

    if (!detail) {
      return { error: 'Arena not found in ledger' };
    }

    return detail;
  }

  /**
   * GET /api/ledger/unclaimed-refunds/:address
   * Returns cancelled arenas where the address has unclaimed refunds
   */
  @Get('unclaimed-refunds/:address')
  async getUnclaimedRefunds(
    @Param('address') address: string,
  ): Promise<{ refunds: any[] }> {
    const refunds = await this.ledgerService.getUnclaimedRefunds(address.toLowerCase());
    return { refunds };
  }

  /**
   * GET /api/ledger/winner/:winnerId
   * History of wins by agent ID
   */
  @Get('winner/:winnerId')
  async getWinnerHistory(
    @Param('winnerId') winnerId: string,
    @Query('limit') limit?: string,
  ): Promise<any[]> {
    return this.ledgerService.getWinnerHistory(
      winnerId,
      limit ? parseInt(limit, 10) : 10,
    );
  }
}
