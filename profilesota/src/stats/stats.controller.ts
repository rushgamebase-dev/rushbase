import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { StatsService } from './stats.service';
import { ProgressionService } from '../progression/progression.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

@Controller()
export class StatsController {
  constructor(
    private readonly statsService: StatsService,
    private readonly progressionService: ProgressionService,
  ) {}

  @Get('levels/config')
  getLevelsConfig() {
    return this.progressionService.getLevelsConfig();
  }

  @Get('users/:id/stats')
  async getUserStats(@Param('id') id: string) {
    return this.statsService.getStats(id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('users/me/bets')
  async getMyBets(
    @CurrentUser() user: JwtPayload,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
  ) {
    return this.statsService.getBetHistory(
      user.sub,
      page ? parseInt(page, 10) : 1,
      pageSize ? Math.min(parseInt(pageSize, 10), 50) : 20,
      status,
    );
  }

  @Get('users/:id/bets')
  async getUserBets(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
  ) {
    return this.statsService.getBetHistory(
      id,
      page ? parseInt(page, 10) : 1,
      pageSize ? Math.min(parseInt(pageSize, 10), 50) : 20,
      status,
    );
  }
}
