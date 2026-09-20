import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { AppConfig } from '../../config/configuration';
import { SessionService, TokenPair } from './session.service';
import { PublicUser } from './auth.service';
import { CreateBusinessDto } from '../tenancy/dto/create-business.dto';
import { BusinessService } from '../tenancy/business.service';

export type OAuthProvider = 'google' | 'facebook';
export type OAuthRole = 'customer' | 'provider';

interface OAuthState {
  role: OAuthRole;
  business?: CreateBusinessDto;
}

interface OAuthProfile {
  providerUserId: string;
  email: string | null;
  emailVerified: boolean;
  fullName: string | null;
}

export interface OAuthResult {
  user: PublicUser;
  tokens: TokenPair;
  tenantId?: string;
  role: OAuthRole;
}

type UserRow = {
  id: string;
  email: string | null;
  phone: string | null;
  full_name: string;
  preferred_language: string;
  status: string;
};

/**
 * "Sign in with Google" / "Sign in with Facebook", built by hand
 * against each provider's plain OAuth 2.0 authorization-code endpoints
 * (no passport — see api/package.json; this project already has
 * @nestjs/jwt and Node 22's global fetch, which is everything the flow
 * needs).
 *
 * There is no server-side session between the authorize step and the
 * callback (this API is otherwise fully stateless/JWT-based — see
 * session.service.ts), so the "role" (customer vs provider) and, for
 * a provider signup, the business details collected on
 * signup-provider.html before the OAuth handoff, travel round-trip
 * through the provider as the `state` parameter, signed with the same
 * JWT secret as access tokens so it can't be tampered with in transit
 * and expires quickly if the flow is abandoned.
 */
