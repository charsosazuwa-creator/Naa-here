// Relative, not absolute: the API is served from this same origin
// in every environment (see api/src/main.ts's static-asset serving),
// so no origin needs hardcoding and none of this breaks when the app
// moves from the local demo's localhost:8811 to a real deployment.
const API_BASE_URL = '/v1';

const SESSION_KEYS = {
  accessToken: 'providerAccessToken',
  refreshToken: 'providerRefreshToken',
  user: 'providerUser',
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
 * Same fetch-wrapper shape as web/auth/api.js, extended with the
 * Bearer token every route past sign-in needs, and a redirect to
 * login.html on a 401 (an expired or otherwise invalid access token —
 * this milestone's portal doesn't implement silent refresh-token
 * rotation in the background, only a fresh sign-in).
 */
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

  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 401 && auth) {
      clearSession();
      window.location.href = 'login.html';
    }
    const message = data?.error?.message || `Request failed (${res.status}).`;
    throw new Error(message);
  }

  return data;
}

/**
 * One method per route this portal actually calls. Paths and DTO
 * shapes match the real controllers exactly (see each module's own
 * *.controller.ts / dto/*.ts) — there is no separate backend-for-
 * frontend layer, this app calls the same API real integrations would.
 */
const Api = {
  login: (payload) => apiRequest('/auth/login', { method: 'POST', body: payload, auth: false }),
  me: () => apiRequest('/me'),

  // tenancy — GET /tenants/mine is new in this milestone (migration
  // 007), added specifically so this portal has a way to discover
  // which businesses the signed-in user belongs to.
  myTenants: () => apiRequest('/tenants/mine'),
  createTenant: (payload) => apiRequest('/tenants', { method: 'POST', body: payload }),
  getTenant: (tenantId) => apiRequest(`/tenants/${tenantId}`),

  // verification
  listVerification: (tenantId) => apiRequest(`/tenants/${tenantId}/verification`),
  submitVerification: (tenantId, payload) => apiRequest(`/tenants/${tenantId}/verification`, { method: 'POST', body: payload }),
  uploadMedia: (payload) => apiRequest('/media', { method: 'POST', body: payload }),

  // catalogue
  listServices: (tenantId) => apiRequest(`/tenants/${tenantId}/services?all=true`),
  createService: (tenantId, payload) => apiRequest(`/tenants/${tenantId}/services`, { method: 'POST', body: payload }),
  setServiceStatus: (tenantId, serviceId, status) =>
    apiRequest(`/tenants/${tenantId}/services/${serviceId}/status`, { method: 'PATCH', body: { status } }),

  // bookings
  listBookings: (tenantId) => apiRequest(`/tenants/${tenantId}/bookings`),
  transitionBooking: (tenantId, bookingId, payload) =>
    apiRequest(`/tenants/${tenantId}/bookings/${bookingId}/status`, { method: 'PATCH', body: payload }),

  // artisan job requests
  listJobRequests: (tenantId) => apiRequest(`/tenants/${tenantId}/job-requests`),
  quoteJobRequest: (tenantId, jobRequestId, payload) =>
    apiRequest(`/tenants/${tenantId}/job-requests/${jobRequestId}/quote`, { method: 'POST', body: payload }),
  declineJobRequest: (tenantId, jobRequestId, payload) =>
    apiRequest(`/tenants/${tenantId}/job-requests/${jobRequestId}/decline`, { method: 'POST', body: payload }),

  // disputes
  listDisputes: (tenantId) => apiRequest(`/tenants/${tenantId}/disputes`),
  raiseDispute: (tenantId, bookingId, payload) =>
    apiRequest(`/tenants/${tenantId}/bookings/${bookingId}/disputes`, { method: 'POST', body: payload }),

  // finance — payouts only; refunds and reconciliation are platform-
  // (admin/finance-administrator) actions, out of scope for a
  // provider's own portal (see the admin back office, not yet built).
  listPayouts: (tenantId) => apiRequest(`/tenants/${tenantId}/payouts`),
  requestPayout: (tenantId, payload) => apiRequest(`/tenants/${tenantId}/payouts`, { method: 'POST', body: payload }),
};
