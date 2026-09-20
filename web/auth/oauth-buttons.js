/**
 * Shared "Continue with Google" / "Continue with Facebook" buttons,
 * used on both sign-in pages and both signup pages. Each button click
 * is a full page navigation (never a fetch) — the next hop is the
 * provider's own consent screen, which can't happen inside an XHR.
 *
 * `apiOrigin`: relative path prefix to the API from the including
 * page (e.g. '/v1' from web/customer or web/provider, or '../v1'-style
 * isn't needed since the API is served from this same origin at
 * /v1 regardless of which page loads it — see api/src/main.ts).
 *
 * `getState()` runs at click time, not at render time, so a page that
 * gathers details first (signup-provider.html's business fields) can
 * validate and include them. It returns
 * { role: 'customer' | 'provider', business?: {name,category,countryCode} }
 * or null to cancel the navigation (the page shows its own validation
 * error and nothing happens).
 */
function renderOAuthButtons(containerId, getState) {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }

  container.innerHTML = `
    <div class="oauth-divider"><span>or</span></div>
    <div class="oauth-buttons">
      <button type="button" class="oauth-btn oauth-btn-google" data-provider="google">
        <span class="oauth-btn-icon" aria-hidden="true">G</span>
        Continue with Google
      </button>
      <button type="button" class="oauth-btn oauth-btn-facebook" data-provider="facebook">
        <span class="oauth-btn-icon" aria-hidden="true">f</span>
        Continue with Facebook
      </button>
    </div>
  `;

  container.querySelectorAll('.oauth-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const state = getState();
      if (!state) {
        return;
      }
      const params = new URLSearchParams({ role: state.role });
      if (state.business) {
        params.set('business', JSON.stringify(state.business));
      }
      window.location.href = `/v1/auth/${btn.dataset.provider}?${params.toString()}`;
    });
  });
}
