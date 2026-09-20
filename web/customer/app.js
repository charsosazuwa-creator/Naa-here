/**
 * Customer-facing app (Milestone 3): browse published services across
 * every tenant, view one service's detail plus business hours, book
 * it (any signed-in user — see booking.controller.ts), and see/cancel
 * "my bookings". Same dependency-free, hash-routed, no-build-step
 * pattern as web/provider/app.js, deliberately without its sidebar or
 * tenant switcher — there's no tenant context here, only Browse and
 * My bookings.
 */

const state = {
  user: isSignedIn() ? currentUser() : null,
  serviceCache: {},
};

const CATEGORY_OPTIONS = [
  { value: '', label: 'All categories' },
  { value: 'barber_salon', label: 'Barber and salon' },
  { value: 'accommodation', label: 'Accommodation' },
  { value: 'artisan', label: 'Artisan and on-demand jobs' },
];

const COUNTRY_OPTIONS = [
  { value: '', label: 'All countries' },
  { value: 'NG', label: 'Nigeria' },
  { value: 'KE', label: 'Kenya' },
  { value: 'GH', label: 'Ghana' },
  { value: 'ZA', label: 'South Africa' },
];

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatMoney(amountMinorUnits, currencyCode) {
  if (amountMinorUnits === undefined || amountMinorUnits === null) return '—';
  return `${(Number(amountMinorUnits) / 100).toFixed(2)} ${currencyCode ?? ''}`.trim();
}

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function badge(status) {
  return `<span class="badge status-${escapeHtml(status)}">${escapeHtml(String(status).replace(/_/g, ' '))}</span>`;
}

/** Local-time datetime-local input value ("YYYY-MM-DDTHH:mm") for a Date, so what the customer picks is what gets sent, not a UTC-shifted reading. */
function toLocalInputValue(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function serviceById(serviceId) {
  if (!state.serviceCache[serviceId]) {
    state.serviceCache[serviceId] = await Api.getService(serviceId).catch(() => null);
  }
  return state.serviceCache[serviceId];
}

/** Every view returns { title, body } and, optionally, an `after()` hook to wire up event listeners once the HTML is in the DOM. */
const views = {};

// ---------------------------------------------------------------------
// Browse: filterable list of every published service, across tenants.
// ---------------------------------------------------------------------
views.browse = async (params) => {
  const filters = {
    category: params.get('category') || '',
    countryCode: params.get('country') || '',
    city: params.get('city') || '',
    search: params.get('q') || '',
  };

  const query = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v),
  ).toString();

  let services = [];
  let loadError = null;
  try {
    services = await Api.discoverServices(query);
  } catch (err) {
    loadError = err.message;
  }
  services.forEach((s) => {
    state.serviceCache[s.id] = s;
  });

  const body = `
    <h1 class="page-title">Browse services</h1>
    <form id="filters-form" class="filters-bar" novalidate>
      <div class="field">
        <label for="f-search">Search</label>
        <input id="f-search" placeholder="Service or business name" value="${escapeHtml(filters.search)}" />
      </div>
      <div class="field">
        <label for="f-category">Category</label>
        <select id="f-category" class="tenant-select">
          ${CATEGORY_OPTIONS.map((o) => `<option value="${o.value}" ${o.value === filters.category ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label for="f-country">Country</label>
        <select id="f-country" class="tenant-select">
          ${COUNTRY_OPTIONS.map((o) => `<option value="${o.value}" ${o.value === filters.countryCode ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label for="f-city">City</label>
        <input id="f-city" placeholder="e.g. Lagos" value="${escapeHtml(filters.city)}" />
      </div>
      <button class="small primary" type="submit">Search</button>
    </form>

    ${loadError ? `<div class="alert error" role="alert">${escapeHtml(loadError)}</div>` : ''}

    ${
      !loadError && services.length === 0
        ? '<p class="empty-state">No published services match these filters yet.</p>'
        : `<div class="service-grid">
      ${services
        .map(
          (s) => `
        <a class="service-card" href="#/service/${s.id}">
          <div class="name">${escapeHtml(s.name)}</div>
          <div class="tenant">${escapeHtml(s.tenantName)}${s.location ? ` · ${escapeHtml(s.location.city)}, ${escapeHtml(s.location.countryCode)}` : ''}</div>
          <div class="price">${formatMoney(s.priceMinorUnits, s.currencyCode)}</div>
          <div class="meta">${escapeHtml(s.categoryName)}${s.durationMinutes ? ` · ${s.durationMinutes} min` : ''}</div>
        </a>`,
        )
        .join('')}
    </div>`
    }
  `;

  const after = () => {
    document.getElementById('filters-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const q = new URLSearchParams(
        Object.entries({
          category: document.getElementById('f-category').value,
          country: document.getElementById('f-country').value,
          city: document.getElementById('f-city').value,
          q: document.getElementById('f-search').value.trim(),
        }).filter(([, v]) => v),
      ).toString();
      window.location.hash = `#/browse${q ? `?${q}` : ''}`;
    });
  };

  return { title: 'Browse services', body, after };
};

