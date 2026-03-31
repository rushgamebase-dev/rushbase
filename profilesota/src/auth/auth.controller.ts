import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { NonceRequestDto } from './dto/nonce-request.dto';
import { VerifyRequestDto } from './dto/verify-request.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('nonce')
  async nonce(@Body() dto: NonceRequestDto) {
    const nonce = await this.authService.generateNonce(dto.wallet);
    return { nonce };
  }

  @Post('verify')
  async verify(@Body() dto: VerifyRequestDto) {
    return this.authService.verify(dto.message, dto.signature);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() user: JwtPayload) {
    return this.authService.getMe(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout() {
    // JWT is stateless — client discards the token.
    // This endpoint exists for API contract completeness.
    return { success: true };
  }
}
