import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateLocationDto {
  @IsString()
  @MinLength(1)
  label!: string;

  @IsString()
  @MinLength(1)
  addressLine!: string;

  @IsString()
  @MinLength(1)
  city!: string;

  @IsIn(['NG', 'KE', 'GH', 'ZA'])
  countryCode!: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
