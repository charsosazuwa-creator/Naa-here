import { IsOptional, IsString, MinLength } from 'class-validator';

export class SuspendListingDto {
  @IsString()
  @MinLength(1)
  reason!: string;
}

export class ReinstateListingDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
