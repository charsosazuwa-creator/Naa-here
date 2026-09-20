import { BadRequestException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdirSync, unlinkSync } from 'fs';
import { writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';

// fieldname/encoding are unused here but are part of what
// @nestjs/platform-express's FileInterceptor actually hands
// @UploadedFile() (see its MulterOptions.fileFilter signature) — kept
// for an accurate shape rather than an incomplete one. No @types/multer
// import needed: @nestjs/platform-express declares this shape itself.
export interface UploadedListingImage {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES_PER_LISTING = 6;

const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

type ImageRow = { id: string; storage_key: string; content_type: string; byte_size: number; position: number };

/**
 * Writes uploaded listing images to real files on disk (see
 * main.ts's uploadsDir/UPLOADS_DIR — a sibling of web/, served back
 * at /uploads/*), unlike attachment.service.ts's media metadata-only
 * records, which this feature needs actual visible bytes for. AC8's
 * "approved file type, file size, image count, and security
 * restrictions" are enforced here: jpeg/png/webp only, 5MB max, 6
 * images max per listing.
 */
@Injectable()
export class ListingImageService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  private uploadsDir(): string {
    const dir = process.env.UPLOADS_DIR;
    if (!dir) {
      throw new Error('UPLOADS_DIR is not set — main.ts should have set it during bootstrap.');
    }
    return dir;
  }

  async add(actorUserId: string, listingId: string, file: UploadedListingImage | undefined): Promise<ImageRow> {
    if (!file) {
      throw new BadRequestException('No image file was provided (expected multipart field "file").');
    }
    if (!ALLOWED_TYPES.has(file.mimetype)) {
      throw new UnprocessableEntityException('Only JPEG, PNG, or WebP images are accepted.');
    }
    if (file.size > MAX_BYTES) {
      throw new UnprocessableEntityException('Images must be 5MB or smaller.');
    }

    const [{ count }] = await this.db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM listing_image WHERE listing_id = $1`,
      [listingId],
    );
    if (Number(count) >= MAX_IMAGES_PER_LISTING) {
      throw new UnprocessableEntityException(`A listing can have at most ${MAX_IMAGES_PER_LISTING} images.`);
    }

    const extension = EXTENSION_BY_TYPE[file.mimetype];
    const storageKey = `listings/${listingId}/${randomUUID()}.${extension}`;
    const fullPath = join(this.uploadsDir(), storageKey);
    mkdirSync(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, file.buffer);

    const [row] = await this.db.query<ImageRow>(
      `INSERT INTO listing_image (listing_id, storage_key, content_type, byte_size, position)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, storage_key, content_type, byte_size, position`,
      [listingId, storageKey, file.mimetype, file.size, Number(count)],
    );

    await this.audit.record({ actorUserId, action: 'listing.image.add', targetType: 'listing', targetId: listingId });
    return row;
  }

  async remove(actorUserId: string, listingId: string, imageId: string): Promise<void> {
    const [row] = await this.db.query<ImageRow>(
      `SELECT id, storage_key, content_type, byte_size, position FROM listing_image WHERE id = $1 AND listing_id = $2`,
      [imageId, listingId],
    );
    if (!row) {
      return;
    }

    await this.db.query(`DELETE FROM listing_image WHERE id = $1`, [imageId]);

    try {
      unlinkSync(join(this.uploadsDir(), row.storage_key));
    } catch {
      // The DB row is the source of truth for what's shown; a missing
      // file on disk (e.g. already gone after a redeploy wiped the
      // ephemeral uploads directory — see main.ts) is not worth
      // failing this request over.
    }

    await this.audit.record({ actorUserId, action: 'listing.image.remove', targetType: 'listing', targetId: listingId });
  }
}
