import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdirSync, unlinkSync } from 'fs';
import { writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { DirectMessageService } from './direct-message.service';

// Same shape @nestjs/platform-express's FileInterceptor hands
// @UploadedFile() with no `storage` option -- see
// marketplace/listing-image.service.ts's UploadedListingImage.
export interface UploadedMessageFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

interface AttachmentRow extends Record<string, unknown> {
  id: string;
  message_id: string;
  storage_key: string;
  content_type: string;
  byte_size: number;
}

// Broader than service/listing images (JPEG/PNG/WebP + PDF) since a
// Customer showing a Provider "what I need" is often a document, not
// just a photo -- same allow-list as dispute evidence.
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_MESSAGE = 5;

const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/**
 * Files/images either party attaches to an already-sent direct
 * message (User Stories 2 & 3's chat halves) -- e.g. a Customer
 * showing a Provider a reference photo, or a Provider sending back a
 * document. Deliberately a follow-up upload against an existing
 * message.id rather than part of the send-message call itself, the
 * same "create the record with JSON, then multipart-upload the file
 * against its id" shape dispute-ui.js's wireDisputeForm already uses
 * for dispute evidence -- keeps the plain-JSON send-message route
 * untouched and this module's only multipart route separate.
 */
@Injectable()
export class MessageAttachmentService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly messages: DirectMessageService,
  ) {}

  private uploadsDir(): string {
    const dir = process.env.UPLOADS_DIR;
    if (!dir) {
      throw new Error('UPLOADS_DIR is not set -- main.ts should have set it during bootstrap.');
    }
    return dir;
  }

  private async requireOwnMessage(conversationId: string, messageId: string, actorUserId: string): Promise<void> {
    const [row] = await this.db.query<{ id: string; sender_user_id: string }>(
      `SELECT id, sender_user_id FROM direct_message WHERE id = $1 AND conversation_id = $2`,
      [messageId, conversationId],
    );
    if (!row) {
      throw new NotFoundException('Message not found.');
    }
    if (row.sender_user_id !== actorUserId) {
      throw new ForbiddenException('You can only attach files to your own messages.');
    }
  }

  async add(
    conversationId: string,
    messageId: string,
    actorUserId: string,
    file: UploadedMessageFile | undefined,
  ): Promise<{ id: string; url: string; contentType: string; byteSize: number }> {
    await this.messages.requireParticipant(conversationId, actorUserId);
    await this.requireOwnMessage(conversationId, messageId, actorUserId);

    if (!file) {
      throw new BadRequestException('No file was provided (expected multipart field "file").');
    }
    if (!ALLOWED_TYPES.has(file.mimetype)) {
      throw new UnprocessableEntityException('Only JPEG, PNG, WebP images or PDF files are accepted.');
    }
    if (file.size > MAX_BYTES) {
      throw new UnprocessableEntityException('Files must be 10MB or smaller.');
    }

    const [{ count }] = await this.db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM direct_message_attachment WHERE message_id = $1`,
      [messageId],
    );
    if (Number(count) >= MAX_ATTACHMENTS_PER_MESSAGE) {
      throw new UnprocessableEntityException(`A message can have at most ${MAX_ATTACHMENTS_PER_MESSAGE} attachments.`);
    }

    const extension = EXTENSION_BY_TYPE[file.mimetype];
    const storageKey = `messages/${messageId}/${randomUUID()}.${extension}`;
    const fullPath = join(this.uploadsDir(), storageKey);
    mkdirSync(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, file.buffer);

    const [row] = await this.db.query<AttachmentRow>(
      `INSERT INTO direct_message_attachment (message_id, storage_key, content_type, byte_size)
       VALUES ($1, $2, $3, $4)
       RETURNING id, message_id, storage_key, content_type, byte_size`,
      [messageId, storageKey, file.mimetype, file.size],
    );

    await this.audit.record({ actorUserId, action: 'message.attachment.add', targetType: 'direct_message', targetId: messageId });

    return { id: row.id, url: `/uploads/${row.storage_key}`, contentType: row.content_type, byteSize: row.byte_size };
  }

  async remove(conversationId: string, messageId: string, attachmentId: string, actorUserId: string): Promise<void> {
    await this.messages.requireParticipant(conversationId, actorUserId);
    await this.requireOwnMessage(conversationId, messageId, actorUserId);

    const [row] = await this.db.query<AttachmentRow>(
      `SELECT id, message_id, storage_key, content_type, byte_size FROM direct_message_attachment WHERE id = $1 AND message_id = $2`,
      [attachmentId, messageId],
    );
    if (!row) {
      return;
    }

    await this.db.query(`DELETE FROM direct_message_attachment WHERE id = $1`, [attachmentId]);

    try {
      unlinkSync(join(this.uploadsDir(), row.storage_key));
    } catch {
      // The DB row is the source of truth for what's shown -- a
      // missing file on disk (e.g. an ephemeral uploads directory
      // wiped by a redeploy) isn't worth failing this request over.
    }

    await this.audit.record({ actorUserId, action: 'message.attachment.remove', targetType: 'direct_message', targetId: messageId });
  }
}
