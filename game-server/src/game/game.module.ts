import { Module, forwardRef } from '@nestjs/common';
import { MatchService } from './match.service';
import { GameGateway } from './game.gateway';
import { GameController } from './game.controller';
import { LeaderboardService } from './leaderboard.service';
import { XPService } from './xp.service';
import { ArenaModule } from '../arena/arena.module';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [forwardRef(() => ArenaModule), forwardRef(() => BlockchainModule), AiModule],
  providers: [MatchService, GameGateway, LeaderboardService, XPService],
  controllers: [GameController],
  exports: [MatchService, GameGateway, LeaderboardService, XPService],
})
export class GameModule {}
