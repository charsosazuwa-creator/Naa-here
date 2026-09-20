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
  // Client-side only: the backend has no GET for blocked time (only
  // POST), so this is the sole record of what's been added, and only
  // for this browser tab's session — it's not fetched from anywhere.
  blockedTimeAdded: [],
};

const NAV_ITEMS = [
  { key: 'overview', label: 'Overview' },
  { key: 'verification', label: 'Verification' },
  { key: 'locations', label: 'Locations' },
  { key: 'services', label: 'Services' },
  { key: 'availability', label: 'Availability' },
  { key: 'staff', label: 'Staff' },
  { key: 'customers', label: 'Customers' },
  { key: 'bookings', label: 'Bookings' },
  { key: 'job-requests', label: 'Job requests' },
  // Marketplace listings (User Story 2) aren't tenant-scoped — they're
  // owned by the signed-in user directly (see
  // db/migrations/012_marketplace_listings.sql) — but the tab lives
  // here since a Service Provider managing their business is exactly
  // who'd want to post a product/service/invention too.
  { key: 'listings', label: 'My Listings' },
  { key: 'groups', label: 'Groups' },
  { key: 'disputes', label: 'Disputes' },
  { key: 'payouts', label: 'Payouts' },
];

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

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
  // Business categories are an open, shared, growing list (see
  // BusinessCategoryService) rather than a fixed 3-option dropdown --
  // this datalist powers "pick an existing one or just type a new
  // one" on the category field below.
  const categories = await Api.listBusinessCategories().catch(() => []);

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
          <label for="ct-business-type">Business type</label>
          <select id="ct-business-type" class="tenant-select">
            <option value="provider">Service provider / business owner</option>
            <option value="artisan">Artisan / on-demand worker</option>
            <option value="host">Accommodation host</option>
          </select>
        </div>
        <div class="field">
          <label for="ct-category">Category</label>
          <input id="ct-category" list="ct-category-options" placeholder="e.g. Barber &amp; Salon" required />
          <datalist id="ct-category-options">
            ${categories.map((c) => `<option value="${escapeHtml(c.name)}"></option>`).join('')}
          </datalist>
          <p style="color:var(--color-text-muted);font-size:0.8rem;margin:4px 0 0">
            Pick an existing category or type a new one — it'll be added for everyone to use.
          </p>
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
          businessType: document.getElementById('ct-business-type').value,
          categoryName: document.getElementById('ct-category').value.trim(),
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
      <p><strong>Business type:</strong> ${escapeHtml(tenant.businessType)}</p>
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
// Locations
// ---------------------------------------------------------------------
views.locations = async () => {
  const locations = await Api.listLocations(state.tenantId);

  const rows = locations.length
    ? locations
        .map(
          (l) => `
      <tr>
        <td>${escapeHtml(l.label)}${l.isPrimary ? ' <span class="badge status-verified">Primary</span>' : ''}</td>
        <td>${escapeHtml(l.addressLine)}</td>
        <td>${escapeHtml(l.city)}</td>
        <td>${escapeHtml(l.countryCode)}</td>
      </tr>`,
        )
        .join('')
    : '<tr class="empty-row"><td colspan="4">No locations yet.</td></tr>';

  const body = `
    <h1 class="page-title">Locations</h1>
    <div class="panel">
      <table class="data-table">
        <thead><tr><th>Label</th><th>Address</th><th>City</th><th>Country</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="panel">
      <h2>Add a location</h2>
      <div id="location-alert" class="alert error" role="alert" hidden></div>
      <form id="create-location-form" novalidate>
        <div class="field"><label for="l-label">Label</label><input id="l-label" placeholder="e.g. Main branch" required /></div>
        <div class="field"><label for="l-address">Address</label><input id="l-address" required /></div>
        <div class="field"><label for="l-city">City</label><input id="l-city" required /></div>
        <div class="field">
          <label for="l-country">Country</label>
          <select id="l-country" class="tenant-select">
            <option value="NG">Nigeria</option>
            <option value="KE">Kenya</option>
            <option value="GH">Ghana</option>
            <option value="ZA">South Africa</option>
          </select>
        </div>
        <div class="field"><label for="l-lat">Latitude (optional)</label><input id="l-lat" type="number" step="any" /></div>
        <div class="field"><label for="l-lng">Longitude (optional)</label><input id="l-lng" type="number" step="any" /></div>
        <div class="field">
          <label for="l-primary"><input id="l-primary" type="checkbox" style="width:auto;margin-right:6px" />Set as primary location</label>
        </div>
        <button class="primary" type="submit">Add location</button>
      </form>
    </div>
  `;

  const after = () => {
    const form = document.getElementById('create-location-form');
    const alertBox = document.getElementById('location-alert');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      alertBox.hidden = true;
      try {
        const lat = document.getElementById('l-lat').value;
        const lng = document.getElementById('l-lng').value;
        await Api.createLocation(state.tenantId, {
          label: document.getElementById('l-label').value.trim(),
          addressLine: document.getElementById('l-address').value.trim(),
          city: document.getElementById('l-city').value.trim(),
          countryCode: document.getElementById('l-country').value,
          latitude: lat === '' ? undefined : Number(lat),
          longitude: lng === '' ? undefined : Number(lng),
          isPrimary: document.getElementById('l-primary').checked,
        });
        renderRoute();
      } catch (err) {
        alertBox.textContent = err.message;
        alertBox.hidden = false;
      }
    });
  };

  return { title: 'Locations', body, after };
};

// ---------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------
views.staff = async () => {
  const staff = await Api.listStaff(state.tenantId);

  const rows = staff.length
    ? staff
        .map(
          (s) => `
      <tr>
        <td>${escapeHtml(s.fullName)}</td>
        <td>${escapeHtml(s.email ?? '—')}</td>
        <td>${escapeHtml(s.roleCode)}</td>
        <td>${badge(s.status)}</td>
      </tr>`,
        )
        .join('')
    : '<tr class="empty-row"><td colspan="4">No staff yet — just the owner.</td></tr>';

  const body = `
    <h1 class="page-title">Staff</h1>
    <div class="panel">
      <table class="data-table">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="panel">
      <h2>Invite staff</h2>
      <p style="color:var(--color-text-muted);font-size:0.85rem;margin-top:-8px">
        Only someone who already has a Naa here account can be invited — they need to sign up first,
        then accept the invitation from their own account.
      </p>
      <div id="staff-alert" class="alert error" role="alert" hidden></div>
      <form id="invite-staff-form" novalidate>
        <div class="field"><label for="st-email">Email</label><input id="st-email" type="email" required /></div>
        <button class="primary" type="submit">Send invite</button>
      </form>
    </div>
  `;

  const after = () => {
    const form = document.getElementById('invite-staff-form');
    const alertBox = document.getElementById('staff-alert');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      alertBox.hidden = true;
      try {
        await Api.inviteStaff(state.tenantId, {
          email: document.getElementById('st-email').value.trim(),
          roleCode: 'staff',
        });
        renderRoute();
      } catch (err) {
        alertBox.textContent = err.message;
        alertBox.hidden = false;
      }
    });
  };

  return { title: 'Staff', body, after };
};

