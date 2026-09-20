import { BadRequestException, ForbiddenException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdirSync, unlinkSync } from 'fs';
import { writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import type { PoolClient } from 'pg';
import { AuditService } from '../audit/audit.service';

// Same shape as marketplace/listing-image.service.ts's UploadedListingImage
// — what @nestjs/platform-express's FileInterceptor hands @UploadedFile()
// with no `storage` option (in-memory buffering). No @types/multer needed.
export interface UploadedDisputeFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface DisputeAttachmentRow {
  id: string;
  storage_key: string;
  content_type: string;
  byte_size: number;
  uploaded_by: string;
  created_at: string;
}

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_DISPUTE = 5;

const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/**
 * Evidence attachments for a dispute (US-056 AC "supporting files may
 * be attached"). Real bytes on disk under UPLOADS_DIR, same pattern
 * as marketplace/listing-image.service.ts and for the same reason
 * (attachment.service.ts's FilesModule is metadata-only, assuming
 * external object storage this project doesn't have wired up).
 * Broader allowed types than listing images (JPEG/PNG/WebP/PDF, not
 * just images) since evidence is often a receipt or a document, not a
 * photo.
 *
 * Every method takes the caller's already-open transaction client
 * (DisputeService always runs dispute writes through db.withTenant or
 * db.withUser) since dispute_attachment's RLS policy keys off that
 * same session context.
 */
@Injectable()
export class DisputeAttachmentService {
  constructor(private readonly audit: AuditService) {}

  private uploadsDir(): string {
    const dir = process.env.UPLOADS_DIR;
    if (!dir) {
      throw new Error('UPLOADS_DIR is not set — main.ts should have set it during bootstrap.');
    }
    return dir;
  }

  async add(
    client: PoolClient,
    actorUserId: string,
    disputeId: string,
    file: UploadedDisputeFile | undefined,
  ): Promise<DisputeAttachmentRow> {
    if (!file) {
      throw new BadRequestException('No file was provided (expected multipart field "file").');
    }
    if (!ALLOWED_TYPES.has(file.mimetype)) {
      throw new UnprocessableEntityException('Only JPEG, PNG, WebP images or PDF files are accepted.');
    }
    if (file.size > MAX_BYTES) {
      throw new UnprocessableEntityException('Files must be 10MB or smaller.');
    }

    const { rows: countRows } = await client.query(
      `SELECT count(*)::int AS count FROM dispute_attachment WHERE dispute_id = $1`,
      [disputeId],
    );
    if ((countRows[0] as { count: number }).count >= MAX_ATTACHMENTS_PER_DISPUTE) {
      throw new UnprocessableEntityException(`A dispute can have at most ${MAX_ATTACHMENTS_PER_DISPUTE} attachments.`);
    }

    const extension = EXTENSION_BY_TYPE[file.mimetype];
    const storageKey = `disputes/${disputeId}/${randomUUID()}.${extension}`;
    const fullPath = join(this.uploadsDir(), storageKey);
    mkdirSync(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, file.buffer);

    const { rows } = await client.query(
      `INSERT INTO dispute_attachment (dispute_id, storage_key, content_type, byte_size, uploaded_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, storage_key, content_type, byte_size, uploaded_by, created_at`,
      [disputeId, storageKey, file.mimetype, file.size, actorUserId],
    );

    await this.audit.record(
      { actorUserId, action: 'dispute.attachment.add', targetType: 'dispute', targetId: disputeId },
      client,
    );
    return rows[0] as DisputeAttachmentRow;
  }

  async remove(client: PoolClient, actorUserId: string, disputeId: string, attachmentId: string): Promise<void> {
    const { rows } = await client.query(
      `SELECT id, storage_key, uploaded_by FROM dispute_attachment WHERE id = $1 AND dispute_id = $2`,
      [attachmentId, disputeId],
    );
    if (rows.length === 0) {
      return;
    }
    const row = rows[0] as { id: string; storage_key: string; uploaded_by: string };
    if (row.uploaded_by !== actorUserId) {
      throw new ForbiddenException('You can only remove your own attachments.');
    }

    await client.query(`DELETE FROM dispute_attachment WHERE id = $1`, [attachmentId]);
    try {
      unlinkSync(join(this.uploadsDir(), row.storage_key));
    } catch {
      // The DB row is the source of truth for what's shown; a missing
      // file on disk (e.g. after an ephemeral-disk wipe) isn't worth
      // failing this request over.
    }

    await this.audit.record(
      { actorUserId, action: 'dispute.attachment.remove', targetType: 'dispute', targetId: disputeId },
      client,
    );
  }

  async listFor(client: PoolClient, disputeId: string): Promise<DisputeAttachmentRow[]> {
    const { rows } = await client.query(
      `SELECT id, storage_key, content_type, byte_size, uploaded_by, created_at
       FROM dispute_attachment WHERE dispute_id = $1 ORDER BY created_at ASC`,
      [disputeId],
    );
    return rows as DisputeAttachmentRow[];
  }
}
