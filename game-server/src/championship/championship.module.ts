import { Module, forwardRef } from '@nestjs/common';
import { ChampionshipController } from './championship.controller';
import { ChampionshipService } from './championship.service';
import { ChampionshipOrchestratorService } from './championship-orchestrator.service';
import { SwissPairingService } from './swiss-pairing.service';
import { TwitterVerificationService } from './twitter-verification.service';
import { GameModule } from '../game/game.module';
import { ArenaLedgerModule } from '../arena-ledger/arena-ledger.module';
import { BlockchainModule } from '../blockchain/blockchain.module';

@Module({
  imports: [forwardRef(() => GameModule), ArenaLedgerModule, BlockchainModule],
  controllers: [ChampionshipController],
  providers: [
    ChampionshipService,
    ChampionshipOrchestratorService,
    SwissPairingService,
    TwitterVerificationService,
  ],
  exports: [ChampionshipService],
})
export class ChampionshipModule {}
