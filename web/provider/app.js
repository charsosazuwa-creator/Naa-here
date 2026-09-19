/**
 * Provider portal (design sections 8/15): the first of the three
 * front-end apps the design calls for, giving a provider a UI for
 * everything past auth that Milestones 2-4 previously only exposed as
 * raw HTTP routes. Dependency-free, hash-routed, no build step — the
 * same constraint web/auth/ works under, extended to a multi-page app
 * shell instead of one card per page.
 *
 * State is kept in memory only (a `state` object below); nothing here
 * needs to survive a reload except the session itself (api.js's
 * sessionStorage), so a reload simply re-fetches /me and /tenants/mine.
 */

const state = {
  user: null,
  tenants: [],
  tenantId: null,
};

const NAV_ITEMS = [
  { key: 'overview', label: 'Overview' },
  { key: 'verification', label: 'Verification' },
  { key: 'services', label: 'Services' },
  { key: 'bookings', label: 'Bookings' },
  { key: 'job-requests', label: 'Job requests' },
  { key: 'disputes', label: 'Disputes' },
  { key: 'payouts', label: 'Payouts' },
];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatMoney(amountMinorUnits, currencyCode) {
  if (amountMinorUnits === undefined || amountMinorUnits === null) return '—';
  return `${(Number(amountMinorUnits) / 100).toFixed(2)} ${currencyCode ?? ''}`.trim();
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function badge(status) {
  return `<span class="badge status-${escapeHtml(status)}">${escapeHtml(String(status).replace(/_/g, ' '))}</span>`;
}

function currentTenant() {
  return state.tenants.find((t) => t.id === state.tenantId) ?? null;
}

/** Every view returns { title, body } and, optionally, an `after()` hook to wire up event listeners once the HTML is in the DOM. */
const views = {};

// ---------------------------------------------------------------------
// Tenants (no tenant selected yet): pick or create a business.
// ---------------------------------------------------------------------
views.tenants = async () => {
  const body = `
    <h1 class="page-title">Your businesses</h1>
    <div class="panel">
      ${
        state.tenants.length === 0
          ? '<p style="color:var(--color-text-muted)">You are not a member of any business yet. Create one below.</p>'
          : state.tenants
              .map(
                (t) => `
        <div class="tenant-card" data-tenant-id="${t.id}">
          <div>
            <div class="name">${escapeHtml(t.name)}</div>
            <div class="meta">${escapeHtml(t.category)} · ${escapeHtml(t.countryCode)} · ${escapeHtml(t.roleCode)}</div>
          </div>
          ${badge(t.verificationStatus)}
        </div>`,
              )
              .join('')
      }
    </div>
    <div class="panel">
      <h2>Create a new business</h2>
      <div id="create-alert" class="alert error" role="alert" hidden></div>
      <form id="create-tenant-form" novalidate>
        <div class="field"><label for="ct-name">Business name</label><input id="ct-name" required /></div>
        <div class="field">
          <label for="ct-category">Category</label>
          <select id="ct-category" class="tenant-select">
            <option value="barber_salon">Barber / salon</option>
            <option value="accommodation">Accommodation</option>
            <option value="artisan">Artisan</option>
          </select>
        </div>
        <div class="field">
          <label for="ct-country">Country</label>
          <select id="ct-country" class="tenant-select">
            <option value="NG">Nigeria</option>
            <option value="KE">Kenya</option>
            <option value="GH">Ghana</option>
            <option value="ZA">South Africa</option>
          </select>
        </div>
        <button class="primary" type="submit">Create business</button>
      </form>
    </div>
  `;

  const after = () => {
    document.querySelectorAll('.tenant-card').forEach((card) => {
      card.addEventListener('click', () => {
        window.location.hash = `#/t/${card.dataset.tenantId}/overview`;
      });
    });

    const form = document.getElementById('create-tenant-form');
    const alertBox = document.getElementById('create-alert');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      alertBox.hidden = true;
      try {
        const tenant = await Api.createTenant({
          name: document.getElementById('ct-name').value.trim(),
          category: document.getElementById('ct-category').value,
          countryCode: document.getElementById('ct-country').value,
        });
        await reloadTenants();
        window.location.hash = `#/t/${tenant.id}/overview`;
      } catch (err) {
        alertBox.textContent = err.message;
        alertBox.hidden = false;
      }
    });
  };

  return { title: 'Your businesses', body, after };
};

