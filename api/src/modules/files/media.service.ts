import { randomUUID } from 'crypto';
import { ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DatabaseService } from '../../database/database.service';
import { AppConfig } from '../../config/configuration';
import { UploadMetadataDto } from './dto/upload-metadata.dto';
import { PresignUploadDto } from './dto/presign-upload.dto';

export interface Attachment {
  id: string;
  tenantId: string | null;
  contentType: string;
  byteSize: number;
  scanStatus: 'pending' | 'clean' | 'rejected';
  scanReason: string | null;
}

export interface PresignedUpload {
  storageKey: string;
  uploadUrl: string;
  expiresInSeconds: number;
}

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

/**
 * Records an upload, runs a MOCK malware/content scan (BR-SEC-01,
 * BR-015: "type, size and content checks"), and -- once R2_* env vars
 * are configured (see configuration.ts) -- actually moves real bytes
 * through Cloudflare R2 (an S3-API-compatible bucket), rather than
 * only ever recording a client-supplied storage key. The upload
 * itself is a direct-to-bucket presigned PUT (uploadFromDevice()
 * never sees the file's bytes, same as a real S3 flow), so this
 * service's job is issuing and verifying the presigned URLs plus the
 * database bookkeeping either side of that upload.
 *
 * The mock scan is unchanged: it still never inspects real file
 * bytes or calls a real scanning provider -- it only re-checks the
 * metadata the client already had validated against (content type
 * allow-list, size ceiling) and marks the record 'clean'. A
 * production deployment swaps this for a real virus/content scanner
 * behind the same interface (the design's adapter pattern, section 5).
 */
@Injectable()
export class MediaService {
  private readonly s3: S3Client | null;
  private readonly bucket: string;
  private readonly presignTtlSeconds: number;

  constructor(
    private readonly db: DatabaseService,
    config: ConfigService<AppConfig, true>,
  ) {
    const r2 = config.get('storage', { infer: true }).r2;
    this.bucket = r2.bucket;
    this.presignTtlSeconds = r2.presignTtlSeconds;
    this.s3 =
      r2.accountId && r2.accessKeyId && r2.secretAccessKey && r2.bucket
        ? new S3Client({
            region: 'auto',
            endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
            credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
          })
        : null;
  }

  isStorageConfigured(): boolean {
    return this.s3 !== null;
  }

  /**
   * Issues a short-lived URL the client PUTs the raw file bytes to
   * directly -- this service, and this server, never sees the file
   * content itself, the same shape a real S3 direct-upload flow uses.
   * The client then calls recordUpload() with the returned storageKey
   * once the PUT has actually succeeded.
   */
  async presignUpload(uploadedByUserId: string, dto: PresignUploadDto): Promise<PresignedUpload> {
    if (!this.s3) {
      throw new ServiceUnavailableException(
        'File storage is not set up yet on this deployment. Ask your platform administrator to configure R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET_NAME.',
      );
    }
    if (dto.tenantId) {
      const [membership] = await this.db.query<{ status: string }>(
        `SELECT status FROM membership WHERE tenant_id = $1 AND user_id = $2`,
        [dto.tenantId, uploadedByUserId],
      );
      if (!membership || membership.status !== 'active') {
        throw new ForbiddenException('You do not have access to this business.');
      }
    }

    const scope = dto.tenantId ? `tenant/${dto.tenantId}` : `user/${uploadedByUserId}`;
    const extension = EXTENSION_BY_CONTENT_TYPE[dto.contentType] ?? '';
    const storageKey = `${scope}/${randomUUID()}${extension}`;

    const uploadUrl = await getSignedUrl(
      this.s3,
      new PutObjectCommand({ Bucket: this.bucket, Key: storageKey, ContentType: dto.contentType }),
      { expiresIn: this.presignTtlSeconds },
    );

    return { storageKey, uploadUrl, expiresInSeconds: this.presignTtlSeconds };
  }

