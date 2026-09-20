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

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    // Distinguishes "wrong credentials" from "signed in fine, but this
    // account holds no platform role" (a 403 from PlatformPermissionGuard)
    // — app.js uses this to show a clear message instead of a generic error.
    const message = (data && (data.message || data.error)) || `Request failed (${res.status})`;
    const err = new Error(Array.isArray(message) ? message.join(' ') : message);
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
};