// ---------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------
views.overview = async () => {
  const tenant = await Api.getTenant(state.tenantId);
  const body = `
    <h1 class="page-title">${escapeHtml(tenant.name)}</h1>
    <div class="panel">
      <h2>Business details</h2>
      <p><strong>Category:</strong> ${escapeHtml(tenant.category)}</p>
      <p><strong>Country:</strong> ${escapeHtml(tenant.countryCode)}</p>
      <p><strong>Verification status:</strong> ${badge(tenant.verificationStatus)}</p>
      <p><strong>Listing status:</strong> ${badge(tenant.status)}</p>
      ${
        tenant.verificationStatus !== 'verified'
          ? '<p style="color:var(--color-text-muted)">A service cannot be published until this business is verified — see the Verification tab.</p>'
          : ''
      }
    </div>
  `;
  return { title: tenant.name, body };
};

// ---------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------
views.verification = async () => {
  const [tenant, submissions] = await Promise.all([Api.getTenant(state.tenantId), Api.listVerification(state.tenantId)]);

  const rows = submissions.length
    ? submissions
        .map(
          (s) => `
      <tr>
        <td>${escapeHtml(s.documentType)}</td>
        <td>${badge(s.status)}</td>
        <td>${escapeHtml(s.decisionNote ?? '—')}</td>
      </tr>`,
        )
        .join('')
    : '<tr class="empty-row"><td colspan="3">No verification documents submitted yet.</td></tr>';

  const body = `
    <h1 class="page-title">Verification</h1>
    <div class="panel">
      <p><strong>Current status:</strong> ${badge(tenant.verificationStatus)}</p>
      <table class="data-table">
        <thead><tr><th>Document type</th><th>Status</th><th>Reviewer note</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="panel">
      <h2>Submit a document</h2>
      <p style="color:var(--color-text-muted);font-size:0.85rem;margin-top:-8px">
        This milestone accepts upload <em>metadata</em> only (no real object storage is wired up yet —
        see the README's "What Milestone 2 does not cover yet"). A storage key stands in for a real
        file upload here.
      </p>
      <div id="verify-alert" class="alert error" role="alert" hidden></div>
      <form id="submit-verification-form" novalidate>
        <div class="field"><label for="v-doctype">Document type</label>
          <input id="v-doctype" placeholder="e.g. business_registration_certificate" required />
        </div>
        <div class="field"><label for="v-storagekey">Storage key</label>
          <input id="v-storagekey" placeholder="e.g. uploads/registration.pdf" required />
        </div>
        <button class="primary" type="submit">Submit for review</button>
      </form>
    </div>
  `;

  const after = () => {
    const form = document.getElementById('submit-verification-form');
    const alertBox = document.getElementById('verify-alert');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      alertBox.hidden = true;
      try {
        const media = await Api.uploadMedia({
          storageKey: document.getElementById('v-storagekey').value.trim(),
          contentType: 'application/pdf',
          byteSize: 1024,
          tenantId: state.tenantId,
        });
        await Api.submitVerification(state.tenantId, {
          documentType: document.getElementById('v-doctype').value.trim(),
          attachmentId: media.id,
        });
        renderRoute();
      } catch (err) {
        alertBox.textContent = err.message;
        alertBox.hidden = false;
      }
    });
  };

  return { title: 'Verification', body, after };
};

