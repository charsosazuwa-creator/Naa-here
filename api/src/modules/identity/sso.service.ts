import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { AppConfig } from '../../config/configuration';
import { SessionService } from './session.service';
import { OAuthResult, OAuthRole } from './oauth.service';
import { CreateBusinessDto } from '../tenancy/dto/create-business.dto';
import { BusinessService } from '../tenancy/business.service';

/**
 * Single sign-on with the CLOUD MEDIA account (OpenID Connect, authorization code + PKCE).
 *
 * Customers and businesses sign in, sign up and reset their password on the CLOUD MEDIA pages; Naa here
 * keeps its own app_user rows, memberships and roles, linked to the central account through oauth_identity
 * (provider 'cloudmedia', provider_user_id = the central account id). Platform staff (support agents,
 * administrators, finance administrators) are never signed in this way: they keep the password login.
 *
 * Like the Google/Facebook flow, the round trip carries its state (role, business details, PKCE verifier,
 * nonce, return page) in a short-lived JWT signed with this API's own secret.
 */
export const SSO_PROVIDER = 'cloudmedia';
const LOGOUT_EVENT = 'http://schemas.openid.net/event/backchannel-logout';
const ACCOUNT_DELETED_EVENT = 'https://cloudmedialtd.com/events/account-deleted';

interface SsoState {
  role: OAuthRole;
  business?: CreateBusinessDto;
  verifier: string;
  nonce: string;
  prompt?: string;
  next?: string;
}

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint: string;
}

type Claims = JWTPayload & { sub: string; sid?: string; email?: string; email_verified?: boolean; name?: string; nonce?: string };

export interface SsoSignIn extends OAuthResult {
  next?: string;
}

