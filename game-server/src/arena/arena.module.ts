// ============================================
// ARENA MODULE - Battle orchestration
// ============================================

import { Module, forwardRef, Global } from '@nestjs/common';
import { ArenaOrchestratorService } from './arena-orchestrator.service';
import { ResultHasherService } from './result-hasher.service';
import { ArenaPersistenceService } from './arena-persistence.service';
import { ArenaRecoveryService } from './arena-recovery.service';
import { VRFTriggerService } from './vrf-trigger.service';
import { ArenaScannerService } from './arena-scanner.service';
import { ArenaStoreService } from './arena-store.service';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { GameModule } from '../game/game.module';

@Global()
@Module({
  imports: [BlockchainModule, forwardRef(() => GameModule)],
  providers: [
    ArenaStoreService,
    ArenaPersistenceService,
    ArenaRecoveryService,
    ArenaOrchestratorService,
    ResultHasherService,
    VRFTriggerService,
    ArenaScannerService,
  ],
  exports: [
    ArenaStoreService,
    ArenaPersistenceService,
    ArenaRecoveryService,
    ArenaOrchestratorService,
    ResultHasherService,
    VRFTriggerService,
    ArenaScannerService,
  ],
})
export class ArenaModule {}