// ---------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------
views.services = async () => {
  const [services, locations, serviceCategories] = await Promise.all([
    Api.listServices(state.tenantId),
    Api.listLocations(state.tenantId),
    Api.listServiceCategories().catch(() => []),
  ]);

  const rows = services.length
    ? services
        .map(
          (s) => `
      <tr>
        <td>${escapeHtml(s.name)}</td>
        <td>${escapeHtml(s.categoryName)}</td>
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
    : '<tr class="empty-row"><td colspan="5">No services yet.</td></tr>';

  const body = `
    <h1 class="page-title">Services</h1>
    <div class="panel">
      <table class="data-table">
        <thead><tr><th>Name</th><th>Category</th><th>Price</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="panel">
      <h2>Add a service</h2>
      <div id="service-alert" class="alert error" role="alert" hidden></div>
      <form id="create-service-form" novalidate>
        <div class="field"><label for="s-name">Name</label><input id="s-name" required /></div>
        <div class="field">
          <label for="s-category">Category</label>
          <input id="s-category" list="s-category-options" placeholder="e.g. Barber and salon appointments" required />
          <datalist id="s-category-options">
            ${serviceCategories.map((c) => `<option value="${escapeHtml(c.name)}"></option>`).join('')}
          </datalist>
          <p style="color:var(--color-text-muted);font-size:0.8rem;margin:4px 0 0">
            Pick an existing category or type a new one — it'll be added for everyone to use.
          </p>
        </div>
        <div class="field">
          <label for="s-location">Location</label>
          <select id="s-location" class="tenant-select">
            <option value="">No specific location</option>
            ${locations.map((l) => `<option value="${l.id}">${escapeHtml(l.label)}</option>`).join('')}
          </select>
        </div>
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
        const locationId = document.getElementById('s-location').value;
        await Api.createService(state.tenantId, {
          name: document.getElementById('s-name').value.trim(),
          categoryName: document.getElementById('s-category').value.trim(),
          locationId: locationId || undefined,
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
// Availability
// ---------------------------------------------------------------------
views.availability = async () => {
  const [rules, services] = await Promise.all([Api.listAvailabilityRules(state.tenantId), Api.listServices(state.tenantId)]);
  const blocked = state.tenantId === currentBlockedTenantId ? state.blockedTimeAdded : [];

  const serviceOptions = (selectedId) => `
    <option value="">All services</option>
    ${services.map((s) => `<option value="${s.id}" ${s.id === selectedId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
  `;

  const ruleRows = rules.length
    ? rules
        .map(
          (r) => `
      <tr>
        <td>${DAYS_OF_WEEK[r.dayOfWeek]}</td>
        <td>${escapeHtml(r.startTime)}</td>
        <td>${escapeHtml(r.endTime)}</td>
        <td>${r.serviceId ? escapeHtml(services.find((s) => s.id === r.serviceId)?.name ?? r.serviceId) : 'All services'}</td>
      </tr>`,
        )
        .join('')
    : '<tr class="empty-row"><td colspan="4">No weekly hours set yet.</td></tr>';

  const blockedRows = blocked.length
    ? blocked
        .map(
          (b) => `
      <tr>
        <td>${formatDate(b.startsAt)}</td>
        <td>${formatDate(b.endsAt)}</td>
        <td>${escapeHtml(b.reason ?? '—')}</td>
      </tr>`,
        )
        .join('')
    : '<tr class="empty-row"><td colspan="3">None added this session.</td></tr>';

  const body = `
    <h1 class="page-title">Availability</h1>

    <div class="panel">
      <h2>Weekly working hours</h2>
      <table class="data-table">
        <thead><tr><th>Day</th><th>Start</th><th>End</th><th>Applies to</th></tr></thead>
        <tbody>${ruleRows}</tbody>
      </table>
    </div>
    <div class="panel">
      <h2>Add a weekly rule</h2>
      <div id="rule-alert" class="alert error" role="alert" hidden></div>
      <form id="create-rule-form" novalidate class="inline-form">
        <div class="field">
          <label for="r-day">Day</label>
          <select id="r-day" class="tenant-select">
            ${DAYS_OF_WEEK.map((d, i) => `<option value="${i}">${d}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label for="r-start">Start (HH:mm)</label><input id="r-start" type="time" value="09:00" required /></div>
        <div class="field"><label for="r-end">End (HH:mm)</label><input id="r-end" type="time" value="17:00" required /></div>
        <div class="field">
          <label for="r-service">Service</label>
          <select id="r-service" class="tenant-select">${serviceOptions()}</select>
        </div>
        <button class="primary" type="submit">Add rule</button>
      </form>
    </div>

    <div class="panel">
      <h2>Blocked time</h2>
      <p style="color:var(--color-text-muted);font-size:0.85rem;margin-top:-8px">
        One-off closures (holidays, days off). The list below only shows what you've added in this
        browser tab this session — there's no way yet to fetch previously-added blocked time back
        from the server.
      </p>
      <table class="data-table">
        <thead><tr><th>Starts</th><th>Ends</th><th>Reason</th></tr></thead>
        <tbody>${blockedRows}</tbody>
      </table>
    </div>
    <div class="panel">
      <h2>Add blocked time</h2>
      <div id="blocked-alert" class="alert error" role="alert" hidden></div>
      <form id="create-blocked-form" novalidate class="inline-form">
        <div class="field"><label for="b-start">Starts</label><input id="b-start" type="datetime-local" required /></div>
        <div class="field"><label for="b-end">Ends</label><input id="b-end" type="datetime-local" required /></div>
        <div class="field">
          <label for="b-service">Service</label>
          <select id="b-service" class="tenant-select">${serviceOptions()}</select>
        </div>
        <div class="field"><label for="b-reason">Reason (optional)</label><input id="b-reason" placeholder="e.g. Public holiday" /></div>
        <button class="primary" type="submit">Add blocked time</button>
      </form>
    </div>
  `;

  const after = () => {
    const ruleForm = document.getElementById('create-rule-form');
    const ruleAlert = document.getElementById('rule-alert');
    ruleForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      ruleAlert.hidden = true;
      try {
        const serviceId = document.getElementById('r-service').value;
        await Api.addAvailabilityRule(state.tenantId, {
          dayOfWeek: Number(document.getElementById('r-day').value),
          startTime: document.getElementById('r-start').value,
          endTime: document.getElementById('r-end').value,
          serviceId: serviceId || undefined,
        });
        renderRoute();
      } catch (err) {
        ruleAlert.textContent = err.message;
        ruleAlert.hidden = false;
      }
    });

    const blockedForm = document.getElementById('create-blocked-form');
    const blockedAlert = document.getElementById('blocked-alert');
    blockedForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      blockedAlert.hidden = true;
      try {
        const serviceId = document.getElementById('b-service').value;
        const startsAt = new Date(document.getElementById('b-start').value).toISOString();
        const endsAt = new Date(document.getElementById('b-end').value).toISOString();
        const reason = document.getElementById('b-reason').value.trim() || undefined;
        const created = await Api.addBlockedTime(state.tenantId, { startsAt, endsAt, reason, serviceId: serviceId || undefined });
        if (currentBlockedTenantId !== state.tenantId) {
          state.blockedTimeAdded = [];
          currentBlockedTenantId = state.tenantId;
        }
        state.blockedTimeAdded.push(created);
        renderRoute();
      } catch (err) {
        blockedAlert.textContent = err.message;
        blockedAlert.hidden = false;
      }
    });
  };

  return { title: 'Availability', body, after };
};
let currentBlockedTenantId = null;

// ---------------------------------------------------------------------
// Customers (CRM): the backend (crm.controller.ts / crm.service.ts —
// customer_profile, customer_note, customer_task) has always fully
// existed; this view was simply never built, so a provider had no way
// to see, note, or task-track a single customer even though the API
// behind it already worked end-to-end.
// ---------------------------------------------------------------------
views.customers = async () => {
  const [customers, tasks, invitations] = await Promise.all([
    Api.listCustomers(state.tenantId),
    Api.listTasks(state.tenantId),
    Api.listCustomerInvitations(state.tenantId),
  ]);

  const customerNameById = new Map(customers.map((c) => [c.id, c.fullName]));

  const customerRows = customers.length
    ? customers
        .map(
          (c) => `
      <tr>
        <td>${escapeHtml(c.fullName)}</td>
        <td>${escapeHtml(c.phone ?? '—')}</td>
        <td>${escapeHtml(c.email ?? '—')}</td>
        <td>
          <div class="actions-row">
            <button class="small" data-action="notes" data-id="${c.id}" data-name="${escapeHtml(c.fullName)}">Notes</button>
          </div>
        </td>
      </tr>`,
        )
        .join('')
    : '<tr class="empty-row"><td colspan="4">No customers yet.</td></tr>';

  const taskRows = tasks.length
    ? tasks
        .map(
          (t) => `
      <tr>
        <td>${escapeHtml(t.title)}</td>
        <td>${t.customerId ? escapeHtml(customerNameById.get(t.customerId) ?? 'Unknown') : '—'}</td>
        <td>${formatDate(t.dueAt)}</td>
        <td>${badge(t.status)}</td>
        <td>
          <div class="actions-row">
            ${
              t.status === 'open'
                ? `<button class="small primary" data-action="task-done" data-id="${t.id}">Mark done</button>
                   <button class="small danger" data-action="task-cancel" data-id="${t.id}">Cancel</button>`
                : '—'
            }
          </div>
        </td>
      </tr>`,
        )
        .join('')
    : '<tr class="empty-row"><td colspan="5">No tasks yet.</td></tr>';

  const customerOptions = customers.map((c) => `<option value="${c.id}">${escapeHtml(c.fullName)}</option>`).join('');

  const invitationRows = invitations.length
    ? invitations
        .map(
          (inv) => `
      <tr>
        <td>${escapeHtml(inv.invitedEmail)}</td>
        <td>${badge(inv.status)}</td>
        <td>${formatDate(inv.expiresAt)}</td>
        <td>
          <div class="actions-row">
            ${
              inv.status === 'pending'
                ? `<button class="small" data-action="invite-resend" data-id="${inv.id}">Resend</button>
                   <button class="small danger" data-action="invite-cancel" data-id="${inv.id}">Cancel</button>`
                : '—'
            }
          </div>
        </td>
      </tr>`,
        )
        .join('')
    : '<tr class="empty-row"><td colspan="4">No customer invitations yet.</td></tr>';

  const body = `
    <h1 class="page-title">Customers</h1>

    <div class="panel">
      <h2>Add a customer</h2>
      <div id="customer-alert" class="alert error" role="alert" hidden></div>
      <form id="customer-form" novalidate class="inline-form">
        <div class="field"><label for="c-name">Full name</label><input id="c-name" required /></div>
        <div class="field"><label for="c-phone">Phone</label><input id="c-phone" /></div>
        <div class="field"><label for="c-email">Email</label><input id="c-email" type="email" /></div>
        <button class="primary" type="submit">Add customer</button>
      </form>
    </div>

    <div class="panel">
      <table class="data-table">
        <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th></th></tr></thead>
        <tbody>${customerRows}</tbody>
      </table>
    </div>

    <div id="notes-panel"></div>

    <div class="panel">
      <h2>Invite a customer</h2>
      <p style="color:var(--color-text-muted);font-size:0.85rem;margin-top:-8px">
        Works whether or not they already have a Naa here account — they'll get an email either way, with the
        right next step (sign in, or create an account first).
      </p>
      <div id="customer-invite-alert" class="alert error" role="alert" hidden></div>
      <form id="invite-customer-form" novalidate class="inline-form">
        <div class="field"><label for="ci-email">Email</label><input id="ci-email" type="email" required /></div>
        <button class="primary" type="submit">Send invitation</button>
      </form>
      <table class="data-table">
        <thead><tr><th>Email</th><th>Status</th><th>Expires</th><th></th></tr></thead>
        <tbody>${invitationRows}</tbody>
      </table>
    </div>

    <div class="panel">
      <h2>Tasks</h2>
      <div id="task-alert" class="alert error" role="alert" hidden></div>
      <form id="task-form" novalidate class="inline-form">
        <div class="field"><label for="t-title">Title</label><input id="t-title" required /></div>
        <div class="field">
          <label for="t-customer">Customer (optional)</label>
          <select id="t-customer" class="tenant-select"><option value="">—</option>${customerOptions}</select>
        </div>
        <div class="field"><label for="t-due">Due</label><input id="t-due" type="datetime-local" /></div>
        <button class="primary" type="submit">Add task</button>
      </form>
      <table class="data-table">
        <thead><tr><th>Title</th><th>Customer</th><th>Due</th><th>Status</th><th></th></tr></thead>
        <tbody>${taskRows}</tbody>
      </table>
    </div>
  `;

  const after = () => {
    document.getElementById('customer-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const alertBox = document.getElementById('customer-alert');
      alertBox.hidden = true;
      try {
        await Api.createCustomer(state.tenantId, {
          fullName: document.getElementById('c-name').value.trim(),
          phone: document.getElementById('c-phone').value.trim() || undefined,
          email: document.getElementById('c-email').value.trim() || undefined,
        });
        renderRoute();
      } catch (err) {
        alertBox.textContent = err.message;
        alertBox.hidden = false;
      }
    });

    document.querySelectorAll('[data-action="notes"]').forEach((btn) =>
      btn.addEventListener('click', () => showCustomerNotes(btn.dataset.id, btn.dataset.name)),
    );

    document.querySelectorAll('[data-action="task-done"]').forEach((btn) =>
      btn.addEventListener('click', () => runAction(btn, () => Api.setTaskStatus(state.tenantId, btn.dataset.id, 'done'))),
    );
    document.querySelectorAll('[data-action="task-cancel"]').forEach((btn) =>
      btn.addEventListener('click', () => runAction(btn, () => Api.setTaskStatus(state.tenantId, btn.dataset.id, 'cancelled'))),
    );

    document.getElementById('task-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const alertBox = document.getElementById('task-alert');
      alertBox.hidden = true;
      const dueVal = document.getElementById('t-due').value;
      try {
        await Api.createTask(state.tenantId, {
          title: document.getElementById('t-title').value.trim(),
          customerId: document.getElementById('t-customer').value || undefined,
          dueAt: dueVal ? new Date(dueVal).toISOString() : undefined,
        });
        renderRoute();
      } catch (err) {
        alertBox.textContent = err.message;
        alertBox.hidden = false;
      }
    });

    document.getElementById('invite-customer-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const alertBox = document.getElementById('customer-invite-alert');
      alertBox.hidden = true;
      const emailInput = document.getElementById('ci-email');
      const submitBtn = event.target.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      try {
        await Api.inviteCustomer(state.tenantId, { email: emailInput.value.trim() });
        renderRoute();
      } catch (err) {
        alertBox.textContent = err.message;
        alertBox.hidden = false;
        submitBtn.disabled = false;
      }
    });

    document.querySelectorAll('[data-action="invite-resend"]').forEach((btn) =>
      btn.addEventListener('click', () => runAction(btn, () => Api.resendCustomerInvitation(state.tenantId, btn.dataset.id))),
    );
    document.querySelectorAll('[data-action="invite-cancel"]').forEach((btn) =>
      btn.addEventListener('click', () => {
        if (!window.confirm('Cancel this invitation?')) return;
        runAction(btn, () => Api.cancelCustomerInvitation(state.tenantId, btn.dataset.id));
      }),
    );
  };

  return { title: 'Customers', body, after };
};

