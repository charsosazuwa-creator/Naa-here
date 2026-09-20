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

  // tenancy — locations and staff (Milestone 2 provider setup).
  listLocations: (tenantId) => apiRequest(`/tenants/${tenantId}/locations`),
  createLocation: (tenantId, payload) => apiRequest(`/tenants/${tenantId}/locations`, { method: 'POST', body: payload }),
  listStaff: (tenantId) => apiRequest(`/tenants/${tenantId}/staff`),
  inviteStaff: (tenantId, payload) => apiRequest(`/tenants/${tenantId}/staff`, { method: 'POST', body: payload }),

  // customer invitations (User Story 6) -- separate from staff invites:
  // these can reach someone who has no account yet, and never grant
  // any tenant membership/role.
  listCustomerInvitations: (tenantId) => apiRequest(`/tenants/${tenantId}/customer-invitations`),
  inviteCustomer: (tenantId, payload) => apiRequest(`/tenants/${tenantId}/customer-invitations`, { method: 'POST', body: payload }),
  resendCustomerInvitation: (tenantId, invitationId) =>
    apiRequest(`/tenants/${tenantId}/customer-invitations/${invitationId}/resend`, { method: 'POST' }),
  cancelCustomerInvitation: (tenantId, invitationId) =>
    apiRequest(`/tenants/${tenantId}/customer-invitations/${invitationId}/cancel`, { method: 'POST' }),

  // verification
  listVerification: (tenantId) => apiRequest(`/tenants/${tenantId}/verification`),
  submitVerification: (tenantId, payload) => apiRequest(`/tenants/${tenantId}/verification`, { method: 'POST', body: payload }),
  uploadMedia: (payload) => apiRequest('/media', { method: 'POST', body: payload }),

  // catalogue
  listServices: (tenantId) => apiRequest(`/tenants/${tenantId}/services?all=true`),
  createService: (tenantId, payload) => apiRequest(`/tenants/${tenantId}/services`, { method: 'POST', body: payload }),
  setServiceStatus: (tenantId, serviceId, status) =>
    apiRequest(`/tenants/${tenantId}/services/${serviceId}/status`, { method: 'PATCH', body: { status } }),

  // catalogue — weekly availability rules and one-off blocked time.
  // There is no GET for blocked time on the backend yet (only POST),
  // so this portal can add blocked time but can't list what's already
  // there — see views.availability's note in app.js.
  listAvailabilityRules: (tenantId) => apiRequest(`/tenants/${tenantId}/availability-rules`),
  addAvailabilityRule: (tenantId, payload) => apiRequest(`/tenants/${tenantId}/availability-rules`, { method: 'POST', body: payload }),
  addBlockedTime: (tenantId, payload) => apiRequest(`/tenants/${tenantId}/blocked-time`, { method: 'POST', body: payload }),

  // CRM — customer records, staff-only notes, and follow-up tasks
  // (never surfaced through any customer-facing route; see crm.service.ts).
  listCustomers: (tenantId) => apiRequest(`/tenants/${tenantId}/customers`),
  createCustomer: (tenantId, payload) => apiRequest(`/tenants/${tenantId}/customers`, { method: 'POST', body: payload }),
  listNotes: (tenantId, customerId) => apiRequest(`/tenants/${tenantId}/customers/${customerId}/notes`),
  addNote: (tenantId, customerId, payload) =>
    apiRequest(`/tenants/${tenantId}/customers/${customerId}/notes`, { method: 'POST', body: payload }),
  listTasks: (tenantId) => apiRequest(`/tenants/${tenantId}/tasks`),
  createTask: (tenantId, payload) => apiRequest(`/tenants/${tenantId}/tasks`, { method: 'POST', body: payload }),
  setTaskStatus: (tenantId, taskId, status) =>
    apiRequest(`/tenants/${tenantId}/tasks/${taskId}/status`, { method: 'PATCH', body: { status } }),

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

  // disputes (US-056)
  listDisputes: (tenantId) => apiRequest(`/tenants/${tenantId}/disputes`),
  raiseDispute: (tenantId, bookingId, payload) =>
    apiRequest(`/tenants/${tenantId}/bookings/${bookingId}/disputes`, { method: 'POST', body: payload }),
  deleteDisputeAttachment: (tenantId, disputeId, attachmentId) =>
    apiRequest(`/tenants/${tenantId}/disputes/${disputeId}/attachments/${attachmentId}`, { method: 'DELETE' }),
  async uploadDisputeAttachment(tenantId, disputeId, file) {
    const token = getAccessToken();
    if (!token) {
      window.location.href = 'login.html';
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
        window.location.href = 'login.html';
      }
      throw new Error(data?.error?.message || `Request failed (${res.status}).`);
    }
    return data;
  },

  // finance — payouts only; refunds and reconciliation are platform-
  // (admin/finance-administrator) actions, out of scope for a
  // provider's own portal (see the admin back office, not yet built).
  listPayouts: (tenantId) => apiRequest(`/tenants/${tenantId}/payouts`),
  requestPayout: (tenantId, payload) => apiRequest(`/tenants/${tenantId}/payouts`, { method: 'POST', body: payload }),

  // Community groups (User Story 5) -- user-level, not tenant-scoped
  // (see group.service.ts's header comment), but shown as a tab
  // within the tenant shell same as "My Listings".
  discoverGroups: (query) => apiRequest(`/groups${query ? `?${query}` : ''}`),
  myGroupInvitations: () => apiRequest('/groups/invitations/mine'),
  createGroup: (payload) => apiRequest('/groups', { method: 'POST', body: payload }),
  getGroup: (groupId) => apiRequest(`/groups/${groupId}`),
  updateGroup: (groupId, payload) => apiRequest(`/groups/${groupId}`, { method: 'PATCH', body: payload }),
  joinGroup: (groupId) => apiRequest(`/groups/${groupId}/join`, { method: 'POST' }),
  leaveGroup: (groupId) => apiRequest(`/groups/${groupId}/leave`, { method: 'POST' }),
  closeGroup: (groupId) => apiRequest(`/groups/${groupId}/close`, { method: 'POST' }),
  transferGroupOwnership: (groupId, newOwnerUserId) =>
    apiRequest(`/groups/${groupId}/transfer-ownership`, { method: 'POST', body: { newOwnerUserId } }),
  listGroupMembers: (groupId) => apiRequest(`/groups/${groupId}/members`),
  listGroupJoinRequests: (groupId) => apiRequest(`/groups/${groupId}/join-requests`),
  approveGroupJoinRequest: (groupId, memberId) => apiRequest(`/groups/${groupId}/join-requests/${memberId}/approve`, { method: 'POST' }),
  declineGroupJoinRequest: (groupId, memberId) => apiRequest(`/groups/${groupId}/join-requests/${memberId}/decline`, { method: 'POST' }),
  inviteGroupMember: (groupId, email) => apiRequest(`/groups/${groupId}/invitations`, { method: 'POST', body: { email } }),
  acceptGroupInvitation: (groupId) => apiRequest(`/groups/${groupId}/invitations/accept`, { method: 'POST' }),
  declineGroupInvitation: (groupId) => apiRequest(`/groups/${groupId}/invitations/decline`, { method: 'POST' }),
  changeGroupMemberRole: (groupId, memberId, role) =>
    apiRequest(`/groups/${groupId}/members/${memberId}/role`, { method: 'PATCH', body: { role } }),
  moderateGroupMember: (groupId, memberId, action, reason) =>
    apiRequest(`/groups/${groupId}/members/${memberId}/moderate`, { method: 'POST', body: { action, reason } }),
  listGroupPosts: (groupId) => apiRequest(`/groups/${groupId}/posts`),
  createGroupPost: (groupId, payload) => apiRequest(`/groups/${groupId}/posts`, { method: 'POST', body: payload }),
  updateGroupPost: (groupId, postId, body) => apiRequest(`/groups/${groupId}/posts/${postId}`, { method: 'PATCH', body: { body } }),
  deleteGroupPost: (groupId, postId) => apiRequest(`/groups/${groupId}/posts/${postId}`, { method: 'DELETE' }),
  reactToGroupPost: (groupId, postId) => apiRequest(`/groups/${groupId}/posts/${postId}/react`, { method: 'POST' }),
  unreactToGroupPost: (groupId, postId) => apiRequest(`/groups/${groupId}/posts/${postId}/react`, { method: 'DELETE' }),
  shareGroupPost: (groupId, postId) => apiRequest(`/groups/${groupId}/posts/${postId}/share`, { method: 'POST' }),
  listGroupPostComments: (groupId, postId) => apiRequest(`/groups/${groupId}/posts/${postId}/comments`),
  addGroupPostComment: (groupId, postId, payload) =>
    apiRequest(`/groups/${groupId}/posts/${postId}/comments`, { method: 'POST', body: payload }),
  deleteGroupPostComment: (groupId, postId, commentId) =>
    apiRequest(`/groups/${groupId}/posts/${postId}/comments/${commentId}`, { method: 'DELETE' }),
  reportGroupContent: (groupId, payload) => apiRequest(`/groups/${groupId}/moderation/reports`, { method: 'POST', body: payload }),
  listGroupReports: (groupId) => apiRequest(`/groups/${groupId}/moderation/reports`),
  decideGroupReport: (groupId, reportId, payload) =>
    apiRequest(`/groups/${groupId}/moderation/reports/${reportId}/decide`, { method: 'POST', body: payload }),
  // Group chat -- polled, not pushed (see group-chat.service.ts).
  listGroupMessages: (groupId, afterId) => apiRequest(`/groups/${groupId}/messages${afterId ? `?after=${afterId}` : ''}`),
  sendGroupMessage: (groupId, body) => apiRequest(`/groups/${groupId}/messages`, { method: 'POST', body: { body } }),
  deleteGroupMessage: (groupId, messageId) => apiRequest(`/groups/${groupId}/messages/${messageId}`, { method: 'DELETE' }),

  async uploadGroupPostAttachment(groupId, postId, file) {
    const token = getAccessToken();
    if (!token) {
      window.location.href = 'login.html';
      throw new Error('Not signed in.');
    }
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE_URL}/groups/${groupId}/posts/${postId}/attachments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401) {
        clearSession();
        window.location.href = 'login.html';
      }
      throw new Error(data?.error?.message || `Request failed (${res.status}).`);
    }
    return data;
  },

  // marketplace listings (User Story 2) — owned by the signed-in user
  // directly, not this tenant, but managed from this portal since any
  // Service Provider is also a registered user (see
  // db/migrations/012_marketplace_listings.sql). uploadListingImage
  // bypasses apiRequest's JSON body handling: it's multipart, not JSON.
  listMyListings: () => apiRequest('/listings/mine'),
  createListing: (payload) => apiRequest('/listings', { method: 'POST', body: payload }),
  updateListing: (listingId, payload) => apiRequest(`/listings/${listingId}`, { method: 'PATCH', body: payload }),
  submitListing: (listingId) => apiRequest(`/listings/${listingId}/submit`, { method: 'POST' }),
  pauseListing: (listingId) => apiRequest(`/listings/${listingId}/pause`, { method: 'POST' }),
  resumeListing: (listingId) => apiRequest(`/listings/${listingId}/resume`, { method: 'POST' }),
  archiveListing: (listingId) => apiRequest(`/listings/${listingId}`, { method: 'DELETE' }),
  deleteListingImage: (listingId, imageId) => apiRequest(`/listings/${listingId}/images/${imageId}`, { method: 'DELETE' }),
  async uploadListingImage(listingId, file) {
    const token = getAccessToken();
    if (!token) {
      window.location.href = 'login.html';
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
        window.location.href = 'login.html';
      }
      throw new Error(data?.error?.message || `Request failed (${res.status}).`);
    }
    return data;
  },
};
