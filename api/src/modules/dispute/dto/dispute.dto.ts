import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

// Kept as a fixed set of short reason codes (rather than free text)
// so a case is easy to triage/report on — "provide details" (AC1) is
// what the separate, optional `details` field is for. Not enforced as
// a DB CHECK constraint: existing disputes raised before this list
// existed keep their original free-text reason unchanged.
export const DISPUTE_REASONS = [
  'service_not_provided',
  'quality_issue',
  'no_show',
  'payment_issue',
  'safety_concern',
  'other',
] as const;

export class CreateDisputeDto {
  @IsIn(DISPUTE_REASONS)
  reason!: (typeof DISPUTE_REASONS)[number];

  @IsOptional()
  @IsString()
  @MinLength(1)
  details?: string;
}

export class ResolveDisputeDto {
  @IsIn(['resolved_customer', 'resolved_provider', 'dismissed'])
  resolution!: 'resolved_customer' | 'resolved_provider' | 'dismissed';

  @IsOptional()
  @IsString()
  notes?: string;
}
