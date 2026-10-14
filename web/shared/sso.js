/**
 * Single sign-on with the CLOUD MEDIA account (see api/src/modules/identity/sso.*).
 *
 * When the API reports SSO as on (GET /v1/auth/sso/config), customers and businesses sign in, sign up and
 * reset passwords on the CLOUD MEDIA pages: the email/password parts of Naa here's own forms are hidden
 * (anything marked data-password-only) and one "Continue with your CLOUD MEDIA account" button replaces
 * the Google/Facebook buttons. Platform staff keep the admin sign-in (web/admin), which never loads this.
 *
 * Every hop is a full page navigation; tokens come back through web/auth/oauth-callback.html.
 */
(function () {
  const CONFIG_KEY = 'naaSsoConfig';
  const TOKEN_KEYS = {
    customer: ['customerAccessToken', 'customerRefreshToken', 'customerUser'],
    provider: ['providerAccessToken', 'providerRefreshToken', 'providerUser'],
  };
  const checkedKey = (role) => `naaSsoChecked:${role}`;
  let pending = null;

  async function config() {
    const cached = sessionStorage.getItem(CONFIG_KEY);
    if (cached) {
      try { return JSON.parse(cached); } catch (e) { /* refetch */ }
    }
    if (!pending) {
      pending = fetch('/v1/auth/sso/config', { headers: { Accept: 'application/json' } })
        .then((r) => (r.ok ? r.json() : { enabled: false }))
        .catch(() => ({ enabled: false }))
        .then((c) => {
          sessionStorage.setItem(CONFIG_KEY, JSON.stringify({ enabled: Boolean(c.enabled) }));
          return { enabled: Boolean(c.enabled) };
        });
    }
    return pending;
  }

  /** Same-site page to come back to, e.g. /customer/index.html#/bookings */
  function returnPage(role) {
    const params = new URLSearchParams(window.location.search);
    const next = params.get('next');
    const home = role === 'provider' ? '/provider/index.html' : '/customer/index.html';
    if (next && next.startsWith('#')) return home + next;
    if (next && next.startsWith('/') && !next.startsWith('//')) return next;
    return home;
  }

  function start({ role = 'customer', prompt, business, next } = {}) {
    const p = new URLSearchParams({ role });
    if (prompt) p.set('prompt', prompt);
    if (business) p.set('business', JSON.stringify(business));
    p.set('next', next || returnPage(role));
    window.location.href = `/v1/auth/sso?${p.toString()}`;
  }

  function isSignedIn(role) {
    return Boolean(sessionStorage.getItem(TOKEN_KEYS[role][0]));
  }

  const BOT = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|preview|headless/i;

  /**
   * Silent check, once per browser tab session: if the visitor is already signed in to their CLOUD MEDIA
   * account, sign them in here too without showing anything.
   */
  async function silentSignIn(role) {
    if (isSignedIn(role) || sessionStorage.getItem(checkedKey(role)) || BOT.test(navigator.userAgent)) return false;
    const c = await config();
    if (!c.enabled) return false;
    sessionStorage.setItem(checkedKey(role), '1');
    start({ role, prompt: 'none', next: window.location.pathname + window.location.search + window.location.hash });
    return true;
  }

  /** Sign out of Naa here and, with SSO on, of the CLOUD MEDIA account and every group app. */
  async function signOut(role, fallbackUrl) {
    const refreshToken = sessionStorage.getItem(TOKEN_KEYS[role][1]);
    if (refreshToken) {
      try {
        await fetch('/v1/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }) });
      } catch (e) { /* still sign out locally */ }
    }
    TOKEN_KEYS[role].forEach((k) => sessionStorage.removeItem(k));
    sessionStorage.setItem(checkedKey('customer'), '1');
    sessionStorage.setItem(checkedKey('provider'), '1');
    const c = await config();
    window.location.href = c.enabled ? `/v1/auth/sso/logout?role=${role}` : fallbackUrl;
  }

  /**
   * On sign-in / sign-up pages: with SSO on, hide the password parts and show one CLOUD MEDIA button.
   * `getState()` returns { role, business? } or null (the page shows its own validation message).
   * Returns true when the page was switched to SSO.
   */
  async function upgradeAuthPage(container, getState, { signup = false } = {}) {
    const c = await config();
    if (!c.enabled || !container) return false;
    document.querySelectorAll('[data-password-only]').forEach((el) => { el.hidden = true; });
    document.querySelectorAll('[data-password-only] input, [data-password-only] select').forEach((el) => { el.required = false; });
    container.innerHTML = `
      <div class="oauth-buttons">
        <button type="button" class="primary sso-btn" id="sso-btn">${signup ? 'Create your CLOUD MEDIA account' : 'Continue with your CLOUD MEDIA account'}</button>
      </div>
      <p class="hint" style="margin-top:var(--space-2)">One account for Naa here, Kooonda and cloudmedialtd.com, all run by CLOUD MEDIA LTD. You can also use Google or Facebook there.</p>`;
    container.querySelector('#sso-btn').addEventListener('click', () => {
      const state = getState();
      if (!state) return;
      start({ role: state.role, business: state.business, prompt: signup ? 'create' : undefined });
    });
    return true;
  }

  window.NaaSSO = { config, start, silentSignIn, signOut, upgradeAuthPage, isSignedIn };
})();
