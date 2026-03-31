import { IsString } from 'class-validator';

export class VerifyRequestDto {
  @IsString()
  message!: string;

  @IsString()
  signature!: string;
}
