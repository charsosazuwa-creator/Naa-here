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

  async issue(userId: string, userAgent?: string, ipAddress?: string): Promise<TokenPair> {
    const jwtConfig = this.config.get('jwt', { infer: true });
    const accessToken = await this.jwt.signAsync(
      { sub: userId },
      { secret: jwtConfig.secret, expiresIn: jwtConfig.accessTokenTtlSeconds },
    );

    const refreshToken = randomBytes(48).toString('base64url');
    const refreshTokenHash = hashToken(refreshToken);

    await this.db.query(
      `INSERT INTO user_session (user_id, refresh_token_hash, user_agent, ip_address, expires_at)
       VALUES ($1, $2, $3, $4, now() + ($5 || ' days')::interval)`,
      [userId, refreshTokenHash, userAgent ?? null, ipAddress ?? null, jwtConfig.refreshTokenTtlDays],
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
    }>(`SELECT id, user_id, revoked_at, expires_at FROM user_session WHERE refresh_token_hash = $1`, [
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
    return this.issue(session.user_id, userAgent, ipAddress);
  }

  async revoke(refreshToken: string): Promise<void> {
    const tokenHash = hashToken(refreshToken);
    await this.db.query(
      `UPDATE user_session SET revoked_at = now() WHERE refresh_token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash],
    );
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
