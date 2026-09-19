import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class CreateAvailabilityRuleDto {
  @IsOptional()
  @IsUUID()
  serviceId?: string;

  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @Matches(TIME_PATTERN, { message: 'startTime must be HH:mm, 24-hour.' })
  startTime!: string;

  @Matches(TIME_PATTERN, { message: 'endTime must be HH:mm, 24-hour.' })
  endTime!: string;
}

export class CreateBlockedTimeDto {
  @IsOptional()
  @IsUUID()
  serviceId?: string;

  @IsDateString()
  startsAt!: string;

  @IsDateString()
  endsAt!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
