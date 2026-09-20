/**
 * Landing page the API redirects the browser to after a
 * Google/Facebook sign-in attempt (see
 * api/src/modules/identity/oauth.controller.ts). Tokens travel here in
 * the URL fragment, not the query string, so they never reach the
 * server's own access logs or get sent onward in a Referer header —
 * only this page's own JS ever reads location.hash.
 *
 * This page lives under web/auth/ so it has no sessionStorage keys of
 * its own; it writes into the SAME per-app keys web/customer/api.js
 * and web/provider/api.js use (sessionStorage is shared across paths
 * on one origin), then redirects into that app.
 */
(function () {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const heading = document.getElementById('heading');
  const subtitle = document.getElementById('subtitle');
  const alertBox = document.getElementById('alert');
  const fallbackLinks = document.getElementById('fallback-links');

  const error = params.get('error');
  const role = params.get('role'); // 'customer' | 'provider' | null

  function showError(message) {
    heading.textContent = "Couldn't sign you in";
    subtitle.textContent = '';
    alertBox.textContent = message;
    alertBox.hidden = false;
    fallbackLinks.hidden = false;
    const link = fallbackLinks.querySelector('a');
    link.href = role === 'provider' ? '../provider/login.html' : role === 'customer' ? '../customer/login.html' : 'signin.html';
  }

  if (error) {
    showError(error);
    return;
  }

  const accessToken = params.get('accessToken');
  const refreshToken = params.get('refreshToken');
  const userRaw = params.get('user');
  const tenantId = params.get('tenantId');

  if (!accessToken || !refreshToken || !userRaw || (role !== 'customer' && role !== 'provider')) {
    showError('Sign-in did not complete. Please try again.');
    return;
  }

  let user;
  try {
    user = JSON.parse(userRaw);
  } catch (err) {
    showError('Sign-in did not complete. Please try again.');
    return;
  }

  const keys =
    role === 'provider'
      ? { accessToken: 'providerAccessToken', refreshToken: 'providerRefreshToken', user: 'providerUser' }
      : { accessToken: 'customerAccessToken', refreshToken: 'customerRefreshToken', user: 'customerUser' };

  sessionStorage.setItem(keys.accessToken, accessToken);
  sessionStorage.setItem(keys.refreshToken, refreshToken);
  sessionStorage.setItem(keys.user, JSON.stringify(user));

  // Clear out any stale password-signup handoff state (see
  // verify.js / provider/login.js) so it can't be picked up later by
  // mistake.
  sessionStorage.removeItem('pendingSignupType');
  sessionStorage.removeItem('pendingBusiness');

  subtitle.textContent = 'Redirecting…';

  const destination =
    role === 'provider'
      ? tenantId
        ? `../provider/index.html#/t/${tenantId}/overview`
        : '../provider/index.html'
      : '../customer/index.html';

  window.location.href = destination;
})();
