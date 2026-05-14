import { Module } from '@nestjs/common';
import { GameModule } from '../game/game.module';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { AdminController } from './admin.controller';

@Module({
  imports: [GameModule, BlockchainModule],
  controllers: [AdminController],
})
export class AdminModule {}
