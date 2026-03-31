import { Module } from '@nestjs/common';
import { ProgressionService } from './progression.service';

@Module({
  providers: [ProgressionService],
  exports: [ProgressionService],
})
export class ProgressionModule {}
