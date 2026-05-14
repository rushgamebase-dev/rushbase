// ============================================
// PROFILE MODULE
// ============================================

import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ProfileService } from './profile.service';
import { ProfileController } from './profile.controller';
import { BlockchainModule } from '../blockchain/blockchain.module';

@Module({
  imports: [
    MulterModule.register({
      storage: memoryStorage(),
      limits: {
        fileSize: 500 * 1024, // 500KB
      },
    }),
    BlockchainModule,
  ],
  controllers: [ProfileController],
  providers: [ProfileService],
  exports: [ProfileService],
})
export class ProfileModule {}