// ---------------------------------------------------------------------
// Service detail + booking form.
// ---------------------------------------------------------------------
views.service = async (params, routeParams) => {
  const serviceId = routeParams[0];
  let service;
  try {
    service = await Api.getService(serviceId);
  } catch (err) {
    return { title: 'Service', body: `<div class="alert error" role="alert">${escapeHtml(err.message)}</div>` };
  }

  const rulesByDay = DAYS_OF_WEEK.map((label, dayOfWeek) => ({
    label,
    windows: service.availability.filter((r) => r.dayOfWeek === dayOfWeek),
  }));

  const now = new Date();
  now.setMinutes(now.getMinutes() - (now.getMinutes() % 30) + 30, 0, 0);
  const defaultStart = toLocalInputValue(now);
  const defaultEnd = toLocalInputValue(new Date(now.getTime() + (service.durationMinutes ?? 60) * 60000));

  const body = `
    <a class="back-link" href="#/browse">&larr; Back to browse</a>
    <h1 class="page-title">${escapeHtml(service.name)}</h1>
    <div class="panel">
      <div class="tenant" style="margin-bottom:var(--space-2)">
        ${escapeHtml(service.tenantName)}${service.location ? ` · ${escapeHtml(service.location.addressLine)}, ${escapeHtml(service.location.city)}, ${escapeHtml(service.location.countryCode)}` : ''}
      </div>
      <p>${escapeHtml(service.description ?? '')}</p>
      <div class="price" style="font-size:1.1rem;margin:var(--space-2) 0">${formatMoney(service.priceMinorUnits, service.currencyCode)}${service.durationMinutes ? ` · ${service.durationMinutes} min` : ''}</div>
      <div>${badge('published')} <span style="color:var(--color-text-muted);font-size:0.85rem">${escapeHtml(service.categoryName)}</span></div>
    </div>

    <div class="panel">
      <h2>Business hours</h2>
      ${
        service.availability.length === 0
          ? '<p class="empty-state">No hours set yet — contact the business to confirm availability.</p>'
          : `<div class="slot-list">
        ${rulesByDay
          .filter((d) => d.windows.length > 0)
          .map(
            (d) => `
          <div class="day-block">
            <div class="day">${d.label}</div>
            ${d.windows.map((w) => `<div>${escapeHtml(w.startTime)} – ${escapeHtml(w.endTime)}</div>`).join('')}
          </div>`,
          )
          .join('')}
      </div>`
      }
      ${
        service.blockedTimes.length > 0
          ? `<p style="color:var(--color-text-muted);font-size:0.85rem;margin-top:var(--space-2)">Already unavailable: ${service.blockedTimes
              .map((b) => `${formatDateTime(b.startsAt)} – ${formatDateTime(b.endsAt)}`)
              .join('; ')}</p>`
          : ''
      }
    </div>

    <div class="panel">
      <h2>Book this service</h2>
      <div id="book-alert" class="alert error" role="alert" hidden></div>
      <form id="book-form" novalidate>
        <div class="field">
          <label for="b-start">Starts at</label>
          <input id="b-start" type="datetime-local" value="${defaultStart}" required />
        </div>
        <div class="field">
          <label for="b-end">Ends at</label>
          <input id="b-end" type="datetime-local" value="${defaultEnd}" required />
        </div>
        <div class="field">
          <label for="b-notes">Notes (optional)</label>
          <textarea id="b-notes" rows="2"></textarea>
        </div>
        <button class="primary" type="submit" id="book-btn">${isSignedIn() ? 'Book now' : 'Sign in to book'}</button>
      </form>
    </div>

    <div class="panel">
      <h2>Request a custom job</h2>
      <p style="color:var(--color-text-muted);font-size:0.85rem;margin-bottom:var(--space-2)">
        Not sure of the exact time or price yet? Describe what you need and the business will send you a quote —
        you can accept it from <a href="#/job-requests">Job requests</a> once it arrives.
      </p>
      <div id="job-request-alert" class="alert error" role="alert" hidden></div>
      <form id="job-request-form" novalidate>
        <div class="field">
          <label for="jr-description">What do you need done?</label>
          <textarea id="jr-description" rows="3" required></textarea>
        </div>
        <button class="primary" type="submit" id="job-request-btn">${isSignedIn() ? 'Send request' : 'Sign in to request'}</button>
      </form>
    </div>
  `;

  const after = () => {
    const startInput = document.getElementById('b-start');
    const endInput = document.getElementById('b-end');
    if (service.durationMinutes) {
      startInput.addEventListener('change', () => {
        if (!startInput.value) return;
        const start = new Date(startInput.value);
        endInput.value = toLocalInputValue(new Date(start.getTime() + service.durationMinutes * 60000));
      });
    }

    document.getElementById('job-request-form').addEventListener('submit', async (event) => {
      event.preventDefault();

      if (!isSignedIn()) {
        window.location.href = `login.html?next=${encodeURIComponent(`#/service/${serviceId}`)}`;
        return;
      }

      const alertBox = document.getElementById('job-request-alert');
      const btn = document.getElementById('job-request-btn');
      alertBox.hidden = true;
      btn.disabled = true;
      btn.textContent = 'Sending…';

      try {
        await Api.createJobRequest(service.tenantId, {
          serviceId: service.id,
          description: document.getElementById('jr-description').value.trim(),
        });
        window.location.hash = '#/job-requests';
      } catch (err) {
        alertBox.textContent = err.message;
        alertBox.hidden = false;
        btn.disabled = false;
        btn.textContent = 'Send request';
      }
    });

    document.getElementById('book-form').addEventListener('submit', async (event) => {
      event.preventDefault();

      if (!isSignedIn()) {
        window.location.href = `login.html?next=${encodeURIComponent(`#/service/${serviceId}`)}`;
        return;
      }

      const alertBox = document.getElementById('book-alert');
      const btn = document.getElementById('book-btn');
      alertBox.hidden = true;
      btn.disabled = true;
      btn.textContent = 'Booking…';

      try {
        const startsAt = new Date(startInput.value).toISOString();
        const endsAt = new Date(endInput.value).toISOString();
        const idempotencyKey =
          window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

        await Api.createBooking(
          service.tenantId,
          { serviceId: service.id, startsAt, endsAt, notes: document.getElementById('b-notes').value.trim() || undefined },
          idempotencyKey,
        );

        window.location.hash = '#/bookings';
      } catch (err) {
        alertBox.textContent = err.message;
        alertBox.hidden = false;
        btn.disabled = false;
        btn.textContent = 'Book now';
      }
    });
  };

  return { title: service.name, body, after };
};

