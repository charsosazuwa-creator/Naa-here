// Same shape as web/provider/api.js and web/customer/api.js — relative
// API base (same origin), its own sessionStorage namespace so signing
// in here doesn't collide with a provider or customer session in
// another tab, and a 401 redirect to this app's own login page.
const API_BASE_URL = '/v1';

const SESSION_KEYS = {
  accessToken: 'adminAccessToken',
  refreshToken: 'adminRefreshToken',
  user: 'adminUser',
};

function getAccessToken() {
  return sessionStorage.getItem(SESSION_KEYS.accessToken);
}

function setSession({ accessToken, refreshToken, user }) {
  sessionStorage.setItem(SESSION_KEYS.accessToken, accessToken);
  sessionStorage.setItem(SESSION_KEYS.refreshToken, refreshToken);
  sessionStorage.setItem(SESSION_KEYS.user, JSON.stringify(user));
}

function clearSession() {
  sessionStorage.removeItem(SESSION_KEYS.accessToken);
  sessionStorage.removeItem(SESSION_KEYS.refreshToken);
  sessionStorage.removeItem(SESSION_KEYS.user);
}

function isSignedIn() {
  return Boolean(getAccessToken());
}

function currentUser() {
  const raw = sessionStorage.getItem(SESSION_KEYS.user);
  return raw ? JSON.parse(raw) : null;
}

async function apiRequest(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getAccessToken();
    if (!token) {
      window.location.href = 'login.html';
      throw new Error('Not signed in.');
    }
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && auth) {
    clearSession();
    window.location.href = 'login.html';
    throw new Error('Session expired. Please sign in again.');
  }

  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    // Real envelope (see http-exception.filter.ts): { error: { code,
    // message, requestId } } — NOT a top-level `message` or `error`
    // string, which is what this file originally (incorrectly)
    // checked, producing "[object Object]" instead of the actual
    // message. Matches web/provider/api.js and web/customer/api.js's
    // already-correct handling.
    //
    // err.status is set separately from this envelope so app.js can
    // distinguish "wrong credentials" from "signed in fine, but this
    // account holds no platform role" (a 403 from PlatformPermissionGuard)
    // and show a clearer message than a generic error.
    const message = data?.error?.message || `Request failed (${res.status}).`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }

  return data;
}

const Api = {
  login(payload) {
    return apiRequest('/auth/login', { method: 'POST', body: payload, auth: false });
  },
  me() {
    return apiRequest('/me', { auth: true });
  },
  listPendingVerifications(includeDecided) {
    const qs = includeDecided ? '?includeDecided=true' : '';
    return apiRequest(`/admin/verification/pending${qs}`, { auth: true });
  },
  decideVerification(tenantId, submissionId, decision, note) {
    return apiRequest(`/tenants/${tenantId}/verification/${submissionId}/decide`, {
      method: 'POST',
      body: { decision, note },
      auth: true,
    });
  },
  // marketplace listing moderation (User Story 2) — same
  // 'listing.moderate' permission and pending-queue shape as
  // verification, see listing-admin.controller.ts.
  listPendingListings() {
    return apiRequest('/admin/listings/pending', { auth: true });
  },
  decideListing(listingId, decision, reason) {
    return apiRequest(`/admin/listings/${listingId}/decide`, {
      method: 'POST',
      body: { decision, reason },
      auth: true,
    });
  },
  // dispute queue (User Story US-056) — see dispute-admin.controller.ts.
  listDisputes() {
    return apiRequest('/admin/disputes', { auth: true });
  },
  resolveDispute(tenantId, disputeId, resolution, notes) {
    return apiRequest(`/tenants/${tenantId}/disputes/${disputeId}/resolve`, {
      method: 'POST',
      body: { resolution, notes },
      auth: true,
    });
  },
};
