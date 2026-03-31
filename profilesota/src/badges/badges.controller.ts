import {
  Controller,
  Get,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { BadgesService } from './badges.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

@Controller()
export class BadgesController {
  constructor(private readonly badgesService: BadgesService) {}

  @Get('badges')
  async getAllBadges() {
    return this.badgesService.getAllBadges();
  }

  @Get('users/:id/badges')
  async getUserBadges(@Param('id') id: string) {
    return this.badgesService.getUserBadges(id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('users/me/badges/:badgeId')
  async toggleBadge(
    @CurrentUser() user: JwtPayload,
    @Param('badgeId') badgeId: string,
  ) {
    return this.badgesService.toggleBadgeDisplay(user.sub, badgeId);
  }
}
