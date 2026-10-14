import { createServer, Server } from 'http';
import { JwtService } from '@nestjs/jwt';
import { SignJWT, exportJWK, generateKeyPair, KeyLike } from 'jose';
import { SsoService } from '../../src/modules/identity/sso.service';

/** CLOUD MEDIA account single sign-on, against a stand-in OpenID provider and an in-memory database. */
describe('SsoService', () => {
  let server: Server;
  let issuer = '';
  let key: KeyLike;
  let jwk: Record<string, unknown>;
  let idToken = '';

  const users: { id: string; email: string; full_name: string; status: string }[] = [];
  const identities: { user_id: string; provider: string; provider_user_id: string }[] = [];
  const staff = new Set<string>();
  const revokedSids: string[] = [];
  const revokedUsers: string[] = [];
  const issued: { userId: string; ssoSid: string | null }[] = [];

  const db = {
    query: jest.fn(async (sql: string, p: unknown[] = []) => {
      if (sql.includes('FROM oauth_identity WHERE provider')) return identities.filter((i) => i.provider === p[0] && i.provider_user_id === p[1]);
      if (sql.startsWith('SELECT id FROM app_user WHERE email')) return users.filter((u) => u.email === p[0]);
      if (sql.includes('INSERT INTO app_user')) { const u = { id: `u${users.length + 1}`, email: String(p[0]), full_name: String(p[1]), status: 'active' }; users.push(u); return [{ id: u.id }]; }
      if (sql.includes('INSERT INTO oauth_identity')) { identities.push({ user_id: String(p[0]), provider: String(p[1]), provider_user_id: String(p[2]) }); return []; }
      if (sql.includes('FROM platform_role_assignment')) return staff.has(String(p[0])) ? [{ '?column?': 1 }] : [];
      if (sql.includes('SELECT id, email, phone')) { const u = users.find((x) => x.id === p[0])!; return [{ ...u, phone: null, preferred_language: 'en' }]; }
      if (sql.includes("full_name = 'Former user'")) { const u = users.find((x) => x.id === p[0])!; u.email = String(p[1]); u.full_name = 'Former user'; u.status = 'disabled'; return []; }
      return [];
    }),
  };
  const sessions = {
    issue: jest.fn(async (userId: string, _ua?: string, _ip?: string, ssoSid?: string | null) => { issued.push({ userId, ssoSid: ssoSid ?? null }); return { accessToken: 'a', refreshToken: 'r', expiresInSeconds: 900 }; }),
    revokeBySsoSid: jest.fn(async (sid: string) => { revokedSids.push(sid); return 1; }),
    revokeAllForUser: jest.fn(async (userId: string) => { revokedUsers.push(userId); return 1; }),
  };
  const audit = { record: jest.fn(async () => undefined) };
  const business = { listForUser: jest.fn(async () => []), create: jest.fn(async () => ({ id: 't1' })) };
  const settings = { sso: { issuer: '', clientId: 'naa-here', clientSecret: 's3cret', enabled: true }, publicBaseUrl: 'https://naahere.example' };
  const config = { get: (k: 'sso' | 'publicBaseUrl') => settings[k] };
  const jwt = new JwtService({ secret: 'test-secret' });
  let sso: SsoService;

  const sign = (payload: Record<string, unknown>, aud = 'naa-here') =>
    new SignJWT(payload).setProtectedHeader({ alg: 'ES256', kid: 'k1' }).setIssuer(issuer).setAudience(aud).setIssuedAt().setExpirationTime('5m').sign(key);

  beforeAll(async () => {
    const kp = await generateKeyPair('ES256');
    key = kp.privateKey;
    jwk = { ...(await exportJWK(kp.publicKey)), kid: 'k1', alg: 'ES256' };
    server = createServer((req, res) => {
      const json = (o: unknown) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url === '/.well-known/openid-configuration') return json({ issuer, authorization_endpoint: `${issuer}/oauth/authorize`, token_endpoint: `${issuer}/oauth/token`, jwks_uri: `${issuer}/oauth/jwks`, end_session_endpoint: `${issuer}/oauth/logout` });
      if (req.url === '/oauth/jwks') return json({ keys: [jwk] });
      if (req.url === '/oauth/token') return json({ id_token: idToken });
      res.writeHead(404); res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    issuer = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    settings.sso.issuer = issuer;
    sso = new SsoService(db as never, audit as never, jwt, sessions as never, business as never, config as never);
  });
  afterAll(() => server.close());

  async function stateFrom(url: string) {
    return sso.readState(new URL(url).searchParams.get('state')!);
  }

  it('builds a PKCE sign-in address and keeps the return page', async () => {
    const url = new URL(await sso.buildAuthorizationUrl('customer', { prompt: 'none', next: '/customer/index.html#/bookings' }));
    expect(url.origin + url.pathname).toBe(`${issuer}/oauth/authorize`);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('prompt')).toBe('none');
    expect(url.searchParams.get('redirect_uri')).toBe('https://naahere.example/v1/auth/sso/callback');
    const st = await stateFrom(url.toString());
    expect(st.next).toBe('/customer/index.html#/bookings');
    expect(SsoService.safeNext('//evil.example')).toBeUndefined();
    expect(SsoService.safeNext('/v1/auth/logout')).toBeUndefined();
  });

  it('signs a new person in, links them, and keeps the CLOUD MEDIA session id on the Naa here session', async () => {
    const st = await stateFrom(await sso.buildAuthorizationUrl('provider', { business: { name: 'Ada Salon', category: 'salon', countryCode: 'NG' } as never }));
    idToken = await sign({ sub: 'central-1', sid: 'sid-1', email: 'Ada@Example.com', email_verified: true, name: 'Ada Obi', nonce: 'wrong' });
    await expect(sso.completeSignIn('code', st)).rejects.toThrow();
    idToken = await sign({ sub: 'central-1', sid: 'sid-1', email: 'Ada@Example.com', email_verified: true, name: 'Ada Obi', nonce: st.nonce });
    const r = await sso.completeSignIn('code', st);
    expect(r.user.email).toBe('ada@example.com');
    expect(r.tenantId).toBe('t1');
    expect(identities).toContainEqual({ user_id: r.user.id, provider: 'cloudmedia', provider_user_id: 'central-1' });
    expect(issued.at(-1)).toEqual({ userId: r.user.id, ssoSid: 'sid-1' });
    // second time: same user, no duplicate
    const st2 = await stateFrom(await sso.buildAuthorizationUrl('customer'));
    idToken = await sign({ sub: 'central-1', sid: 'sid-2', email: 'ada@example.com', email_verified: true, nonce: st2.nonce });
    expect((await sso.completeSignIn('code', st2)).user.id).toBe(r.user.id);
    expect(users.length).toBe(1);
  });

  it('refuses platform staff accounts', async () => {
    users.push({ id: 'staff1', email: 'agent@naahere.example', full_name: 'Agent', status: 'active' });
    staff.add('staff1');
    const st = await stateFrom(await sso.buildAuthorizationUrl('customer'));
    idToken = await sign({ sub: 'central-9', sid: 'sid-9', email: 'agent@naahere.example', email_verified: true, nonce: st.nonce });
    await expect(sso.completeSignIn('code', st)).rejects.toThrow(/staff/);
  });

  it('applies sign-out notices by session, and anonymises on account deletion', async () => {
    const events = { 'http://schemas.openid.net/event/backchannel-logout': {} };
    await expect(sso.handleLogoutToken(await sign({ sub: 'central-1', sid: 'sid-1', events: {} }))).rejects.toThrow();
    await expect(sso.handleLogoutToken(await sign({ sub: 'central-1', sid: 'sid-1', events }, 'someone-else'))).rejects.toThrow();
    await sso.handleLogoutToken(await sign({ sub: 'central-1', sid: 'sid-1', events }));
    expect(revokedSids).toEqual(['sid-1']);
    expect(revokedUsers).toEqual([]);
    await sso.handleLogoutToken(await sign({ sub: 'central-1', events: { ...events, 'https://cloudmedialtd.com/events/account-deleted': {} } }));
    expect(revokedUsers).toEqual(['u1']);
    expect(users[0].email).toContain('@invalid.local');
    expect(users[0].status).toBe('disabled');
  });

  it('points sign-out at the CLOUD MEDIA account', async () => {
    const u = new URL(await sso.endSessionUrl());
    expect(u.pathname).toBe('/oauth/logout');
    expect(u.searchParams.get('post_logout_redirect_uri')).toBe('https://naahere.example/auth/signin.html?signedout=1');
  });
});
