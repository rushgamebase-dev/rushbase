import {
  Body, Controller, Get, Param, Patch, Query, UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMe(@CurrentUser() user: JwtPayload) {
    return this.usersService.getMe(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  async updateMe(@CurrentUser() user: JwtPayload, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(user.sub, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/check-handle')
  async checkHandle(@Query('handle') handle: string) {
    const available = await this.usersService.checkHandle(handle);
    return { handle, available };
  }

  @Get('batch')
  async getBatch(@Query('addresses') addresses: string) {
    const list = addresses ? addresses.split(',').filter(Boolean) : [];
    return this.usersService.getBatch(list);
  }

  @Get('address/:address')
  async getByAddress(@Param('address') address: string) {
    return this.usersService.getByAddress(address);
  }

  @Get(':id/card')
  async getCard(@Param('id') id: string) {
    return this.usersService.getCard(id);
  }

  @Get(':handle')
  async getByHandle(@Param('handle') handle: string) {
    return this.usersService.getByHandle(handle);
  }
}
