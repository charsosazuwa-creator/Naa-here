import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { AppConfig } from '../../config/configuration';
import { assertPasswordStrength, hashPassword, verifyPassword } from './password.util';
import { VerificationCodeService } from './verification-code.service';
import { SessionService, TokenPair } from './session.service';
import { RegisterDto } from './dto/register.dto';

export interface PublicUser {
  id: string;
  email: string | null;
  phone: string | null;
  fullName: string;
  preferredLanguage: string;
  status: string;
}

// A `type` alias, not an `interface`: DatabaseService.query<T>()'s generic
// constrains T to `Record<string, unknown>`, and a named `interface` (unlike
// an equivalent type alias or object literal) isn't structurally assignable
// to that constraint under this project's tsconfig — TS2344. Every other
// row-shape interface in this codebase is a small inline object literal
// passed straight to query<{...}>(), so this file was the only place the
// gap showed up.
type UserRow = {
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
};

/**
 * The Identity & Access module's business logic (design section 6). Every
 * write here is followed by an audit_event, and every credential check
 * fails closed: an ambiguous state (user not found, wrong password,
 * account locked) never leaks which condition applied, per master
 * prompt section 8 — sign-in errors are deliberately generic.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly verificationCodes: VerificationCodeService,
    private readonly sessions: SessionService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async register(dto: RegisterDto, ipAddress?: string): Promise<{ userId: string }> {
    assertPasswordStrength(dto.password);

    const existing = await this.db.query<{ id: string }>(
      `SELECT id FROM app_user WHERE (email IS NOT NULL AND email = $1) OR (phone IS NOT NULL AND phone = $2)`,
      [dto.email ?? null, dto.phone ?? null],
    );
    if (existing.length > 0) {
      // Deliberately vague: does not reveal whether the email or the
      // phone was the one that collided (avoids account enumeration).
      throw new ConflictException('An account with these details may already exist.');
    }

    const passwordHash = await hashPassword(dto.password);

    const [user] = await this.db.query<{ id: string }>(
      `INSERT INTO app_user (email, phone, password_hash, full_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [dto.email ?? null, dto.phone ?? null, passwordHash, dto.fullName],
    );

    await this.audit.record({
      actorUserId: user.id,
      action: 'auth.register',
      targetType: 'app_user',
      targetId: user.id,
      ipAddress,
    });

    const channel: 'email' | 'sms' = dto.email ? 'email' : 'sms';
    const purpose = dto.email ? 'email_verify' : 'phone_verify';
    await this.verificationCodes.issue(user.id, purpose, channel);

    return { userId: user.id };
  }

  async verify(userId: string, purpose: 'email_verify' | 'phone_verify', code: string): Promise<void> {
    await this.verificationCodes.verify(userId, purpose, code);

    const column = purpose === 'email_verify' ? 'email_verified_at' : 'phone_verified_at';
    await this.db.query(
      `UPDATE app_user SET ${column} = now(), status = 'active', updated_at = now() WHERE id = $1`,
      [userId],
    );

    await this.audit.record({ actorUserId: userId, action: `auth.${purpose}`, targetType: 'app_user', targetId: userId });
  }

  async resendVerification(userId: string, purpose: 'email_verify' | 'phone_verify'): Promise<void> {
    const [user] = await this.findUserById(userId);
    const channel: 'email' | 'sms' = purpose === 'email_verify' ? 'email' : 'sms';
    await this.verificationCodes.issue(user.id, purpose, channel);
  }

  async login(
    identifier: { email?: string; phone?: string },
    password: string,
    userAgent?: string,
    ipAddress?: string,
  ): Promise<{ user: PublicUser; tokens: TokenPair }> {
    const rows = await this.db.query<UserRow>(
      `SELECT * FROM app_user WHERE (email IS NOT NULL AND email = $1) OR (phone IS NOT NULL AND phone = $2)`,
      [identifier.email ?? null, identifier.phone ?? null],
    );
    const user = rows[0];

    // Generic failure for "no such user" and "wrong password" alike.
    const genericFailure = () => new UnauthorizedException('Incorrect email/phone or password.');

    if (!user) {
      throw genericFailure();
    }

    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      throw new ForbiddenException('This account is temporarily locked. Try again later.');
    }

    const passwordOk = await verifyPassword(user.password_hash, password);
    if (!passwordOk) {
      await this.registerFailedLogin(user);
      throw genericFailure();
    }

    if (user.status !== 'active') {
      throw new ForbiddenException('Please verify your account before signing in.');
    }

    await this.db.query(
      `UPDATE app_user SET failed_login_count = 0, locked_until = NULL, updated_at = now() WHERE id = $1`,
      [user.id],
    );

    const tokens = await this.sessions.issue(user.id, userAgent, ipAddress);

    await this.audit.record({ actorUserId: user.id, action: 'auth.login', targetType: 'app_user', targetId: user.id, ipAddress });

    return { user: toPublicUser(user), tokens };
  }

  private async registerFailedLogin(user: UserRow): Promise<void> {
    const { maxFailedAttempts, lockoutMinutes } = this.config.get('login', { infer: true });
    const nextCount = user.failed_login_count + 1;

    if (nextCount >= maxFailedAttempts) {
      await this.db.query(
        `UPDATE app_user
         SET failed_login_count = $2, locked_until = now() + ($3 || ' minutes')::interval, updated_at = now()
         WHERE id = $1`,
        [user.id, nextCount, lockoutMinutes],
      );
      await this.audit.record({ actorUserId: user.id, action: 'auth.locked', targetType: 'app_user', targetId: user.id });
    } else {
      await this.db.query(`UPDATE app_user SET failed_login_count = $2, updated_at = now() WHERE id = $1`, [
        user.id,
        nextCount,
      ]);
    }
  }

  async refresh(refreshToken: string, userAgent?: string, ipAddress?: string): Promise<TokenPair> {
    return this.sessions.rotate(refreshToken, userAgent, ipAddress);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.sessions.revoke(refreshToken);
  }

  async forgotPassword(identifier: { email?: string; phone?: string }): Promise<void> {
    const rows = await this.db.query<UserRow>(
      `SELECT * FROM app_user WHERE (email IS NOT NULL AND email = $1) OR (phone IS NOT NULL AND phone = $2)`,
      [identifier.email ?? null, identifier.phone ?? null],
    );
    const user = rows[0];
    // Always behaves as "if an account exists, a code was sent" without
    // confirming or denying existence in the response (BR-SEC, avoids
    // account enumeration). If there's no user, silently do nothing.
    if (user) {
      const channel: 'email' | 'sms' = user.email ? 'email' : 'sms';
      await this.verificationCodes.issue(user.id, 'password_reset', channel);
    }
  }

  async resetPassword(
    identifier: { email?: string; phone?: string },
    code: string,
    newPassword: string,
  ): Promise<void> {
    assertPasswordStrength(newPassword);

    const rows = await this.db.query<UserRow>(
      `SELECT * FROM app_user WHERE (email IS NOT NULL AND email = $1) OR (phone IS NOT NULL AND phone = $2)`,
      [identifier.email ?? null, identifier.phone ?? null],
    );
    const user = rows[0];
    if (!user) {
      // Same generic failure as an incorrect code, so this endpoint
      // never confirms or denies whether the account exists either.
      throw new UnauthorizedException('That code is incorrect or has expired.');
    }

    await this.verificationCodes.verify(user.id, 'password_reset', code);

    const passwordHash = await hashPassword(newPassword);
    // Receiving and entering a code sent to the account's own email or
    // phone is at least as strong a proof of ownership as the signup
    // verification step, so a successful reset also verifies the
    // channel it went through and activates the account. Without
    // this, an account that never finished the original signup-time
    // verification (e.g. the browser tab was closed before entering
    // the code) had no self-service way back in: this same identifier
    // has no user ID to resend a fresh code against.
    const verifiedChannelColumn = user.email ? 'email_verified_at' : 'phone_verified_at';
    await this.db.query(
      `UPDATE app_user
       SET password_hash = $2, updated_at = now(), status = 'active',
           ${verifiedChannelColumn} = COALESCE(${verifiedChannelColumn}, now())
       WHERE id = $1`,
      [user.id, passwordHash],
    );

    // A password reset invalidates every existing session (master
    // prompt section 8: "password reset ending old sessions").
    await this.db.query(`UPDATE user_session SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [
      user.id,
    ]);

    await this.audit.record({ actorUserId: user.id, action: 'auth.password_reset', targetType: 'app_user', targetId: user.id });
  }

  async me(userId: string): Promise<PublicUser> {
    const [user] = await this.findUserById(userId);
    return toPublicUser(user);
  }

  async updateMe(userId: string, updates: { fullName?: string; preferredLanguage?: string }): Promise<PublicUser> {
    const [user] = await this.db.query<UserRow>(
      `UPDATE app_user
       SET full_name = COALESCE($2, full_name),
           preferred_language = COALESCE($3, preferred_language),
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [userId, updates.fullName ?? null, updates.preferredLanguage ?? null],
    );
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    return toPublicUser(user);
  }

  private async findUserById(userId: string): Promise<UserRow[]> {
    const rows = await this.db.query<UserRow>(`SELECT * FROM app_user WHERE id = $1`, [userId]);
    if (rows.length === 0) {
      throw new NotFoundException('User not found.');
    }
    return rows;
  }
}

function toPublicUser(user: UserRow): PublicUser {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    fullName: user.full_name,
    preferredLanguage: user.preferred_language,
    status: user.status,
  };
}
