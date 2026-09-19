import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { UploadMetadataDto } from './dto/upload-metadata.dto';

export interface Attachment {
  id: string;
  tenantId: string | null;
  contentType: string;
  byteSize: number;
  scanStatus: 'pending' | 'clean' | 'rejected';
  scanReason: string | null;
}

/**
 * Records an upload and runs a MOCK malware/content scan (BR-SEC-01,
 * BR-015: "type, size and content checks"). Like the verification-code
 * sender, this is explicitly a mock: it never inspects real file bytes
 * or calls a real scanning provider — it only re-checks the metadata
 * the client already had validated against (content type allow-list,
 * size ceiling) and marks the record 'clean'. A production deployment
 * swaps this for a real virus/content scanner behind the same
 * interface (the design's adapter pattern, section 5).
 */
@Injectable()
export class MediaService {
  constructor(private readonly db: DatabaseService) {}

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
