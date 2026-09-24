import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { CreateServiceDto } from './dto/service.dto';
import { ServiceImageService, ServiceImageRow } from './service-image.service';

export interface ServiceListing {
  id: string;
  categoryId: number;
  categoryName: string;
  locationId: string | null;
  name: string;
  description: string | null;
  durationMinutes: number | null;
  priceMinorUnits: number;
  currencyCode: string;
  status: 'draft' | 'published' | 'archived';
  images: { id: string; url: string; position: number }[];
}

export interface ServiceCategory {
  id: number;
  code: string;
  name: string;
}

const SELECT_COLUMNS = `s.id, s.category_id, sc.name AS category_name, s.location_id, s.name, s.description,
       s.duration_minutes, s.price_minor_units, s.currency_code, s.status`;

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

/**
 * Publishing is gated on the tenant being verified — enforced both
 * here (a clear error message) and again by the database trigger
 * `service_publish_requires_verified_tenant` in migration 002, per the
 * design's three-layer isolation model (section 10).
 */
@Injectable()
export class ServiceCatalogueService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly images: ServiceImageService,
  ) {}

  /**
   * service_category (migration 002) was a fixed, hand-seeded list of
   * three rows; migration 018 gave it a real sequence and audit
   * columns so the app can add to it. Same "resolve, or create if it
   * doesn't exist yet" shape as BusinessCategoryService.resolve() --
   * this table has no RLS either, so a plain query is fine.
   */
  async resolveCategory(userId: string, input: { id?: number; name?: string }): Promise<number> {
    if (input.id) {
      const [row] = await this.db.query<{ id: number }>(`SELECT id FROM service_category WHERE id = $1`, [input.id]);
      if (!row) {
        throw new BadRequestException('That category no longer exists -- pick another or type a new one.');
      }
      return row.id;
    }

    const name = (input.name ?? '').trim();
    const code = slugify(name);
    if (!name || !code) {
      throw new BadRequestException('A service category is required.');
    }

    const [existing] = await this.db.query<{ id: number }>(`SELECT id FROM service_category WHERE code = $1`, [code]);
    if (existing) {
      return existing.id;
    }

    const [created] = await this.db.query<{ id: number }>(
      `INSERT INTO service_category (code, name, created_by) VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code
       RETURNING id`,
      [code, name, userId],
    );
    return created.id;
  }

  async listCategories(): Promise<ServiceCategory[]> {
    const rows = await this.db.query<{ id: number; code: string; name: string }>(
      `SELECT id, code, name FROM service_category ORDER BY name`,
    );
    return rows.map((row) => ({ id: row.id, code: row.code, name: row.name }));
  }

  /**
   * The admin console's direct "add a category" action (the
   * 'category.manage'-gated counterpart to resolveCategory() above,
   * which a provider reaches indirectly by typing a new name into the
   * "create service" form). Same upsert-by-code shape, but returns the
   * full row rather than just an id, since the admin UI lists it
   * straight back.
   */
  async createCategory(userId: string, name: string): Promise<ServiceCategory> {
    const trimmed = (name ?? '').trim();
    const code = slugify(trimmed);
    if (!trimmed || !code) {
      throw new BadRequestException('A category name is required.');
    }

    const [row] = await this.db.query<{ id: number; code: string; name: string }>(
      `INSERT INTO service_category (code, name, created_by) VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code
       RETURNING id, code, name`,
      [code, trimmed, userId],
    );
    return { id: row.id, code: row.code, name: row.name };
  }

  async create(tenantId: string, createdBy: string, dto: CreateServiceDto): Promise<ServiceListing> {
    const categoryId = await this.resolveCategory(createdBy, { id: dto.categoryId, name: dto.categoryName });

    return this.db.withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO service (tenant_id, location_id, category_id, name, description, duration_minutes, price_minor_units, currency_code)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, category_id, location_id, name, description, duration_minutes, price_minor_units, currency_code, status`,
        [
          tenantId,
          dto.locationId ?? null,
          categoryId,
          dto.name,
          dto.description ?? null,
          dto.durationMinutes ?? null,
          dto.priceMinorUnits,
          dto.currencyCode,
        ],
      );

      await this.audit.record({
        tenantId,
        actorUserId: createdBy,
        action: 'service.create',
        targetType: 'service',
        targetId: rows[0].id,
      }, client);

      const { rows: withCategory } = await client.query(
        `SELECT ${SELECT_COLUMNS} FROM service s JOIN service_category sc ON sc.id = s.category_id WHERE s.id = $1`,
        [rows[0].id],
      );
      return toListing(withCategory[0], []);
    });
  }

  async setStatus(
    tenantId: string,
    serviceId: string,
    actorUserId: string,
    status: 'draft' | 'published' | 'archived',
  ): Promise<ServiceListing> {
    try {
      return await this.db.withTenant(tenantId, async (client) => {
        const { rows } = await client.query(
          `UPDATE service SET status = $3, updated_at = now()
           WHERE id = $1 AND tenant_id = $2
           RETURNING id`,
          [serviceId, tenantId, status],
        );

        if (rows.length === 0) {
          throw new NotFoundException('Service not found.');
        }

        await this.audit.record({
          tenantId,
          actorUserId,
          action: 'service.status_change',
          targetType: 'service',
          targetId: serviceId,
          metadata: { status },
        }, client);

        const { rows: withCategory } = await client.query(
          `SELECT ${SELECT_COLUMNS} FROM service s JOIN service_category sc ON sc.id = s.category_id WHERE s.id = $1`,
          [serviceId],
        );
        const images = await this.images.forService(serviceId);
        return toListing(withCategory[0], images);
      });
    } catch (err) {
      // Surfaces the database trigger's rejection (unverified tenant
      // trying to publish) as a normal 400, not a raw Postgres error.
      if (err instanceof Error && err.message.includes('is not verified')) {
        throw new BadRequestException('This business must be verified before it can publish a service.');
      }
      throw err;
    }
  }

  async listForTenant(tenantId: string, includeUnpublished: boolean): Promise<ServiceListing[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        includeUnpublished
          ? `SELECT ${SELECT_COLUMNS} FROM service s JOIN service_category sc ON sc.id = s.category_id
             WHERE s.tenant_id = $1 ORDER BY s.created_at DESC`
          : `SELECT ${SELECT_COLUMNS} FROM service s JOIN service_category sc ON sc.id = s.category_id
             WHERE s.tenant_id = $1 AND s.status = 'published' ORDER BY s.created_at DESC`,
        [tenantId],
      );
      const images = await this.images.forServices(rows.map((r) => r.id as string));
      return rows.map((row) => toListing(row, images.filter((img) => img.service_id === row.id)));
    });
  }
}

function toListing(row: Record<string, unknown>, images: ServiceImageRow[]): ServiceListing {
  return {
    id: row.id as string,
    categoryId: row.category_id as number,
    categoryName: row.category_name as string,
    locationId: (row.location_id as string) ?? null,
    name: row.name as string,
    description: (row.description as string) ?? null,
    durationMinutes: (row.duration_minutes as number) ?? null,
    priceMinorUnits: row.price_minor_units as number,
    currencyCode: row.currency_code as string,
    status: row.status as ServiceListing['status'],
    images: images
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((img) => ({ id: img.id, url: `/uploads/${img.storage_key}`, position: img.position })),
  };
}
