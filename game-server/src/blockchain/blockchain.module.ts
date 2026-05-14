// ============================================
// BLOCKCHAIN MODULE - NestJS module for blockchain integration
// ============================================

import { Module, forwardRef } from '@nestjs/common';
import { BlockchainService } from './blockchain.service';
import { EventListenerService } from './event-listener.service';
import { ContractWriterService } from './contract-writer.service';
import { GameModule } from '../game/game.module';
import { ArenaModule } from '../arena/arena.module';
import { ArenaLedgerModule } from '../arena-ledger/arena-ledger.module';

@Module({
  imports: [
    forwardRef(() => GameModule),
    forwardRef(() => ArenaModule),
    ArenaLedgerModule, // For PrismaService (checkpoint persistence)
  ],
  providers: [BlockchainService, EventListenerService, ContractWriterService],
  exports: [BlockchainService, EventListenerService, ContractWriterService],
})
export class BlockchainModule {}
