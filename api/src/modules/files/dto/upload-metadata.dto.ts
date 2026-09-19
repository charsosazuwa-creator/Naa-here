import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min, MinLength } from 'class-validator';

const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MiB

/**
 * This milestone accepts pre-computed upload metadata rather than raw
 * bytes: object-storage direct-upload (presigned URL) wiring is
 * environment-specific and deferred, per section 6's storage layer.
 * The API still enforces the type/size checks BR-SEC-01 and BR-015
 * call for, against whatever storageKey the client already uploaded to.
 */
export class UploadMetadataDto {
  @IsString()
  @MinLength(1)
  storageKey!: string;

  @IsIn(ALLOWED_CONTENT_TYPES)
  contentType!: (typeof ALLOWED_CONTENT_TYPES)[number];

  @IsInt()
  @Min(1)
  @Max(MAX_UPLOAD_BYTES)
  byteSize!: number;

  @IsOptional()
  @IsUUID()
  tenantId?: string;
}
