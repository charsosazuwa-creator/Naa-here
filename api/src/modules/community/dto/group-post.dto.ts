import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const TOPICS = [
  'service', 'product', 'invention', 'business_idea', 'industry_knowledge',
  'opportunity', 'event', 'training', 'question', 'general',
] as const;

// A product/invention post needs the IP-disclosure acknowledgment
// (AC: "posts about products/inventions must show an IP-disclosure
// reminder and require acknowledgment where configured").
export const IP_SENSITIVE_TOPICS = new Set(['product', 'invention']);

export class CreatePostDto {
  @IsIn(TOPICS)
  topic!: (typeof TOPICS)[number];

  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  body!: string;

  @IsOptional()
  @IsBoolean()
  ipAck?: boolean;
}

export class UpdatePostDto {
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  body!: string;
}

export class CreateCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;

  @IsOptional()
  @IsString()
  parentCommentId?: string;
}