// ---------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------
views.services = async () => {
  const services = await Api.listServices(state.tenantId);

  const rows = services.length
    ? services
        .map(
          (s) => `
      <tr>
        <td>${escapeHtml(s.name)}</td>
        <td>${formatMoney(s.priceMinorUnits, s.currencyCode)}</td>
        <td>${badge(s.status)}</td>
        <td>
          <div class="actions-row">
            ${s.status !== 'published' ? `<button class="small primary" data-action="publish" data-id="${s.id}">Publish</button>` : ''}
            ${s.status === 'published' ? `<button class="small" data-action="archive" data-id="${s.id}">Archive</button>` : ''}
          </div>
        </td>
      </tr>`,
        )
        .join('')
    : '<tr class="empty-row"><td colspan="4">No services yet.</td></tr>';

  const body = `
    <h1 class="page-title">Services</h1>
    <div class="panel">
      <table class="data-table">
        <thead><tr><th>Name</th><th>Price</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="panel">
      <h2>Add a service</h2>
      <div id="service-alert" class="alert error" role="alert" hidden></div>
      <form id="create-service-form" novalidate>
        <div class="field"><label for="s-name">Name</label><input id="s-name" required /></div>
        <div class="field"><label for="s-category">Category id</label><input id="s-category" type="number" value="1" required /></div>
        <div class="field"><label for="s-price">Price (minor units — 0 for quote-per-job)</label><input id="s-price" type="number" min="0" value="0" required /></div>
        <div class="field">
          <label for="s-currency">Currency</label>
          <select id="s-currency" class="tenant-select">
            <option>NGN</option><option>KES</option><option>GHS</option><option>ZAR</option>
          </select>
        </div>
        <div class="field"><label for="s-duration">Duration (minutes)</label><input id="s-duration" type="number" min="1" value="30" /></div>
        <button class="primary" type="submit">Create service</button>
      </form>
    </div>
  `;

  const after = () => {
    document.querySelectorAll('[data-action="publish"]').forEach((btn) =>
      btn.addEventListener('click', () => runAction(btn, () => Api.setServiceStatus(state.tenantId, btn.dataset.id, 'published'))),
    );
    document.querySelectorAll('[data-action="archive"]').forEach((btn) =>
      btn.addEventListener('click', () => runAction(btn, () => Api.setServiceStatus(state.tenantId, btn.dataset.id, 'archived'))),
    );

    const form = document.getElementById('create-service-form');
    const alertBox = document.getElementById('service-alert');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      alertBox.hidden = true;
      try {
        await Api.createService(state.tenantId, {
          name: document.getElementById('s-name').value.trim(),
          categoryId: Number(document.getElementById('s-category').value),
          priceMinorUnits: Number(document.getElementById('s-price').value),
          currencyCode: document.getElementById('s-currency').value,
          durationMinutes: Number(document.getElementById('s-duration').value) || undefined,
        });
        renderRoute();
      } catch (err) {
        alertBox.textContent = err.message;
        alertBox.hidden = false;
      }
    });
  };

  return { title: 'Services', body, after };
};

// ---------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------
const BOOKING_TRANSITIONS = {
  confirmed: [
    { to: 'in_progress', label: 'Start' },
    { to: 'cancelled', label: 'Cancel' },
    { to: 'no_show', label: 'No-show' },
  ],
  in_progress: [
    { to: 'completed', label: 'Complete' },
    { to: 'cancelled', label: 'Cancel' },
  ],
};

