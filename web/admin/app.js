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
          <code>${escapeHtml(s.attachmentId)}</code>.</p>
          <div class="actions-row">
            <button class="btn-plain" data-action="view-document" data-id="${escapeHtml(s.id)}">View document</button>
          </div>
          <p class="document-view-status" data-status-for="${escapeHtml(s.id)}" style="color:var(--color-text-muted);font-size:0.85rem"></p>
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

    view.querySelectorAll('[data-action="view-document"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const { id } = btn.dataset;
        const statusEl = view.querySelector(`[data-status-for="${CSS.escape(id)}"]`);
        btn.disabled = true;
        statusEl.textContent = 'Fetching document link…';
        try {
          const { url } = await Api.getVerificationDocumentUrl(id);
          window.open(url, '_blank', 'noopener');
          statusEl.textContent = 'Opened in a new tab. The link expires shortly, so click "View document" again if it stops working.';
        } catch (err) {
          statusEl.textContent = err.message;
        } finally {
          btn.disabled = false;
        }
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

  const CURRENCY_SYMBOLS = { NGN: '₦', KES: 'KSh ', GHS: 'GH₵', ZAR: 'R', RWF: 'RWF ' };

  function priceLabel(l) {
    if (l.priceType === 'contact') return 'Contact for price';
    if (l.priceType === 'negotiable') return 'Negotiable';
    if (l.priceMinorUnits === null || l.priceMinorUnits === undefined) return '—';
    const formatted = (Number(l.priceMinorUnits) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const code = l.currencyCode ?? '';
    const symbol = CURRENCY_SYMBOLS[code];
    const amount = symbol ? `${symbol}${formatted}` : `${formatted} ${code}`.trim();
    return l.priceType === 'starting_from' ? `From ${amount}` : amount;
  }

  async function renderPendingListings() {
    view.innerHTML = `<p class="empty-state">Loading…</p>`;
    let listings;
    try {
      listings = await Api.listPendingListings();
    } catch (err) {
      if (err.status === 403) {
        renderNotAuthorized();
        return;
      }
      renderError(err);
      return;
    }

    if (listings.length === 0) {
      view.innerHTML = `
        <div class="panel">
          <h2>Pending marketplace listings</h2>
          <p class="empty-state">Nothing waiting on review right now.</p>
        </div>`;
      return;
    }

    const rows = listings
      .map(
        (l) => `
      <tr class="submission-row" data-id="${escapeHtml(l.id)}">
        <td>${escapeHtml(l.title)}</td>
        <td>${escapeHtml(l.listingType)}</td>
        <td>${escapeHtml(l.ownerName)}</td>
        <td>${escapeHtml(priceLabel(l))}</td>
        <td>${formatDateTime(l.updatedAt)}</td>
        <td>
          <button class="btn-plain" data-action="review" data-id="${escapeHtml(l.id)}">Review</button>
        </td>
      </tr>
      <tr class="submission-detail" data-detail-for="${escapeHtml(l.id)}" hidden>
        <td colspan="6">
          <p>${escapeHtml(l.description ?? '')}</p>
          ${
            l.images.length
              ? `<div class="listing-review-images">${l.images.map((img) => `<img src="${escapeHtml(img.url)}" alt="" />`).join('')}</div>`
              : '<p style="color:var(--color-text-muted);font-size:0.85rem">No images attached.</p>'
          }
          <p style="font-size:0.85rem;color:var(--color-text-muted)">
            Category: <strong>${escapeHtml(l.category)}</strong> · Contact:
            ${escapeHtml(l.contactMethod)} — ${escapeHtml(l.contactValue)}
            ${l.locationText ? ` · Location: ${escapeHtml(l.locationText)}` : ''}
          </p>
          <textarea class="review-note" placeholder="Reason (shown to the owner, required to reject)"></textarea>
          <div class="actions-row">
            <button class="primary" data-action="approve" data-id="${escapeHtml(l.id)}">Approve</button>
            <button class="btn-plain" data-action="reject" data-id="${escapeHtml(l.id)}">Reject</button>
          </div>
        </td>
      </tr>`,
      )
      .join('');

    view.innerHTML = `
      <div class="panel">
        <h2>Pending marketplace listings</h2>
        <table class="data-table">
          <thead>
            <tr><th>Title</th><th>Type</th><th>Owner</th><th>Price</th><th>Submitted</th><th></th></tr>
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
        const id = btn.dataset.id;
        const decision = btn.dataset.action === 'approve' ? 'approved' : 'rejected';
        const reason = view.querySelector(`[data-detail-for="${CSS.escape(id)}"] .review-note`).value.trim();

        if (decision === 'rejected' && !reason) {
          window.alert('A reason is required to reject a listing.');
          return;
        }
        if (decision === 'rejected' && !window.confirm('Reject this listing?')) {
          return;
        }

        btn.disabled = true;
        try {
          await Api.decideListing(id, decision, reason || undefined);
          await renderPendingListings();
        } catch (err) {
          window.alert(err.message);
          btn.disabled = false;
        }
      });
    });
  }

  // US-056: platform dispute queue. Each row carries its own tenantId
  // (a dispute's tenant, not the admin's), used to call the existing
  // tenant-scoped resolve route — same "platform queue, tenant-scoped
  // decide" split as verification and listing moderation above.
  async function renderDisputesQueue() {
    view.innerHTML = `<p class="empty-state">Loading…</p>`;
    let disputes;
    try {
      disputes = await Api.listDisputes();
    } catch (err) {
      if (err.status === 403) {
        renderNotAuthorized();
        return;
      }
      renderError(err);
      return;
    }

    if (disputes.length === 0) {
      view.innerHTML = `
        <div class="panel">
          <h2>Disputes</h2>
          <p class="empty-state">No disputes have been raised yet.</p>
        </div>`;
      return;
    }

    const rows = disputes
      .map(
        (d) => `
      <tr class="submission-row" data-id="${escapeHtml(d.id)}">
        <td><code>${escapeHtml(d.caseNumber)}</code></td>
        <td>${escapeHtml(d.tenantName)}</td>
        <td>${escapeHtml(d.raisedByName)}</td>
        <td>${DisputeUI.reasonLabel(d.reason)}</td>
        <td>${DisputeUI.badge(d.status)}</td>
        <td>${DisputeUI.formatDateTime(d.createdAt)}</td>
        <td>
          <button class="btn-plain" data-action="review" data-id="${escapeHtml(d.id)}">Review</button>
        </td>
      </tr>
      <tr class="submission-detail" data-detail-for="${escapeHtml(d.id)}" hidden>
        <td colspan="7">
          ${DisputeUI.disputeDetailHtml(
            d,
            d.status === 'open'
              ? `
            <div class="field">
              <label>Resolution</label>
              <select class="resolution-select tenant-select">
                <option value="resolved_customer">In the customer's favor (refunds the held amount)</option>
                <option value="resolved_provider">In the provider's favor</option>
                <option value="dismissed">Dismiss</option>
              </select>
            </div>
            <textarea class="review-note" placeholder="Note (sent to both parties)"></textarea>
            <div class="actions-row">
              <button class="primary" data-action="resolve" data-id="${escapeHtml(d.id)}" data-tenant="${escapeHtml(d.tenantId)}">Resolve</button>
            </div>`
              : '',
          )}
        </td>
      </tr>`,
      )
      .join('');

    view.innerHTML = `
      <div class="panel">
        <h2>Disputes</h2>
        <table class="data-table">
          <thead>
            <tr><th>Case</th><th>Business</th><th>Raised by</th><th>Reason</th><th>Status</th><th>Raised</th><th></th></tr>
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

    view.querySelectorAll('[data-action="resolve"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const { id, tenant } = btn.dataset;
        const detail = view.querySelector(`[data-detail-for="${CSS.escape(id)}"]`);
        const resolution = detail.querySelector('.resolution-select').value;
        const notes = detail.querySelector('.review-note').value.trim();

        if (!window.confirm('Resolve this dispute? This cannot be undone.')) {
          return;
        }

        btn.disabled = true;
        try {
          await Api.resolveDispute(tenant, id, resolution, notes || undefined);
          await renderDisputesQueue();
        } catch (err) {
          window.alert(err.message);
          btn.disabled = false;
        }
      });
    });
  }

  function switchTab(tab) {
    document.querySelectorAll('.admin-tabs button').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tab));
    if (tab === 'listings') {
      renderPendingListings();
    } else if (tab === 'disputes') {
      renderDisputesQueue();
    } else {
      renderPending();
    }
  }

  async function init() {
    if (!isSignedIn()) {
      window.location.href = 'login.html';
      return;
    }
    renderAuthArea();
    document.querySelectorAll('.admin-tabs button').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    await renderPending();
  }

  init();
})();
