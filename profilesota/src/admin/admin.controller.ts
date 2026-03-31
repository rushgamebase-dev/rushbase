import { Body, Controller, Delete, Param, Post, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { GrantLabelDto } from './dto/grant-label.dto';
import { GrantBadgeDto } from './dto/grant-badge.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post('labels')
  async grantLabel(@CurrentUser() caller: JwtPayload, @Body() dto: GrantLabelDto) {
    this.adminService.assertAdmin(caller.wallet);
    return this.adminService.grantLabel(dto.userId, dto.label, caller.wallet, dto.color, dto.icon);
  }

  @Delete('labels/:id')
  async removeLabel(@CurrentUser() caller: JwtPayload, @Param('id') id: string) {
    this.adminService.assertAdmin(caller.wallet);
    return this.adminService.removeLabel(id);
  }

  @Post('badges/grant')
  async grantBadge(@CurrentUser() caller: JwtPayload, @Body() dto: GrantBadgeDto) {
    this.adminService.assertAdmin(caller.wallet);
    return this.adminService.grantBadge(dto.userId, dto.badgeSlug, caller.wallet);
  }
}
