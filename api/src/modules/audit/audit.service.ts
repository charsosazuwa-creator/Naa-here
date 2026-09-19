import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';

export interface AuditEventInput {
  tenantId?: string | null;
  actorUserId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}

/**
 * Append-only audit log (BR-SEC-02, BR-015). The migration revokes
 * UPDATE/DELETE on audit_event from PUBLIC, so this service only ever
 * needs an INSERT statement — there is deliberately no update() or
 * remove() method here.
 */
@Injectable()
export class AuditService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * `client`: when the caller already holds a transaction client (nearly
   * every call site does, from its own withTenant()/withTransaction()),
   * pass it here so the audit insert runs on that SAME connection —
   * required for two reasons real execution against a live database
   * caught and a fake-DB-backed test cannot: (1) audit_event's RLS
   * policy needs app.tenant_id set, which withTenant() only sets on its
   * own client, not on some other pooled connection; (2) an insert like
   * business.service.ts's, which audits the tenant it just created in
   * the same still-open transaction, would otherwise hit that new
   * tenant row on a second, separate connection before the first
   * transaction commits — invisible to it, and audit_event's own FK to
   * tenant(id) then rejects the insert outright. When no client is
   * given (the handful of platform-level auth events with no tenant),
   * this opens its own short transaction instead.
   */
  async record(event: AuditEventInput, client?: PoolClient): Promise<void> {
    const text = `INSERT INTO audit_event (tenant_id, actor_user_id, action, target_type, target_id, metadata, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`;
    const params = [
      event.tenantId ?? null,
      event.actorUserId ?? null,
      event.action,
      event.targetType ?? null,
      event.targetId ?? null,
      JSON.stringify(event.metadata ?? {}),
      event.ipAddress ?? null,
    ];

    if (client) {
      await client.query(text, params);
      return;
    }

    await this.db.withOptionalTenant(event.tenantId, (c) => c.query(text, params));
  }
}
