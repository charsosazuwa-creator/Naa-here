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

  // The reporting Agent's advisory review (ModerationAssistService,
  // attached by ListingAdminController/VerificationAdminController to
  // each pending item). Read-only and informational: it never changes
  // a submission's status, it just gives the reviewer a head start.
  function agentReviewBadge(review) {
    if (!review) return '';
    const cls = review.recommendation === 'looks_ready' ? 'ready' : 'attention';
    const label = review.recommendation === 'looks_ready' ? 'Agent: looks ready' : `Agent: ${review.reasons.length} to check`;
    return `<span class="agent-review-badge ${cls}">${escapeHtml(label)}</span>`;
  }

  function agentReviewDetail(review) {
    if (!review || review.reasons.length === 0) return '';
    return `
      <div class="agent-review-detail">
        <p class="agent-review-detail-label">Agent review</p>
        <ul class="agent-review-reasons">
          ${review.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}
        </ul>
      </div>`;
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
        <td>${agentReviewBadge(s.agentReview)}</td>
        <td>
          <button class="btn-plain" data-action="review" data-id="${escapeHtml(s.id)}" data-tenant="${escapeHtml(s.tenantId)}">Review</button>
        </td>
      </tr>
      <tr class="submission-detail" data-detail-for="${escapeHtml(s.id)}" hidden>
        <td colspan="7">
          <p>Document type: <strong>${escapeHtml(s.documentType)}</strong> — attachment id
          <code>${escapeHtml(s.attachmentId)}</code>.</p>
          ${
            s.licenseNumber
              ? `<p>License / registration number: <strong>${escapeHtml(s.licenseNumber)}</strong> <span style="color:var(--color-text-muted);font-size:0.85rem">(self-reported, not verified against any registry)</span></p>`
              : ''
          }
          ${agentReviewDetail(s.agentReview)}
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
            <tr><th>Business</th><th>Country</th><th>Document</th><th>Submitted</th><th>Status</th><th>Agent review</th><th></th></tr>
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

  function formatMoney(amountMinorUnits, currencyCode) {
    if (amountMinorUnits === undefined || amountMinorUnits === null) return '—';
    const amount = (Number(amountMinorUnits) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const code = currencyCode ?? '';
    const symbol = CURRENCY_SYMBOLS[code];
    return symbol ? `${symbol}${amount}` : `${amount} ${code}`.trim();
  }

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
        <td>${escapeHtml(l.listingType.replace(/_/g, ' '))}</td>
        <td>${escapeHtml(l.ownerName)}</td>
        <td>${escapeHtml(priceLabel(l))}</td>
        <td>${formatDateTime(l.updatedAt)}</td>
        <td>${agentReviewBadge(l.agentReview)}</td>
        <td>
          <button class="btn-plain" data-action="review" data-id="${escapeHtml(l.id)}">Review</button>
        </td>
      </tr>
      <tr class="submission-detail" data-detail-for="${escapeHtml(l.id)}" hidden>
        <td colspan="7">
          <p data-view-for="${escapeHtml(l.id)}">${escapeHtml(l.description ?? '')}</p>
          ${agentReviewDetail(l.agentReview)}
          ${
            l.vehicleDetail
              ? `<p style="font-size:0.85rem;color:var(--color-text-muted)">Vehicle: ${escapeHtml([l.vehicleDetail.year, l.vehicleDetail.make, l.vehicleDetail.model].filter(Boolean).join(' ') || '—')}${l.vehicleDetail.mileageKm != null ? ` · ${l.vehicleDetail.mileageKm.toLocaleString()} km` : ''}${l.vehicleDetail.transmission ? ` · ${l.vehicleDetail.transmission}` : ''}${l.vehicleDetail.fuelType ? ` · ${l.vehicleDetail.fuelType}` : ''}${l.vehicleDetail.condition ? ` · ${l.vehicleDetail.condition}` : ''}</p>`
              : ''
          }
          ${
            l.propertyDetail
              ? `<p style="font-size:0.85rem;color:var(--color-text-muted)">Property: ${escapeHtml(l.propertyDetail.propertyType ?? '—')}${l.propertyDetail.bedrooms != null ? ` · ${l.propertyDetail.bedrooms} bed` : ''}${l.propertyDetail.bathrooms != null ? ` · ${l.propertyDetail.bathrooms} bath` : ''}${l.propertyDetail.areaSqm != null ? ` · ${l.propertyDetail.areaSqm} m²` : ''}${l.propertyDetail.saleOrRent ? ` · ${l.propertyDetail.saleOrRent === 'rent' ? 'for rent' : 'for sale'}` : ''}</p>`
              : ''
          }
          <div class="listing-review-images" data-images-for="${escapeHtml(l.id)}">
            ${
              l.images.length
                ? l.images
                    .map(
                      (img) => `
              <span class="listing-review-image" data-image-wrap="${escapeHtml(img.id)}">
                <img src="${escapeHtml(img.url)}" alt="" />
                <button class="btn-plain" type="button" data-action="remove-listing-image" data-id="${escapeHtml(l.id)}" data-image-id="${escapeHtml(img.id)}">Delete photo</button>
              </span>`,
                    )
                    .join('')
                : '<p style="color:var(--color-text-muted);font-size:0.85rem">No images attached.</p>'
            }
          </div>
          <p data-view-for="${escapeHtml(l.id)}" style="font-size:0.85rem;color:var(--color-text-muted)">
            Category: <strong>${escapeHtml(l.category)}</strong> · Contact:
            ${escapeHtml(l.contactMethod)} — ${escapeHtml(l.contactValue)}
            ${l.locationText ? ` · Location: ${escapeHtml(l.locationText)}` : ''}
          </p>
          <div class="actions-row">
            <button class="btn-plain" type="button" data-action="toggle-edit-listing" data-id="${escapeHtml(l.id)}">Edit</button>
          </div>

          <div class="listing-edit-form" data-edit-for="${escapeHtml(l.id)}" hidden style="margin-top:var(--space-2)">
            <div class="listing-edit-alert alert error" role="alert" hidden></div>
            <div class="field"><label>Title</label><input class="le-title" value="${escapeHtml(l.title)}" /></div>
            <div class="field"><label>Category</label><input class="le-category" value="${escapeHtml(l.category)}" /></div>
            <div class="field"><label>Description</label><textarea class="le-description" rows="3">${escapeHtml(l.description ?? '')}</textarea></div>
            <div class="field">
              <label>Price type</label>
              <select class="le-price-type tenant-select">
                ${['fixed', 'starting_from', 'negotiable', 'contact']
                  .map((pt) => `<option value="${pt}" ${pt === l.priceType ? 'selected' : ''}>${pt}</option>`)
                  .join('')}
              </select>
            </div>
            <div class="field"><label>Price (e.g. 25.00 — ignored for negotiable/contact)</label><input class="le-price" type="number" min="0" step="0.01" value="${l.priceMinorUnits != null ? (Number(l.priceMinorUnits) / 100).toFixed(2) : ''}" /></div>
            <div class="field">
              <label>Currency</label>
              <select class="le-currency tenant-select">
                ${['NGN', 'KES', 'GHS', 'ZAR'].map((c) => `<option value="${c}" ${c === l.currencyCode ? 'selected' : ''}>${c}</option>`).join('')}
              </select>
            </div>
            <div class="actions-row">
              <button class="primary" type="button" data-action="save-listing-edit" data-id="${escapeHtml(l.id)}">Save changes</button>
              <button class="btn-plain" type="button" data-action="toggle-edit-listing" data-id="${escapeHtml(l.id)}">Cancel</button>
            </div>
          </div>

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
            <tr><th>Title</th><th>Type</th><th>Owner</th><th>Price</th><th>Submitted</th><th>Agent review</th><th></th></tr>
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

    // US-0xx: admin can fix a listing up before approving/rejecting it.
    view.querySelectorAll('[data-action="toggle-edit-listing"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const form = view.querySelector(`[data-edit-for="${CSS.escape(id)}"]`);
        form.hidden = !form.hidden;
      });
    });

    view.querySelectorAll('[data-action="save-listing-edit"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const form = view.querySelector(`[data-edit-for="${CSS.escape(id)}"]`);
        const alertBox = form.querySelector('.listing-edit-alert');
        alertBox.hidden = true;

        const priceType = form.querySelector('.le-price-type').value;
        const priceRaw = form.querySelector('.le-price').value.trim();
        const patch = {
          title: form.querySelector('.le-title').value.trim(),
          category: form.querySelector('.le-category').value.trim(),
          description: form.querySelector('.le-description').value.trim(),
          priceType,
          currencyCode: form.querySelector('.le-currency').value,
        };
        if (priceType === 'fixed' || priceType === 'starting_from') {
          const amount = Number(priceRaw);
          if (!priceRaw || Number.isNaN(amount) || amount < 0) {
            alertBox.textContent = 'Enter a valid price for this price type.';
            alertBox.hidden = false;
            return;
          }
          patch.priceMinorUnits = Math.round(amount * 100);
        }

        btn.disabled = true;
        try {
          await Api.editListing(id, patch);
          await renderPendingListings();
        } catch (err) {
          alertBox.textContent = err.message;
          alertBox.hidden = false;
          btn.disabled = false;
        }
      });
    });

    view.querySelectorAll('[data-action="remove-listing-image"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!window.confirm('Delete this photo from the listing?')) return;
        btn.disabled = true;
        try {
          await Api.deleteListingImage(btn.dataset.id, btn.dataset.imageId);
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

  // Admin's direct "add a category" screen — lists both the service
  // and business category tables (migration 023's 'category.manage'
  // permission gates the add forms; the lists themselves are public
  // GETs, same as the "create service"/"create business" forms that
  // autocomplete against them, so those load even for a signed-in
  // account without the permission — only submitting the add form
  // needs it).
  async function renderCategories() {
    view.innerHTML = `<p class="empty-state">Loading…</p>`;
    let serviceCategories, businessCategories;
    try {
      [serviceCategories, businessCategories] = await Promise.all([
        Api.listServiceCategories(),
        Api.listBusinessCategories(),
      ]);
    } catch (err) {
      renderError(err);
      return;
    }

    const categoryListHtml = (categories) =>
      categories.length
        ? `<ul style="margin:0;padding-left:1.2em">${categories.map((c) => `<li>${escapeHtml(c.name)}</li>`).join('')}</ul>`
        : '<p class="empty-state">No categories yet.</p>';

    view.innerHTML = `
      <div class="panel">
        <h2>Service categories</h2>
        <p style="color:var(--color-text-muted);font-size:0.85rem">Shown to providers when they create a service.</p>
        <div id="service-category-list">${categoryListHtml(serviceCategories)}</div>
        <div id="service-category-alert" class="alert error" role="alert" hidden></div>
        <form id="service-category-form" novalidate style="margin-top:var(--space-3)">
          <div class="field"><label for="sc-name">Add a service category</label><input id="sc-name" required /></div>
          <button class="primary" type="submit">Add</button>
        </form>
      </div>
      <div class="panel">
        <h2>Business categories</h2>
        <p style="color:var(--color-text-muted);font-size:0.85rem">Shown when a business signs up.</p>
        <div id="business-category-list">${categoryListHtml(businessCategories)}</div>
        <div id="business-category-alert" class="alert error" role="alert" hidden></div>
        <form id="business-category-form" novalidate style="margin-top:var(--space-3)">
          <div class="field"><label for="bc-name">Add a business category</label><input id="bc-name" required /></div>
          <button class="primary" type="submit">Add</button>
        </form>
      </div>`;

    document.getElementById('service-category-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = document.getElementById('sc-name');
      const alertBox = document.getElementById('service-category-alert');
      const name = input.value.trim();
      if (!name) return;
      alertBox.hidden = true;
      try {
        await Api.createServiceCategory(name);
        input.value = '';
        await renderCategories();
      } catch (err) {
        alertBox.textContent = err.status === 403
          ? "This account doesn't hold a platform role that carries the category.manage permission."
          : err.message;
        alertBox.hidden = false;
      }
    });

    document.getElementById('business-category-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = document.getElementById('bc-name');
      const alertBox = document.getElementById('business-category-alert');
      const name = input.value.trim();
      if (!name) return;
      alertBox.hidden = true;
      try {
        await Api.createBusinessCategory(name);
        input.value = '';
        await renderCategories();
      } catch (err) {
        alertBox.textContent = err.status === 403
          ? "This account doesn't hold a platform role that carries the category.manage permission."
          : err.message;
        alertBox.hidden = false;
      }
    });
  }

  // -----------------------------------------------------------------
  // Reports: cross-tenant platform summary (admin-only) and any
  // tenant's business-performance report, both generated on demand by
  // the reporting Agent service account (db/migrations/
  // 026_admin_agent_reports.sql, api/src/modules/reports/). A
  // provider sees the same business-performance report for their own
  // tenant only, from the provider portal's own Reports tab
  // (web/provider/app.js) — this is the admin-side view: any tenant,
  // plus the cross-tenant summary nothing else can produce.
  // -----------------------------------------------------------------

  function renderPlatformSummaryResult(result) {
    const statusEntries = Object.entries(result.bookingsByStatus ?? {});
    const statusList = statusEntries.length
      ? statusEntries.map(([status, count]) => `<li>${badge(status)} <strong>${count}</strong></li>`).join('')
      : '<li class="empty-state">No bookings in this period.</li>';
    const revenueList = (result.revenueByCurrency ?? []).length
      ? result.revenueByCurrency.map((r) => `<li>${formatMoney(r.amountMinorUnits, r.currencyCode)}</li>`).join('')
      : '<li class="empty-state">No completed charges in this period.</li>';
    const tenantRows = (result.topTenantsByBookings ?? []).length
      ? result.topTenantsByBookings.map((t) => `<tr><td>${escapeHtml(t.tenantName)}</td><td>${t.bookingCount}</td></tr>`).join('')
      : '<tr class="empty-row"><td colspan="2">No bookings in this period.</td></tr>';

    return `
      <div class="report-stats">
        <div class="report-stat"><div class="report-stat-value">${result.totalTenants}</div><div class="report-stat-label">Total businesses</div></div>
        <div class="report-stat"><div class="report-stat-value">${result.newTenants}</div><div class="report-stat-label">New businesses (${result.periodDays}d)</div></div>
        <div class="report-stat"><div class="report-stat-value">${result.newSignups}</div><div class="report-stat-label">New signups (${result.periodDays}d)</div></div>
        <div class="report-stat"><div class="report-stat-value">${result.openDisputes}</div><div class="report-stat-label">Open disputes</div></div>
      </div>
      <div class="report-grid">
        <div class="report-card">
          <div class="report-card-header"><h2>Bookings by status</h2></div>
          <ul class="report-list">${statusList}</ul>
        </div>
        <div class="report-card">
          <div class="report-card-header"><h2>Revenue</h2></div>
          <ul class="report-list">${revenueList}</ul>
        </div>
        <div class="report-card">
          <div class="report-card-header"><h2>Top businesses by bookings</h2></div>
          <table class="data-table">
            <thead><tr><th>Business</th><th>Bookings</th></tr></thead>
            <tbody>${tenantRows}</tbody>
          </table>
        </div>
      </div>`;
  }

  function renderBusinessPerformanceResult(result) {
    const statusEntries = Object.entries(result.bookingsByStatus ?? {});
    const totalBookings = statusEntries.reduce((sum, [, count]) => sum + count, 0);
    const statusList = statusEntries.length
      ? statusEntries.map(([status, count]) => `<li>${badge(status)} <strong>${count}</strong></li>`).join('')
      : '<li class="empty-state">No bookings in this period.</li>';
    const revenueList = (result.revenueByCurrency ?? []).length
      ? result.revenueByCurrency.map((r) => `<li>${formatMoney(r.amountMinorUnits, r.currencyCode)}</li>`).join('')
      : '<li class="empty-state">No completed charges in this period.</li>';
    const servicesRows = (result.topServices ?? []).length
      ? result.topServices.map((s) => `<tr><td>${escapeHtml(s.name)}</td><td>${s.bookingCount}</td></tr>`).join('')
      : '<tr class="empty-row"><td colspan="2">No bookings in this period.</td></tr>';

    return `
      <div class="report-stats">
        <div class="report-stat"><div class="report-stat-value">${escapeHtml(result.tenantName)}</div><div class="report-stat-label">Business</div></div>
        <div class="report-stat"><div class="report-stat-value">${totalBookings}</div><div class="report-stat-label">Bookings (${result.periodDays}d)</div></div>
        <div class="report-stat"><div class="report-stat-value">${result.openDisputes}</div><div class="report-stat-label">Open disputes</div></div>
      </div>
      <div class="report-grid">
        <div class="report-card">
          <div class="report-card-header"><h2>Bookings by status</h2></div>
          <ul class="report-list">${statusList}</ul>
        </div>
        <div class="report-card">
          <div class="report-card-header"><h2>Revenue</h2></div>
          <ul class="report-list">${revenueList}</ul>
        </div>
        <div class="report-card">
          <div class="report-card-header"><h2>Top services</h2></div>
          <table class="data-table">
            <thead><tr><th>Service</th><th>Bookings</th></tr></thead>
            <tbody>${servicesRows}</tbody>
          </table>
        </div>
      </div>`;
  }

  async function renderReports() {
    view.innerHTML = `<p class="empty-state">Loading…</p>`;
    let tenants, history;
    try {
      [tenants, history] = await Promise.all([Api.listReportTenants(), Api.listReportHistory()]);
    } catch (err) {
      renderError(err);
      return;
    }

    const tenantOptions = tenants.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
    const historyRows = history.length
      ? history
          .map(
            (r, i) => `
        <tr>
          <td>${formatDateTime(r.createdAt)}</td>
          <td>${r.reportType === 'platform_summary' ? 'Platform summary' : 'Business performance'}</td>
          <td>${r.tenantName ? escapeHtml(r.tenantName) : '—'}</td>
          <td>${r.periodDays} days</td>
          <td><button type="button" class="btn-plain report-view-btn" data-index="${i}">View</button></td>
        </tr>`,
          )
          .join('')
      : '<tr class="empty-row"><td colspan="5">No reports generated yet.</td></tr>';

    view.innerHTML = `
      <div class="panel">
        <h2>Platform summary</h2>
        <p style="color:var(--color-text-muted);font-size:0.85rem">
          Cross-tenant: bookings, revenue and disputes across every business on the platform.
        </p>
        <div style="display:flex;gap:var(--space-3);align-items:flex-end;flex-wrap:wrap">
          <div class="field" style="margin-bottom:0">
            <label for="platform-period">Period</label>
            <select id="platform-period" class="tenant-select">
              <option value="7">Last 7 days</option>
              <option value="30" selected>Last 30 days</option>
              <option value="90">Last 90 days</option>
            </select>
          </div>
          <button id="generate-platform-btn" class="primary" type="button">Generate</button>
        </div>
        <div id="platform-alert" class="alert error" role="alert" hidden></div>
        <div id="platform-result" style="margin-top:var(--space-4)"></div>
      </div>

      <div class="panel">
        <h2>Business performance</h2>
        <p style="color:var(--color-text-muted);font-size:0.85rem">Any business's own bookings, revenue and top services.</p>
        <div style="display:flex;gap:var(--space-3);align-items:flex-end;flex-wrap:wrap">
          <div class="field" style="margin-bottom:0">
            <label for="business-tenant">Business</label>
            <select id="business-tenant" class="tenant-select">${tenantOptions}</select>
          </div>
          <div class="field" style="margin-bottom:0">
            <label for="business-period">Period</label>
            <select id="business-period" class="tenant-select">
              <option value="7">Last 7 days</option>
              <option value="30" selected>Last 30 days</option>
              <option value="90">Last 90 days</option>
            </select>
          </div>
          <button id="generate-business-btn" class="primary" type="button">Generate</button>
        </div>
        <div id="business-alert" class="alert error" role="alert" hidden></div>
        <div id="business-result" style="margin-top:var(--space-4)"></div>
      </div>

      <div class="panel">
        <h2>History</h2>
        <table class="data-table">
          <thead><tr><th>Generated</th><th>Type</th><th>Business</th><th>Period</th><th></th></tr></thead>
          <tbody>${historyRows}</tbody>
        </table>
      </div>`;

    const platformResult = document.getElementById('platform-result');
    const platformAlert = document.getElementById('platform-alert');
    document.getElementById('generate-platform-btn').addEventListener('click', async (event) => {
      const btn = event.currentTarget;
      platformAlert.hidden = true;
      btn.disabled = true;
      btn.textContent = 'Generating…';
      try {
        const periodDays = Number(document.getElementById('platform-period').value);
        const report = await Api.generatePlatformSummary(periodDays);
        platformResult.innerHTML = renderPlatformSummaryResult(report.result);
        history.unshift({ ...report, tenantName: null });
      } catch (err) {
        platformAlert.textContent = err.status === 403
          ? "This account doesn't hold a platform role that carries the report.view permission."
          : err.message;
        platformAlert.hidden = false;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Generate';
      }
    });

    const businessResult = document.getElementById('business-result');
    const businessAlert = document.getElementById('business-alert');
    document.getElementById('generate-business-btn').addEventListener('click', async (event) => {
      const btn = event.currentTarget;
      businessAlert.hidden = true;
      if (!tenants.length) {
        businessAlert.textContent = 'No businesses exist yet.';
        businessAlert.hidden = false;
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Generating…';
      try {
        const tenantId = document.getElementById('business-tenant').value;
        const periodDays = Number(document.getElementById('business-period').value);
        const report = await Api.generateBusinessPerformance(tenantId, periodDays);
        businessResult.innerHTML = renderBusinessPerformanceResult(report.result);
      } catch (err) {
        businessAlert.textContent = err.message;
        businessAlert.hidden = false;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Generate';
      }
    });

    document.querySelectorAll('.report-view-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const row = history[Number(btn.dataset.index)];
        if (!row) return;
        if (row.reportType === 'platform_summary') {
          platformResult.innerHTML = renderPlatformSummaryResult(row.result);
          platformResult.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          businessResult.innerHTML = renderBusinessPerformanceResult(row.result);
          businessResult.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
    } else if (tab === 'categories') {
      renderCategories();
    } else if (tab === 'reports') {
      renderReports();
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
