// Same relative-origin convention as web/provider/api.js — the API is
// served from this same origin in every environment (see
// api/src/main.ts's static-asset serving).
const API_BASE_URL = '/v1';

const SESSION_KEYS = {
  accessToken: 'customerAccessToken',
  refreshToken: 'customerRefreshToken',
  user: 'customerUser',
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

/**
 * Same fetch-wrapper shape as web/provider/api.js. Unlike the provider
 * portal, most of this app's routes are public (browsing is
 * unauthenticated by design — see discovery.controller.ts) so `auth`
 * defaults to false here instead of true, and callers opt in for the
 * routes that do need a signed-in customer (booking, my bookings).
 */
async function apiRequest(path, { method = 'GET', body, auth = false, headers: extraHeaders = {} } = {}) {
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  if (auth) {
    const token = getAccessToken();
    if (!token) {
      window.location.href = `login.html?next=${encodeURIComponent(window.location.hash)}`;
      throw new Error('Not signed in.');
    }
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 401 && auth) {
      clearSession();
      window.location.href = `login.html?next=${encodeURIComponent(window.location.hash)}`;
    }
    const message = data?.error?.message || `Request failed (${res.status}).`;
    throw new Error(message);
  }

  return data;
}

/** One method per route this app actually calls — see discovery.controller.ts and booking.controller.ts. */
const Api = {
  login: (payload) => apiRequest('/auth/login', { method: 'POST', body: payload }),
  me: () => apiRequest('/me', { auth: true }),

  // discovery — public, no sign-in required.
  discoverServices: (query) => apiRequest(`/discover/services${query ? `?${query}` : ''}`),
  getService: (serviceId) => apiRequest(`/discover/services/${serviceId}`),

  // bookings — a customer is just any signed-in user (see
  // booking.controller.ts's comment: deliberately not behind
  // TenantRoleGuard), so these reuse the same routes the provider
  // portal's staff-side booking screens call, just as "myself" rather
  // than "this business's bookings".
  createBooking: (tenantId, payload, idempotencyKey) =>
    apiRequest(`/tenants/${tenantId}/bookings`, {
      method: 'POST',
      body: payload,
      auth: true,
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
  myBookings: () => apiRequest('/bookings/mine', { auth: true }),
  cancelBooking: (bookingId, reason) =>
    apiRequest(`/bookings/${bookingId}/cancel`, { method: 'PATCH', body: { reason }, auth: true }),
};
