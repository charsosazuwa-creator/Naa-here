import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * How far ahead to compute slots for, in days starting from now.
 * Bounded to keep the query (and the response) small -- this is
 * computed fresh on every request, not cached, so an unbounded range
 * would mean scanning an unbounded number of candidate slots.
 */
export class AvailabilitySlotsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  days?: number;
}
