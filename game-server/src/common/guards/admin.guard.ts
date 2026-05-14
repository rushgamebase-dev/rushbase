import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const adminKey = process.env.ADMIN_API_KEY || '';

    if (!adminKey) {
      this.logger.error('ADMIN_API_KEY not configured — blocking all admin requests');
      throw new UnauthorizedException('Admin access not configured');
    }

    const request = context.switchToHttp().getRequest();
    const providedKey = request.headers['x-admin-key'];

    if (!providedKey || typeof providedKey !== 'string') {
      this.logger.warn(`Unauthorized admin request: ${request.method} ${request.url}`);
      throw new UnauthorizedException('Invalid or missing X-ADMIN-KEY');
    }

    // Timing-safe comparison to prevent timing attacks
    const a = Buffer.from(providedKey, 'utf8');
    const b = Buffer.from(adminKey, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      this.logger.warn(`Unauthorized admin request: ${request.method} ${request.url}`);
      throw new UnauthorizedException('Invalid or missing X-ADMIN-KEY');
    }

    return true;
  }
}
