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

async function serviceById(serviceId) {
  if (!state.serviceCache[serviceId]) {
    state.serviceCache[serviceId] = await Api.getService(serviceId).catch(() => null);
  }
  return state.serviceCache[serviceId];
}

/** Every view returns { title, body } and, optionally, an `after()` hook to wire up event listeners once the HTML is in the DOM. */
const views = {};

// ---------------------------------------------------------------------
// Home: landing page with a hero, category shortcuts, a handful of
// currently-published services, and the markets we operate in. Not
// the default route (that's still Browse) — reached via the logo in
// the header, or directly at #/home.
// ---------------------------------------------------------------------
views.home = async () => {
  let popular = [];
  try {
    popular = (await Api.discoverServices('')).slice(0, 4);
  } catch {
    popular = [];
  }
  popular.forEach((s) => {
    state.serviceCache[s.id] = s;
  });

  const CATEGORY_CARDS = [
    { icon: '\u2702\ufe0f', value: 'barber_salon', label: 'Barber & Salon' },
    { icon: '\ud83c\udfe0', value: 'accommodation', label: 'Accommodation' },
    { icon: '\ud83d\udd27', value: 'artisan', label: 'Artisan & on-demand jobs' },
  ];

  const body = `
    <section class="hero">
      <h1>Welcome to naahere.com</h1>
      <p class="sub">Find and book trusted local salons, barbers, artisans, and accommodation
        providers across Nigeria, Kenya, Ghana, and South Africa. Book online, pay the provider directly \u2014
        cash, mobile money, or bank transfer.</p>
      <div class="hero-actions">
        <a class="btn-hero primary" href="#/browse">Browse services</a>
        <a class="btn-hero secondary" href="../auth/signup-provider.html">List your business</a>
      </div>
    </section>

    <section class="home-section">
      <h2>Browse by category</h2>
      <div class="category-grid">
        ${CATEGORY_CARDS.map(
          (c) => `
          <a class="category-card" href="#/browse?category=${c.value}">
            <span class="icon">${c.icon}</span>
            <span>${escapeHtml(c.label)}</span>
          </a>`,
        ).join('')}
      </div>
    </section>

    ${
      popular.length
        ? `<section class="home-section">
      <h2>Popular right now</h2>
      <div class="service-grid">
        ${popular
          .map(
            (s) => `
          <a class="service-card" href="#/service/${s.id}">
            <div class="name">${escapeHtml(s.name)}</div>
            <div class="tenant">${escapeHtml(s.tenantName)}${s.location ? ` \u00b7 ${escapeHtml(s.location.city)}, ${escapeHtml(s.location.countryCode)}` : ''}</div>
            <div class="price">${formatMoney(s.priceMinorUnits, s.currencyCode)}</div>
            <div class="meta">${escapeHtml(s.categoryName)}${s.durationMinutes ? ` \u00b7 ${s.durationMinutes} min` : ''}</div>
          </a>`,
          )
          .join('')}
      </div>
    </section>`
        : ''
    }

    <section class="home-section">
      <h2>Where we operate</h2>
      <div class="markets-row">
        <span>\ud83c\uddf3\ud83c\uddec Nigeria</span>
        <span>\ud83c\uddf0\ud83c\uddea Kenya</span>
        <span>\ud83c\uddec\ud83c\udded Ghana</span>
        <span>\ud83c\uddff\ud83c\udde6 South Africa</span>
      </div>
    </section>
  `;

  return { title: 'Naa here', body };
};

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
      const newHash = `#/browse${q ? `?${q}` : ''}`;
      if (window.location.hash === newHash) {
        renderRoute();
      } else {
        window.location.hash = newHash;
      }
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
      <div id="slot-picker">
        <p class="empty-state">Loading availability…</p>
      </div>
      <form id="book-form" novalidate>
        <div class="field">
          <label for="b-notes">Notes (optional)</label>
          <textarea id="b-notes" rows="2"></textarea>
        </div>
        <button class="primary" type="submit" id="book-btn" disabled>${isSignedIn() ? 'Select a time above' : 'Sign in to book'}</button>
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

    <div class="panel">
      <h2>Message this business</h2>
      <p style="color:var(--color-text-muted);font-size:0.85rem;margin-bottom:var(--space-2)">
        Ask a question before booking — a Customer can always start a conversation with a business.
      </p>
      <div id="dm-start-alert" class="alert error" role="alert" hidden></div>
      <form id="dm-start-form" novalidate>
        <div class="field">
          <textarea id="dm-start-body" rows="2" placeholder="Write a message…" required></textarea>
        </div>
        <button class="primary" type="submit" id="dm-start-btn">${isSignedIn() ? 'Send message' : 'Sign in to message'}</button>
      </form>
    </div>

    <div class="panel">
      <h2>Call this business</h2>
      <button class="primary" type="button" id="call-business-btn">${isSignedIn() ? 'Call' : 'Sign in to call'}</button>
    </div>
  `;

  let selectedSlot = null;

  const renderSlotPicker = async () => {
    const container = document.getElementById('slot-picker');
    let days;
    try {
      days = await Api.getAvailableSlots(service.id, 14);
    } catch (err) {
      container.innerHTML = `<p class="empty-state">Couldn't load availability: ${escapeHtml(err.message)}</p>`;
      return;
    }

    const daysWithSlots = days.filter((d) => d.slots.length > 0);
    if (daysWithSlots.length === 0) {
      container.innerHTML = '<p class="empty-state">No available times in the next two weeks — contact the business directly.</p>';
      return;
    }

    const dateLabel = (isoDate) => {
      const d = new Date(`${isoDate}T00:00:00`);
      return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    };
    const timeLabel = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

    let activeDate = daysWithSlots[0].date;

    const render = () => {
      const active = daysWithSlots.find((d) => d.date === activeDate) ?? daysWithSlots[0];
      container.innerHTML = `
        <div class="slot-day-row" style="display:flex;gap:var(--space-1);overflow-x:auto;padding-bottom:var(--space-1)">
          ${daysWithSlots
            .map(
              (d) => `<button type="button" class="btn-plain slot-day-btn" data-date="${d.date}" style="${
                d.date === active.date ? 'font-weight:700;border-color:var(--color-primary)' : ''
              }">${dateLabel(d.date)}</button>`,
            )
            .join('')}
        </div>
        <div class="slot-time-row" style="display:flex;flex-wrap:wrap;gap:var(--space-1);margin-top:var(--space-2)">
          ${active.slots
            .map(
              (s) => `<button type="button" class="btn-plain slot-time-btn" data-starts="${s.startsAt}" data-ends="${s.endsAt}" style="${
                selectedSlot && selectedSlot.startsAt === s.startsAt ? 'font-weight:700;border-color:var(--color-primary)' : ''
              }">${timeLabel(s.startsAt)}</button>`,
            )
            .join('')}
        </div>
      `;

      container.querySelectorAll('.slot-day-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          activeDate = btn.dataset.date;
          render();
        });
      });

      container.querySelectorAll('.slot-time-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          selectedSlot = { startsAt: btn.dataset.starts, endsAt: btn.dataset.ends };
          const bookBtn = document.getElementById('book-btn');
          bookBtn.disabled = false;
          bookBtn.textContent = isSignedIn() ? 'Book now' : 'Sign in to book';
          render();
        });
      });
    };

    render();
  };

  const after = () => {
    renderSlotPicker();

    document.getElementById('call-business-btn').addEventListener('click', () => {
      if (!isSignedIn()) {
        window.location.href = `login.html?next=${encodeURIComponent(`#/service/${serviceId}`)}`;
        return;
      }
      CallUI.startCall(() => Api.startCallWithBusiness(service.tenantId), service.tenantName);
    });

    document.getElementById('dm-start-form').addEventListener('submit', async (event) => {
      event.preventDefault();

      if (!isSignedIn()) {
        window.location.href = `login.html?next=${encodeURIComponent(`#/service/${serviceId}`)}`;
        return;
      }

      const alertBox = document.getElementById('dm-start-alert');
      const btn = document.getElementById('dm-start-btn');
      const text = document.getElementById('dm-start-body').value.trim();
      if (!text) return;
      alertBox.hidden = true;
      btn.disabled = true;
      btn.textContent = 'Sending…';

      try {
        const conversation = await Api.startConversation({
          tenantId: service.tenantId,
          body: text,
          contextType: 'general',
        });
        window.location.hash = `#/conversations/${conversation.id}`;
      } catch (err) {
        alertBox.textContent = err.message;
        alertBox.hidden = false;
        btn.disabled = false;
        btn.textContent = 'Send message';
      }
    });

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

      if (!selectedSlot) {
        alertBox.textContent = 'Choose an available time above first.';
        alertBox.hidden = false;
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Booking…';

      try {
        const idempotencyKey =
          window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

        await Api.createBooking(
          service.tenantId,
          {
            serviceId: service.id,
            startsAt: selectedSlot.startsAt,
            endsAt: selectedSlot.endsAt,
            notes: document.getElementById('b-notes').value.trim() || undefined,
          },
          idempotencyKey,
        );

        window.location.hash = '#/bookings';
      } catch (err) {
        alertBox.textContent = err.message;
        alertBox.hidden = false;
        btn.disabled = false;
        btn.textContent = 'Book now';
        // The slot may have just been taken by someone else -- refresh
        // the picker so the customer sees current availability rather
        // than retrying the same now-stale slot.
        selectedSlot = null;
        renderSlotPicker();
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
// Direct messaging (User Stories 2 & 3's chat half): conversations
// between a signed-in Customer and a Provider business. Real-time
// delivery rides RealtimeGateway/web/shared/realtime-ws.js -- see that
// file's header for why losing the connection never loses a message,
// only its instantness.
// ---------------------------------------------------------------------

const messagingState = { conn: null, conversationId: null };

function stopMessagingRealtime() {
  if (messagingState.conn) {
    messagingState.conn.close();
    messagingState.conn = null;
  }
  messagingState.conversationId = null;
}

function renderDirectMessageHtml(m) {
  const mine = m.senderIsCustomer;
  return `
    <div class="chat-message" data-message-id="${m.id}" style="margin-bottom:10px">
      <div style="font-size:0.78rem;color:var(--color-text-muted)">
        <strong>${mine ? 'You' : 'Business'}</strong> · ${formatDateTime(m.createdAt)}
      </div>
      <div>${escapeHtml(m.body)}</div>
    </div>`;
}

function callOtherPartyLabel(c, myUserId) {
  if (c.contextType === 'group') {
    return c.callerUserId === myUserId ? c.calleeName ?? 'Group member' : c.callerName;
  }
  // Customer <-> Provider: the business name is always the "other party" from a Customer's view.
  return c.tenantName ?? 'Business';
}

async function renderConversationList() {
  let conversations = [];
  let calls = [];
  let loadError = null;
  try {
    [conversations, calls] = await Promise.all([Api.myConversations(), Api.myCalls()]);
  } catch (err) {
    loadError = err.message;
  }

  const body = `
    <h1 class="page-title">Messages</h1>
    ${loadError ? `<div class="alert error" role="alert">${escapeHtml(loadError)}</div>` : ''}
    ${
      conversations.length === 0
        ? '<p class="empty-state">No conversations yet — message a business from its profile page.</p>'
        : `<div class="panel"><table class="data-table"><thead><tr><th>Business</th><th>Last message</th><th>When</th><th></th></tr></thead><tbody>
        ${conversations
          .map(
            (c) => `
          <tr>
            <td>${escapeHtml(c.tenantName)}${c.unreadCount > 0 ? ` <span class="badge status-pending">${c.unreadCount} new</span>` : ''}</td>
            <td>${escapeHtml(c.lastMessagePreview ?? '')}</td>
            <td>${formatDateTime(c.lastMessageAt)}</td>
            <td><a href="#/conversations/${c.id}">Open</a></td>
          </tr>`,
          )
          .join('')}
      </tbody></table></div>`
    }

    <h2 style="margin-top:var(--space-4)">Call history</h2>
    ${
      calls.length === 0
        ? '<p class="empty-state">No calls yet.</p>'
        : `<div class="panel"><table class="data-table"><thead><tr><th>With</th><th>Status</th><th>When</th></tr></thead><tbody>
        ${calls
          .map(
            (c) => `
          <tr>
            <td>${escapeHtml(callOtherPartyLabel(c, state.user?.id))}</td>
            <td>${badge(c.status)}</td>
            <td>${formatDateTime(c.startedAt)}</td>
          </tr>`,
          )
          .join('')}
      </tbody></table></div>`
    }
  `;

  return { title: 'Messages', body };
}

async function renderConversationDetail(conversationId) {
  let conversations, messages;
  try {
    [conversations, messages] = await Promise.all([Api.myConversations(), Api.listConversationMessages(conversationId)]);
  } catch (err) {
    return { title: 'Messages', body: `<div class="alert error" role="alert">${escapeHtml(err.message)}</div>` };
  }
  const conversation = conversations.find((c) => c.id === conversationId);

  const body = `
    <a class="back-link" href="#/conversations">&larr; Back to messages</a>
    <h1 class="page-title">${escapeHtml(conversation?.tenantName ?? 'Conversation')}</h1>
    <div class="panel">
      <div id="dm-messages" style="max-height:420px;overflow-y:auto;margin-bottom:var(--space-2)" data-empty="${messages.length === 0}">
        ${
          messages.length === 0
            ? '<p style="color:var(--color-text-muted);font-style:italic;margin:0">No messages yet — say hello.</p>'
            : messages.map(renderDirectMessageHtml).join('')
        }
      </div>
      <div id="dm-alert" class="alert error" role="alert" hidden></div>
      <form id="dm-form" novalidate>
        <div class="field">
          <textarea id="dm-body" rows="2" placeholder="Write a message…" required></textarea>
        </div>
        <button class="primary" type="submit" id="dm-send-btn">Send</button>
      </form>
      <div style="margin-top:var(--space-2)">
        <button class="small" type="button" id="dm-block-btn">Block this business</button>
        <button class="small" type="button" id="dm-unblock-btn">Unblock this business</button>
      </div>
    </div>
  `;

  const after = () => {
    const container = document.getElementById('dm-messages');
    container.scrollTop = container.scrollHeight;

    document.getElementById('dm-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const textarea = document.getElementById('dm-body');
      const alertBox = document.getElementById('dm-alert');
      const btn = document.getElementById('dm-send-btn');
      const text = textarea.value.trim();
      if (!text) return;
      alertBox.hidden = true;
      btn.disabled = true;
      try {
        const message = await Api.sendConversationMessage(conversationId, text);
        if (container.dataset.empty === 'true') container.innerHTML = '';
        container.dataset.empty = 'false';
        container.insertAdjacentHTML('beforeend', renderDirectMessageHtml(message));
        container.scrollTop = container.scrollHeight;
        textarea.value = '';
      } catch (err) {
        alertBox.textContent = err.message;
        alertBox.hidden = false;
      } finally {
        btn.disabled = false;
      }
    });

    document.getElementById('dm-block-btn').addEventListener('click', () =>
      runAction(document.getElementById('dm-block-btn'), () => Api.blockConversation(conversationId)),
    );
    document.getElementById('dm-unblock-btn').addEventListener('click', () =>
      runAction(document.getElementById('dm-unblock-btn'), () => Api.unblockConversation(conversationId)),
    );

    stopMessagingRealtime();
    messagingState.conversationId = conversationId;
    messagingState.conn = RealtimeWS.connect(getAccessToken);
    messagingState.conn.on('message:new', (payload) => {
      if (payload.conversationId !== messagingState.conversationId) return;
      const el = document.getElementById('dm-messages');
      if (!el || !document.body.contains(el)) return;
      if (el.dataset.empty === 'true') el.innerHTML = '';
      el.dataset.empty = 'false';
      el.insertAdjacentHTML('beforeend', renderDirectMessageHtml(payload.message));
      el.scrollTop = el.scrollHeight;
    });
  };

  return { title: conversation?.tenantName ?? 'Conversation', body, after };
}

views.conversations = async (params, routeParams) => {
  if (!isSignedIn()) {
    window.location.href = `login.html?next=${encodeURIComponent('#/conversations')}`;
    return { title: 'Messages', body: '' };
  }
  const conversationId = routeParams[0];
  if (conversationId) return renderConversationDetail(conversationId);
  return renderConversationList();
};

// ---------------------------------------------------------------------
// Customer invitations (User Story 6): landed on from an emailed link
// via login.html?next=%23%2Finvite%2FTOKEN or, for a brand-new
// account, straight after ../auth/verify.html -- see
// ../auth/signup-customer.js and ../auth/verify.js for the other half
// of this hand-off.
// ---------------------------------------------------------------------
views.invite = async (params, routeParams) => {
  const token = routeParams[0];
  if (!token) {
    return { title: 'Invitation', body: '<div class="alert error" role="alert">Missing invitation link.</div>' };
  }

  let preview;
  try {
    preview = await Api.previewInvitation(token);
  } catch (err) {
    return { title: 'Invitation', body: `<div class="alert error" role="alert">${escapeHtml(err.message)}</div>` };
  }

  const signedIn = isSignedIn();
  const isPending = preview.status === 'pending';

  const statusNote = !isPending
    ? `<div class="alert error" role="alert">This invitation is ${escapeHtml(preview.status)}${
        preview.status === 'expired' ? ' — ask the business to send a new one.' : '.'
      }</div>`
    : '';

  const actions = !isPending
    ? ''
    : signedIn
      ? `
      <div id="invite-alert" class="alert error" role="alert" hidden></div>
      <div class="actions-row">
        <button class="primary" id="invite-accept-btn" style="width:auto;padding:11px 16px">Accept invitation</button>
        <button class="btn-plain" id="invite-decline-btn">Decline</button>
      </div>`
      : `
      <p style="color:var(--color-text-muted);font-size:0.85rem">
        Sign in with <strong>${escapeHtml(preview.invitedEmail)}</strong> to accept, or create an account with that
        email if you're new here.
      </p>
      <div class="actions-row">
        <a href="login.html?next=${encodeURIComponent(`#/invite/${token}`)}"
           style="display:inline-block;padding:11px 16px;border-radius:8px;background:var(--color-primary);color:#fff;font-weight:600;text-decoration:none;font-size:0.9rem">Sign in to accept</a>
        <a class="btn-plain" style="display:inline-block;text-decoration:none"
           href="../auth/signup-customer.html?${new URLSearchParams({ email: preview.invitedEmail, invite: token }).toString()}">Create an account</a>
      </div>`;

  const body = `
    <div class="panel" style="max-width:480px;margin:0 auto">
      <h1 class="page-title">Invitation from ${escapeHtml(preview.businessName)}</h1>
      <p style="color:var(--color-text-muted)">
        ${escapeHtml(preview.businessName)} invited <strong>${escapeHtml(preview.invitedEmail)}</strong> to connect on Naa here.
      </p>
      ${statusNote}
      ${actions}
    </div>
  `;

  const after = () => {
    const acceptBtn = document.getElementById('invite-accept-btn');
    const declineBtn = document.getElementById('invite-decline-btn');
    const alertBox = document.getElementById('invite-alert');
    if (acceptBtn) {
      acceptBtn.addEventListener('click', async () => {
        acceptBtn.disabled = true;
        if (declineBtn) declineBtn.disabled = true;
        if (alertBox) alertBox.hidden = true;
        try {
          await Api.acceptInvitation(token);
          window.location.hash = '#/bookings';
        } catch (err) {
          if (alertBox) {
            alertBox.textContent = err.message;
            alertBox.hidden = false;
          }
          acceptBtn.disabled = false;
          if (declineBtn) declineBtn.disabled = false;
        }
      });
    }
    if (declineBtn) {
      declineBtn.addEventListener('click', async () => {
        if (!window.confirm('Decline this invitation?')) return;
        acceptBtn.disabled = true;
        declineBtn.disabled = true;
        if (alertBox) alertBox.hidden = true;
        try {
          await Api.declineInvitation(token);
          renderRoute();
        } catch (err) {
          if (alertBox) {
            alertBox.textContent = err.message;
            alertBox.hidden = false;
          }
          acceptBtn.disabled = false;
          declineBtn.disabled = false;
        }
      });
    }
  };

  return { title: 'Invitation', body, after };
};

// ---------------------------------------------------------------------
// Help: searchable help center (shared renderer, see web/shared/help-ui.js).
// ---------------------------------------------------------------------
views.help = async (params, routeParams) => HelpUI.render(CUSTOMER_HELP_TOPICS, routeParams, { basePath: '#/help' });

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
  const section = segments[0] || 'home';
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
      // Send the user back to Home after signing out, rather than leaving
      // them on a page (My bookings, Messages, etc.) that assumed they
      // were signed in. Same same-hash fallback as the search fix: if
      // they were already on Home, the hash won't change on its own, so
      // re-render directly instead of waiting on a hashchange that will
      // never fire.
      if (window.location.hash === '#/home') {
        renderRoute();
      } else {
        window.location.hash = '#/home';
      }
    };
  } else {
    userNameEl.textContent = '';
    authBtn.textContent = 'Sign in';
    authBtn.onclick = () => {
      window.location.href = `login.html?next=${encodeURIComponent(window.location.hash || '#/home')}`;
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

function initNavToggle() {
  const toggle = document.getElementById('nav-toggle');
  const nav = document.getElementById('customer-nav');
  if (!toggle || !nav) return;
  const closeNav = () => {
    nav.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
  };
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  nav.addEventListener('click', (e) => {
    if (e.target.tagName === 'A') closeNav();
  });
  document.addEventListener('click', (e) => {
    if (!nav.contains(e.target) && !toggle.contains(e.target)) closeNav();
  });
  window.addEventListener('hashchange', closeNav);
}

function init() {
  renderAuthArea();
  initNavToggle();
  if (isSignedIn()) {
    CallUI.init({
      getAccessToken,
      getCurrentUserId: () => state.user?.id,
      api: {
        accept: Api.acceptCall,
        decline: Api.declineCall,
        end: Api.endCall,
        timeout: Api.timeoutCall,
      },
    });
  }
  window.addEventListener('hashchange', () => {
    stopMessagingRealtime();
    renderRoute();
  });
  renderRoute();
}

init();
