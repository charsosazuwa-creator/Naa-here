import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { CreateAvailabilityRuleDto, CreateBlockedTimeDto } from './dto/availability.dto';

export interface AvailabilityRule {
  id: string;
  serviceId: string | null;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface BlockedTime {
  id: string;
  serviceId: string | null;
  startsAt: string;
  endsAt: string;
  reason: string | null;
}

/**
 * Weekly working-hours rules plus one-off blocked time. This is the
 * data the Phase-3 booking engine's slot computation will read;
 * Phase 2 only needs it to exist and be settable so a provider can
 * finish onboarding, per the design's phase dependency (phase 3
 * depends on phase 2).
 */
@Injectable()
export class AvailabilityService {
  constructor(private readonly db: DatabaseService) {}

  async addRule(tenantId: string, dto: CreateAvailabilityRuleDto): Promise<AvailabilityRule> {
    return this.db.withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO availability_rule (tenant_id, service_id, day_of_week, start_time, end_time)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, service_id, day_of_week, start_time, end_time`,
        [tenantId, dto.serviceId ?? null, dto.dayOfWeek, dto.startTime, dto.endTime],
      );
      return toRule(rows[0]);
    });
  }

  async listRules(tenantId: string): Promise<AvailabilityRule[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT id, service_id, day_of_week, start_time, end_time
         FROM availability_rule WHERE tenant_id = $1 ORDER BY day_of_week, start_time`,
        [tenantId],
      );
      return rows.map(toRule);
    });
  }

  async addBlockedTime(tenantId: string, dto: CreateBlockedTimeDto): Promise<BlockedTime> {
    return this.db.withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO blocked_time (tenant_id, service_id, starts_at, ends_at, reason)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, service_id, starts_at, ends_at, reason`,
        [tenantId, dto.serviceId ?? null, dto.startsAt, dto.endsAt, dto.reason ?? null],
      );
      return toBlocked(rows[0]);
    });
  }
}

function toRule(row: Record<string, unknown>): AvailabilityRule {
  return {
    id: row.id as string,
    serviceId: (row.service_id as string) ?? null,
    dayOfWeek: row.day_of_week as number,
    startTime: row.start_time as string,
    endTime: row.end_time as string,
  };
}

function toBlocked(row: Record<string, unknown>): BlockedTime {
  return {
    id: row.id as string,
    serviceId: (row.service_id as string) ?? null,
    startsAt: row.starts_at as string,
    endsAt: row.ends_at as string,
    reason: (row.reason as string) ?? null,
  };
}
