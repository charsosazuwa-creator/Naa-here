import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { DatabaseService } from '../../src/database/database.service';

/**
 * Exercises the identity module's HTTP surface end to end: register,
 * verify (using the code the mock sender wrote to the log — captured
 * here directly instead, since the real DB round trip is faked), then
 * sign in. This is the "Done when" scenario from design section 15.
 *
 * The real PostgreSQL connection is replaced with an in-memory fake so
 * this suite runs without a live database; test/db/*.spec.ts covers
 * behaviour (RLS, exclusion constraints) that only a real Postgres can
 * enforce.
 */

interface FakeUser {
  id: string;
  email: string | null;
  phone: string | null;
  password_hash: string;
  full_name: string;
  preferred_language: string;
  status: string;
  email_verified_at: string | null;
  phone_verified_at: string | null;
  failed_login_count: number;
  locked_until: string | null;
  created_at: string;
  updated_at: string;
}

interface FakeCode {
  id: string;
  user_id: string;
  purpose: string;
  code_hash: string;
  channel: string;
  expires_at: string;
  consumed_at: string | null;
  attempt_count: number;
  created_at: string;
}

class FakeDatabaseService {
  users: FakeUser[] = [];
  codes: FakeCode[] = [];
  sessions: { id: string; user_id: string; refresh_token_hash: string; revoked_at: string | null; expires_at: string }[] = [];

  async query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
    const sql = text.replace(/\s+/g, ' ').trim();

    if (sql.startsWith('SELECT id FROM app_user WHERE')) {
      const [email, phone] = params as [string | null, string | null];
      return this.users.filter((u) => (email && u.email === email) || (phone && u.phone === phone)) as unknown as T[];
    }

    if (sql.startsWith('INSERT INTO app_user')) {
      const [email, phone, passwordHash, fullName] = params as [string | null, string | null, string, string];
      // register/login/verify DTOs are @IsUUID()-validated against the
      // real schema's gen_random_uuid() ids (the same fix already made
      // in booking/admin-finance/provider-crm's fakes), so a sequential
      // 'user-1' string here would make ValidationPipe 400 every route
      // that takes this id back as input, such as POST /auth/verify.
      const user: FakeUser = {
        id: randomUUID(),
        email,
        phone,
        password_hash: passwordHash,
        full_name: fullName,
        preferred_language: 'en',
        status: 'pending_verification',
        email_verified_at: null,
        phone_verified_at: null,
        failed_login_count: 0,
        locked_until: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      this.users.push(user);
      return [{ id: user.id }] as unknown as T[];
    }

    if (sql.startsWith('INSERT INTO verification_code')) {
      const [userId, purpose, codeHash, channel] = params as [string, string, string, string];
      const code: FakeCode = {
        id: randomUUID(),
        user_id: userId,
        purpose,
        code_hash: codeHash,
        channel,
        expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
        consumed_at: null,
        attempt_count: 0,
        created_at: new Date().toISOString(),
      };
      this.codes.push(code);
      return [] as unknown as T[];
    }

    if (sql.startsWith('SELECT id, code_hash, expires_at, consumed_at, attempt_count')) {
      const [userId, purpose] = params as [string, string];
      const matches = this.codes
        .filter((c) => c.user_id === userId && c.purpose === purpose)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      return matches.slice(0, 1) as unknown as T[];
    }

    if (sql.startsWith('UPDATE verification_code SET attempt_count')) {
      const [id] = params as [string];
      const code = this.codes.find((c) => c.id === id);
      if (code) code.attempt_count += 1;
      return [] as unknown as T[];
    }

    if (sql.startsWith('UPDATE verification_code SET consumed_at')) {
      const [id] = params as [string];
      const code = this.codes.find((c) => c.id === id);
      if (code) code.consumed_at = new Date().toISOString();
      return [] as unknown as T[];
    }

    if (sql.startsWith('UPDATE app_user SET email_verified_at') || sql.startsWith('UPDATE app_user SET phone_verified_at')) {
      const [id] = params as [string];
      const user = this.users.find((u) => u.id === id);
      if (user) {
        if (sql.includes('email_verified_at')) user.email_verified_at = new Date().toISOString();
        if (sql.includes('phone_verified_at')) user.phone_verified_at = new Date().toISOString();
        user.status = 'active';
      }
      return [] as unknown as T[];
    }

    if (sql.startsWith('SELECT * FROM app_user WHERE')) {
      const [email, phone] = params as [string | null, string | null];
      return this.users.filter((u) => (email && u.email === email) || (phone && u.phone === phone)) as unknown as T[];
    }

    if (sql.startsWith('UPDATE app_user SET failed_login_count = 0')) {
      const [id] = params as [string];
      const user = this.users.find((u) => u.id === id);
      if (user) {
        user.failed_login_count = 0;
        user.locked_until = null;
      }
      return [] as unknown as T[];
    }

    if (sql.startsWith('INSERT INTO user_session')) {
      const [userId, refreshTokenHash] = params as [string, string];
      this.sessions.push({
        id: randomUUID(),
        user_id: userId,
        refresh_token_hash: refreshTokenHash,
        revoked_at: null,
        expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      });
      return [] as unknown as T[];
    }

    // Anything unhandled (e.g. audit_event inserts, health check SELECT 1) is a harmless no-op for this suite.
    return [] as unknown as T[];
  }

