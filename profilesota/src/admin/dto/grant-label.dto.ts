import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class GrantLabelDto {
  @IsString()
  userId!: string;

  @IsString()
  @MaxLength(30)
  label!: string;

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'Color must be hex (#RRGGBB)' })
  color?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  icon?: string;
}
