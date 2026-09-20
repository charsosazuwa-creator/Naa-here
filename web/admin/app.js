(function () {
  const view = document.getElementById('view');

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  function formatDateTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  function badge(status) {
    return `<span class="badge status-${escapeHtml(status)}">${escapeHtml(status)}</span>`;
  }

  function renderAuthArea() {
    const user = currentUser();
    document.getElementById('user-name').textContent = user ? (user.fullName || user.email || '') : '';
    const btn = document.getElementById('auth-btn');
    btn.onclick = () => {
      clearSession();
      window.location.href = 'login.html';
    };
  }

  function renderNotAuthorized() {
    view.innerHTML = `
      <div class="not-authorized">
        <h2>You're signed in, but not as an admin</h2>
        <p>This account doesn't hold a platform role (e.g. administrator) that carries the
        <code>verification.decide</code> permission, so there's nothing here for it to see.
        Sign in with an account that's been granted a platform role, or ask whoever manages
        this deployment to grant one (see <code>PLATFORM_ADMIN_EMAILS</code>).</p>
      </div>`;
  }

  function renderError(err) {
    view.innerHTML = `<div class="alert error" role="alert">${escapeHtml(err.message)}</div>`;
  }

  async function renderPending() {
    view.innerHTML = `<p class="empty-state">Loading…</p>`;
    let submissions;
    try {
      submissions = await Api.listPendingVerifications(false);
    } catch (err) {
      if (err.status === 403) {
        renderNotAuthorized();
        return;
      }
      renderError(err);
      return;
    }

    if (submissions.length === 0) {
      view.innerHTML = `
        <div class="panel">
          <h2>Pending business verifications</h2>
          <p class="empty-state">Nothing waiting on review right now.</p>
        </div>`;
      return;
    }

    const rows = submissions.map((s) => `
      <tr class="submission-row" data-id="${escapeHtml(s.id)}">
        <td>${escapeHtml(s.tenantName)}</td>
        <td>${escapeHtml(s.countryCode)}</td>
        <td>${escapeHtml(s.documentType)}</td>
        <td>${formatDateTime(s.submittedAt)}</td>
        <td>${badge(s.status)}</td>
        <td>
          <button class="btn-plain" data-action="review" data-id="${escapeHtml(s.id)}" data-tenant="${escapeHtml(s.tenantId)}">Review</button>
        </td>
      </tr>
      <tr class="submission-detail" data-detail-for="${escapeHtml(s.id)}" hidden>
        <td colspan="6">
          <p>Document type: <strong>${escapeHtml(s.documentType)}</strong> — attachment id
          <code>${escapeHtml(s.attachmentId)}</code>. This milestone records upload metadata only
          (see media.service.ts); there's no stored file to preview yet, so review this against
          whatever the provider submitted through their own channel until real file storage is
          wired up.</p>
          <textarea class="review-note" placeholder="Optional note (visible to the provider)"></textarea>
          <div class="actions-row">
            <button class="primary" data-action="approve" data-id="${escapeHtml(s.id)}" data-tenant="${escapeHtml(s.tenantId)}">Approve</button>
            <button class="btn-plain" data-action="reject" data-id="${escapeHtml(s.id)}" data-tenant="${escapeHtml(s.tenantId)}">Reject</button>
          </div>
        </td>
      </tr>`).join('');

    view.innerHTML = `
      <div class="panel">
        <h2>Pending business verifications</h2>
        <table class="data-table">
          <thead>
            <tr><th>Business</th><th>Country</th><th>Document</th><th>Submitted</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;

    view.querySelectorAll('[data-action="review"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const detail = view.querySelector(`[data-detail-for="${CSS.escape(id)}"]`);
        detail.hidden = !detail.hidden;
      });
    });

    view.querySelectorAll('[data-action="approve"], [data-action="reject"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const { id, tenant } = btn.dataset;
        const decision = btn.dataset.action === 'approve' ? 'approved' : 'rejected';
        const note = view.querySelector(`[data-detail-for="${CSS.escape(id)}"] .review-note`).value.trim();

        if (decision === 'rejected' && !window.confirm('Reject this verification submission?')) {
          return;
        }

        btn.disabled = true;
        try {
          await Api.decideVerification(tenant, id, decision, note || undefined);
          await renderPending();
        } catch (err) {
          window.alert(err.message);
          btn.disabled = false;
        }
      });
    });
  }

  async function init() {
    if (!isSignedIn()) {
      window.location.href = 'login.html';
      return;
    }
    renderAuthArea();
    await renderPending();
  }

  init();
})();
