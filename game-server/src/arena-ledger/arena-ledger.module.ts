// ============================================
// ARENA LEDGER MODULE
// ============================================
// Provides transparency and auditability for all arena battles.
// All data is derived from public blockchain events.

import { Module, Global } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { ArenaLedgerService } from './arena-ledger.service';
import { ArenaLedgerController } from './arena-ledger.controller';

@Global()
@Module({
  providers: [PrismaService, ArenaLedgerService],
  controllers: [ArenaLedgerController],
  exports: [PrismaService, ArenaLedgerService],
})
export class ArenaLedgerModule {}
