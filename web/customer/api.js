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

  // job requests (the "artisan flow" — see job.controller.ts): a
  // customer describes a job against a specific service, the
  // business quotes a price and schedule, the customer accepts it
  // (creating a booking) from their own cross-tenant "mine" list.
  createJobRequest: (tenantId, payload) =>
    apiRequest(`/tenants/${tenantId}/job-requests`, { method: 'POST', body: payload, auth: true }),
  myJobRequests: () => apiRequest('/job-requests/mine', { auth: true }),
  acceptJobRequestQuote: (tenantId, jobRequestId) =>
    apiRequest(`/tenants/${tenantId}/job-requests/${jobRequestId}/accept`, { method: 'POST', auth: true }),

  // marketplace listings (User Story 2): public browse/detail (any
  // registered user's published product/service/invention), plus
  // "My Listings" management for the signed-in user's own — a
  // Customer account can own listings same as a Service Provider (see
  // db/migrations/012_marketplace_listings.sql). uploadListingImage
  // bypasses apiRequest's JSON body handling: it's multipart, not JSON.
  searchListings: (query) => apiRequest(`/discover/listings${query ? `?${query}` : ''}`),
  getPublicListing: (listingId) => apiRequest(`/discover/listings/${listingId}`),
  // US-005/US-006: Google Places search and AI natural-language search,
  // both public (no sign-in required to browse the marketplace).
  searchGoogle: (query) => apiRequest(`/discover/google${query ? `?${query}` : ''}`),
  aiSearch: (payload) => apiRequest('/discover/ai-search', { method: 'POST', body: payload }),

  // disputes (User Story US-056): a customer is just a signed-in user,
  // same as bookings/job-requests, so raising and viewing use the same
  // routes the provider portal calls, plus /disputes/mine for the
  // cross-tenant "my own cases" list.
  raiseDispute: (tenantId, bookingId, payload) =>
    apiRequest(`/tenants/${tenantId}/bookings/${bookingId}/disputes`, { method: 'POST', body: payload, auth: true }),
  myDisputes: () => apiRequest('/disputes/mine', { auth: true }),
  deleteDisputeAttachment: (tenantId, disputeId, attachmentId) =>
    apiRequest(`/tenants/${tenantId}/disputes/${disputeId}/attachments/${attachmentId}`, { method: 'DELETE', auth: true }),
  async uploadDisputeAttachment(tenantId, disputeId, file) {
    const token = getAccessToken();
    if (!token) {
      window.location.href = `login.html?next=${encodeURIComponent(window.location.hash)}`;
      throw new Error('Not signed in.');
    }
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE_URL}/tenants/${tenantId}/disputes/${disputeId}/attachments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401) {
        clearSession();
        window.location.href = `login.html?next=${encodeURIComponent(window.location.hash)}`;
      }
      throw new Error(data?.error?.message || `Request failed (${res.status}).`);
    }
    return data;
  },
  listMyListings: () => apiRequest('/listings/mine', { auth: true }),
  createListing: (payload) => apiRequest('/listings', { method: 'POST', body: payload, auth: true }),
  updateListing: (listingId, payload) => apiRequest(`/listings/${listingId}`, { method: 'PATCH', body: payload, auth: true }),
  submitListing: (listingId) => apiRequest(`/listings/${listingId}/submit`, { method: 'POST', auth: true }),
  pauseListing: (listingId) => apiRequest(`/listings/${listingId}/pause`, { method: 'POST', auth: true }),
  resumeListing: (listingId) => apiRequest(`/listings/${listingId}/resume`, { method: 'POST', auth: true }),
  archiveListing: (listingId) => apiRequest(`/listings/${listingId}`, { method: 'DELETE', auth: true }),
  deleteListingImage: (listingId, imageId) =>
    apiRequest(`/listings/${listingId}/images/${imageId}`, { method: 'DELETE', auth: true }),
  async uploadListingImage(listingId, file) {
    const token = getAccessToken();
    if (!token) {
      window.location.href = `login.html?next=${encodeURIComponent(window.location.hash)}`;
      throw new Error('Not signed in.');
    }
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE_URL}/listings/${listingId}/images`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401) {
        clearSession();
        window.location.href = `login.html?next=${encodeURIComponent(window.location.hash)}`;
      }
      throw new Error(data?.error?.message || `Request failed (${res.status}).`);
    }
    return data;
  },
  // customer invitations (User Story 6): previewing is public (no
  // sign-in yet, possibly no account yet); accept/decline need a
  // signed-in customer -- apiRequest's auth:true here is what sends an
  // unauthenticated visitor to login.html?next=... and back.
  previewInvitation: (token) => apiRequest(`/customer-invitations/${encodeURIComponent(token)}`),

  // direct messaging (User Story 2's chat half): a Customer can always
  // start a new conversation with any tenant (no eligibility gate on
  // this side -- see direct-message.service.ts's class comment), reply
  // within an existing one, and block/unblock a business.
  startConversation: (payload) => apiRequest('/conversations', { method: 'POST', body: payload, auth: true }),
  myConversations: () => apiRequest('/conversations/mine', { auth: true }),
  listConversationMessages: (conversationId) => apiRequest(`/conversations/${conversationId}/messages`, { auth: true }),
  sendConversationMessage: (conversationId, body) =>
    apiRequest(`/conversations/${conversationId}/messages`, { method: 'POST', body: { body }, auth: true }),
  blockConversation: (conversationId) => apiRequest(`/conversations/${conversationId}/block`, { method: 'POST', auth: true }),
  unblockConversation: (conversationId) => apiRequest(`/conversations/${conversationId}/block`, { method: 'DELETE', auth: true }),

  // voice calling (Phase 2 -- User Stories 1 & 2's calling halves).
  // accept/decline/end/timeoutCall are shared verbs regardless of who
  // started the call, same as reply on the messaging side.
  startCallWithBusiness: (tenantId) => apiRequest('/calls', { method: 'POST', body: { tenantId }, auth: true }),
  startGroupCall: (groupId, calleeUserId) =>
    apiRequest(`/groups/${groupId}/calls`, { method: 'POST', body: { calleeUserId }, auth: true }),
  myCalls: () => apiRequest('/calls/mine', { auth: true }),
  acceptCall: (callId) => apiRequest(`/calls/${callId}/accept`, { method: 'POST', auth: true }),
  declineCall: (callId) => apiRequest(`/calls/${callId}/decline`, { method: 'POST', auth: true }),
  endCall: (callId) => apiRequest(`/calls/${callId}/end`, { method: 'POST', auth: true }),
  timeoutCall: (callId) => apiRequest(`/calls/${callId}/timeout`, { method: 'POST', auth: true }),

  acceptInvitation: (token) => apiRequest(`/customer-invitations/${encodeURIComponent(token)}/accept`, { method: 'POST', auth: true }),
  declineInvitation: (token) => apiRequest(`/customer-invitations/${encodeURIComponent(token)}/decline`, { method: 'POST', auth: true }),
};
