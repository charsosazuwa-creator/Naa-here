import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { DiscoverServicesQueryDto } from './dto/discover.dto';

export interface DiscoveredService {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number | null;
  priceMinorUnits: number;
  currencyCode: string;
  categoryId: number;
  categoryCode: string;
  categoryName: string;
  tenantId: string;
  tenantName: string;
  location: {
    id: string;
    label: string;
    addressLine: string;
    city: string;
    countryCode: string;
    latitude: number | null;
    longitude: number | null;
  } | null;
}

export interface AvailabilityWindow {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface BlockedWindow {
  startsAt: string;
  endsAt: string;
}

export interface DiscoveredServiceDetail extends DiscoveredService {
  availability: AvailabilityWindow[];
  blockedTimes: BlockedWindow[];
}

/**
 * Unauthenticated, cross-tenant browse and detail. Relies entirely on
 * the public-read RLS policies added in migration 008 — this service
 * never sets app.tenant_id, so a plain query() only ever sees the
 * rows those policies let through (published, non-suspended
 * services, and the location/availability/blocked-time rows tied to
 * them). No WHERE clause here needs to re-check publish status; the
 * database already guarantees it can't see anything else.
 */
@Injectable()
export class DiscoveryService {
  constructor(private readonly db: DatabaseService) {}

  async listServices(filters: DiscoverServicesQueryDto): Promise<DiscoveredService[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.countryCode) {
      params.push(filters.countryCode.toUpperCase());
      conditions.push(`(l.country_code = $${params.length} OR (l.id IS NULL AND t.country_code = $${params.length}))`);
    }
    if (filters.category) {
      params.push(filters.category);
      conditions.push(`sc.code = $${params.length}`);
    }
    if (filters.city) {
      params.push(`%${filters.city}%`);
      conditions.push(`l.city ILIKE $${params.length}`);
    }
    if (filters.search) {
      params.push(`%${filters.search}%`);
      conditions.push(`(s.name ILIKE $${params.length} OR t.name ILIKE $${params.length})`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = await this.db.query(
      `SELECT
         s.id, s.name, s.description, s.duration_minutes, s.price_minor_units, s.currency_code,
         sc.id AS category_id, sc.code AS category_code, sc.name AS category_name,
         t.id AS tenant_id, t.name AS tenant_name,
         l.id AS location_id, l.label AS location_label, l.address_line, l.city, l.country_code,
         l.latitude, l.longitude
       FROM service s
       JOIN service_category sc ON sc.id = s.category_id
       JOIN tenant t ON t.id = s.tenant_id
       LEFT JOIN location l ON l.id = s.location_id
       ${where}
       ORDER BY s.created_at DESC
       LIMIT 100`,
      params,
    );

    return rows.map(toDiscoveredService);
  }

  async getServiceDetail(serviceId: string): Promise<DiscoveredServiceDetail> {
    const rows = await this.db.query(
      `SELECT
         s.id, s.name, s.description, s.duration_minutes, s.price_minor_units, s.currency_code,
         sc.id AS category_id, sc.code AS category_code, sc.name AS category_name,
         t.id AS tenant_id, t.name AS tenant_name,
         l.id AS location_id, l.label AS location_label, l.address_line, l.city, l.country_code,
         l.latitude, l.longitude
       FROM service s
       JOIN service_category sc ON sc.id = s.category_id
       JOIN tenant t ON t.id = s.tenant_id
       LEFT JOIN location l ON l.id = s.location_id
       WHERE s.id = $1`,
      [serviceId],
    );

    if (rows.length === 0) {
      // Either the id doesn't exist, or it's a real service that isn't
      // publicly visible (draft/archived/suspended) — RLS makes those
      // indistinguishable from here, which is the correct behavior for
      // an unauthenticated route (no confirming that a hidden service
      // exists).
      throw new NotFoundException('Service not found.');
    }

    const service = toDiscoveredService(rows[0]);

    const [availabilityRows, blockedRows] = await Promise.all([
      this.db.query(
        `SELECT day_of_week, start_time, end_time
         FROM availability_rule
         WHERE tenant_id = $1 AND (service_id = $2 OR service_id IS NULL)
         ORDER BY day_of_week, start_time`,
        [service.tenantId, serviceId],
      ),
      this.db.query(
        `SELECT starts_at, ends_at
         FROM blocked_time
         WHERE tenant_id = $1 AND (service_id = $2 OR service_id IS NULL) AND ends_at > now()
         ORDER BY starts_at`,
        [service.tenantId, serviceId],
      ),
    ]);

    return {
      ...service,
      availability: availabilityRows.map((r: Record<string, unknown>) => ({
        dayOfWeek: r.day_of_week as number,
        startTime: r.start_time as string,
        endTime: r.end_time as string,
      })),
      blockedTimes: blockedRows.map((r: Record<string, unknown>) => ({
        startsAt: r.starts_at as string,
        endsAt: r.ends_at as string,
      })),
    };
  }
}

function toDiscoveredService(row: Record<string, unknown>): DiscoveredService {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? null,
    durationMinutes: (row.duration_minutes as number) ?? null,
    priceMinorUnits: row.price_minor_units as number,
    currencyCode: row.currency_code as string,
    categoryId: row.category_id as number,
    categoryCode: row.category_code as string,
    categoryName: row.category_name as string,
    tenantId: row.tenant_id as string,
    tenantName: row.tenant_name as string,
    location: row.location_id
      ? {
          id: row.location_id as string,
          label: row.location_label as string,
          addressLine: row.address_line as string,
          city: row.city as string,
          countryCode: row.country_code as string,
          latitude: (row.latitude as number) ?? null,
          longitude: (row.longitude as number) ?? null,
        }
      : null,
  };
}
