import { BadRequestException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdirSync, unlinkSync } from 'fs';
import { writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';

// Same shape FileInterceptor hands @UploadedFile() -- see
// listing-image.service.ts's UploadedListingImage for why this is
// spelled out rather than imported from @types/multer.
export interface UploadedServiceImage {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES_PER_SERVICE = 6;

const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export type ServiceImageRow = { id: string; service_id: string; storage_key: string; content_type: string; byte_size: number; position: number };

/**
 * Photos for a Provider's service, on the "Service page" where a
 * service is created/managed -- same disk-backed pattern as
 * ListingImageService (marketplace/listing-image.service.ts), copied
 * rather than shared because a service and a listing are two
 * different owning entities with two different access-control models
 * (tenant membership + 'service.manage' permission here, plain
 * owner_user_id there).
 */
@Injectable()
export class ServiceImageService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  private uploadsDir(): string {
    const dir = process.env.UPLOADS_DIR;
    if (!dir) {
      throw new Error('UPLOADS_DIR is not set -- main.ts should have set it during bootstrap.');
    }
    return dir;
  }

  async add(actorUserId: string, serviceId: string, file: UploadedServiceImage | undefined): Promise<ServiceImageRow> {
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
      `SELECT count(*)::text AS count FROM service_image WHERE service_id = $1`,
      [serviceId],
    );
    if (Number(count) >= MAX_IMAGES_PER_SERVICE) {
      throw new UnprocessableEntityException(`A service can have at most ${MAX_IMAGES_PER_SERVICE} photos.`);
    }

    const extension = EXTENSION_BY_TYPE[file.mimetype];
    const storageKey = `services/${serviceId}/${randomUUID()}.${extension}`;
    const fullPath = join(this.uploadsDir(), storageKey);
    mkdirSync(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, file.buffer);

    const [row] = await this.db.query<ServiceImageRow>(
      `INSERT INTO service_image (service_id, storage_key, content_type, byte_size, position)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, service_id, storage_key, content_type, byte_size, position`,
      [serviceId, storageKey, file.mimetype, file.size, Number(count)],
    );

    await this.audit.record({ actorUserId, action: 'service.image.add', targetType: 'service', targetId: serviceId });
    return row;
  }

  async remove(actorUserId: string, serviceId: string, imageId: string): Promise<void> {
    const [row] = await this.db.query<ServiceImageRow>(
      `SELECT id, service_id, storage_key, content_type, byte_size, position FROM service_image WHERE id = $1 AND service_id = $2`,
      [imageId, serviceId],
    );
    if (!row) {
      return;
    }

    await this.db.query(`DELETE FROM service_image WHERE id = $1`, [imageId]);

    try {
      unlinkSync(join(this.uploadsDir(), row.storage_key));
    } catch {
      // The DB row is the source of truth for what's shown -- a
      // missing file on disk (e.g. an ephemeral uploads directory
      // wiped by a redeploy) isn't worth failing this request over.
    }

    await this.audit.record({ actorUserId, action: 'service.image.remove', targetType: 'service', targetId: serviceId });
  }

  /** Batch-load images for several services at once (list views), ordered within each service. */
  async forServices(serviceIds: string[]): Promise<ServiceImageRow[]> {
    if (serviceIds.length === 0) return [];
    return this.db.query<ServiceImageRow>(
      `SELECT id, service_id, storage_key, content_type, byte_size, position FROM service_image
       WHERE service_id = ANY($1::uuid[]) ORDER BY position ASC`,
      [serviceIds],
    );
  }

  async forService(serviceId: string): Promise<ServiceImageRow[]> {
    return this.forServices([serviceId]);
  }
}
