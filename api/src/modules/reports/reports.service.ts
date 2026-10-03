import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';

const AGENT_EMAIL = 'reporting-agent@naahere.internal';
const DEFAULT_PERIOD_DAYS = 30;

export interface MoneyByCurrency {
  currencyCode: string;
  amountMinorUnits: number;
}

export interface PlatformSummaryResult {
  periodDays: number;
  totalTenants: number;
  newTenants: number;
  newSignups: number;
  bookingsByStatus: Record<string, number>;
  revenueByCurrency: MoneyByCurrency[];
  openDisputes: number;
  topTenantsByBookings: { tenantId: string; tenantName: string; bookingCount: number }[];
}

export interface BusinessPerformanceResult {
  periodDays: number;
  tenantId: string;
  tenantName: string;
  bookingsByStatus: Record<string, number>;
  revenueByCurrency: MoneyByCurrency[];
  topServices: { serviceId: string; name: string; bookingCount: number }[];
  openDisputes: number;
}

export interface ReportRun<T = unknown> {
  id: string;
  reportType: 'platform_summary' | 'business_performance';
  tenantId: string | null;
  periodDays: number;
  requestedBy: string;
  generatedBy: string;
  result: T;
  createdAt: string;
}

function toReportRun(row: Record<string, unknown>): ReportRun {
  return {
    id: row.id as string,
    reportType: row.report_type as ReportRun['reportType'],
    tenantId: (row.tenant_id as string) ?? null,
    periodDays: Number(row.period_days),
    requestedBy: row.requested_by as string,
    generatedBy: row.generated_by as string,
    result: row.result,
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

/**
 * Reports the "Agent" service account generates (migration 026). An
 * admin or provider's click is what gets a report to actually run —
 * this service has no scheduler of its own yet (see migration 026's
 * header and docs/DEV_QA.md for why on-demand-only was the deliberate
 * scope for this first version) — but the resulting report_run row is
 * always attributed to the Agent's app_user id, never to whichever
 * human happened to click, via generatedBy below.
 *
 * Every read in here runs scoped to a real tenant or a real user id
 * (DatabaseService.withTenant / withUser), never a bare pool query
 * against a table RLS protects. For the cross-tenant platform summary
 * that means looping tenant-by-tenant rather than adding a new
 * "platform staff see every row" policy to booking/ledger_entry/etc.
 * — deliberately, to avoid widening RLS on tables this migration
 * doesn't own just to save some round trips in a report that already
 * isn't on any user-facing request's critical path. tenant and
 * app_user themselves carry no RLS at all (see migration 001/002), so
 * the handful of platform-wide counts below (total/new tenants, new
 * signups) read them directly.
 */
@Injectable()
export class ReportsService {
  private agentUserIdCache: string | null = null;

  constructor(private readonly db: DatabaseService) {}

  private async getAgentUserId(): Promise<string> {
    if (this.agentUserIdCache) return this.agentUserIdCache;
    const [row] = await this.db.query<{ id: string }>('SELECT id FROM app_user WHERE email = $1', [AGENT_EMAIL]);
    if (!row) {
      throw new Error(
        `The reporting Agent account (${AGENT_EMAIL}) is missing — migration 026_admin_agent_reports.sql has not run against this database.`,
      );
    }
    this.agentUserIdCache = row.id;
    return row.id;
  }

  async listTenantsForAdmin(): Promise<{ id: string; name: string; countryCode: string; status: string }[]> {
    const rows = await this.db.query<{ id: string; name: string; country_code: string; status: string }>(
      `SELECT id, name, country_code, status FROM tenant ORDER BY name`,
    );
    return rows.map((r) => ({ id: r.id, name: r.name, countryCode: r.country_code, status: r.status }));
  }

  async generatePlatformSummary(requestedBy: string, periodDaysInput?: number): Promise<ReportRun<PlatformSummaryResult>> {
    const periodDays = periodDaysInput ?? DEFAULT_PERIOD_DAYS;
    const cutoff = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();

    const tenants = await this.db.query<{ id: string; name: string; created_at: string }>(
      `SELECT id, name, created_at FROM tenant`,
    );
    const newSignupsRows = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM app_user WHERE created_at >= $1`,
      [cutoff],
    );

    const bookingsByStatus: Record<string, number> = {};
    const revenueByCurrency = new Map<string, number>();
    let openDisputes = 0;
    const topTenantsByBookings: { tenantId: string; tenantName: string; bookingCount: number }[] = [];

    // One withTenant() transaction per tenant — see the class doc
    // comment for why this loop exists instead of a single cross-tenant
    // query. Demo-scale tenant counts only; revisit if this product
    // ever has enough tenants for N round trips to matter.
    for (const tenant of tenants) {
      const tenantTotals = await this.db.withTenant(tenant.id, async (client: PoolClient) => {
        const statusRows = await client
          .query<{ status: string; count: string }>(
            `SELECT status, COUNT(*) AS count FROM booking WHERE created_at >= $1 GROUP BY status`,
            [cutoff],
          )
          .then((r) => r.rows);
        const revenueRows = await client
          .query<{ currency_code: string; total: string }>(
            `SELECT currency_code, COALESCE(SUM(amount_minor_units), 0) AS total
             FROM ledger_entry WHERE type = 'charge' AND created_at >= $1 GROUP BY currency_code`,
            [cutoff],
          )
          .then((r) => r.rows);
        const [disputeRow] = await client
          .query<{ count: string }>(`SELECT COUNT(*) AS count FROM dispute WHERE status = 'open'`)
          .then((r) => r.rows);
        return { statusRows, revenueRows, openDisputes: Number(disputeRow?.count ?? 0) };
      });

      let tenantBookingCount = 0;
      for (const row of tenantTotals.statusRows) {
        const count = Number(row.count);
        tenantBookingCount += count;
        bookingsByStatus[row.status] = (bookingsByStatus[row.status] ?? 0) + count;
      }
      for (const row of tenantTotals.revenueRows) {
        revenueByCurrency.set(row.currency_code, (revenueByCurrency.get(row.currency_code) ?? 0) + Number(row.total));
      }
      openDisputes += tenantTotals.openDisputes;

      if (tenantBookingCount > 0) {
        topTenantsByBookings.push({ tenantId: tenant.id, tenantName: tenant.name, bookingCount: tenantBookingCount });
      }
    }

    topTenantsByBookings.sort((a, b) => b.bookingCount - a.bookingCount);

    const result: PlatformSummaryResult = {
      periodDays,
      totalTenants: tenants.length,
      newTenants: tenants.filter((t) => t.created_at >= cutoff).length,
      newSignups: Number(newSignupsRows[0]?.count ?? 0),
      bookingsByStatus,
      revenueByCurrency: Array.from(revenueByCurrency.entries()).map(([currencyCode, amountMinorUnits]) => ({
        currencyCode,
        amountMinorUnits,
      })),
      openDisputes,
      topTenantsByBookings: topTenantsByBookings.slice(0, 5),
    };

    const agentUserId = await this.getAgentUserId();
    // Inserted under the Agent's own identity (withUser, not withTenant)
    // so report_run's "platform staff holding report.view" RLS policy
    // is what admits this write — the Agent holds that permission via
    // platform_role_assignment the same way a human administrator
    // would (migration 026), not through any special-case bypass.
    const row = await this.db.withUser(agentUserId, async (client: PoolClient) => {
      const { rows } = await client.query(
        `INSERT INTO report_run (report_type, tenant_id, period_days, requested_by, generated_by, result)
         VALUES ('platform_summary', NULL, $1, $2, $3, $4::jsonb)
         RETURNING *`,
        [periodDays, requestedBy, agentUserId, JSON.stringify(result)],
      );
      return rows[0];
    });

    return toReportRun(row) as ReportRun<PlatformSummaryResult>;
  }

  async generateBusinessPerformance(
    tenantId: string,
    requestedBy: string,
    periodDaysInput?: number,
  ): Promise<ReportRun<BusinessPerformanceResult>> {
    const periodDays = periodDaysInput ?? DEFAULT_PERIOD_DAYS;
    const cutoff = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();
    const agentUserId = await this.getAgentUserId();

    const row = await this.db.withTenant(tenantId, async (client: PoolClient) => {
      const [tenantRow] = await client
        .query<{ name: string }>(`SELECT name FROM tenant WHERE id = $1`, [tenantId])
        .then((r) => r.rows);

      const statusRows = await client
        .query<{ status: string; count: string }>(
          `SELECT status, COUNT(*) AS count FROM booking WHERE created_at >= $1 GROUP BY status`,
          [cutoff],
        )
        .then((r) => r.rows);
      const revenueRows = await client
        .query<{ currency_code: string; total: string }>(
          `SELECT currency_code, COALESCE(SUM(amount_minor_units), 0) AS total
           FROM ledger_entry WHERE type = 'charge' AND created_at >= $1 GROUP BY currency_code`,
          [cutoff],
        )
        .then((r) => r.rows);
      const topServiceRows = await client
        .query<{ id: string; name: string; booking_count: string }>(
          `SELECT s.id, s.name, COUNT(b.id) AS booking_count
           FROM booking b JOIN service s ON s.id = b.service_id
           WHERE b.created_at >= $1
           GROUP BY s.id, s.name ORDER BY COUNT(b.id) DESC LIMIT 5`,
          [cutoff],
        )
        .then((r) => r.rows);
      const [disputeRow] = await client
        .query<{ count: string }>(`SELECT COUNT(*) AS count FROM dispute WHERE status = 'open'`)
        .then((r) => r.rows);

      const bookingsByStatus: Record<string, number> = {};
      for (const r of statusRows) bookingsByStatus[r.status] = Number(r.count);

      const result: BusinessPerformanceResult = {
        periodDays,
        tenantId,
        tenantName: tenantRow?.name ?? 'Unknown business',
        bookingsByStatus,
        revenueByCurrency: revenueRows.map((r) => ({ currencyCode: r.currency_code, amountMinorUnits: Number(r.total) })),
        topServices: topServiceRows.map((r) => ({ serviceId: r.id, name: r.name, bookingCount: Number(r.booking_count) })),
        openDisputes: Number(disputeRow?.count ?? 0),
      };

      const { rows } = await client.query(
        `INSERT INTO report_run (report_type, tenant_id, period_days, requested_by, generated_by, result)
         VALUES ('business_performance', $1, $2, $3, $4, $5::jsonb)
         RETURNING *`,
        [tenantId, periodDays, requestedBy, agentUserId, JSON.stringify(result)],
      );
      return rows[0];
    });

    return toReportRun(row) as ReportRun<BusinessPerformanceResult>;
  }

  /** Platform-wide report history — the requesting admin's own withUser context supplies the RLS-checked identity. */
  async listPlatformHistory(adminUserId: string, limit = 20): Promise<ReportRun[]> {
    return this.db.withUser(adminUserId, async (client: PoolClient) => {
      const { rows } = await client.query(
        `SELECT rr.*, t.name AS tenant_name
         FROM report_run rr LEFT JOIN tenant t ON t.id = rr.tenant_id
         ORDER BY rr.created_at DESC LIMIT $1`,
        [limit],
      );
      return rows.map((r) => ({ ...toReportRun(r), tenantName: r.tenant_name ?? null }));
    });
  }

  /** A tenant's own report history (business_performance only — platform_summary rows have tenant_id NULL and never match). */
  async listTenantHistory(tenantId: string, limit = 20): Promise<ReportRun[]> {
    return this.db.withTenant(tenantId, async (client: PoolClient) => {
      const { rows } = await client.query(
        `SELECT * FROM report_run WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [tenantId, limit],
      );
      return rows.map(toReportRun);
    });
  }
}
