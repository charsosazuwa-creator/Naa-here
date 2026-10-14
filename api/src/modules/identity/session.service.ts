import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, createHash } from 'crypto';
import { DatabaseService } from '../../database/database.service';
import { AppConfig } from '../../config/configuration';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

/**
 * Access tokens are short-lived signed JWTs (never persisted).
 * Refresh tokens are opaque random strings; only their SHA-256 hash is
 * stored, so a stolen database row cannot be replayed as a token
 * itself. Refresh is single-use and rotates: reusing an already-used
 * refresh token revokes the whole session (BR-SEC, master prompt
 * section 8 "Sessions and tokens" — detects token replay).
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /**
   * Starts a session. The access token carries the session id ("sid") so JwtAuthGuard can refuse it
   * the moment the session is revoked (sign-out, a CLOUD MEDIA sign-out notice) instead of after up to
   * 15 minutes. `ssoSid` links the session to a CLOUD MEDIA account session.
   */
  async issue(userId: string, userAgent?: string, ipAddress?: string, ssoSid?: string | null): Promise<TokenPair> {
    const jwtConfig = this.config.get('jwt', { infer: true });
    const refreshToken = randomBytes(48).toString('base64url');
    const refreshTokenHash = hashToken(refreshToken);

    const [row] = await this.db.query<{ id: string }>(
      `INSERT INTO user_session (user_id, refresh_token_hash, user_agent, ip_address, expires_at, sso_sid)
       VALUES ($1, $2, $3, $4, now() + ($5 || ' days')::interval, $6)
       RETURNING id`,
      [userId, refreshTokenHash, userAgent ?? null, ipAddress ?? null, jwtConfig.refreshTokenTtlDays, ssoSid ?? null],
    );

    const accessToken = await this.jwt.signAsync(
      { sub: userId, sid: row?.id },
      { secret: jwtConfig.secret, expiresIn: jwtConfig.accessTokenTtlSeconds },
    );

    return { accessToken, refreshToken, expiresInSeconds: jwtConfig.accessTokenTtlSeconds };
  }

  /** Rotates a refresh token: the old one is revoked and a new pair is issued. Reuse of a revoked token revokes the whole session. */
  async rotate(refreshToken: string, userAgent?: string, ipAddress?: string): Promise<TokenPair> {
    const tokenHash = hashToken(refreshToken);

    const [session] = await this.db.query<{
      id: string;
      user_id: string;
      revoked_at: string | null;
      expires_at: string;
      sso_sid: string | null;
    }>(`SELECT id, user_id, revoked_at, expires_at, sso_sid FROM user_session WHERE refresh_token_hash = $1`, [
      tokenHash,
    ]);

    if (!session) {
      throw new UnauthorizedException('Invalid refresh token.');
    }
    if (session.revoked_at) {
      // Replay of an already-rotated token: treat as compromised and
      // revoke every session this user has, per section 10.
      await this.db.query(`UPDATE user_session SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [
        session.user_id,
      ]);
      throw new UnauthorizedException('This session has been revoked. Please sign in again.');
    }
    if (new Date(session.expires_at).getTime() < Date.now()) {
      throw new UnauthorizedException('Session expired. Please sign in again.');
    }

    await this.db.query(`UPDATE user_session SET revoked_at = now() WHERE id = $1`, [session.id]);
    return this.issue(session.user_id, userAgent, ipAddress, session.sso_sid);
  }

  /** A CLOUD MEDIA sign-out notice: end the Naa here sessions started from that central session. */
  async revokeBySsoSid(ssoSid: string): Promise<number> {
    const rows = await this.db.query(`UPDATE user_session SET revoked_at = now() WHERE sso_sid = $1 AND revoked_at IS NULL RETURNING id`, [ssoSid]);
    return rows.length;
  }

  async revokeAllForUser(userId: string): Promise<number> {
    const rows = await this.db.query(`UPDATE user_session SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL RETURNING id`, [userId]);
    return rows.length;
  }

  async revoke(refreshToken: string): Promise<void> {
    const tokenHash = hashToken(refreshToken);
    await this.db.query(
      `UPDATE user_session SET revoked_at = now() WHERE refresh_token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash],
    );
  }
}

/** Is this session still live? Used by JwtAuthGuard for access tokens that carry a session id. */
export async function sessionIsActive(db: DatabaseService, sessionId: string): Promise<boolean> {
  const rows = await db.query<{ ok: number }>(
    `SELECT 1 AS ok FROM user_session WHERE id = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [sessionId],
  );
  return rows.length > 0;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