@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
    private readonly sessions: SessionService,
    private readonly business: BusinessService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  isConfigured(provider: OAuthProvider): boolean {
    const creds = this.config.get('oauth', { infer: true })[provider];
    return Boolean(creds.clientId && creds.clientSecret);
  }

  parseBusinessParam(raw?: string): CreateBusinessDto | undefined {
    if (!raw) {
      return undefined;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BadRequestException('Malformed business details.');
    }
    const dto = plainToInstance(CreateBusinessDto, parsed);
    const errors = validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length > 0) {
      throw new BadRequestException('Invalid business details.');
    }
    return dto;
  }

  private redirectUri(provider: OAuthProvider): string {
    const base = this.config.get('publicBaseUrl', { infer: true }).replace(/\/+$/, '');
    return `${base}/v1/auth/${provider}/callback`;
  }

  private async signState(state: OAuthState): Promise<string> {
    return this.jwt.signAsync(state, { expiresIn: '10m' });
  }

  private async verifyState(state: string): Promise<OAuthState> {
    return this.jwt.verifyAsync<OAuthState>(state);
  }

  async buildAuthorizationUrl(provider: OAuthProvider, role: OAuthRole, business?: CreateBusinessDto): Promise<string> {
    const state = await this.signState({ role, business });
    const oauth = this.config.get('oauth', { infer: true })[provider];
    const redirectUri = this.redirectUri(provider);

    if (provider === 'google') {
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.searchParams.set('client_id', oauth.clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'openid email profile');
      url.searchParams.set('access_type', 'online');
      url.searchParams.set('prompt', 'select_account');
      url.searchParams.set('state', state);
      return url.toString();
    }

    const url = new URL('https://www.facebook.com/v19.0/dialog/oauth');
    url.searchParams.set('client_id', oauth.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'email,public_profile');
    url.searchParams.set('state', state);
    return url.toString();
  }

  /**
   * Exchanges the provider's `code` for the caller's identity, then
   * signs them in — creating an app_user (and, for a provider signup
   * with business details, a tenant) the first time this
   * provider+account is seen, or reusing the linked/matching one on
   * every return visit. Throws on an expired/tampered `state`,
   * provider API failure, or a provider account with no usable email.
   */
  async completeSignIn(provider: OAuthProvider, code: string, rawState: string): Promise<OAuthResult> {
    const state = await this.verifyState(rawState);
    const profile = await this.fetchProfile(provider, code);

    const userId = await this.resolveUserId(provider, profile);

    let tenantId: string | undefined;
    if (state.role === 'provider' && state.business) {
      const existing = await this.business.listForUser(userId);
      if (existing.length === 0) {
        const tenant = await this.business.create(userId, state.business);
        tenantId = tenant.id;
      }
    }

    const tokens = await this.sessions.issue(userId);
    await this.audit.record({ actorUserId: userId, action: `auth.login.${provider}`, targetType: 'app_user', targetId: userId });

    const [row] = await this.db.query<UserRow>(`SELECT * FROM app_user WHERE id = $1`, [userId]);
    return { user: toPublicUser(row), tokens, tenantId, role: state.role };
  }

  private async resolveUserId(provider: OAuthProvider, profile: OAuthProfile): Promise<string> {
    const [identity] = await this.db.query<{ user_id: string }>(
      `SELECT user_id FROM oauth_identity WHERE provider = $1 AND provider_user_id = $2`,
      [provider, profile.providerUserId],
    );
    if (identity) {
      // Returning sign-in. A password-only account might still be
      // 'pending_verification' if it was never finished — this OAuth
      // provider vouching for the identity is at least as strong a
      // proof as the original verification code, so make sure it's
      // active on every sign-in, not just the first.
      await this.db.query(`UPDATE app_user SET status = 'active', updated_at = now() WHERE id = $1 AND status <> 'active'`, [
        identity.user_id,
      ]);
      return identity.user_id;
    }

    if (!profile.email) {
      throw new BadRequestException(
        `Your ${provider === 'google' ? 'Google' : 'Facebook'} account didn't share an email address, so we can't use it to sign in here. Please allow email access, or use email/password instead.`,
      );
    }

    const [existingUser] = await this.db.query<{ id: string }>(`SELECT id FROM app_user WHERE email = $1`, [profile.email]);

    let userId: string;
    if (existingUser) {
      // Only auto-link to an existing password account when the
      // provider itself vouches the email is verified — otherwise
      // anyone could add an unverified email at a provider and take
      // over an existing account here.
      if (!profile.emailVerified) {
        throw new BadRequestException(
          'An account with this email already exists. Please sign in with your password instead.',
        );
      }
      userId = existingUser.id;
      await this.db.query(`UPDATE app_user SET status = 'active', updated_at = now() WHERE id = $1 AND status <> 'active'`, [
        userId,
      ]);
    } else {
      const [created] = await this.db.query<{ id: string }>(
        `INSERT INTO app_user (email, full_name, status, email_verified_at)
         VALUES ($1, $2, 'active', CASE WHEN $3 THEN now() ELSE NULL END)
         RETURNING id`,
        [profile.email, profile.fullName ?? profile.email, profile.emailVerified],
      );
      userId = created.id;
      await this.audit.record({ actorUserId: userId, action: 'auth.register', targetType: 'app_user', targetId: userId });
    }

    await this.db.query(
      `INSERT INTO oauth_identity (user_id, provider, provider_user_id, email) VALUES ($1, $2, $3, $4)`,
      [userId, provider, profile.providerUserId, profile.email],
    );
    await this.audit.record({ actorUserId: userId, action: `auth.oauth_link.${provider}`, targetType: 'app_user', targetId: userId });

    return userId;
  }

  private async fetchProfile(provider: OAuthProvider, code: string): Promise<OAuthProfile> {
    return provider === 'google' ? this.fetchGoogleProfile(code) : this.fetchFacebookProfile(code);
  }

  private async fetchGoogleProfile(code: string): Promise<OAuthProfile> {
    const oauth = this.config.get('oauth', { infer: true }).google;
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: oauth.clientId,
        client_secret: oauth.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: this.redirectUri('google'),
      }),
    });
    if (!tokenRes.ok) {
      this.logger.warn(`Google token exchange failed: ${tokenRes.status} ${await safeText(tokenRes)}`);
      throw new BadRequestException('Could not complete Google sign-in.');
    }
    const tokenBody = (await tokenRes.json()) as { access_token: string };

    const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    });
    if (!profileRes.ok) {
      this.logger.warn(`Google userinfo fetch failed: ${profileRes.status} ${await safeText(profileRes)}`);
      throw new BadRequestException('Could not complete Google sign-in.');
    }
    const profile = (await profileRes.json()) as {
      sub: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
    };

    return {
      providerUserId: profile.sub,
      email: profile.email ?? null,
      emailVerified: Boolean(profile.email_verified),
      fullName: profile.name ?? null,
    };
  }

  private async fetchFacebookProfile(code: string): Promise<OAuthProfile> {
    const oauth = this.config.get('oauth', { infer: true }).facebook;
    const tokenUrl = new URL('https://graph.facebook.com/v19.0/oauth/access_token');
    tokenUrl.searchParams.set('client_id', oauth.clientId);
    tokenUrl.searchParams.set('client_secret', oauth.clientSecret);
    tokenUrl.searchParams.set('code', code);
    tokenUrl.searchParams.set('redirect_uri', this.redirectUri('facebook'));

    const tokenRes = await fetch(tokenUrl);
    if (!tokenRes.ok) {
      this.logger.warn(`Facebook token exchange failed: ${tokenRes.status} ${await safeText(tokenRes)}`);
      throw new BadRequestException('Could not complete Facebook sign-in.');
    }
    const tokenBody = (await tokenRes.json()) as { access_token: string };

    const profileUrl = new URL('https://graph.facebook.com/me');
    profileUrl.searchParams.set('fields', 'id,name,email');
    profileUrl.searchParams.set('access_token', tokenBody.access_token);
    const profileRes = await fetch(profileUrl);
    if (!profileRes.ok) {
      this.logger.warn(`Facebook profile fetch failed: ${profileRes.status} ${await safeText(profileRes)}`);
      throw new BadRequestException('Could not complete Facebook sign-in.');
    }
    const profile = (await profileRes.json()) as { id: string; name?: string; email?: string };

    return {
      providerUserId: profile.id,
      // Facebook's Graph API doesn't expose a separate "is this email
      // verified" flag the way Google does — an email only appears
      // here at all if the account has one and the person granted the
      // `email` permission, so treat its presence as sufficient
      // (matches how this app already trusts Facebook's own signup
      // verification, which it doesn't re-check).
      email: profile.email ?? null,
      emailVerified: Boolean(profile.email),
      fullName: profile.name ?? null,
    };
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<no body>';
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
