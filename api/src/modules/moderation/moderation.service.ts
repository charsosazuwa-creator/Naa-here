import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';

export interface ModerationAction {
  id: string;
  serviceId: string;
  action: 'suspended' | 'reinstated';
  reason: string | null;
}

/**
 * Listing moderation (design section 11, phase 5). Platform-level, not
 * tenant-membership-based — see PlatformPermissionGuard, the same
 * pattern verification.decide already uses. A suspended listing keeps
 * its 'published' status (so reinstating doesn't need the provider to
 * re-publish) but booking.service.ts and job.service.ts both check
 * moderation_status separately and reject a suspended one even though
 * status = 'published'.
 */
@Injectable()
export class ModerationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async suspend(tenantId: string, serviceId: string, actorUserId: string, reason: string): Promise<ModerationAction> {
    return this.db.withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `UPDATE service SET moderation_status = 'suspended', updated_at = now()
         WHERE id = $1 AND tenant_id = $2
         RETURNING id`,
        [serviceId, tenantId],
      );
      if (rows.length === 0) {
        throw new NotFoundException('Service not found.');
      }

      const { rows: actionRows } = await client.query(
        `INSERT INTO listing_moderation_action (service_id, tenant_id, action, reason, actor_user_id)
         VALUES ($1, $2, 'suspended', $3, $4)
         RETURNING id, service_id, action, reason`,
        [serviceId, tenantId, reason, actorUserId],
      );

      await this.audit.record({
        tenantId,
        actorUserId,
        action: 'listing.suspend',
        targetType: 'service',
        targetId: serviceId,
        metadata: { reason },
      }, client);

      return toAction(actionRows[0]);
    });
  }

  async reinstate(tenantId: string, serviceId: string, actorUserId: string, reason: string | undefined): Promise<ModerationAction> {
    return this.db.withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `UPDATE service SET moderation_status = 'active', updated_at = now()
         WHERE id = $1 AND tenant_id = $2
         RETURNING id`,
        [serviceId, tenantId],
      );
      if (rows.length === 0) {
        throw new NotFoundException('Service not found.');
      }

      const { rows: actionRows } = await client.query(
        `INSERT INTO listing_moderation_action (service_id, tenant_id, action, reason, actor_user_id)
         VALUES ($1, $2, 'reinstated', $3, $4)
         RETURNING id, service_id, action, reason`,
        [serviceId, tenantId, reason ?? null, actorUserId],
      );

      await this.audit.record({
        tenantId,
        actorUserId,
        action: 'listing.reinstate',
        targetType: 'service',
        targetId: serviceId,
      }, client);

      return toAction(actionRows[0]);
    });
  }

  async listForTenant(tenantId: string): Promise<ModerationAction[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT id, service_id, action, reason FROM listing_moderation_action
         WHERE tenant_id = $1 ORDER BY created_at DESC`,
        [tenantId],
      );
      return rows.map(toAction);
    });
  }
}

function toAction(row: Record<string, unknown>): ModerationAction {
  return {
    id: row.id as string,
    serviceId: row.service_id as string,
    action: row.action as ModerationAction['action'],
    reason: (row.reason as string) ?? null,
  };
}
