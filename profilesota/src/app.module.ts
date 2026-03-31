import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { StatsModule } from './stats/stats.module';
import { BadgesModule } from './badges/badges.module';
import { ProgressionModule } from './progression/progression.module';
import { LeaderboardModule } from './leaderboard/leaderboard.module';
import { WebhookModule } from './webhook/webhook.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    UsersModule,
    StatsModule,
    BadgesModule,
    ProgressionModule,
    LeaderboardModule,
    WebhookModule,
    AdminModule,
  ],
})
export class AppModule {}
