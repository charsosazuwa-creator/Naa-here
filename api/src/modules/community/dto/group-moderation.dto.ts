import { IsIn, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateReportDto {
  @IsIn(['post', 'comment'])
  targetType!: 'post' | 'comment';

  @IsUUID()
  targetId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reason!: string;
}

export class DecideReportDto {
  @IsIn(['retained', 'hidden', 'removed'])
  decision!: 'retained' | 'hidden' | 'removed';

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reason!: string;
}
