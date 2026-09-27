import { IsOptional, IsString, MaxLength } from 'class-validator';

// Empty string clears the field (BusinessService.updateLicenseNumber
// treats a blank/whitespace-only value as null) rather than leaving
// it required-non-empty, since this field is optional by design.
export class UpdateLicenseNumberDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  licenseNumber?: string;
}
