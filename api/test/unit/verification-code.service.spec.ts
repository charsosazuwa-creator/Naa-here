import * as argon2 from 'argon2';
import { VerificationCodeService } from '../../src/modules/identity/verification-code.service';
import { DatabaseService } from '../../src/database/database.service';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../src/config/configuration';

function makeConfig(overrides: Partial<{ codeTtlMinutes: number; maxAttempts: number }> = {}) {
  return {
    get: () => ({ codeTtlMinutes: 15, maxAttempts: 5, ...overrides }),
  } as unknown as ConfigService<AppConfig, true>;
}

describe('VerificationCodeService', () => {
  it('issue() stores a hashed code, never the code itself', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const db = { query } as unknown as DatabaseService;
    const service = new VerificationCodeService(db, makeConfig());

    await service.issue('user-1', 'email_verify', 'email');

    expect(query).toHaveBeenCalledTimes(1);
    const [, params] = query.mock.calls[0] as [string, unknown[]];
    const storedHash = params[2] as string;
    // argon2 hashes never contain the plaintext six-digit code as a substring
    // in a way that would let it be read back out.
    expect(storedHash.startsWith('$argon2')).toBe(true);
  });

  it('verify() rejects an expired code', async () => {
    const expiredRecord = {
      id: 'code-1',
      code_hash: await argon2.hash('123456'),
      expires_at: new Date(Date.now() - 60_000).toISOString(),
      consumed_at: null,
      attempt_count: 0,
    };
    const query = jest.fn().mockResolvedValueOnce([expiredRecord]);
    const db = { query } as unknown as DatabaseService;
    const service = new VerificationCodeService(db, makeConfig());

    await expect(service.verify('user-1', 'email_verify', '123456')).rejects.toThrow('expired');
  });

  it('verify() rejects a code that was already consumed', async () => {
    const consumedRecord = {
      id: 'code-1',
      code_hash: await argon2.hash('123456'),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      consumed_at: new Date().toISOString(),
      attempt_count: 0,
    };
    const query = jest.fn().mockResolvedValueOnce([consumedRecord]);
    const db = { query } as unknown as DatabaseService;
    const service = new VerificationCodeService(db, makeConfig());

    await expect(service.verify('user-1', 'email_verify', '123456')).rejects.toThrow('already been used');
  });

  it('verify() rejects once attempt_count has reached the configured maximum', async () => {
    const record = {
      id: 'code-1',
      code_hash: await argon2.hash('123456'),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      consumed_at: null,
      attempt_count: 5,
    };
    const query = jest.fn().mockResolvedValueOnce([record]);
    const db = { query } as unknown as DatabaseService;
    const service = new VerificationCodeService(db, makeConfig({ maxAttempts: 5 }));

    await expect(service.verify('user-1', 'email_verify', '123456')).rejects.toThrow('Too many attempts');
  });

  it('verify() succeeds and marks the code consumed when the code matches', async () => {
    const record = {
      id: 'code-1',
      code_hash: await argon2.hash('123456'),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      consumed_at: null,
      attempt_count: 0,
    };
    const query = jest
      .fn()
      .mockResolvedValueOnce([record]) // SELECT
      .mockResolvedValueOnce([]) // UPDATE attempt_count
      .mockResolvedValueOnce([]); // UPDATE consumed_at
    const db = { query } as unknown as DatabaseService;
    const service = new VerificationCodeService(db, makeConfig());

    await expect(service.verify('user-1', 'email_verify', '123456')).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(3);
    expect(String(query.mock.calls[2][0])).toContain('consumed_at = now()');
  });
});