views.bookings = async () => {
  const bookings = await Api.listBookings(state.tenantId);

  const rows = bookings.length
    ? bookings
        .map((b) => {
          const actions = (BOOKING_TRANSITIONS[b.status] ?? [])
            .map((t) => `<button class="small" data-action="transition" data-id="${b.id}" data-status="${t.to}">${t.label}</button>`)
            .join('');
          return `
      <tr>
        <td>${formatDate(b.startsAt)}</td>
        <td>${formatDate(b.endsAt)}</td>
        <td>${badge(b.status)}</td>
        <td><div class="actions-row">${actions || '—'}
          <button class="small" data-action="dispute" data-id="${b.id}">Raise dispute</button>
        </div></td>
      </tr>`;
        })
        .join('')
    : '<tr class="empty-row"><td colspan="4">No bookings yet.</td></tr>';

  const body = `
    <h1 class="page-title">Bookings</h1>
    <div class="panel">
      <table class="data-table">
        <thead><tr><th>Starts</th><th>Ends</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  const after = () => {
    document.querySelectorAll('[data-action="transition"]').forEach((btn) =>
      btn.addEventListener('click', () =>
        runAction(btn, () => Api.transitionBooking(state.tenantId, btn.dataset.id, { status: btn.dataset.status })),
      ),
    );
    document.querySelectorAll('[data-action="dispute"]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const reason = window.prompt('Reason for the dispute:');
        if (!reason) return;
        await runAction(btn, () => Api.raiseDispute(state.tenantId, btn.dataset.id, { reason }));
      }),
    );
  };

  return { title: 'Bookings', body, after };
};

// ---------------------------------------------------------------------
// Job requests (artisan flow)
// ---------------------------------------------------------------------
views['job-requests'] = async () => {
  const jobs = await Api.listJobRequests(state.tenantId);

  const rows = jobs.length
    ? jobs
        .map(
          (j) => `
      <tr>
        <td>${escapeHtml(j.description)}</td>
        <td>${badge(j.status)}</td>
        <td>
          <div class="actions-row">
            ${
              ['requested', 'quoted'].includes(j.status)
                ? `<button class="small primary" data-action="quote" data-id="${j.id}">Quote</button>
                   <button class="small danger" data-action="decline" data-id="${j.id}">Decline</button>`
                : '—'
            }
          </div>
        </td>
      </tr>`,
        )
        .join('')
    : '<tr class="empty-row"><td colspan="3">No job requests yet.</td></tr>';

  const body = `
    <h1 class="page-title">Job requests</h1>
    <div class="panel">
      <table class="data-table">
        <thead><tr><th>Description</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div id="quote-panel"></div>
  `;

  const after = () => {
    document.querySelectorAll('[data-action="decline"]').forEach((btn) =>
      btn.addEventListener('click', () => runAction(btn, () => Api.declineJobRequest(state.tenantId, btn.dataset.id, {}))),
    );

    document.querySelectorAll('[data-action="quote"]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const panel = document.getElementById('quote-panel');
        panel.innerHTML = `
          <div class="panel">
            <h2>Quote job request</h2>
            <div id="quote-alert" class="alert error" role="alert" hidden></div>
            <form id="quote-form" novalidate>
              <div class="field"><label for="q-amount">Amount (minor units)</label><input id="q-amount" type="number" min="0" required /></div>
              <div class="field">
                <label for="q-currency">Currency</label>
                <select id="q-currency" class="tenant-select"><option>NGN</option><option>KES</option><option>GHS</option><option>ZAR</option></select>
              </div>
              <div class="field"><label for="q-start">Proposed start</label><input id="q-start" type="datetime-local" required /></div>
              <div class="field"><label for="q-end">Proposed end</label><input id="q-end" type="datetime-local" required /></div>
              <div class="field"><label for="q-valid">Valid until</label><input id="q-valid" type="datetime-local" required /></div>
              <button class="primary" type="submit">Send quote</button>
            </form>
          </div>`;
        document.getElementById('quote-form').addEventListener('submit', async (event) => {
          event.preventDefault();
          const alertBox = document.getElementById('quote-alert');
          alertBox.hidden = true;
          try {
            await Api.quoteJobRequest(state.tenantId, btn.dataset.id, {
              amountMinorUnits: Number(document.getElementById('q-amount').value),
              currencyCode: document.getElementById('q-currency').value,
              proposedStartsAt: new Date(document.getElementById('q-start').value).toISOString(),
              proposedEndsAt: new Date(document.getElementById('q-end').value).toISOString(),
              validUntil: new Date(document.getElementById('q-valid').value).toISOString(),
            });
            renderRoute();
          } catch (err) {
            alertBox.textContent = err.message;
            alertBox.hidden = false;
          }
        });
      }),
    );
  };

  return { title: 'Job requests', body, after };
};

// ---------------------------------------------------------------------
// Disputes (view + raise only — resolving is a platform/admin action,
// out of scope for a provider's own portal; see the admin back office).
// ---------------------------------------------------------------------
views.disputes = async () => {
  const disputes = await Api.listDisputes(state.tenantId);

  const rows = disputes.length
    ? disputes
        .map(
          (d) => `
      <tr>
        <td>${escapeHtml(d.reason)}</td>
        <td>${badge(d.status)}</td>
        <td>${escapeHtml(d.resolutionNotes ?? '—')}</td>
      </tr>`,
        )
        .join('')
    : '<tr class="empty-row"><td colspan="3">No disputes on this business.</td></tr>';

  const body = `
    <h1 class="page-title">Disputes</h1>
    <p style="color:var(--color-text-muted);font-size:0.85rem">
      Resolving a dispute is a platform-administrator action (separation of
      duties — see the design's phase-5 rules), not something this portal
      exposes. This view is read-only plus raising a new one from the
      Bookings tab.
    </p>
    <div class="panel">
      <table class="data-table">
        <thead><tr><th>Reason</th><th>Status</th><th>Notes</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
  return { title: 'Disputes', body };
};

// ---------------------------------------------------------------------
// Payouts
// ---------------------------------------------------------------------
views.payouts = async () => {
  const payouts = await Api.listPayouts(state.tenantId);

  const rows = payouts.length
    ? payouts
        .map(
          (p) => `
      <tr>
        <td>${formatMoney(p.amountMinorUnits, p.currencyCode)}</td>
        <td>${badge(p.status)}</td>
        <td>${escapeHtml(p.decisionNotes ?? '—')}</td>
      </tr>`,
        )
        .join('')
    : '<tr class="empty-row"><td colspan="3">No payout requests yet.</td></tr>';

  const body = `
    <h1 class="page-title">Payouts</h1>
    <p style="color:var(--color-text-muted);font-size:0.85rem">
      Requests are decided by a finance administrator, against this
      business's escrow balance (Phase 4/5 — a dormant ledger backed by
      a mock payment provider, not a real payout to a bank account or
      mobile-money wallet in this milestone).
    </p>
    <div class="panel">
      <table class="data-table">
        <thead><tr><th>Amount</th><th>Status</th><th>Notes</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="panel">
      <h2>Request a payout</h2>
      <div id="payout-alert" class="alert error" role="alert" hidden></div>
      <form id="payout-form" novalidate>
        <div class="field"><label for="p-amount">Amount (minor units)</label><input id="p-amount" type="number" min="1" required /></div>
        <div class="field">
          <label for="p-currency">Currency</label>
          <select id="p-currency" class="tenant-select"><option>NGN</option><option>KES</option><option>GHS</option><option>ZAR</option></select>
        </div>
        <button class="primary" type="submit">Request payout</button>
      </form>
    </div>
  `;

  const after = () => {
    const form = document.getElementById('payout-form');
    const alertBox = document.getElementById('payout-alert');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      alertBox.hidden = true;
      try {
        await Api.requestPayout(state.tenantId, {
          amountMinorUnits: Number(document.getElementById('p-amount').value),
          currencyCode: document.getElementById('p-currency').value,
        });
        renderRoute();
      } catch (err) {
        alertBox.textContent = err.message;
        alertBox.hidden = false;
      }
    });
  };

  return { title: 'Payouts', body, after };
};