/** Notes are staff-only (never a customer-facing route) — shown in an inline panel under the customer table, one customer at a time. */
async function showCustomerNotes(customerId, customerName) {
  const panel = document.getElementById('notes-panel');
  panel.innerHTML = `<p style="color:var(--color-text-muted);font-size:0.85rem">Loading notes…</p>`;
  try {
    const notes = await Api.listNotes(state.tenantId, customerId);
    const items = notes.length
      ? notes.map((n) => `<li><strong>${formatDate(n.createdAt)}</strong> — ${escapeHtml(n.body)}</li>`).join('')
      : '<li style="color:var(--color-text-muted);font-style:italic">No notes yet.</li>';
    panel.innerHTML = `
      <div class="panel">
        <h2>Notes — ${escapeHtml(customerName)}</h2>
        <div id="note-alert" class="alert error" role="alert" hidden></div>
        <ul>${items}</ul>
        <form id="note-form" novalidate class="inline-form">
          <div class="field" style="flex:1;min-width:240px"><label for="note-body">Add a note</label><input id="note-body" required /></div>
          <button class="primary" type="submit">Add note</button>
        </form>
      </div>`;
    document.getElementById('note-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const alertBox = document.getElementById('note-alert');
      alertBox.hidden = true;
      try {
        await Api.addNote(state.tenantId, customerId, { body: document.getElementById('note-body').value.trim() });
        showCustomerNotes(customerId, customerName);
      } catch (err) {
        alertBox.textContent = err.message;
        alertBox.hidden = false;
      }
    });
  } catch (err) {
    panel.innerHTML = `<div class="alert error" role="alert">${escapeHtml(err.message)}</div>`;
  }
}


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
    <div id="dispute-panel"></div>
  `;

  const after = () => {
    document.querySelectorAll('[data-action="transition"]').forEach((btn) =>
      btn.addEventListener('click', () =>
        runAction(btn, () => Api.transitionBooking(state.tenantId, btn.dataset.id, { status: btn.dataset.status })),
      ),
    );
    // US-056: a proper reason/details/attachment form, replacing the
    // original window.prompt()-based quick raise.
    document.querySelectorAll('[data-action="dispute"]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const bookingId = btn.dataset.id;
        const panel = document.getElementById('dispute-panel');
        panel.innerHTML = `<div class="panel"><h2>Raise a dispute</h2>${DisputeUI.disputeFormHtml()}</div>`;
        DisputeUI.wireDisputeForm(panel, Api, state.tenantId, bookingId, (dispute) => {
          panel.innerHTML = `
            <div class="panel">
              <p>Case <strong>${DisputeUI.escapeHtml(dispute.caseNumber)}</strong> raised — see the
              <a href="#/t/${state.tenantId}/disputes">Disputes</a> tab for status.</p>
            </div>`;
        });
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
        <td><code>${escapeHtml(d.caseNumber)}</code></td>
        <td>${DisputeUI.reasonLabel(d.reason)}</td>
        <td>${badge(d.status)}</td>
        <td>${DisputeUI.formatDateTime(d.createdAt)}</td>
        <td><button class="small" data-action="expand" data-id="${d.id}">Details</button></td>
      </tr>
      <tr class="submission-detail" data-detail-for="${d.id}" hidden>
        <td colspan="5">
          ${DisputeUI.disputeDetailHtml(
            d,
            d.status === 'open'
              ? `
            <div class="field"><label>Add supporting evidence</label><input class="add-evidence-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" /></div>
            <button class="small" data-action="add-evidence" data-id="${d.id}">Upload</button>`
              : '',
          )}
        </td>
      </tr>`,
        )
        .join('')
    : '<tr class="empty-row"><td colspan="5">No disputes on this business.</td></tr>';

  const body = `
    <h1 class="page-title">Disputes</h1>
    <p style="color:var(--color-text-muted);font-size:0.85rem">
      Resolving a dispute is a platform-administrator action (separation of
      duties — see the design's phase-5 rules), not something this portal
      exposes. This view is read-only, plus raising a new one from the
      Bookings tab and adding evidence to one that's still open.
    </p>
    <div class="panel">
      <table class="data-table">
        <thead><tr><th>Case</th><th>Reason</th><th>Status</th><th>Raised</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  const after = () => {
    document.querySelectorAll('[data-action="expand"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const detail = document.querySelector(`[data-detail-for="${btn.dataset.id}"]`);
        detail.hidden = !detail.hidden;
      });
    });
    document.querySelectorAll('[data-action="add-evidence"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const detail = document.querySelector(`[data-detail-for="${btn.dataset.id}"]`);
        const file = detail.querySelector('.add-evidence-file').files[0];
        if (!file) return;
        btn.disabled = true;
        try {
          await Api.uploadDisputeAttachment(state.tenantId, btn.dataset.id, file);
          renderRoute();
        } catch (err) {
          window.alert(err.message);
          btn.disabled = false;
        }
      });
    });
  };

  return { title: 'Disputes', body, after };
};

// ---------------------------------------------------------------------
// My Listings (User Story 2) — shared with the customer portal, see
// web/shared/listing-ui.js.
// ---------------------------------------------------------------------
views.listings = async () => ListingUI.renderMyListings(Api, runAction);

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
// Community groups (User Story 5): open to verified Service Providers
// / Business Owners. Not tenant-scoped (see group.service.ts's header
// comment) but shown as a tab within the tenant shell, same as "My
// Listings" -- the tenant is just where you're browsing from, not
// what owns the group.
// ---------------------------------------------------------------------

function renderGroupRows(groups) {
  return groups.length
    ? groups
        .map(
          (g) => `
      <tr>
        <td><a href="#/t/${state.tenantId}/groups/${g.id}">${escapeHtml(g.name)}</a></td>
        <td>${escapeHtml(g.industryCategory ?? '—')}</td>
        <td>${escapeHtml(g.locationText ?? '—')}</td>
        <td>${badge(g.visibility)} ${badge(g.membershipType)}</td>
        <td>${g.memberCount}</td>
        <td>${g.myStatus ? badge(g.myStatus) : '—'}</td>
      </tr>`,
        )
        .join('')
    : '<tr class="empty-row"><td colspan="6">No groups match yet — be the first to create one.</td></tr>';
}

async function renderGroupList() {
  const [groups, invitations] = await Promise.all([Api.discoverGroups(''), Api.myGroupInvitations().catch(() => [])]);

  const invitationRows = invitations.length
    ? invitations
        .map(
          (inv) => `
      <tr>
        <td>${escapeHtml(inv.groupName)}</td>
        <td>
          <div class="actions-row">
            <button class="small primary" data-action="group-invite-accept" data-group="${inv.groupId}">Accept</button>
            <button class="small danger" data-action="group-invite-decline" data-group="${inv.groupId}">Decline</button>
          </div>
        </td>
      </tr>`,
        )
        .join('')
    : '';

  const body = `
    <h1 class="page-title">Community Groups</h1>
    <p style="color:var(--color-text-muted);font-size:0.85rem">
      Open to verified Service Providers and Business Owners — connect with other businesses, share knowledge,
      and post about your services, products, and opportunities.
    </p>

    ${
      invitations.length
        ? `
    <div class="panel">
      <h2>Your invitations</h2>
      <table class="data-table"><tbody>${invitationRows}</tbody></table>
    </div>`
        : ''
    }

    <div class="panel">
      <h2>Create a group</h2>
      <div id="group-create-alert" class="alert error" role="alert" hidden></div>
      <form id="group-create-form" novalidate class="inline-form">
        <div class="field"><label for="g-name">Name</label><input id="g-name" required /></div>
        <div class="field"><label for="g-category">Industry / category</label><input id="g-category" /></div>
        <div class="field"><label for="g-location">Location / service area</label><input id="g-location" /></div>
        <div class="field">
          <label for="g-visibility">Visibility</label>
          <select id="g-visibility"><option value="public">Public</option><option value="private">Private</option><option value="hidden">Hidden</option></select>
        </div>
        <div class="field">
          <label for="g-membership-type">Joining</label>
          <select id="g-membership-type"><option value="open">Open</option><option value="request">Request to join</option><option value="invite_only">Invite only</option></select>
        </div>
        <div class="field" style="flex:1;min-width:240px"><label for="g-description">Description</label><input id="g-description" /></div>
        <button class="primary" type="submit">Create group</button>
      </form>
    </div>

    <div class="panel">
      <h2>Discover groups</h2>
      <form id="group-search-form" class="inline-form" novalidate>
        <div class="field"><label for="g-q">Search</label><input id="g-q" placeholder="Name or description" /></div>
        <div class="field"><label for="g-search-category">Category</label><input id="g-search-category" /></div>
        <div class="field"><label for="g-search-location">Location</label><input id="g-search-location" /></div>
        <button class="btn-plain" type="submit">Search</button>
      </form>
      <table class="data-table">
        <thead><tr><th>Name</th><th>Category</th><th>Location</th><th>Type</th><th>Members</th><th>You</th></tr></thead>
        <tbody id="group-rows">${renderGroupRows(groups)}</tbody>
      </table>
    </div>
  `;

  const after = () => {
    document.getElementById('group-create-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const alertBox = document.getElementById('group-create-alert');
      alertBox.hidden = true;
      try {
        const group = await Api.createGroup({
          name: document.getElementById('g-name').value.trim(),
          industryCategory: document.getElementById('g-category').value.trim() || undefined,
          locationText: document.getElementById('g-location').value.trim() || undefined,
          visibility: document.getElementById('g-visibility').value,
          membershipType: document.getElementById('g-membership-type').value,
          description: document.getElementById('g-description').value.trim() || undefined,
        });
        window.location.hash = `#/t/${state.tenantId}/groups/${group.id}`;
      } catch (err) {
        alertBox.textContent = err.message;
        alertBox.hidden = false;
      }
    });

    document.getElementById('group-search-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const params = new URLSearchParams();
      const q = document.getElementById('g-q').value.trim();
      const category = document.getElementById('g-search-category').value.trim();
      const location = document.getElementById('g-search-location').value.trim();
      if (q) params.set('q', q);
      if (category) params.set('category', category);
      if (location) params.set('location', location);
      try {
        const filtered = await Api.discoverGroups(params.toString());
        document.getElementById('group-rows').innerHTML = renderGroupRows(filtered);
      } catch (err) {
        window.alert(err.message);
      }
    });

    document.querySelectorAll('[data-action="group-invite-accept"]').forEach((btn) =>
      btn.addEventListener('click', () => runAction(btn, () => Api.acceptGroupInvitation(btn.dataset.group))),
    );
    document.querySelectorAll('[data-action="group-invite-decline"]').forEach((btn) =>
      btn.addEventListener('click', () => runAction(btn, () => Api.declineGroupInvitation(btn.dataset.group))),
    );
  };

  return { title: 'Community Groups', body, after };
}

