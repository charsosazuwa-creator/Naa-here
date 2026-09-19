import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateBusinessDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsIn(['barber_salon', 'accommodation', 'artisan'])
  category!: 'barber_salon' | 'accommodation' | 'artisan';

  @IsIn(['NG', 'KE', 'GH', 'ZA'])
  countryCode!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;
}
