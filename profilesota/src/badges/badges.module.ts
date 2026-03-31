import { Module } from '@nestjs/common';
import { BadgesController } from './badges.controller';
import { BadgesService } from './badges.service';
import { BadgeEngineService } from './badge-engine.service';

@Module({
  controllers: [BadgesController],
  providers: [BadgesService, BadgeEngineService],
  exports: [BadgesService],
})
export class BadgesModule {}
