import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { BusinessCategoryService } from './business-category.service';
import { CreateBusinessDto } from './dto/create-business.dto';

export interface BusinessProfile {
  id: string;
  name: string;
  categoryId: string;
  category: string;
  businessType: 'provider' | 'artisan' | 'host';
  countryCode: string;
  description: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  verificationStatus: 'unverified' | 'pending' | 'verified' | 'rejected';
  status: string;
}

const BUSINESS_TYPE_ROLE_ID: Record<CreateBusinessDto['businessType'], number> = {
  provider: 1,
  artisan: 3,
  host: 4,
};

/**
 * Creating a business is the entry point to Phase 2 (design section 11,
 * "a provider registers, is verified, and publishes a bookable
 * service"). It creates the tenant row and, in the same transaction,
 * an 'owner' membership for the creator — so the very next request
 * they make already passes TenantRoleGuard.
 */
@Injectable()
export class BusinessService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly categories: BusinessCategoryService,
  ) {}

  async create(ownerUserId: string, dto: CreateBusinessDto): Promise<BusinessProfile> {
    let categoryId: string;
    try {
      categoryId = await this.categories.resolve(ownerUserId, { id: dto.categoryId, name: dto.categoryName });
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }

    return this.db.withTransaction(async (client) => {
      const { rows: tenantRows } = await client.query(
        `INSERT INTO tenant (name, country_code, category_id, business_type, description, contact_phone, contact_email)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, name, category_id, business_type, country_code, description, contact_phone, contact_email, verification_status, status`,
        [dto.name, dto.countryCode, categoryId, dto.businessType, dto.description ?? null, dto.contactPhone ?? null, dto.contactEmail ?? null],
      );
      const tenant = tenantRows[0];

      // Explicit now (migration 018) rather than inferred from
      // category text -- see BUSINESS_TYPE_ROLE_ID above, and that
      // migration's own comment for why. This also makes the 'host'
      // role (migration 001) reachable for the first time.
      const roleId = BUSINESS_TYPE_ROLE_ID[dto.businessType];

      // membership carries an RLS policy scoped to app.tenant_id, and
      // this transaction started with no tenant context (the tenant
      // didn't exist yet). Only real execution against a database with
      // RLS actually enabled ever caught this — every fake-DB-backed
      // unit/e2e test skips RLS entirely, so this insert had silently
      // never worked. Set the session var to the tenant we just created
      // before inserting its owner's membership row.
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenant.id]);

      await client.query(
        `INSERT INTO membership (tenant_id, user_id, role_id, status) VALUES ($1, $2, $3, 'active')`,
        [tenant.id, ownerUserId, roleId],
      );

      await this.audit.record({
        tenantId: tenant.id,
        actorUserId: ownerUserId,
        action: 'business.create',
        targetType: 'tenant',
        targetId: tenant.id,
      }, client);

      return toBusinessProfile({ ...tenant, category_name: await this.categoryName(categoryId) });
    });
  }

  /**
   * The businesses this user is an active member of, across every
   * tenant — what the provider portal's tenant switcher calls right
   * after sign-in. Runs under withUser(), not withTenant(), since no
   * single tenantId is known yet; relies on migration 007's added RLS
   * policy on membership (see that migration's own comment for why the
   * original tenant-scoped policy alone isn't enough here).
   */
  async listForUser(userId: string): Promise<(BusinessProfile & { roleCode: string })[]> {
    return this.db.withUser(userId, async (client) => {
      const { rows } = await client.query(
        `SELECT t.id, t.name, t.category_id, bc.name AS category_name, t.business_type, t.country_code,
                t.description, t.contact_phone, t.contact_email,
                t.verification_status, t.status, r.code AS role_code
         FROM membership m
         JOIN tenant t ON t.id = m.tenant_id
         JOIN role r ON r.id = m.role_id
         JOIN business_category bc ON bc.id = t.category_id
         WHERE m.user_id = $1 AND m.status = 'active'
         ORDER BY t.name`,
        [userId],
      );
      return rows.map((row) => ({ ...toBusinessProfile(row), roleCode: row.role_code as string }));
    });
  }

  async findById(tenantId: string): Promise<BusinessProfile> {
    const rows = await this.db.query(
      `SELECT t.id, t.name, t.category_id, bc.name AS category_name, t.business_type, t.country_code,
              t.description, t.contact_phone, t.contact_email, t.verification_status, t.status
       FROM tenant t JOIN business_category bc ON bc.id = t.category_id
       WHERE t.id = $1`,
      [tenantId],
    );
    if (rows.length === 0) {
      throw new NotFoundException('Business not found.');
    }
    return toBusinessProfile(rows[0]);
  }

  private async categoryName(categoryId: string): Promise<string> {
    const [row] = await this.db.query<{ name: string }>(`SELECT name FROM business_category WHERE id = $1`, [categoryId]);
    return row?.name ?? '';
  }
}

function toBusinessProfile(row: Record<string, unknown>): BusinessProfile {
  return {
    id: row.id as string,
    name: row.name as string,
    categoryId: row.category_id as string,
    category: row.category_name as string,
    businessType: row.business_type as BusinessProfile['businessType'],
    countryCode: row.country_code as string,
    description: (row.description as string) ?? null,
    contactPhone: (row.contact_phone as string) ?? null,
    contactEmail: (row.contact_email as string) ?? null,
    verificationStatus: row.verification_status as BusinessProfile['verificationStatus'],
    status: row.status as string,
  };
}
