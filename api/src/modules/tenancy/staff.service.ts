import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';

export interface StaffMember {
  membershipId: string;
  userId: string;
  fullName: string;
  email: string | null;
  roleCode: string;
  status: string;
}

/**
 * Invites an EXISTING registered user to join a business as staff.
 * Inviting someone who has no account yet (by email, before they sign
 * up) is a later phase — the design's invitation flow for a
 * not-yet-registered person needs its own token/acceptance-page work
 * that is out of scope for this milestone's "Done when" criterion.
 */
@Injectable()
export class StaffService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async invite(tenantId: string, invitedByUserId: string, email: string, roleCode: 'staff'): Promise<StaffMember> {
    const [user] = await this.db.query<{ id: string; full_name: string; email: string | null }>(
      `SELECT id, full_name, email FROM app_user WHERE email = $1`,
      [email],
    );
    if (!user) {
      throw new NotFoundException('No account exists yet for that email. They need to register first.');
    }

    const [role] = await this.db.query<{ id: number }>(`SELECT id FROM role WHERE code = $1`, [roleCode]);

    return this.db.withTenant(tenantId, async (client) => {
      const { rows: existing } = await client.query(`SELECT id FROM membership WHERE tenant_id = $1 AND user_id = $2`, [
        tenantId,
        user.id,
      ]);
      if (existing.length > 0) {
        throw new ConflictException('This person is already a member of this business.');
      }

      const { rows } = await client.query(
        `INSERT INTO membership (tenant_id, user_id, role_id, status, invited_by)
         VALUES ($1, $2, $3, 'invited', $4)
         RETURNING id`,
        [tenantId, user.id, role.id, invitedByUserId],
      );

      await this.audit.record({
        tenantId,
        actorUserId: invitedByUserId,
        action: 'staff.invite',
        targetType: 'membership',
        targetId: rows[0].id,
        metadata: { invitedUserId: user.id, roleCode },
      }, client);

      return {
        membershipId: rows[0].id,
        userId: user.id,
        fullName: user.full_name,
        email: user.email,
        roleCode,
        status: 'invited',
      };
    });
  }

  async accept(tenantId: string, userId: string): Promise<void> {
    await this.db.withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `UPDATE membership SET status = 'active', updated_at = now()
         WHERE tenant_id = $1 AND user_id = $2 AND status = 'invited'
         RETURNING id`,
        [tenantId, userId],
      );
      if (rows.length === 0) {
        throw new NotFoundException('No pending invitation found for this business.');
      }
    });
  }

  async listForTenant(tenantId: string): Promise<StaffMember[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT m.id AS membership_id, u.id AS user_id, u.full_name, u.email, r.code AS role_code, m.status
         FROM membership m
         JOIN app_user u ON u.id = m.user_id
         JOIN role r ON r.id = m.role_id
         WHERE m.tenant_id = $1
         ORDER BY m.created_at ASC`,
        [tenantId],
      );
      return rows.map((row) => ({
        membershipId: row.membership_id,
        userId: row.user_id,
        fullName: row.full_name,
        email: row.email,
        roleCode: row.role_code,
        status: row.status,
      }));
    });
  }
}
