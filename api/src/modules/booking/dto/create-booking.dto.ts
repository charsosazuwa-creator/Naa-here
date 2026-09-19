import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * The booking's customer is always the signed-in caller (JwtAuthGuard
 * gives us their user id) — this milestone does not support a staff
 * member booking on behalf of a walk-in customer_profile that has no
 * linked_user_id; that is a provider-portal feature for a later phase.
 */
export class CreateBookingDto {
  @IsUUID()
  serviceId!: string;

  @IsDateString()
  startsAt!: string;

  @IsDateString()
  endsAt!: string;

  @IsOptional()
  @IsUUID()
  staffUserId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class RescheduleBookingDto {
  @IsDateString()
  startsAt!: string;

  @IsDateString()
  endsAt!: string;
}

export class CancelBookingDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
