import { Inject, Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'crypto';
import * as argon2 from 'argon2';
import { DatabaseService } from '../../database/database.service';
import { AppConfig } from '../../config/configuration';
import { EMAIL_PROVIDER, EmailProvider } from '../notifications/email-provider.interface';

export type VerificationPurpose = 'email_verify' | 'phone_verify' | 'password_reset';

/**
 * Generates, stores (hashed) and checks one-time codes.
 *
 * Email delivery goes through EmailProvider (see notifications/), which
 * is either MockEmailProvider (logs the code, same behavior this
 * service always had) or ResendEmailProvider (a real send), chosen by
 * the EMAIL_PROVIDER env var — see notifications.module.ts. SMS
 * delivery (channel: 'sms') is still mock-only: it's logged the same
 * way it always was, pending a chosen SMS provider (Termii/Twilio/etc.)
 * getting the same treatment as a follow-up.
 *
 * A failed email send is logged but does not throw out of issue():
 * the code is already persisted and still checkable (e.g. by reading
 * server logs, or once delivery is fixed and the user hits "resend"),
 * so a transient provider outage shouldn't turn into a 500 on
 * signup/login just because the follow-up email didn't go out.
 */
@Injectable()
export class VerificationCodeService {
  private readonly logger = new Logger('VerificationCodeService');

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService<AppConfig, true>,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
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

    await this.send(userId, purpose, channel, code, ttlMinutes);
  }

  private async send(
    userId: string,
    purpose: VerificationPurpose,
    channel: 'email' | 'sms',
    code: string,
    ttlMinutes: number,
  ): Promise<void> {
    if (channel === 'sms') {
      // No real SMS provider wired up yet — see the class comment.
      this.logger.warn(`[MOCK SMS SEND — NOT ACTUALLY SENT] user=${userId} purpose=${purpose} code=${code}`);
      return;
    }

    const [user] = await this.db.query<{ email: string | null; full_name: string | null }>(
      `SELECT email, full_name FROM app_user WHERE id = $1`,
      [userId],
    );

    if (!user?.email) {
      // Shouldn't happen (issue() is only called with channel:'email'
      // when the account has an email on file), but fail loud rather
      // than silently dropping the code if it ever does.
      this.logger.error(`No email on file for user=${userId} (purpose=${purpose}) — could not send verification code.`);
      return;
    }

    const greetingName = user.full_name?.split(' ')[0] || 'there';
    const purposeCopy: Record<VerificationPurpose, string> = {
      email_verify: 'Confirm your email to finish setting up your Naa here account.',
      phone_verify: 'Confirm your phone number.',
      password_reset: 'Reset your Naa here password.',
    };

    const text = `Hi ${greetingName},

${purposeCopy[purpose]}

Your verification code is: ${code}

This code expires in ${ttlMinutes} minutes. If you didn't request this, you can ignore this email.

— Naa here`;
    const html = `<p>Hi ${greetingName},</p><p>${purposeCopy[purpose]}</p><p style="font-size:28px;font-weight:700;letter-spacing:4px;">${code}</p><p>This code expires in ${ttlMinutes} minutes. If you didn't request this, you can ignore this email.</p><p>— Naa here</p>`;

    try {
      await this.emailProvider.send({
        to: user.email,
        subject: purpose === 'password_reset' ? 'Your Naa here password reset code' : 'Your Naa here verification code',
        text,
        html,
      });
    } catch (err) {
      this.logger.error(
        `Failed to send verification email (provider=${this.emailProvider.name}) to user=${userId}: ${(err as Error).message}`,
      );
    }
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
