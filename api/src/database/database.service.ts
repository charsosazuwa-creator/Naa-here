import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient } from 'pg';
import { AppConfig } from '../config/configuration';

/**
 * Thin wrapper over `pg`. No ORM: the design package (section 5) chose
 * raw SQL plus hand-written migrations so that every exclusion
 * constraint, RLS policy and trigger is visible and reviewable, rather
 * than generated.
 *
 * Tenant isolation (the database layer of the three independent layers
 * in section 10) works by setting the Postgres session variable
 * `app.tenant_id` for the lifetime of one transaction via
 * `withTenant()`. Every tenant-scoped table's RLS policy reads that
 * variable, so a bug in the API or business-rules layer still cannot
 * leak another tenant's rows — the database refuses on its own.
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(configService: ConfigService<AppConfig, true>) {
    const pgSsl = configService.get('pgSsl', { infer: true });
    this.pool = new Pool({
      connectionString: configService.get('databaseUrl', { infer: true }),
      // Render's managed Postgres presents a certificate not in
      // Node's default trust store (see configuration.ts's pgSsl and
      // the PGSSL env var). rejectUnauthorized: false still gives us
      // an encrypted connection, just without chain-of-trust
      // verification, which matches Render's own connection guidance.
      ssl: pgSsl ? { rejectUnauthorized: false } : undefined,
    });
  }

  /** Platform-level queries that are not scoped to any one tenant (e.g. registration, before a membership exists). */
  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const result = await this.pool.query(text, params);
    return result.rows as T[];
  }

  /**
   * Run `fn` inside a transaction with `app.tenant_id` set for its
   * duration, so RLS policies scope every statement to that tenant.
   */
  async withTenant<T>(tenantId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Run `fn` inside a transaction with `app.user_id` set (no tenant
   * context). Backs the one cross-tenant read customers legitimately
   * need — "my bookings" — via the booking table's second RLS policy,
   * which allows a row when it belongs to a customer_profile linked to
   * this user id, in addition to the usual tenant-match policy. See
   * migration 004's booking_visible_to_tenant_or_owning_customer policy.
   */
  async withUser<T>(userId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['app.user_id', userId]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Run `fn` inside a transaction, setting `app.tenant_id` only when a
   * tenant id is actually given. Backs AuditService.record(), which is
   * called with or without a tenant (a platform-level event has none)
   * and — unlike the rest of the app's writes — is never handed the
   * caller's own transaction client, so it needs its own way to satisfy
   * audit_event's RLS policy on its own connection. Real execution
   * against a database with RLS enabled is what caught this: every
   * tenant-scoped audit_event insert failed closed until this existed,
   * invisible to every fake-DB-backed test because those never enforce
   * RLS at all.
   */
  async withOptionalTenant<T>(tenantId: string | null | undefined, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (tenantId) {
        await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
      }
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /** Run `fn` inside a plain transaction, no tenant context (platform-level writes). */
  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
