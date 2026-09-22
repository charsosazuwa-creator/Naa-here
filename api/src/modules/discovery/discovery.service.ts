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

export interface DaySlots {
  date: string;
  slots: { startsAt: string; endsAt: string }[];
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

  /**
   * Real slot computation, replacing the earlier approach of just
   * showing business hours as text and letting the customer type any
   * start/end time. For each day in the requested window: take the
   * service's weekly availability windows (getServiceDetail's same
   * rule/blocked-time lookup), step through them in service-duration
   * increments, and drop any candidate slot that overlaps a blocked
   * window or an existing non-cancelled booking. The booking check
   * needs the booking table's tenant-scoped RLS policy to actually
   * see rows, so unlike the rest of this (deliberately anonymous,
   * cross-tenant) service, it runs through withTenant() -- safe here
   * because tenantId itself isn't secret (it's already returned by
   * getServiceDetail) and only aggregate free/busy is exposed, never
   * the booking rows themselves (no customer identity, no notes).
   */
  async getAvailableSlots(serviceId: string, days: number): Promise<DaySlots[]> {
    const service = await this.getServiceDetail(serviceId);
    const durationMinutes = service.durationMinutes ?? 60;
    const durationMs = durationMinutes * 60_000;

    const now = new Date();
    const rangeEnd = new Date(now);
    rangeEnd.setDate(rangeEnd.getDate() + days);

    const blockedWindows = service.blockedTimes.map((b) => ({
      start: new Date(b.startsAt).getTime(),
      end: new Date(b.endsAt).getTime(),
    }));

    const bookedWindows = await this.db.withTenant(service.tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT starts_at, ends_at FROM booking
         WHERE service_id = $1 AND status NOT IN ('cancelled', 'no_show')
           AND ends_at > $2 AND starts_at < $3`,
        [serviceId, now.toISOString(), rangeEnd.toISOString()],
      );
      return rows.map((r: Record<string, unknown>) => ({
        start: new Date(r.starts_at as string).getTime(),
        end: new Date(r.ends_at as string).getTime(),
      }));
    });

    const busyWindows = [...blockedWindows, ...bookedWindows];
    const overlaps = (slotStart: number, slotEnd: number) =>
      busyWindows.some((w) => slotStart < w.end && slotEnd > w.start);

    const result: DaySlots[] = [];
    for (let offset = 0; offset < days; offset += 1) {
      const day = new Date(now);
      day.setDate(day.getDate() + offset);
      day.setHours(0, 0, 0, 0);
      const dayOfWeek = day.getDay();

      const windowsForDay = service.availability.filter((w) => w.dayOfWeek === dayOfWeek);
      const slots: { startsAt: string; endsAt: string }[] = [];

      for (const window of windowsForDay) {
        const [startHour, startMinute] = window.startTime.split(':').map(Number);
        const [endHour, endMinute] = window.endTime.split(':').map(Number);
        const windowStart = new Date(day);
        windowStart.setHours(startHour, startMinute, 0, 0);
        const windowEnd = new Date(day);
        windowEnd.setHours(endHour, endMinute, 0, 0);

        for (
          let slotStart = windowStart.getTime();
          slotStart + durationMs <= windowEnd.getTime();
          slotStart += durationMs
        ) {
          const slotEnd = slotStart + durationMs;
          if (slotStart <= now.getTime()) {
            continue;
          }
          if (overlaps(slotStart, slotEnd)) {
            continue;
          }
          slots.push({ startsAt: new Date(slotStart).toISOString(), endsAt: new Date(slotEnd).toISOString() });
        }
      }

      slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      result.push({ date: day.toISOString().slice(0, 10), slots });
    }

    return result;
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
