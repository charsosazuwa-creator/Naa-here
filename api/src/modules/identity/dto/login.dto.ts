import { IsString, MinLength, ValidateIf } from 'class-validator';

export class LoginDto {
  @ValidateIf((o: LoginDto) => !o.phone)
  @IsString()
  email?: string;

  @ValidateIf((o: LoginDto) => !o.email)
  @IsString()
  phone?: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

export class RefreshDto {
  @IsString()
  refreshToken!: string;
}

export class LogoutDto {
  @IsString()
  refreshToken!: string;
}

export class ForgotPasswordDto {
  @ValidateIf((o: ForgotPasswordDto) => !o.phone)
  @IsString()
  email?: string;

  @ValidateIf((o: ForgotPasswordDto) => !o.email)
  @IsString()
  phone?: string;
}

export class ResetPasswordDto {
  @ValidateIf((o: ResetPasswordDto) => !o.phone)
  @IsString()
  email?: string;

  @ValidateIf((o: ResetPasswordDto) => !o.email)
  @IsString()
  phone?: string;

  @IsString()
  code!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}
