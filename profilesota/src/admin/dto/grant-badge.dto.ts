import { IsString } from 'class-validator';

export class GrantBadgeDto {
  @IsString()
  userId!: string;

  @IsString()
  badgeSlug!: string;
}
