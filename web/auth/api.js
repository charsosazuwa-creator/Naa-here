// Relative, not absolute: the API is served from this same origin
// in every environment (see api/src/main.ts's static-asset serving),
// so no origin needs hardcoding and none of this breaks when the app
// moves from the local demo's localhost:8811 to a real deployment.
const API_BASE_URL = '/v1';

/**
 * Small fetch wrapper matching the API conventions in design section 9:
 * errors come back as { error: { code, message, requestId } }.
 */
async function apiRequest(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message = data?.error?.message || 'Something went wrong. Please try again.';
    throw new Error(message);
  }

  return data;
}

const AuthApi = {
  register: (payload) => apiRequest('/auth/register', { method: 'POST', body: payload }),
  verify: (payload) => apiRequest('/auth/verify', { method: 'POST', body: payload }),
  resendVerification: (payload) => apiRequest('/auth/verify/resend', { method: 'POST', body: payload }),
  login: (payload) => apiRequest('/auth/login', { method: 'POST', body: payload }),
  forgotPassword: (payload) => apiRequest('/auth/password/forgot', { method: 'POST', body: payload }),
  resetPassword: (payload) => apiRequest('/auth/password/reset', { method: 'POST', body: payload }),
};