function renderPostCard(p, canModerate) {
  const attachmentsHtml = p.attachments.length
    ? `<div class="post-attachments" style="margin:8px 0">${p.attachments
        .map((a) =>
          a.kind === 'image'
            ? `<img src="${a.url}" alt="" style="max-width:220px;max-height:220px;margin:0 6px 6px 0;border-radius:6px" />`
            : `<a href="${a.url}" target="_blank" rel="noopener" style="display:inline-block;margin-right:10px">${escapeHtml(a.kind)} attachment</a>`,
        )
        .join('')}</div>`
    : '';

  return `
    <div class="panel post-card" data-post-id="${p.id}" style="margin-bottom:12px">
      <p style="font-size:0.78rem;color:var(--color-text-muted);margin:0 0 6px">
        <strong>${escapeHtml(p.authorName)}</strong> · ${badge(p.topic)} · ${formatDate(p.createdAt)}
      </p>
      ${p.ipAckRequired ? '<p class="alert" style="background:rgba(217,119,6,0.1);color:#92400e;font-size:0.78rem;padding:6px 10px;border-radius:6px">IP disclosure acknowledged by the author for this post.</p>' : ''}
      <p style="white-space:pre-wrap">${escapeHtml(p.body)}</p>
      ${attachmentsHtml}
      <div class="actions-row">
        <button class="small ${p.myReaction ? 'primary' : ''}" data-action="post-react" data-post="${p.id}" data-reacted="${p.myReaction}">${p.myReaction ? 'Liked' : 'Like'} (${p.reactionCount})</button>
        <button class="small" data-action="post-comments-toggle" data-post="${p.id}">Comments (${p.commentCount})</button>
        <button class="small" data-action="post-share" data-post="${p.id}">Share (${p.shareCount})</button>
        <button class="small" data-action="post-report" data-post="${p.id}">Report</button>
        ${p.authorUserId === state.user?.id ? `<button class="small danger" data-action="post-delete" data-post="${p.id}">Delete</button>` : ''}
      </div>
      <div class="post-comments" data-post-comments="${p.id}" hidden></div>
    </div>`;
}

