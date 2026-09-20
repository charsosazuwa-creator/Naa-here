import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

export interface BusinessCategory {
  id: string;
  code: string;
  name: string;
}

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

/**
 * Business categories used to be a hardcoded, three-value CHECK
 * constraint on tenant.category (migration 002). Migration 018 turned
 * that into a shared, growing lookup table instead -- this service is
 * the "on the fly" half of that: given either an existing category's
 * id, or a name that may or may not exist yet, resolve it to a row,
 * creating one if needed, so a provider is never stuck picking the
 * closest of a fixed list.
 */
@Injectable()
export class BusinessCategoryService {
  constructor(private readonly db: DatabaseService) {}

  async list(): Promise<BusinessCategory[]> {
    const rows = await this.db.query<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM business_category ORDER BY name`,
    );
    return rows.map((row) => ({ id: row.id, code: row.code, name: row.name }));
  }

  /**
   * Resolves a category for a business being created/edited. `id`
   * takes priority when both are given (picking an existing option
   * from a list); `name` is looked up by its slugified code and
   * created if no category with that code exists yet.
   */
  async resolve(userId: string, input: { id?: string; name?: string }): Promise<string> {
    if (input.id) {
      const [row] = await this.db.query<{ id: string }>(`SELECT id FROM business_category WHERE id = $1`, [input.id]);
      if (!row) {
        throw new Error('That category no longer exists -- pick another or type a new one.');
      }
      return row.id;
    }

    const name = (input.name ?? '').trim();
    const code = slugify(name);
    if (!name || !code) {
      throw new Error('A business category is required.');
    }

    const [existing] = await this.db.query<{ id: string }>(`SELECT id FROM business_category WHERE code = $1`, [code]);
    if (existing) {
      return existing.id;
    }

    const [created] = await this.db.query<{ id: string }>(
      `INSERT INTO business_category (code, name, created_by) VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code
       RETURNING id`,
      [code, name, userId],
    );
    return created.id;
  }
}
