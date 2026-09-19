import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { CreateServiceDto } from './dto/service.dto';

export interface ServiceListing {
  id: string;
  categoryId: number;
  locationId: string | null;
  name: string;
  description: string | null;
  durationMinutes: number | null;
  priceMinorUnits: number;
  currencyCode: string;
  status: 'draft' | 'published' | 'archived';
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
  ) {}

  async create(tenantId: string, createdBy: string, dto: CreateServiceDto): Promise<ServiceListing> {
    return this.db.withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO service (tenant_id, location_id, category_id, name, description, duration_minutes, price_minor_units, currency_code)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, category_id, location_id, name, description, duration_minutes, price_minor_units, currency_code, status`,
        [
          tenantId,
          dto.locationId ?? null,
          dto.categoryId,
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

      return toListing(rows[0]);
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
           RETURNING id, category_id, location_id, name, description, duration_minutes, price_minor_units, currency_code, status`,
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

        return toListing(rows[0]);
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
          ? `SELECT id, category_id, location_id, name, description, duration_minutes, price_minor_units, currency_code, status
             FROM service WHERE tenant_id = $1 ORDER BY created_at DESC`
          : `SELECT id, category_id, location_id, name, description, duration_minutes, price_minor_units, currency_code, status
             FROM service WHERE tenant_id = $1 AND status = 'published' ORDER BY created_at DESC`,
        [tenantId],
      );
      return rows.map(toListing);
    });
  }
}

function toListing(row: Record<string, unknown>): ServiceListing {
  return {
    id: row.id as string,
    categoryId: row.category_id as number,
    locationId: (row.location_id as string) ?? null,
    name: row.name as string,
    description: (row.description as string) ?? null,
    durationMinutes: (row.duration_minutes as number) ?? null,
    priceMinorUnits: row.price_minor_units as number,
    currencyCode: row.currency_code as string,
    status: row.status as ServiceListing['status'],
  };
}