async function toggleGroupPostComments(groupId, postId) {
  const panel = document.querySelector(`[data-post-comments="${postId}"]`);
  if (!panel.hidden) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  panel.innerHTML = '<p style="font-size:0.8rem;color:var(--color-text-muted)">Loading…</p>';
  try {
    const comments = await Api.listGroupPostComments(groupId, postId);
    const list = comments.length
      ? comments
          .map(
            (c) => `
        <li style="margin-bottom:6px">
          <strong>${escapeHtml(c.authorName)}</strong> ${formatDate(c.createdAt)}<br/>
          ${escapeHtml(c.body)}
          ${c.authorUserId === state.user?.id ? ` <button class="small danger" data-action="comment-delete" data-post="${postId}" data-comment="${c.id}">Delete</button>` : ''}
        </li>`,
          )
          .join('')
      : '<li style="color:var(--color-text-muted);font-style:italic">No comments yet.</li>';

    panel.innerHTML = `
      <ul style="list-style:none;padding:0;margin:8px 0">${list}</ul>
      <form class="inline-form" data-comment-form="${postId}" novalidate>
        <div class="field" style="flex:1"><input placeholder="Write a comment…" required /></div>
        <button class="small primary" type="submit">Reply</button>
      </form>`;

    panel.querySelector(`[data-comment-form="${postId}"]`).addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = event.target.querySelector('input');
      try {
        await Api.addGroupPostComment(groupId, postId, { body: input.value.trim() });
        panel.hidden = true;
        await toggleGroupPostComments(groupId, postId);
        renderRoute();
      } catch (err) {
        window.alert(err.message);
      }
    });

    panel.querySelectorAll('[data-action="comment-delete"]').forEach((btn) =>
      btn.addEventListener('click', () =>
        runAction(btn, () => Api.deleteGroupPostComment(groupId, btn.dataset.post, btn.dataset.comment)),
      ),
    );
  } catch (err) {
    panel.innerHTML = `<div class="alert error" role="alert">${escapeHtml(err.message)}</div>`;
  }
}