  async withTenant<T>(_tenantId: string, fn: (client: unknown) => Promise<T>): Promise<T> {
    return fn(undefined);
  }

  // AuditService.record() calls this when it has no transaction client
  // of its own to reuse — every auth event here (no tenant yet at
  // registration, or a tenant-less action) goes through this path. This
  // fake has no RLS to enforce, so the client just delegates straight
  // back to this.query(), wrapped in the {rows} shape a real
  // PoolClient.query() returns (AuditService.record() only ever calls
  // client.query() with the audit_event INSERT here, so nothing else
  // needs to be modeled).
  async withOptionalTenant<T>(_tenantId: string | null | undefined, fn: (client: { query: (t: string, p?: unknown[]) => Promise<{ rows: unknown[] }> }) => Promise<T>): Promise<T> {
    return fn({ query: async (t: string, p: unknown[] = []) => ({ rows: await this.query(t, p) }) });
  }

  async withTransaction<T>(fn: (client: unknown) => Promise<T>): Promise<T> {
    return fn(undefined);
  }

  async onModuleDestroy(): Promise<void> {
    /* no-op */
  }
}

describe('Auth flow (e2e)', () => {
  let app: INestApplication;
  let loggedCodes: string[];

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';

    loggedCodes = [];
    // The mock sender writes codes via Logger.warn (see
    // verification-code.service.ts). This test stands in for "read the
    // code off the server log" by capturing that same warn call,
    // instead of trying to invert the one-way argon2 hash.
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(function (this: unknown, message: unknown) {
      const text = String(message);
      const match = text.match(/code=(\d{6})/);
      if (match) loggedCodes.push(match[1]);
      return undefined as unknown as Logger;
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService)
      .useClass(FakeDatabaseService)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.setGlobalPrefix('v1', { exclude: ['health/live', 'health/ready'] });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers, verifies, and signs in a new user end to end', async () => {
    const server = app.getHttpServer();

    const registerRes = await request(server)
      .post('/v1/auth/register')
      .send({ email: 'chidi@example.com', password: 'letMeIn123', fullName: 'Chidi Okafor' })
      .expect(201);

    const userId = registerRes.body.userId as string;
    expect(userId).toBeTruthy();

    expect(loggedCodes.length).toBeGreaterThan(0);
    const plainCode = loggedCodes[loggedCodes.length - 1];

    await request(server)
      .post('/v1/auth/verify')
      .send({ userId, purpose: 'email_verify', code: plainCode })
      .expect(200, { verified: true });

    const loginRes = await request(server)
      .post('/v1/auth/login')
      .send({ email: 'chidi@example.com', password: 'letMeIn123' })
      .expect(200);

    expect(loginRes.body.accessToken).toBeTruthy();
    expect(loginRes.body.refreshToken).toBeTruthy();
    expect(loginRes.body.user.status).toBe('active');
  });

  it('rejects sign-in with the wrong password without revealing whether the account exists', async () => {
    const server = app.getHttpServer();
    const res = await request(server)
      .post('/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'whatever123' })
      .expect(401);

    // Nest's default exception filter puts the message at the top level
    // ({statusCode, message, error}), not nested under `error` — this
    // assertion targeted a shape the API never actually returns.
    expect(res.body.message).toBe('Incorrect email/phone or password.');
  });

  it('rejects a malformed registration payload with 400', async () => {
    const server = app.getHttpServer();
    await request(server).post('/v1/auth/register').send({ password: 'short', fullName: '' }).expect(400);
  });
});
