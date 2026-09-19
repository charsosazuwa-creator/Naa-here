import { Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'crypto';
import * as argon2 from 'argon2';
import { DatabaseService } from '../../database/database.service';
import { AppConfig } from '../../config/configuration';

export type VerificationPurpose = 'email_verify' | 'phone_verify' | 'password_reset';

/**
 * Generates, stores (hashed) and checks one-time codes.
 *
 * IMPORTANT — this milestone's sender is a MOCK. `send()` never calls a
 * real SMS or email provider: it writes the six-digit code to the
 * server log (`Logger`, at `warn` level so it is easy to spot and
 * cannot be mistaken for routine output) and returns. This mirrors the
 * "Done when" criterion in design section 15: the sender must be
 * clearly labelled as a mock, not a stub trying to look real. Real
 * providers are chosen in Q2 (payment/communication provider
 * selection) and swapped in behind this same interface.
 */
@Injectable()
export class VerificationCodeService {
  private readonly logger = new Logger('MockVerificationSender');

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async issue(userId: string, purpose: VerificationPurpose, channel: 'email' | 'sms'): Promise<void> {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const codeHash = await argon2.hash(code);
    const ttlMinutes = this.config.get('verification', { infer: true }).codeTtlMinutes;

    await this.db.query(
      `INSERT INTO verification_code (user_id, purpose, code_hash, channel, expires_at)
       VALUES ($1, $2, $3, $4, now() + ($5 || ' minutes')::interval)`,
      [userId, purpose, codeHash, channel, ttlMinutes],
    );

    this.send(userId, purpose, channel, code);
  }

  /** MOCK SENDER — logs only. Never sends a real message. Replace before production. */
  private send(userId: string, purpose: VerificationPurpose, channel: 'email' | 'sms', code: string): void {
    this.logger.warn(
      `[MOCK ${channel.toUpperCase()} SEND — NOT ACTUALLY SENT] user=${userId} purpose=${purpose} code=${code}`,
    );
  }

  /** Verifies a code and marks it consumed. Throws on wrong/expired/reused code or too many attempts. */
  async verify(userId: string, purpose: VerificationPurpose, submittedCode: string): Promise<void> {
    const maxAttempts = this.config.get('verification', { infer: true }).maxAttempts;

    const [record] = await this.db.query<{
      id: string;
      code_hash: string;
      expires_at: string;
      consumed_at: string | null;
      attempt_count: number;
    }>(
      `SELECT id, code_hash, expires_at, consumed_at, attempt_count
       FROM verification_code
       WHERE user_id = $1 AND purpose = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, purpose],
    );

    if (!record) {
      throw new UnprocessableEntityException('No verification code was requested for this account.');
    }
    if (record.consumed_at) {
      throw new UnprocessableEntityException('This code has already been used. Request a new one.');
    }
    if (new Date(record.expires_at).getTime() < Date.now()) {
      throw new UnprocessableEntityException('This code has expired. Request a new one.');
    }
    if (record.attempt_count >= maxAttempts) {
      throw new UnprocessableEntityException('Too many attempts. Request a new code.');
    }

    const matches = await argon2.verify(record.code_hash, submittedCode);

    await this.db.query(`UPDATE verification_code SET attempt_count = attempt_count + 1 WHERE id = $1`, [
      record.id,
    ]);

    if (!matches) {
      throw new UnprocessableEntityException('That code is incorrect.');
    }

    await this.db.query(`UPDATE verification_code SET consumed_at = now() WHERE id = $1`, [record.id]);
  }
}