// ---------------------------------------------------------------------
// My bookings.
// ---------------------------------------------------------------------
views.bookings = async () => {
  if (!isSignedIn()) {
    window.location.href = `login.html?next=${encodeURIComponent('#/bookings')}`;
    return { title: 'My bookings', body: '' };
  }

  let bookings;
  try {
    bookings = await Api.myBookings();
  } catch (err) {
    return { title: 'My bookings', body: `<div class="alert error" role="alert">${escapeHtml(err.message)}</div>` };
  }

  await Promise.all(bookings.map((b) => serviceById(b.serviceId)));

  const body = `
    <h1 class="page-title">My bookings</h1>
    <div class="panel">
      <table class="data-table">
        <thead>
          <tr><th>Service</th><th>Business</th><th>When</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          ${
            bookings.length === 0
              ? '<tr class="empty-row"><td colspan="5">No bookings yet — browse services to make your first one.</td></tr>'
              : bookings
                  .map((b) => {
                    const svc = state.serviceCache[b.serviceId];
                    const canCancel = !['cancelled', 'completed', 'no_show'].includes(b.status);
                    return `
              <tr data-booking-id="${b.id}" data-tenant-id="${svc?.tenantId ?? ''}">
                <td>${svc ? `<a href="#/service/${b.serviceId}">${escapeHtml(svc.name)}</a>` : escapeHtml(b.serviceId)}</td>
                <td>${escapeHtml(svc?.tenantName ?? '—')}</td>
                <td>${formatDateTime(b.startsAt)} – ${formatDateTime(b.endsAt)}</td>
                <td>${badge(b.status)}</td>
                <td>
                  <div class="actions-row">
                    ${canCancel ? '<button class="small danger" data-action="cancel">Cancel</button>' : ''}
                    <button class="small" data-action="dispute">Report a problem</button>
                  </div>
                </td>
              </tr>`;
                  })
                  .join('')
          }
        </tbody>
      </table>
    </div>
    <div id="dispute-panel"></div>
  `;

  const after = () => {
    document.querySelectorAll('[data-action="cancel"]').forEach((btn) => {
      btn.addEventListener('click', () =>
        runAction(btn, async () => {
          const bookingId = btn.closest('tr').dataset.bookingId;
          if (!window.confirm('Cancel this booking?')) throw new Error('__cancelled__');
          await Api.cancelBooking(bookingId);
        }),
      );
    });

    // US-056: report a problem with this booking (raise a dispute).
    document.querySelectorAll('[data-action="dispute"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const row = btn.closest('tr');
        const { bookingId, tenantId } = row.dataset;
        const panel = document.getElementById('dispute-panel');
        panel.innerHTML = `<div class="panel"><h2>Report a problem</h2>${DisputeUI.disputeFormHtml()}</div>`;
        DisputeUI.wireDisputeForm(panel, Api, tenantId, bookingId, (dispute) => {
          panel.innerHTML = `
            <div class="panel">
              <p>Your report was submitted — case reference <strong>${DisputeUI.escapeHtml(dispute.caseNumber)}</strong>.
              You can track its status under <a href="#/my-disputes">My Disputes</a>.</p>
            </div>`;
        });
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    });
  };

  return { title: 'My bookings', body, after };
};

