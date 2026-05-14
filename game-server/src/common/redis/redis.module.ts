import { Global, Module } from '@nestjs/common';
import { RedisLockService } from './redis.service';

@Global()
@Module({
  providers: [RedisLockService],
  exports: [RedisLockService],
})
export class RedisModule {}