@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name);
  private discoveryCache: { at: number; d: Discovery } | null = null;
  private jwks: { uri: string; set: ReturnType<typeof createRemoteJWKSet> } | null = null;

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
    private readonly sessions: SessionService,
    private readonly business: BusinessService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  get enabled(): boolean {
    return this.config.get('sso', { infer: true }).enabled;
  }

  private get settings() {
    return this.config.get('sso', { infer: true });
  }

  private publicBase(): string {
    return this.config.get('publicBaseUrl', { infer: true }).replace(/\/+$/, '');
  }

  callbackUrl(): string {
    return `${this.publicBase()}/v1/auth/sso/callback`;
  }

  /** A same-site page to return to, e.g. "/customer/index.html#/bookings". */
  static safeNext(next?: string | null): string | undefined {
    if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\') || next.startsWith('/v1/')) return undefined;
    return next.slice(0, 500);
  }

  async discovery(): Promise<Discovery> {
    if (this.discoveryCache && Date.now() - this.discoveryCache.at < 10 * 60_000) return this.discoveryCache.d;
    const res = await fetch(`${this.settings.issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new BadRequestException('The CLOUD MEDIA account is unavailable right now. Please try again shortly.');
    const d = (await res.json()) as Discovery;
    if (d.issuer !== this.settings.issuer) throw new Error('CLOUD MEDIA account issuer mismatch');
    this.discoveryCache = { at: Date.now(), d };
    return d;
  }

  private async keySet() {
    const d = await this.discovery();
    if (!this.jwks || this.jwks.uri !== d.jwks_uri) this.jwks = { uri: d.jwks_uri, set: createRemoteJWKSet(new URL(d.jwks_uri)) };
    return this.jwks.set;
  }

  async buildAuthorizationUrl(role: OAuthRole, opts: { business?: CreateBusinessDto; prompt?: string; next?: string } = {}): Promise<string> {
    const d = await this.discovery();
    const verifier = randomBytes(32).toString('base64url');
    const nonce = randomBytes(16).toString('base64url');
    const prompt = opts.prompt && ['none', 'login', 'create'].includes(opts.prompt) ? opts.prompt : undefined;
    const state: SsoState = { role, business: opts.business, verifier, nonce, prompt, next: SsoService.safeNext(opts.next) };
    const signed = await this.jwt.signAsync(state, { expiresIn: '15m' });
    const url = new URL(d.authorization_endpoint);
    url.searchParams.set('client_id', this.settings.clientId);
    url.searchParams.set('redirect_uri', this.callbackUrl());
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', signed);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
    url.searchParams.set('code_challenge_method', 'S256');
    if (prompt) url.searchParams.set('prompt', prompt);
    return url.toString();
  }

  /** Reads the signed round-trip state (also used when the CLOUD MEDIA account returns an error). */
  async readState(raw: string): Promise<SsoState> {
    try {
      return await this.jwt.verifyAsync<SsoState>(raw);
    } catch {
      throw new BadRequestException('That sign-in took too long or was started in another window. Please try again.');
    }
  }

  /** Exchanges the code, verifies the signed ID token, then signs the person in to Naa here. */
  async completeSignIn(code: string, state: SsoState, userAgent?: string, ipAddress?: string): Promise<SsoSignIn> {
    const d = await this.discovery();
    const basic = Buffer.from(`${encodeURIComponent(this.settings.clientId)}:${encodeURIComponent(this.settings.clientSecret)}`).toString('base64');
    const res = await fetch(d.token_endpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(8000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: this.callbackUrl(), code_verifier: state.verifier }),
    });
    const body = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string };
    if (!res.ok || !body.id_token) {
      this.logger.warn(`CLOUD MEDIA token exchange failed: ${res.status} ${body.error ?? ''}`);
      throw new BadRequestException('Could not complete sign-in with your CLOUD MEDIA account.');
    }
    const { payload } = await jwtVerify(body.id_token, await this.keySet(), { issuer: d.issuer, audience: this.settings.clientId, algorithms: ['ES256'] });
    const claims = payload as Claims;
    if (claims.nonce !== state.nonce) throw new BadRequestException('Could not complete sign-in with your CLOUD MEDIA account.');
    if (!claims.sub || !claims.email) throw new BadRequestException('Your CLOUD MEDIA account has no email address.');

    const userId = await this.resolveUserId(claims);

    let tenantId: string | undefined;
    if (state.role === 'provider' && state.business) {
      const existing = await this.business.listForUser(userId);
      if (existing.length === 0) {
        const tenant = await this.business.create(userId, state.business);
        tenantId = tenant.id;
      }
    }

    const tokens = await this.sessions.issue(userId, userAgent, ipAddress, claims.sid ?? null);
    await this.audit.record({ actorUserId: userId, action: 'auth.login.cloudmedia', targetType: 'app_user', targetId: userId, ipAddress });
    const [row] = await this.db.query<{ id: string; email: string | null; phone: string | null; full_name: string; preferred_language: string; status: string }>(
      `SELECT id, email, phone, full_name, preferred_language, status FROM app_user WHERE id = $1`,
      [userId],
    );
    return {
      user: { id: row.id, email: row.email, phone: row.phone, fullName: row.full_name, preferredLanguage: row.preferred_language, status: row.status },
      tokens,
      tenantId,
      role: state.role,
      next: state.next,
    };
  }

  /** Finds the Naa here user: by link, then by email (linking it), else creates one. Platform staff are refused. */
  private async resolveUserId(c: Claims): Promise<string> {
    const email = c.email!.toLowerCase();
    const [linked] = await this.db.query<{ user_id: string }>(
      `SELECT user_id FROM oauth_identity WHERE provider = $1 AND provider_user_id = $2`,
      [SSO_PROVIDER, c.sub],
    );
    let userId = linked?.user_id;
    if (!userId) {
      const [existing] = await this.db.query<{ id: string }>(`SELECT id FROM app_user WHERE email = $1`, [email]);
      if (existing) {
        userId = existing.id;
      } else {
        const [created] = await this.db.query<{ id: string }>(
          `INSERT INTO app_user (email, full_name, status, email_verified_at)
           VALUES ($1, $2, 'active', CASE WHEN $3 THEN now() ELSE NULL END) RETURNING id`,
          [email, (c.name || email.split('@')[0]).slice(0, 120), Boolean(c.email_verified)],
        );
        userId = created.id;
        await this.audit.record({ actorUserId: userId, action: 'auth.register', targetType: 'app_user', targetId: userId });
      }
      await this.db.query(
        `INSERT INTO oauth_identity (user_id, provider, provider_user_id, email) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [userId, SSO_PROVIDER, c.sub, email],
      );
    }
    const [staff] = await this.db.query(`SELECT 1 FROM platform_role_assignment WHERE user_id = $1 LIMIT 1`, [userId]);
    if (staff) {
      throw new ForbiddenException('This email belongs to a Naa here staff account, which signs in with its own password at the admin sign-in.');
    }
    // The CLOUD MEDIA account vouches for the person: make sure the account is active and the email current.
    await this.db.query(
      `UPDATE app_user SET status = 'active',
              email_verified_at = CASE WHEN $2 THEN COALESCE(email_verified_at, now()) ELSE email_verified_at END,
              updated_at = now()
        WHERE id = $1 AND status <> 'disabled'`,
      [userId, Boolean(c.email_verified)],
    );
    return userId;
  }

  async endSessionUrl(): Promise<string> {
    const d = await this.discovery();
    const url = new URL(d.end_session_endpoint);
    url.searchParams.set('client_id', this.settings.clientId);
    url.searchParams.set('post_logout_redirect_uri', `${this.publicBase()}/auth/signin.html?signedout=1`);
    return url.toString();
  }

  /** Verifies and applies a back-channel sign-out notice from the CLOUD MEDIA account. */
  async handleLogoutToken(token: string): Promise<number> {
    const d = await this.discovery();
    const { payload } = await jwtVerify(token, await this.keySet(), { issuer: d.issuer, audience: this.settings.clientId, algorithms: ['ES256'], maxTokenAge: '10m' });
    const events = payload.events as Record<string, unknown> | undefined;
    if (!events || typeof events !== 'object' || !(LOGOUT_EVENT in events)) throw new BadRequestException('Not a logout token.');
    if ('nonce' in payload) throw new BadRequestException('A logout token must not carry a nonce.');
    const sid = payload.sid as string | undefined;
    if (!sid && !payload.sub) throw new BadRequestException('A logout token needs sub or sid.');
    const deleted = ACCOUNT_DELETED_EVENT in events;

    let ended = 0;
    if (sid) ended += await this.sessions.revokeBySsoSid(sid);
    const linked = payload.sub
      ? await this.db.query<{ user_id: string }>(`SELECT user_id FROM oauth_identity WHERE provider = $1 AND provider_user_id = $2`, [SSO_PROVIDER, payload.sub])
      : [];
    if (!sid || deleted) for (const l of linked) ended += await this.sessions.revokeAllForUser(l.user_id);
    if (deleted) {
      for (const l of linked) {
        await this.db.query(
          `UPDATE app_user SET email = $2, phone = NULL, full_name = 'Former user', password_hash = NULL, status = 'disabled', updated_at = now() WHERE id = $1`,
          [l.user_id, `deleted+${l.user_id}@invalid.local`],
        );
        await this.db.query(`DELETE FROM oauth_identity WHERE user_id = $1`, [l.user_id]);
        await this.audit.record({ actorUserId: null, action: 'auth.account_deleted_sso', targetType: 'app_user', targetId: l.user_id });
      }
    }
    return ended;
  }
}
