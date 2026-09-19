import { IsIn, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class SubmitVerificationDto {
  @IsString()
  @MinLength(1)
  documentType!: string;

  @IsUUID()
  attachmentId!: string;
}

export class DecideVerificationDto {
  @IsIn(['approved', 'rejected'])
  decision!: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  note?: string;
}
