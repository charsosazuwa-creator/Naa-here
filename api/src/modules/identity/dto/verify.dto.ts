import { IsIn, IsString, IsUUID, Length } from 'class-validator';

export class VerifyDto {
  @IsUUID()
  userId!: string;

  @IsIn(['email_verify', 'phone_verify'])
  purpose!: 'email_verify' | 'phone_verify';

  @IsString()
  @Length(6, 6)
  code!: string;
}

export class ResendVerificationDto {
  @IsUUID()
  userId!: string;

  @IsIn(['email_verify', 'phone_verify'])
  purpose!: 'email_verify' | 'phone_verify';
}
