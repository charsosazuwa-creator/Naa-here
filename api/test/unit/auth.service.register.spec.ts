import { AuthService } from '../../src/modules/identity/auth.service';
import { DatabaseService } from '../../src/database/database.service';
import { AuditService } from '../../src/modules/audit/audit.service';
import { VerificationCodeService } from '../../src/modules/identity/verification-code.service';
import { SessionService } from '../../src/modules/identity/session.service';

/**
 * Covers the signup-time verification gate: an email signup is created
 * already active with no code issued (see auth.service.ts's register()
 * for the product-decision comment), while a phone-only signup is
 * unaffected and still goes through the existing phone_verify +
 * pending_verification gate.
 */
describe('AuthService.register', () => {
  function makeService(overrides: { existingRows?: unknown[] } = {}) {
    const insertedValues: unknown[] = [];
    const db = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        if (sql.startsWith('SELECT id FROM app_user WHERE')) {
          return overrides.existingRows ?? [];
        }
        if (sql.startsWith('INSERT INTO app_user')) {
          insertedValues.push(params);
          return [{ id: 'user-1' }];
        }
        throw new Error(`Unhandled query in test fake: ${sql}`);
      }),
    } as unknown as DatabaseService;

    const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    const verificationCodes = { issue: jest.fn().mockResolvedValue(undefined) } as unknown as VerificationCodeService;
    const sessions = {} as SessionService;
    const config = {} as never;

    const service = new AuthService(db, audit, verificationCodes, sessions, config);
    return { service, db, audit, verificationCodes, insertedValues };
  }

  it('creates an email signup already active, with no verification code issued', async () => {
    const { service, verificationCodes, insertedValues } = makeService();

    const result = await service.register({
      email: 'new-user@example.com',
      password: 'abc12345',
      fullName: 'New User',
    });

    expect(result).toEqual({ userId: 'user-1', requiresVerification: false });
    expect(verificationCodes.issue).not.toHaveBeenCalled();

    // [email, phone, passwordHash, fullName, status]
    const [, , , , status] = insertedValues[0] as unknown[];
    expect(status).toBe('active');
  });

  it('still requires verification for a phone-only signup', async () => {
    const { service, verificationCodes, insertedValues } = makeService();

    const result = await service.register({
      phone: '+2348012345678',
      password: 'abc12345',
      fullName: 'New User',
    });

    expect(result).toEqual({ userId: 'user-1', requiresVerification: true });
    expect(verificationCodes.issue).toHaveBeenCalledWith('user-1', 'phone_verify', 'sms');

    const [, , , , status] = insertedValues[0] as unknown[];
    expect(status).toBe('pending_verification');
  });

  it('skips verification when both email and phone are given, matching the email precedence used elsewhere', async () => {
    const { service, verificationCodes } = makeService();

    const result = await service.register({
      email: 'new-user@example.com',
      phone: '+2348012345678',
      password: 'abc12345',
      fullName: 'New User',
    });

    expect(result.requiresVerification).toBe(false);
    expect(verificationCodes.issue).not.toHaveBeenCalled();
  });

  it('still records an audit event for an email signup', async () => {
    const { service, audit } = makeService();

    await service.register({ email: 'new-user@example.com', password: 'abc12345', fullName: 'New User' });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.register', actorUserId: 'user-1' }),
    );
  });
});
