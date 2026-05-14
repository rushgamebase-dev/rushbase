import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { GameModule } from './game/game.module';
import { BlockchainModule } from './blockchain/blockchain.module';
import { ArenaModule } from './arena/arena.module';
import { ProfileModule } from './profile/profile.module';
import { ArenaLedgerModule } from './arena-ledger/arena-ledger.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RedisModule } from './common/redis/redis.module';
import { AdminModule } from './admin/admin.module';
import { AiModule } from './ai/ai.module';
import { ChampionshipModule } from './championship/championship.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{
      ttl: 60000,   // 60 seconds window
      limit: 100,   // 100 requests per IP per minute
    }]),
    RedisModule,
    GameModule,
    BlockchainModule,
    ArenaModule,
    ProfileModule,
    ArenaLedgerModule,
    NotificationsModule,
    AdminModule,
    AiModule,
    ChampionshipModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