// ---------------------------------------------------------------------
// My Disputes (US-056) — any signed-in user's own cases, as raiser or
// as the customer on a booking the other party disputed.
// ---------------------------------------------------------------------
views['my-disputes'] = async () => {
  if (!isSignedIn()) {
    window.location.href = `login.html?next=${encodeURIComponent('#/my-disputes')}`;
    return { title: 'My Disputes', body: '' };
  }

  let disputes;
  try {
    disputes = await Api.myDisputes();
  } catch (err) {
    return { title: 'My Disputes', body: `<div class="alert error" role="alert">${escapeHtml(err.message)}</div>` };
  }

  const rows = disputes.length
    ? disputes
        .map(
          (d) => `
      <tr>
        <td><code>${escapeHtml(d.caseNumber)}</code></td>
        <td>${DisputeUI.reasonLabel(d.reason)}</td>
        <td>${DisputeUI.badge(d.status)}</td>
        <td>${DisputeUI.formatDateTime(d.createdAt)}</td>
        <td><button class="small" data-action="expand" data-id="${d.id}">Details</button></td>
      </tr>
      <tr class="submission-detail" data-detail-for="${d.id}" hidden>
        <td colspan="5">${DisputeUI.disputeDetailHtml(d)}</td>
      </tr>`,
        )
        .join('')
    : '<tr class="empty-row"><td colspan="5">No cases yet.</td></tr>';

  const body = `
    <h1 class="page-title">My Disputes</h1>
    <p style="color:var(--color-text-muted);font-size:0.85rem">
      Cases you've reported, or that were reported about one of your bookings.
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
  };

  return { title: 'My Disputes', body, after };
};

// ---------------------------------------------------------------------
// Marketplace (User Story 2): public browse/detail for
// products/services/inventions any registered user has posted, plus
// "My Listings" management for the signed-in user's own. Rendering
// logic is shared with the provider portal — see
// web/shared/listing-ui.js — since a listing is owned by a user, not
// a tenant (db/migrations/012_marketplace_listings.sql).
// ---------------------------------------------------------------------
views.market = async (params) => {
  const filters = {
    listingType: params.get('type') || '',
    countryCode: params.get('country') || '',
    location: params.get('location') || '',
    search: params.get('q') || '',
    sort: params.get('sort') || '',
    minPrice: params.get('minPrice') || '',
    maxPrice: params.get('maxPrice') || '',
    lat: params.get('lat') || '',
    lng: params.get('lng') || '',
    radiusKm: params.get('radius') || '',
  };
  return ListingUI.renderMarketBrowse(Api, filters, 'market-item');
};

views['market-item'] = async (params, routeParams) => ListingUI.renderMarketDetail(Api, routeParams[0], 'market');

views['my-listings'] = async () => {
  if (!isSignedIn()) {
    window.location.href = `login.html?next=${encodeURIComponent('#/my-listings')}`;
    return { title: 'My Listings', body: '' };
  }
  return ListingUI.renderMyListings(Api, runAction);
};

// ---------------------------------------------------------------------
// Job requests ("mine"): the artisan flow's customer-facing half —
// see job.service.ts's listMine/accept. Status moves
// requested -> quoted -> accepted (creates a booking, visible under
// My bookings) or declined by the business.
// ---------------------------------------------------------------------
views['job-requests'] = async () => {
  if (!isSignedIn()) {
    window.location.href = `login.html?next=${encodeURIComponent('#/job-requests')}`;
    return { title: 'Job requests', body: '' };
  }

  let requests;
  try {
    requests = await Api.myJobRequests();
  } catch (err) {
    return { title: 'Job requests', body: `<div class="alert error" role="alert">${escapeHtml(err.message)}</div>` };
  }

  const body = `
    <h1 class="page-title">Job requests</h1>
    <div id="jr-list-alert" class="alert error" role="alert" hidden></div>
    <div class="panel">
      ${
        requests.length === 0
          ? '<p class="empty-state">No job requests yet — open a service and use "Request a custom job" to send one.</p>'
          : `<table class="data-table">
        <thead>
          <tr><th>Service</th><th>Business</th><th>Description</th><th>Status</th><th>Quote</th><th></th></tr>
        </thead>
        <tbody>
          ${requests
            .map((r) => {
              const q = r.quotation;
              const quoteText = q
                ? `${formatMoney(q.amountMinorUnits, q.currencyCode)}<br><span style="color:var(--color-text-muted);font-size:0.8rem">${formatDateTime(q.proposedStartsAt)} – ${formatDateTime(q.proposedEndsAt)}</span>`
                : '—';
              const canAccept = r.status === 'quoted' && q;
              return `
              <tr data-job-request-id="${r.id}" data-tenant-id="${r.tenantId}">
                <td><a href="#/service/${r.serviceId}">${escapeHtml(r.serviceName)}</a></td>
                <td>${escapeHtml(r.tenantName)}</td>
                <td>${escapeHtml(r.description)}</td>
                <td>${badge(r.status)}</td>
                <td>${quoteText}</td>
                <td>${canAccept ? '<button class="small primary" data-action="accept-quote">Accept quote</button>' : ''}</td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>`
      }
    </div>
  `;

  const after = () => {
    document.querySelectorAll('[data-action="accept-quote"]').forEach((btn) => {
      btn.addEventListener('click', () =>
        runAction(btn, async () => {
          const row = btn.closest('tr');
          const { jobRequestId, tenantId } = row.dataset;
          if (!window.confirm('Accept this quote? This will create a booking for the proposed time.')) {
            throw new Error('__cancelled__');
          }
          try {
            await Api.acceptJobRequestQuote(tenantId, jobRequestId);
          } catch (err) {
            document.getElementById('jr-list-alert').textContent = err.message;
            document.getElementById('jr-list-alert').hidden = false;
            throw new Error('__cancelled__');
          }
          window.location.hash = '#/bookings';
        }),
      );
    });
  };

  return { title: 'Job requests', body, after };
};

// ---------------------------------------------------------------------
// Shell: routing.
// ---------------------------------------------------------------------

async function runAction(button, action) {
  button.disabled = true;
  try {
    await action();
    renderRoute();
  } catch (err) {
    if (err.message !== '__cancelled__') window.alert(err.message);
    button.disabled = false;
  }
}

function parseRoute() {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const [pathPart, queryPart] = hash.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const section = segments[0] || 'browse';
  const routeParams = segments.slice(1);
  const params = new URLSearchParams(queryPart || '');
  return { section, routeParams, params };
}

function renderNav() {
  const { section } = parseRoute();
  document.querySelectorAll('.customer-nav a').forEach((a) => {
    const target = a.getAttribute('href').replace(/^#\//, '').split(/[/?]/)[0];
    a.classList.toggle(
      'active',
      target === section ||
        (target === 'browse' && section === 'service') ||
        (target === 'market' && section === 'market-item'),
    );
  });
}

function renderAuthArea() {
  const userNameEl = document.getElementById('user-name');
  const authBtn = document.getElementById('auth-btn');
  if (isSignedIn()) {
    state.user = currentUser();
    userNameEl.textContent = state.user?.fullName ?? '';
    authBtn.textContent = 'Sign out';
    authBtn.onclick = () => {
      clearSession();
      state.user = null;
      renderAuthArea();
      renderRoute();
    };
  } else {
    userNameEl.textContent = '';
    authBtn.textContent = 'Sign in';
    authBtn.onclick = () => {
      window.location.href = `login.html?next=${encodeURIComponent(window.location.hash || '#/browse')}`;
    };
  }
}

async function renderRoute() {
  const { section, routeParams, params } = parseRoute();
  renderNav();

  const viewFn = views[section];
  const container = document.getElementById('view');

  if (!viewFn) {
    container.innerHTML = '<p>Unknown page.</p>';
    return;
  }

  try {
    const { body, after } = await viewFn(params, routeParams);
    container.innerHTML = body;
    document.title = 'Naa here';
    if (after) after();
  } catch (err) {
    container.innerHTML = `<div class="alert error" role="alert">${escapeHtml(err.message)}</div>`;
  }
}

function init() {
  renderAuthArea();
  window.addEventListener('hashchange', renderRoute);
  renderRoute();
}

init();
