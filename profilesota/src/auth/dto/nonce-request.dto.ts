import { IsString, Matches } from 'class-validator';

export class NonceRequestDto {
  @IsString()
  @Matches(/^0x[a-fA-F0-9]{40}$/, { message: 'Invalid Ethereum address' })
  wallet!: string;
}