// ---------------------------------------------------------------------
// Shell: routing, sidebar, tenant switcher.
// ---------------------------------------------------------------------

/** Runs a mutating action from a table row button, disabling it and showing an inline error without a full page reload's flash. */
async function runAction(button, action) {
  button.disabled = true;
  try {
    await action();
    renderRoute();
  } catch (err) {
    window.alert(err.message);
    button.disabled = false;
  }
}

function parseRoute() {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const match = hash.match(/^t\/([^/]+)(?:\/(.+))?$/);
  if (match) {
    return { tenantId: match[1], section: match[2] || 'overview' };
  }
  return { tenantId: null, section: 'tenants' };
}

function renderSidebar() {
  const sidebar = document.getElementById('sidebar');
  const nav = document.getElementById('sidebar-nav');
  const { tenantId, section } = parseRoute();

  if (!tenantId) {
    sidebar.hidden = true;
    document.body.classList.add('no-tenant');
    return;
  }

  document.body.classList.remove('no-tenant');
  sidebar.hidden = false;
  nav.innerHTML = NAV_ITEMS.map(
    (item) => `<a href="#/t/${tenantId}/${item.key}" class="${item.key === section ? 'active' : ''}">${item.label}</a>`,
  ).join('');
}

function renderTenantSwitcher() {
  const select = document.getElementById('tenant-select');
  if (state.tenants.length === 0) {
    select.hidden = true;
    return;
  }
  select.hidden = false;
  select.innerHTML = state.tenants.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  if (state.tenantId) select.value = state.tenantId;
  select.onchange = () => {
    window.location.hash = `#/t/${select.value}/overview`;
  };
}

async function reloadTenants() {
  state.tenants = await Api.myTenants();
  renderTenantSwitcher();
}

async function renderRoute() {
  const { tenantId, section } = parseRoute();
  state.tenantId = tenantId;
  renderSidebar();
  renderTenantSwitcher();

  const viewFn = tenantId ? views[section] : views.tenants;
  const container = document.getElementById('view');

  if (!viewFn) {
    container.innerHTML = `<p>Unknown page.</p>`;
    return;
  }

  try {
    const { body, after } = await viewFn();
    container.innerHTML = body;
    document.title = `Naa here — Provider portal`;
    if (after) after();
  } catch (err) {
    container.innerHTML = `<div class="alert error" role="alert">${escapeHtml(err.message)}</div>`;
  }
}

async function init() {
  if (!isSignedIn()) {
    window.location.href = 'login.html';
    return;
  }

  state.user = currentUser();
  document.getElementById('user-name').textContent = state.user?.fullName ?? '';

  document.getElementById('sign-out-btn').addEventListener('click', () => {
    clearSession();
    window.location.href = 'login.html';
  });

  try {
    await reloadTenants();
  } catch (err) {
    // A 401 here already redirected to login.html via api.js; anything
    // else, show it inline rather than leaving a blank shell.
    document.getElementById('view').innerHTML = `<div class="alert error" role="alert">${escapeHtml(err.message)}</div>`;
    return;
  }

  window.addEventListener('hashchange', renderRoute);
  await renderRoute();
}

init();