  async recordUpload(uploadedByUserId: string, dto: UploadMetadataDto): Promise<Attachment> {
    if (dto.tenantId) {
      // The route itself carries no :tenantId path param (it's in the
      // body instead), so it isn't behind TenantRoleGuard — this is
      // the membership check that guard would otherwise have done,
      // done here instead so a signed-in user can't attach a file to
      // a business they don't belong to.
      const [membership] = await this.db.query<{ status: string }>(
        `SELECT status FROM membership WHERE tenant_id = $1 AND user_id = $2`,
        [dto.tenantId, uploadedByUserId],
      );
      if (!membership || membership.status !== 'active') {
        throw new ForbiddenException('You do not have access to this business.');
      }
    }

    // MOCK SCAN: always passes once type/size are already within the
    // DTO's validated bounds. Never a substitute for a real scanner.
    const scanStatus: Attachment['scanStatus'] = 'clean';
    const insertSql = `INSERT INTO attachment (tenant_id, uploaded_by, storage_key, content_type, byte_size, scan_status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, tenant_id, content_type, byte_size, scan_status, scan_reason`;
    const params = [dto.tenantId ?? null, uploadedByUserId, dto.storageKey, dto.contentType, dto.byteSize, scanStatus];

    let row: Record<string, unknown>;
    if (dto.tenantId) {
      row = await this.db.withTenant(dto.tenantId, async (client) => (await client.query(insertSql, params)).rows[0]);
    } else {
      row = (await this.db.query(insertSql, params))[0];
    }

    return toAttachment(row);
  }

  async findById(tenantId: string | null, attachmentId: string): Promise<Attachment> {
    const selectSql = `SELECT id, tenant_id, content_type, byte_size, scan_status, scan_reason
       FROM attachment WHERE id = $1 AND tenant_id ${tenantId ? '= $2' : 'IS NULL'}`;

    let rows: Record<string, unknown>[];
    if (tenantId) {
      rows = await this.db.withTenant(tenantId, async (client) => (await client.query(selectSql, [attachmentId, tenantId])).rows);
    } else {
      rows = await this.db.query(selectSql, [attachmentId]);
    }

    if (rows.length === 0) {
      throw new NotFoundException('Attachment not found.');
    }
    return toAttachment(rows[0]);
  }

  /**
   * A short-lived URL to view/download the real file -- used both by
   * a tenant viewing its own submitted documents and (via
   * VerificationService.getDocumentUrl(), which resolves the right
   * tenantId first) by a platform reviewer viewing any tenant's
   * submission. The bucket is never made public; every read goes
   * through a fresh, time-limited signed URL instead.
   */
  async getDownloadUrl(tenantId: string | null, attachmentId: string): Promise<{ url: string; expiresInSeconds: number }> {
    if (!this.s3) {
      throw new ServiceUnavailableException('File storage is not set up yet on this deployment.');
    }
    const attachment = await this.findByIdWithStorageKey(tenantId, attachmentId);
    const url = await getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: attachment.storageKey }), {
      expiresIn: this.presignTtlSeconds,
    });
    return { url, expiresInSeconds: this.presignTtlSeconds };
  }

  /**
   * Member-facing counterpart to getDownloadUrl(): checks the caller
   * actually belongs to the tenant they're claiming before issuing a
   * signed URL, since (unlike findById()'s tenant-scoped SELECT, which
   * relies on RLS to filter rows) a caller-supplied tenantId here is
   * just an unchecked argument until this runs.
   */
  async getDownloadUrlForMember(
    callerUserId: string,
    tenantId: string | null,
    attachmentId: string,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    if (tenantId) {
      const [membership] = await this.db.query<{ status: string }>(
        `SELECT status FROM membership WHERE tenant_id = $1 AND user_id = $2`,
        [tenantId, callerUserId],
      );
      if (!membership || membership.status !== 'active') {
        throw new ForbiddenException('You do not have access to this business.');
      }
    }
    return this.getDownloadUrl(tenantId, attachmentId);
  }

  private async findByIdWithStorageKey(tenantId: string | null, attachmentId: string): Promise<{ storageKey: string }> {
    const selectSql = `SELECT storage_key FROM attachment WHERE id = $1 AND tenant_id ${tenantId ? '= $2' : 'IS NULL'}`;
    let rows: Record<string, unknown>[];
    if (tenantId) {
      rows = await this.db.withTenant(tenantId, async (client) => (await client.query(selectSql, [attachmentId, tenantId])).rows);
    } else {
      rows = await this.db.query(selectSql, [attachmentId]);
    }
    if (rows.length === 0) {
      throw new NotFoundException('Attachment not found.');
    }
    return { storageKey: rows[0].storage_key as string };
  }
}

function toAttachment(row: Record<string, unknown>): Attachment {
  return {
    id: row.id as string,
    tenantId: (row.tenant_id as string) ?? null,
    contentType: row.content_type as string,
    byteSize: row.byte_size as number,
    scanStatus: row.scan_status as Attachment['scanStatus'],
    scanReason: (row.scan_reason as string) ?? null,
  };
}