async function renderGroupDetail(groupId) {
  let group;
  try {
    group = await Api.getGroup(groupId);
  } catch (err) {
    return { title: 'Group', body: `<div class="alert error" role="alert">${escapeHtml(err.message)}</div>` };
  }

  const isMember = group.myStatus === 'active';
  const isOwner = group.myRole === 'owner';
  const canManage = isMember && (group.myRole === 'owner' || group.myRole === 'administrator');
  const canModerate = isMember && ['owner', 'administrator', 'moderator'].includes(group.myRole);

  let posts = [];
  let members = [];
  let joinRequests = [];
  let reports = [];
  if (isMember) {
    [posts, members] = await Promise.all([Api.listGroupPosts(groupId), Api.listGroupMembers(groupId)]);
    if (canManage) joinRequests = await Api.listGroupJoinRequests(groupId).catch(() => []);
    if (canModerate) reports = await Api.listGroupReports(groupId).catch(() => []);
  }

  const membershipNote = !group.myStatus
    ? group.membershipType === 'invite_only'
      ? '<p style="color:var(--color-text-muted)">This group is invite-only.</p>'
      : `<button class="primary" id="group-join-btn">${group.membershipType === 'request' ? 'Request to join' : 'Join group'}</button>`
    : group.myStatus === 'pending'
      ? '<p style="color:var(--color-text-muted)">Your request to join is awaiting approval.</p>'
      : group.myStatus === 'invited'
        ? `
        <div class="actions-row">
          <button class="primary" id="group-invite-accept-btn">Accept invitation</button>
          <button class="btn-plain" id="group-invite-decline-btn">Decline</button>
        </div>`
        : group.myStatus === 'suspended' || group.myStatus === 'muted'
          ? `<p style="color:var(--color-text-muted)">Your membership is currently ${escapeHtml(group.myStatus)}${group.myStatus === 'muted' ? ' — you can view the group but not post.' : '.'}</p>`
          : ['removed', 'declined', 'left'].includes(group.myStatus)
            ? `<p style="color:var(--color-text-muted)">You are not currently a member (${escapeHtml(group.myStatus)}).</p>`
            : '';

  const memberRows = members
    .map(
      (m) => `
    <tr>
      <td>${escapeHtml(m.fullName)}</td>
      <td>${badge(m.role)}</td>
      <td>${badge(m.status)}</td>
      <td>
        ${
          isOwner && m.role !== 'owner'
            ? `<select class="tenant-select" data-action="member-role-select" data-member="${m.membershipId}" style="font-size:0.8rem">
                 <option value="member" ${m.role === 'member' ? 'selected' : ''}>Member</option>
                 <option value="moderator" ${m.role === 'moderator' ? 'selected' : ''}>Moderator</option>
                 <option value="administrator" ${m.role === 'administrator' ? 'selected' : ''}>Administrator</option>
               </select>`
            : ''
        }
        ${
          canModerate && m.role !== 'owner' && m.userId !== state.user?.id
            ? `<div class="actions-row" style="margin-top:4px">
                 <button class="small" data-action="member-moderate" data-member="${m.membershipId}" data-mod-action="warn">Warn</button>
                 <button class="small" data-action="member-moderate" data-member="${m.membershipId}" data-mod-action="mute">Mute</button>
                 <button class="small" data-action="member-moderate" data-member="${m.membershipId}" data-mod-action="suspend">Suspend</button>
                 <button class="small danger" data-action="member-moderate" data-member="${m.membershipId}" data-mod-action="remove">Remove</button>
               </div>`
            : ''
        }
      </td>
    </tr>`,
    )
    .join('');

  const joinRequestRows = joinRequests.length
    ? joinRequests
        .map(
          (r) => `
    <tr>
      <td>${escapeHtml(r.fullName)}</td>
      <td>
        <div class="actions-row">
          <button class="small primary" data-action="join-request-approve" data-member="${r.membershipId}">Approve</button>
          <button class="small danger" data-action="join-request-decline" data-member="${r.membershipId}">Decline</button>
        </div>
      </td>
    </tr>`,
        )
        .join('')
    : '<tr class="empty-row"><td colspan="2">No pending requests.</td></tr>';

  const reportRows = reports.length
    ? reports
        .map(
          (r) => `
    <tr>
      <td>${badge(r.targetType)}</td>
      <td>${escapeHtml(r.reason)}</td>
      <td>
        <div class="actions-row">
          <button class="small primary" data-action="report-decide" data-report="${r.id}" data-decision="retained">Retain</button>
          <button class="small" data-action="report-decide" data-report="${r.id}" data-decision="hidden">Hide</button>
          <button class="small danger" data-action="report-decide" data-report="${r.id}" data-decision="removed">Remove</button>
        </div>
      </td>
    </tr>`,
        )
        .join('')
    : '<tr class="empty-row"><td colspan="3">No open reports.</td></tr>';

  const postsHtml = isMember
    ? posts.length
      ? posts.map((p) => renderPostCard(p, canModerate)).join('')
      : '<p style="color:var(--color-text-muted);font-style:italic">No posts yet — start the conversation.</p>'
    : '';

  const body = `
    <a href="#/t/${state.tenantId}/groups" style="font-size:0.85rem">&larr; All groups</a>
    <h1 class="page-title">${escapeHtml(group.name)}</h1>
    <p style="color:var(--color-text-muted)">
      ${badge(group.visibility)} ${badge(group.membershipType)} · ${group.memberCount} member${group.memberCount === 1 ? '' : 's'}
      ${group.industryCategory ? ` · ${escapeHtml(group.industryCategory)}` : ''}
      ${group.locationText ? ` · ${escapeHtml(group.locationText)}` : ''}
    </p>
    ${group.description ? `<p>${escapeHtml(group.description)}</p>` : ''}
    ${group.rules ? `<div class="panel"><h2>Group rules</h2><p style="white-space:pre-wrap">${escapeHtml(group.rules)}</p></div>` : ''}

    <div id="group-membership-alert" class="alert error" role="alert" hidden></div>
    <div class="panel">${membershipNote}</div>

    ${
      isMember
        ? `
    <div class="panel">
      <h2>Group chat</h2>
      <div id="group-chat-messages" style="max-height:320px;overflow-y:auto;border:1px solid var(--color-border);border-radius:8px;padding:10px;margin-bottom:10px;background:var(--color-surface)"></div>
      <form id="group-chat-form" class="inline-form" novalidate>
        <div class="field" style="flex:1"><input id="gc-input" placeholder="Message the group…" autocomplete="off" required /></div>
        <button class="small primary" type="submit">Send</button>
      </form>
    </div>

    <div class="panel">
      <h2>Post to the group</h2>
      <div id="group-post-alert" class="alert error" role="alert" hidden></div>
      <form id="group-post-form" novalidate>
        <div class="field">
          <label for="gp-topic">Topic</label>
          <select id="gp-topic">
            <option value="general">General</option>
            <option value="service">Service</option>
            <option value="product">Product</option>
            <option value="invention">Invention</option>
            <option value="business_idea">Business idea</option>
            <option value="industry_knowledge">Industry knowledge</option>
            <option value="opportunity">Opportunity</option>
            <option value="event">Event</option>
            <option value="training">Training</option>
            <option value="question">Question</option>
          </select>
        </div>
        <div class="field"><label for="gp-body">What's on your mind?</label><textarea id="gp-body" rows="3" required></textarea></div>
        <div class="field" id="gp-ip-field" hidden>
          <label><input type="checkbox" id="gp-ip-ack" /> I understand this post may disclose product/invention details and I acknowledge the intellectual-property notice.</label>
        </div>
        <div class="field"><label for="gp-attachment">Attach a file (optional)</label><input id="gp-attachment" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,application/pdf" /></div>
        <button class="primary" type="submit">Post</button>
      </form>
    </div>

    <div>${postsHtml}</div>

    <div class="panel">
      <h2>Members</h2>
      <table class="data-table">
        <thead><tr><th>Name</th><th>Role</th><th>Status</th><th></th></tr></thead>
        <tbody>${memberRows}</tbody>
      </table>
    </div>`
        : ''
    }

    ${
      canManage
        ? `
    <div class="panel">
      <h2>Invite a member</h2>
      <div id="group-invite-alert" class="alert error" role="alert" hidden></div>
      <form id="group-invite-form" class="inline-form" novalidate>
        <div class="field"><label for="gi-email">Email</label><input id="gi-email" type="email" required /></div>
        <button class="primary" type="submit">Invite</button>
      </form>
    </div>

    <div class="panel">
      <h2>Join requests</h2>
      <table class="data-table"><thead><tr><th>Name</th><th></th></tr></thead><tbody>${joinRequestRows}</tbody></table>
    </div>`
        : ''
    }

    ${
      canModerate
        ? `
    <div class="panel">
      <h2>Reported content</h2>
      <table class="data-table"><thead><tr><th>Type</th><th>Reason</th><th></th></tr></thead><tbody>${reportRows}</tbody></table>
    </div>`
        : ''
    }

    ${
      isOwner
        ? `
    <div class="panel">
      <h2>Group settings</h2>
      <div id="group-settings-alert" class="alert error" role="alert" hidden></div>
      <form id="group-settings-form" novalidate class="inline-form">
        <div class="field"><label for="gs-name">Name</label><input id="gs-name" value="${escapeHtml(group.name)}" /></div>
        <div class="field">
          <label for="gs-visibility">Visibility</label>
          <select id="gs-visibility">
            <option value="public" ${group.visibility === 'public' ? 'selected' : ''}>Public</option>
            <option value="private" ${group.visibility === 'private' ? 'selected' : ''}>Private</option>
            <option value="hidden" ${group.visibility === 'hidden' ? 'selected' : ''}>Hidden</option>
          </select>
        </div>
        <div class="field">
          <label for="gs-membership-type">Joining</label>
          <select id="gs-membership-type">
            <option value="open" ${group.membershipType === 'open' ? 'selected' : ''}>Open</option>
            <option value="request" ${group.membershipType === 'request' ? 'selected' : ''}>Request to join</option>
            <option value="invite_only" ${group.membershipType === 'invite_only' ? 'selected' : ''}>Invite only</option>
          </select>
        </div>
        <div class="field" style="flex:1;min-width:240px"><label for="gs-rules">Group rules</label><textarea id="gs-rules" rows="2">${escapeHtml(group.rules ?? '')}</textarea></div>
        <button class="primary" type="submit">Save settings</button>
      </form>
      <p style="color:var(--color-text-muted);font-size:0.85rem;margin-top:12px">
        As owner you must transfer ownership to another active member (by their member ID below) before you can leave,
        or close the group instead.
      </p>
      <form id="group-transfer-form" class="inline-form" novalidate>
        <div class="field"><label for="gt-user">New owner's user ID</label><input id="gt-user" required /></div>
        <button class="btn-plain" type="submit">Transfer ownership</button>
      </form>
      <button class="btn-plain" id="group-close-btn" style="margin-top:8px">Close this group</button>
    </div>`
        : ''
    }
  `;

  const after = () => {
    if (isMember) {
      const chatForm = document.getElementById('group-chat-form');
      if (chatForm) {
        chatForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          const input = document.getElementById('gc-input');
          const text = input.value.trim();
          if (!text || chatForm.dataset.sending === 'true') return;
          chatForm.dataset.sending = 'true';
          const submitBtn = chatForm.querySelector('button[type="submit"]');
          if (submitBtn) submitBtn.disabled = true;
          input.value = '';
          const container = document.getElementById('group-chat-messages');
          try {
            await Api.sendGroupMessage(groupId, text);
            await pollGroupChat(groupId, container);
          } catch (err) {
            window.alert(err.message);
            input.value = text;
          } finally {
            chatForm.dataset.sending = 'false';
            if (submitBtn) submitBtn.disabled = false;
          }
        });
      }
      initGroupChat(groupId);
    }

    const joinBtn = document.getElementById('group-join-btn');
    if (joinBtn) {
      joinBtn.addEventListener('click', () => runAction(joinBtn, () => Api.joinGroup(groupId)));
    }
    const acceptBtn = document.getElementById('group-invite-accept-btn');
    if (acceptBtn) acceptBtn.addEventListener('click', () => runAction(acceptBtn, () => Api.acceptGroupInvitation(groupId)));
    const declineBtn = document.getElementById('group-invite-decline-btn');
    if (declineBtn) declineBtn.addEventListener('click', () => runAction(declineBtn, () => Api.declineGroupInvitation(groupId)));

    const postForm = document.getElementById('group-post-form');
    if (postForm) {
      const topicSelect = document.getElementById('gp-topic');
      const ipField = document.getElementById('gp-ip-field');
      const syncIpField = () => {
        ipField.hidden = !['product', 'invention'].includes(topicSelect.value);
      };
      topicSelect.addEventListener('change', syncIpField);
      syncIpField();

      postForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const alertBox = document.getElementById('group-post-alert');
        alertBox.hidden = true;
        const topic = topicSelect.value;
        const ipAck = document.getElementById('gp-ip-ack').checked;
        if (['product', 'invention'].includes(topic) && !ipAck) {
          alertBox.textContent = 'Please acknowledge the intellectual-property notice before posting.';
          alertBox.hidden = false;
          return;
        }
        const fileInput = document.getElementById('gp-attachment');
        try {
          const post = await Api.createGroupPost(groupId, { topic, body: document.getElementById('gp-body').value.trim(), ipAck });
          if (fileInput.files[0]) {
            await Api.uploadGroupPostAttachment(groupId, post.id, fileInput.files[0]);
          }
          renderRoute();
        } catch (err) {
          alertBox.textContent = err.message;
          alertBox.hidden = false;
        }
      });
    }

    document.querySelectorAll('[data-action="post-react"]').forEach((btn) =>
      btn.addEventListener('click', () =>
        runAction(btn, () => (btn.dataset.reacted === 'true' ? Api.unreactToGroupPost(groupId, btn.dataset.post) : Api.reactToGroupPost(groupId, btn.dataset.post))),
      ),
    );
    document.querySelectorAll('[data-action="post-share"]').forEach((btn) =>
      btn.addEventListener('click', () => runAction(btn, () => Api.shareGroupPost(groupId, btn.dataset.post))),
    );
    document.querySelectorAll('[data-action="post-delete"]').forEach((btn) =>
      btn.addEventListener('click', () => {
        if (!window.confirm('Delete this post?')) return;
        runAction(btn, () => Api.deleteGroupPost(groupId, btn.dataset.post));
      }),
    );
    document.querySelectorAll('[data-action="post-comments-toggle"]').forEach((btn) =>
      btn.addEventListener('click', () => toggleGroupPostComments(groupId, btn.dataset.post)),
    );
    document.querySelectorAll('[data-action="post-report"]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const reason = window.prompt('Why are you reporting this post?');
        if (!reason) return;
        try {
          await Api.reportGroupContent(groupId, { targetType: 'post', targetId: btn.dataset.post, reason });
          window.alert('Report submitted. A moderator will review it.');
        } catch (err) {
          window.alert(err.message);
        }
      }),
    );

    const inviteForm = document.getElementById('group-invite-form');
    if (inviteForm) {
      inviteForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const alertBox = document.getElementById('group-invite-alert');
        alertBox.hidden = true;
        try {
          await Api.inviteGroupMember(groupId, document.getElementById('gi-email').value.trim());
          renderRoute();
        } catch (err) {
          alertBox.textContent = err.message;
          alertBox.hidden = false;
        }
      });
    }

    document.querySelectorAll('[data-action="join-request-approve"]').forEach((btn) =>
      btn.addEventListener('click', () => runAction(btn, () => Api.approveGroupJoinRequest(groupId, btn.dataset.member))),
    );
    document.querySelectorAll('[data-action="join-request-decline"]').forEach((btn) =>
      btn.addEventListener('click', () => runAction(btn, () => Api.declineGroupJoinRequest(groupId, btn.dataset.member))),
    );

    document.querySelectorAll('[data-action="member-role-select"]').forEach((select) =>
      select.addEventListener('change', () =>
        runAction(select, () => Api.changeGroupMemberRole(groupId, select.dataset.member, select.value)),
      ),
    );
    document.querySelectorAll('[data-action="member-moderate"]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const reason = window.prompt(`Reason for this action (${btn.dataset.modAction})?`);
        if (!reason) return;
        await runAction(btn, () => Api.moderateGroupMember(groupId, btn.dataset.member, btn.dataset.modAction, reason));
      }),
    );

    document.querySelectorAll('[data-action="report-decide"]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const reason = window.prompt('Reason for this decision?');
        if (!reason) return;
        await runAction(btn, () => Api.decideGroupReport(groupId, btn.dataset.report, { decision: btn.dataset.decision, reason }));
      }),
    );

    const settingsForm = document.getElementById('group-settings-form');
    if (settingsForm) {
      settingsForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const alertBox = document.getElementById('group-settings-alert');
        alertBox.hidden = true;
        try {
          await Api.updateGroup(groupId, {
            name: document.getElementById('gs-name').value.trim(),
            visibility: document.getElementById('gs-visibility').value,
            membershipType: document.getElementById('gs-membership-type').value,
            rules: document.getElementById('gs-rules').value.trim() || undefined,
          });
          renderRoute();
        } catch (err) {
          alertBox.textContent = err.message;
          alertBox.hidden = false;
        }
      });
    }

    const transferForm = document.getElementById('group-transfer-form');
    if (transferForm) {
      transferForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
          await Api.transferGroupOwnership(groupId, document.getElementById('gt-user').value.trim());
          renderRoute();
        } catch (err) {
          window.alert(err.message);
        }
      });
    }

    const closeBtn = document.getElementById('group-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        if (!window.confirm('Close this group? This cannot be undone from here.')) return;
        runAction(closeBtn, () => Api.closeGroup(groupId));
      });
    }
  };

  return { title: group.name, body, after };
}

