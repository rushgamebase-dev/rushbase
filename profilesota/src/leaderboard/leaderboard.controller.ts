import { Controller, Get, Param, Query } from '@nestjs/common';
import { LeaderboardService } from './leaderboard.service';

@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  @Get(':type')
  async getLeaderboard(
    @Param('type') type: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.leaderboardService.getLeaderboard(
      type, page ? parseInt(page, 10) : 1,
      pageSize ? Math.min(parseInt(pageSize, 10), 100) : 25,
    );
  }
}
