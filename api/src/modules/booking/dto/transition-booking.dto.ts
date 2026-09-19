import { IsIn, IsOptional, IsString } from 'class-validator';

export class TransitionBookingDto {
  @IsIn(['in_progress', 'completed', 'no_show', 'cancelled'])
  status!: 'in_progress' | 'completed' | 'no_show' | 'cancelled';

  @IsOptional()
  @IsString()
  reason?: string;
}