// Group chat state lives outside any view function since it's a
// setInterval polling loop that must keep running (and get torn down
// on navigation) independently of a single renderGroupDetail() call.
const groupChatState = { timer: null, lastId: null };

function stopGroupChatPolling() {
  if (groupChatState.timer) {
    clearInterval(groupChatState.timer);
    groupChatState.timer = null;
  }
  groupChatState.lastId = null;
}

function renderChatMessageHtml(m) {
  const mine = m.authorUserId === state.user?.id;
  return `
    <div class="chat-message" data-message-id="${m.id}" style="margin-bottom:10px">
      <div style="font-size:0.78rem;color:var(--color-text-muted)">
        <strong>${escapeHtml(m.authorName)}</strong> · ${formatDate(m.createdAt)}
        ${mine ? `<button class="small danger" data-action="chat-delete" data-message="${m.id}" style="float:right;padding:1px 6px;font-size:0.72rem">Delete</button>` : ''}
      </div>
      <div>${escapeHtml(m.body)}</div>
    </div>`;
}

function wireGroupChatDeleteButtons(groupId, container) {
  container.querySelectorAll('[data-action="chat-delete"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await Api.deleteGroupMessage(groupId, btn.dataset.message);
        const row = btn.closest('.chat-message');
        if (row) row.remove();
      } catch (err) {
        window.alert(err.message);
        btn.disabled = false;
      }
    });
  });
}

