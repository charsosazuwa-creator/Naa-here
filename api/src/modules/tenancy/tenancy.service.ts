import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

export interface Membership {
  id: string;
  tenantId: string;
  userId: string;
  roleCode: string;
  status: 'invited' | 'active' | 'suspended' | 'removed';
}

/**
 * Tenancy and organisation module (design package section 6, "Modules
 * and what may be extracted later"). Milestone 1 only needs enough of
 * this module to answer "which tenants, and with which role, is this
 * user a member of" for /v1/me — the fuller business-management surface
 * (creating tenants, inviting staff) is a later milestone.
 */
@Injectable()
export class TenancyService {
  constructor(private readonly db: DatabaseService) {}

  async membershipsForUser(userId: string): Promise<Membership[]> {
    const rows = await this.db.query<{
      id: string;
      tenant_id: string;
      user_id: string;
      role_code: string;
      status: Membership['status'];
    }>(
      `SELECT m.id, m.tenant_id, m.user_id, r.code AS role_code, m.status
       FROM membership m
       JOIN role r ON r.id = m.role_id
       WHERE m.user_id = $1`,
      [userId],
    );

    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      roleCode: row.role_code,
      status: row.status,
    }));
  }
}
