import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { ALLOWED_CONTENT_TYPES, MAX_UPLOAD_BYTES } from './upload-metadata.dto';

/**
 * Requests a short-lived, direct-to-object-storage upload URL (see
 * media.service.ts's presignUpload). Same type/size bounds as
 * UploadMetadataDto -- the metadata the client posts to POST /media
 * afterwards must match what it actually uploaded, and both ends are
 * checked against the same allow-list.
 */
export class PresignUploadDto {
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