function appendChatMessages(container, messages) {
  if (container.dataset.empty === 'true') container.innerHTML = '';
  messages.forEach((m) => container.insertAdjacentHTML('beforeend', renderChatMessageHtml(m)));
  container.dataset.empty = 'false';
  container.scrollTop = container.scrollHeight;
}

async function pollGroupChat(groupId, container) {
  if (!container || !document.body.contains(container)) {
    // The view moved on since this poll was scheduled (or this direct
    // call after sending) -- nothing left to update.
    stopGroupChatPolling();
    return;
  }
  try {
    const fresh = await Api.listGroupMessages(groupId, groupChatState.lastId || undefined);
    if (fresh.length) {
      appendChatMessages(container, fresh);
      groupChatState.lastId = fresh[fresh.length - 1].id;
      wireGroupChatDeleteButtons(groupId, container);
    }
  } catch {
    // A transient poll failure isn't worth interrupting the chat over -- just try again next tick.
  }
}

async function initGroupChat(groupId) {
  stopGroupChatPolling();
  const container = document.getElementById('group-chat-messages');
  if (!container) return;

  try {
    const messages = await Api.listGroupMessages(groupId);
    if (messages.length) {
      container.dataset.empty = 'false';
      container.innerHTML = messages.map(renderChatMessageHtml).join('');
      groupChatState.lastId = messages[messages.length - 1].id;
    } else {
      container.dataset.empty = 'true';
      container.innerHTML = '<p style="color:var(--color-text-muted);font-style:italic;margin:0">No messages yet — say hello.</p>';
    }
    container.scrollTop = container.scrollHeight;
    wireGroupChatDeleteButtons(groupId, container);
  } catch (err) {
    container.innerHTML = `<div class="alert error" role="alert">${escapeHtml(err.message)}</div>`;
    return;
  }

  // A 4s poll is a deliberate, simple stand-in for real-time push:
  // this project has no websocket/SSE layer anywhere else to hang a
  // live channel off of (see group-chat.service.ts).
  groupChatState.timer = setInterval(() => pollGroupChat(groupId, container), 4000);
}

views.groups = async () => {
  const { section } = parseRoute();
  const match = section.match(/^groups\/([^/]+)$/);
  if (match) {
    return renderGroupDetail(match[1]);
  }
  return renderGroupList();
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
    (item) => `<a href="#/t/${tenantId}/${item.key}" class="${item.key === section || section.startsWith(item.key + '/') ? 'active' : ''}">${item.label}</a>`,
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

  // `section` can be a sub-route like "groups/<groupId>" (see
  // views.groups, which parses the remainder itself) -- only the
  // first path segment picks which view function to call.
  const baseSection = section.split('/')[0];
  const viewFn = tenantId ? views[baseSection] : views.tenants;
  const container = document.getElementById('view');

  if (!viewFn) {
    container.innerHTML = `<p>Unknown page.</p>`;
    return;
  }

  try {
    const { body, after } = await viewFn();
    container.innerHTML = body;
    document.title = `Naa here - Provider portal`;
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

  window.addEventListener('hashchange', () => {
    stopGroupChatPolling();
    renderRoute();
  });
  await renderRoute();
}

init();
