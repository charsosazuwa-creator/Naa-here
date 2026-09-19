import { IsEmail, IsIn, IsOptional, IsString, Matches, MinLength, ValidateIf } from 'class-validator';

/**
 * Password rule enforced here AND re-checked in AuthService.assertPasswordStrength
 * so the rule lives in one place (password.util.ts) and both layers agree
 * with it — a defence-in-depth pattern the design calls for at the API
 * and business-rules layers (section 10).
 */
export class RegisterDto {
  @ValidateIf((o: RegisterDto) => !o.phone)
  @IsEmail({}, { message: 'A valid email is required when no phone number is given.' })
  email?: string;

  @ValidateIf((o: RegisterDto) => !o.email)
  @Matches(/^\+[1-9]\d{7,14}$/, { message: 'Phone must be in E.164 format, e.g. +2348012345678.' })
  phone?: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @MinLength(1)
  fullName!: string;

  @IsOptional()
  @IsIn(['NG', 'KE', 'GH', 'ZA'])
  countryCode?: string;
}
