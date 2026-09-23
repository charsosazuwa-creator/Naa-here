/**
 * Shared marketplace-listing UI (User Story 2), used by BOTH
 * web/provider/app.js ("My Listings" tab) and web/customer/app.js
 * ("My Listings" + the public "Marketplace" browse/detail pages) —
 * a listing is owned by a user, not a tenant, so the exact same
 * management screen makes sense from either portal (see
 * db/migrations/012_marketplace_listings.sql).
 *
 * Deliberately self-contained (its own escapeHtml/badge/formatMoney,
 * not the host app's) so load order relative to api.js/app.js doesn't
 * matter — every function here takes the host app's `Api` object
 * (and, where needed, its `runAction` helper) as a parameter instead
 * of assuming a particular global shape beyond that.
 */
(function () {
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const CURRENCY_SYMBOLS = { NGN: '₦', KES: 'KSh ', GHS: 'GH₵', ZAR: 'R', RWF: 'RWF ' };

  function formatMoney(amountMinorUnits, currencyCode) {
    if (amountMinorUnits === undefined || amountMinorUnits === null) return null;
    const amount = (Number(amountMinorUnits) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const code = currencyCode ?? '';
    const symbol = CURRENCY_SYMBOLS[code];
    if (symbol) return `${symbol}${amount}`;
    return `${amount} ${code}`.trim();
  }

  function priceLabel(listing) {
    if (listing.priceType === 'contact') return 'Contact for price';
    if (listing.priceType === 'negotiable') return 'Negotiable';
    const amount = formatMoney(listing.priceMinorUnits, listing.currencyCode);
    if (!amount) return '—';
    return listing.priceType === 'starting_from' ? `From ${amount}` : amount;
  }

  function badge(status) {
    return `<span class="badge status-${escapeHtml(status)}">${escapeHtml(String(status).replace(/_/g, ' '))}</span>`;
  }

  const LISTING_TYPE_LABELS = { product: 'Product', service: 'Service', invention: 'Invention' };

  const CATEGORY_SUGGESTIONS = {
    product: ['Electronics', 'Fashion & Apparel', 'Home & Furniture', 'Beauty & Personal Care', 'Food & Groceries'],
    service: ['Cleaning', 'Repairs & Maintenance', 'Tutoring', 'Event Services', 'Transport'],
    invention: ['Technology', 'Agriculture', 'Health', 'Household'],
  };

  const COUNTRY_LABELS = { NG: 'Nigeria', KE: 'Kenya', GH: 'Ghana', ZA: 'South Africa' };

  // -- Owner-side: create/edit form, "My Listings" -----------------------

  function listingFormHtml(existing) {
    const l = existing || {};
    return `
      <div class="listing-form-alert alert error" role="alert" hidden></div>
      <form class="listing-form" novalidate data-listing-id="${l.id ?? ''}">
        <div class="field">
          <label>Listing type</label>
          <select class="lf-type tenant-select">
            <option value="product" ${l.listingType === 'product' ? 'selected' : ''}>Product</option>
            <option value="service" ${l.listingType === 'service' ? 'selected' : ''}>Service</option>
            <option value="invention" ${l.listingType === 'invention' ? 'selected' : ''}>Invention</option>
          </select>
        </div>
        <div class="field"><label>Title</label><input class="lf-title" required value="${escapeHtml(l.title ?? '')}" /></div>
        <div class="field">
          <label>Category</label>
          <input class="lf-category" list="lf-category-list" required value="${escapeHtml(l.category ?? '')}" />
          <datalist class="lf-category-list"></datalist>
        </div>
        <div class="field"><label>Description</label><textarea class="lf-description" rows="3">${escapeHtml(l.description ?? '')}</textarea></div>
        <div class="field">
          <label>Pricing</label>
          <select class="lf-price-type tenant-select">
            <option value="fixed" ${!l.priceType || l.priceType === 'fixed' ? 'selected' : ''}>Fixed price</option>
            <option value="starting_from" ${l.priceType === 'starting_from' ? 'selected' : ''}>Starting from</option>
            <option value="negotiable" ${l.priceType === 'negotiable' ? 'selected' : ''}>Negotiable</option>
            <option value="contact" ${l.priceType === 'contact' ? 'selected' : ''}>Contact for price</option>
          </select>
        </div>
        <div class="field inline-form">
          <div><label>Price (minor units, e.g. 500000 = 5,000.00)</label><input class="lf-price" type="number" min="0" value="${l.priceMinorUnits ?? ''}" /></div>
          <div><label>Currency</label>
            <select class="lf-currency tenant-select">
              <option ${l.currencyCode === 'NGN' || !l.currencyCode ? 'selected' : ''}>NGN</option>
              <option ${l.currencyCode === 'KES' ? 'selected' : ''}>KES</option>
              <option ${l.currencyCode === 'GHS' ? 'selected' : ''}>GHS</option>
              <option ${l.currencyCode === 'ZAR' ? 'selected' : ''}>ZAR</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label>Country</label>
          <select class="lf-country tenant-select">
            <option value="">—</option>
            <option value="NG" ${l.countryCode === 'NG' ? 'selected' : ''}>Nigeria</option>
            <option value="KE" ${l.countryCode === 'KE' ? 'selected' : ''}>Kenya</option>
            <option value="GH" ${l.countryCode === 'GH' ? 'selected' : ''}>Ghana</option>
            <option value="ZA" ${l.countryCode === 'ZA' ? 'selected' : ''}>South Africa</option>
          </select>
        </div>
        <div class="field"><label>Location / service area</label><input class="lf-location" value="${escapeHtml(l.locationText ?? '')}" placeholder="e.g. Lekki, Lagos" /></div>
        <div class="field lf-geo-status" style="color:var(--color-text-muted);font-size:0.78rem"></div>
        <input class="lf-lat" type="hidden" value="${l.latitude ?? ''}" />
        <input class="lf-lng" type="hidden" value="${l.longitude ?? ''}" />
        <button type="button" class="small lf-use-location">
          ${l.latitude != null ? 'Update map pin to my current location' : 'Pin my current location (helps customers find you nearby)'}
        </button>
        <div class="field">
          <label>Contact method</label>
          <select class="lf-contact-method tenant-select">
            <option value="phone" ${!l.contactMethod || l.contactMethod === 'phone' ? 'selected' : ''}>Phone</option>
            <option value="whatsapp" ${l.contactMethod === 'whatsapp' ? 'selected' : ''}>WhatsApp</option>
            <option value="email" ${l.contactMethod === 'email' ? 'selected' : ''}>Email</option>
          </select>
        </div>
        <div class="field"><label>Contact details</label><input class="lf-contact-value" required value="${escapeHtml(l.contactValue ?? '')}" placeholder="Shown publicly on this listing only" /></div>
        <button class="primary" type="submit">${existing ? 'Save changes' : 'Create listing (draft)'}</button>
      </form>
    `;
  }

  function wireListingForm(container, Api, onSaved) {
    const form = container.querySelector('.listing-form');
    const typeSelect = container.querySelector('.lf-type');
    const categoryList = container.querySelector('.lf-category-list');

    function refreshCategoryOptions() {
      categoryList.innerHTML = (CATEGORY_SUGGESTIONS[typeSelect.value] || [])
        .map((c) => `<option value="${escapeHtml(c)}"></option>`)
        .join('');
    }
    refreshCategoryOptions();
    typeSelect.addEventListener('change', refreshCategoryOptions);

    const alertBox = container.querySelector('.listing-form-alert');

    // US-004/US-009: an optional map pin, filled in via the browser's
    // own geolocation rather than asking the owner to type coordinates.
    const geoStatus = container.querySelector('.lf-geo-status');
    const useLocationBtn = container.querySelector('.lf-use-location');
    useLocationBtn.addEventListener('click', () => {
      if (!navigator.geolocation) {
        geoStatus.textContent = 'Location is not available in this browser.';
        return;
      }
      geoStatus.textContent = 'Getting your location…';
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          container.querySelector('.lf-lat').value = pos.coords.latitude;
          container.querySelector('.lf-lng').value = pos.coords.longitude;
          geoStatus.textContent = `Pinned at ${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}.`;
        },
        () => {
          geoStatus.textContent = 'Could not get your location — check your browser/device permissions.';
        },
      );
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      alertBox.hidden = true;

      const priceType = container.querySelector('.lf-price-type').value;
      const priceRaw = container.querySelector('.lf-price').value;
      const needsPrice = priceType === 'fixed' || priceType === 'starting_from';

      const payload = {
        listingType: typeSelect.value,
        title: container.querySelector('.lf-title').value.trim(),
        category: container.querySelector('.lf-category').value.trim(),
        description: container.querySelector('.lf-description').value.trim() || undefined,
        priceType,
        priceMinorUnits: needsPrice && priceRaw !== '' ? Number(priceRaw) : undefined,
        currencyCode: needsPrice ? container.querySelector('.lf-currency').value : undefined,
        countryCode: container.querySelector('.lf-country').value || undefined,
        locationText: container.querySelector('.lf-location').value.trim() || undefined,
        latitude: container.querySelector('.lf-lat').value !== '' ? Number(container.querySelector('.lf-lat').value) : undefined,
        longitude: container.querySelector('.lf-lng').value !== '' ? Number(container.querySelector('.lf-lng').value) : undefined,
        contactMethod: container.querySelector('.lf-contact-method').value,
        contactValue: container.querySelector('.lf-contact-value').value.trim(),
      };

      const listingId = form.dataset.listingId;
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      try {
        if (listingId) {
          await Api.updateListing(listingId, payload);
        } else {
          await Api.createListing(payload);
        }
        onSaved();
      } catch (err) {
        alertBox.textContent = err.message;
        alertBox.hidden = false;
        submitBtn.disabled = false;
      }
    });
  }

  function imageGalleryHtml(listing) {
    const thumbs = listing.images.length
      ? listing.images
          .map(
            (img) => `
        <div class="listing-image-thumb">
          <img src="${escapeHtml(img.url)}" alt="" />
          <button type="button" class="small danger" data-image="${img.id}">Remove</button>
        </div>`,
          )
          .join('')
      : '<p class="empty-state">No images yet.</p>';

    return `
      <div class="listing-images">${thumbs}</div>
      <div class="image-upload-alert alert error" role="alert" hidden></div>
      <form class="image-upload-form inline-form" novalidate>
        <input type="file" accept="image/jpeg,image/png,image/webp" required />
        <button class="small primary" type="submit">Add image</button>
      </form>
      <p style="color:var(--color-text-muted);font-size:0.78rem;margin-top:var(--space-2)">
        JPEG, PNG or WebP, up to 5MB, up to 6 images per listing.
      </p>
    `;
  }

  function wireImagePanel(container, Api, listing, refresh) {
    container.querySelectorAll('[data-image]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await Api.deleteListingImage(listing.id, btn.dataset.image);
          refresh();
        } catch (err) {
          window.alert(err.message);
          btn.disabled = false;
        }
      });
    });

    const uploadForm = container.querySelector('.image-upload-form');
    const alertBox = container.querySelector('.image-upload-alert');
    uploadForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      alertBox.hidden = true;
      const file = uploadForm.querySelector('input[type="file"]').files[0];
      if (!file) return;
      const submitBtn = uploadForm.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Uploading…';
      try {
        await Api.uploadListingImage(listing.id, file);
        refresh();
      } catch (err) {
        alertBox.textContent = err.message;
        alertBox.hidden = false;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Add image';
      }
    });
  }

  async function renderMyListings(Api, runAction) {
    let listings;
    try {
      listings = await Api.listMyListings();
    } catch (err) {
      return { title: 'My Listings', body: `<div class="alert error" role="alert">${escapeHtml(err.message)}</div>` };
    }

    const rows = listings.length
      ? listings
          .map(
            (l) => `
      <tr>
        <td>${escapeHtml(l.title)}</td>
        <td>${LISTING_TYPE_LABELS[l.listingType] ?? escapeHtml(l.listingType)}</td>
        <td>${priceLabel(l)}</td>
        <td>${badge(l.status)}${
              l.status === 'rejected' && l.rejectionReason
                ? `<div style="color:var(--color-error);font-size:0.78rem;margin-top:4px">${escapeHtml(l.rejectionReason)}</div>`
                : ''
            }</td>
        <td>
          <div class="actions-row">
            <button class="small" data-action="edit" data-id="${l.id}">Edit</button>
            <button class="small" data-action="images" data-id="${l.id}">Images (${l.images.length})</button>
            ${l.status === 'draft' || l.status === 'rejected' ? `<button class="small primary" data-action="submit" data-id="${l.id}">Submit for review</button>` : ''}
            ${l.status === 'published' ? `<button class="small" data-action="pause" data-id="${l.id}">Pause</button>` : ''}
            ${l.status === 'paused' ? `<button class="small primary" data-action="resume" data-id="${l.id}">Resume</button>` : ''}
            ${l.status !== 'archived' ? `<button class="small danger" data-action="archive" data-id="${l.id}">Archive</button>` : ''}
          </div>
        </td>
      </tr>`,
          )
          .join('')
      : '<tr class="empty-row"><td colspan="5">No listings yet — post one below.</td></tr>';

    const body = `
      <h1 class="page-title">My Listings</h1>
      <p style="color:var(--color-text-muted);font-size:0.85rem">
        Products, services, and inventions you're advertising on the marketplace. A new listing starts
        as a draft; Submit for review sends it to a platform admin, and it becomes publicly visible
        once approved.
      </p>
      <div class="panel">
        <table class="data-table">
          <thead><tr><th>Title</th><th>Type</th><th>Price</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div id="listing-detail-panel"></div>
      <div class="panel listing-create-panel">
        <h2>Post a new listing</h2>
        ${listingFormHtml(null)}
      </div>
    `;

    const after = () => {
      const createPanel = document.querySelector('.listing-create-panel');
      wireListingForm(createPanel, Api, () => renderRoute());

      const detailPanel = document.getElementById('listing-detail-panel');

      document.querySelectorAll('[data-action="edit"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const listing = listings.find((l) => l.id === btn.dataset.id);
          detailPanel.innerHTML = `<div class="panel"><h2>Edit listing</h2>${listingFormHtml(listing)}</div>`;
          wireListingForm(detailPanel, Api, () => renderRoute());
          detailPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
      });

      document.querySelectorAll('[data-action="images"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const listing = listings.find((l) => l.id === btn.dataset.id);
          detailPanel.innerHTML = `<div class="panel"><h2>Images — ${escapeHtml(listing.title)}</h2>${imageGalleryHtml(listing)}</div>`;
          wireImagePanel(detailPanel, Api, listing, () => renderRoute());
          detailPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
      });

      document.querySelectorAll('[data-action="submit"]').forEach((btn) =>
        btn.addEventListener('click', () => runAction(btn, () => Api.submitListing(btn.dataset.id))),
      );
      document.querySelectorAll('[data-action="pause"]').forEach((btn) =>
        btn.addEventListener('click', () => runAction(btn, () => Api.pauseListing(btn.dataset.id))),
      );
      document.querySelectorAll('[data-action="resume"]').forEach((btn) =>
        btn.addEventListener('click', () => runAction(btn, () => Api.resumeListing(btn.dataset.id))),
      );
      document.querySelectorAll('[data-action="archive"]').forEach((btn) =>
        btn.addEventListener('click', () => {
          if (!window.confirm('Archive this listing? It will no longer be publicly visible.')) return;
          runAction(btn, () => Api.archiveListing(btn.dataset.id));
        }),
      );
    };

    return { title: 'My Listings', body, after };
  }

  // -- Public: Marketplace browse + detail (customer app only) -----------

  function listingCardHtml(l, hashBase) {
    const distance = l.distanceKm !== undefined ? `<div class="meta">${l.distanceKm} km away</div>` : '';
    return `
      <a class="service-card" href="#/${hashBase}/${l.id}">
        ${l.images[0] ? `<img src="${escapeHtml(l.images[0].url)}" alt="" style="width:100%;border-radius:8px;margin-bottom:var(--space-2);aspect-ratio:4/3;object-fit:cover" />` : ''}
        <div class="name">${escapeHtml(l.title)}</div>
        <div class="tenant">${LISTING_TYPE_LABELS[l.listingType] ?? ''} · ${escapeHtml(l.category)}</div>
        <div class="price">${priceLabel(l)}</div>
        <div class="meta">${escapeHtml(l.locationText || COUNTRY_LABELS[l.countryCode] || '')}</div>
        ${distance}
      </a>`;
  }

  function listingGridHtml(listings, hashBase, emptyMessage) {
    if (listings.length === 0) {
      return `<p class="empty-state">${escapeHtml(emptyMessage)}</p>`;
    }
    return `<div class="service-grid">${listings.map((l) => listingCardHtml(l, hashBase)).join('')}</div>`;
  }

  // US-006/US-007: natural-language box. Interpreted criteria are shown
  // back to the customer (AC "must show the interpreted... criteria")
  // with a plain-English summary and a way to fall back to the regular
  // filter form below if the interpretation isn't right (AC "the
  // customer must be able to correct the interpreted criteria").
  function aiSearchBoxHtml() {
    return `
      <div class="panel ai-search-panel">
        <h2>Describe what you need</h2>
        <p style="color:var(--color-text-muted);font-size:0.85rem">
          e.g. "Find a barber near me who's open now" or "I need an electrician urgently" — we'll turn
          this into a search you can check before we run it.
        </p>
        <form class="ai-search-form inline-form" novalidate>
          <input class="ai-search-input" placeholder="Find a barber near me who's open now…" style="flex:1" />
          <button class="small primary" type="submit">Ask</button>
        </form>
        <div class="ai-search-result" hidden></div>
      </div>
    `;
  }

  function wireAiSearchBox(container, Api, filters, hashBase) {
    const form = container.querySelector('.ai-search-form');
    const resultBox = container.querySelector('.ai-search-result');

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const query = container.querySelector('.ai-search-input').value.trim();
      if (!query) return;
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Thinking…';
      resultBox.hidden = false;
      resultBox.innerHTML = '<p class="empty-state">Interpreting your request…</p>';

      try {
        const response = await Api.aiSearch({
          query,
          lat: filters.lat ? Number(filters.lat) : undefined,
          lng: filters.lng ? Number(filters.lng) : undefined,
          radiusKm: filters.radiusKm ? Number(filters.radiusKm) : undefined,
        });

        const interpreted = response.interpreted;
        const summaryParts = interpreted
          ? [
              interpreted.listingType ? LISTING_TYPE_LABELS[interpreted.listingType] : null,
              interpreted.category,
              interpreted.location ? `near "${interpreted.location}"` : null,
              interpreted.urgent ? 'marked urgent' : null,
            ].filter(Boolean)
          : [];

        const summary = !response.available
          ? '<p style="color:var(--color-text-muted);font-size:0.85rem">AI search isn\'t set up yet — showing a plain keyword search instead.</p>'
          : summaryParts.length
            ? `<p style="font-size:0.85rem">We understood this as: <strong>${escapeHtml(summaryParts.join(', '))}</strong>. Not quite right? Use the filters below instead.</p>`
            : '<p style="color:var(--color-text-muted);font-size:0.85rem">We couldn\'t pick out specific filters from that — showing a plain keyword search instead.</p>';

        resultBox.innerHTML = `
          ${summary}
          ${listingGridHtml(response.results, hashBase, 'No listings matched — try rephrasing, or use the filters below.')}
        `;
      } catch (err) {
        resultBox.innerHTML = `<div class="alert error" role="alert">${escapeHtml(err.message)}</div>`;
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Ask';
      }
    });
  }

  // US-005: a clearly separate, clearly labeled section — never merged
  // into the platform-listing grid above (AC "a Google result must not
  // automatically become a verified platform provider").
  function googleSectionHtml(available, results) {
    if (!available) {
      return `
        <div class="panel" style="margin-top:var(--space-4)">
          <h2>Nearby on Google</h2>
          <p class="empty-state">Google search isn't set up yet.</p>
        </div>`;
    }
    if (results.length === 0) {
      return '';
    }
    return `
      <div class="panel" style="margin-top:var(--space-4)">
        <h2>Also nearby on Google</h2>
        <p style="color:var(--color-text-muted);font-size:0.78rem">
          Found via Google — these aren't verified platform providers.
        </p>
        <div class="service-grid">
          ${results
            .map(
              (r) => `
          <div class="service-card">
            <span class="badge status-paused">Google</span>
            <div class="name">${escapeHtml(r.name)}</div>
            ${r.category ? `<div class="tenant">${escapeHtml(r.category)}</div>` : ''}
            ${r.address ? `<div class="meta">${escapeHtml(r.address)}</div>` : ''}
            ${r.rating ? `<div class="meta">Rating: ${r.rating}</div>` : ''}
            ${r.openNow === true ? '<div class="meta" style="color:var(--color-success, #1a7f37)">Open now</div>' : ''}
          </div>`,
            )
            .join('')}
        </div>
      </div>`;
  }

  // US-009: a Leaflet map (no API key needed — OpenStreetMap tiles),
  // loaded from index.html; if the CDN script didn't load for any
  // reason, `window.L` is simply absent and this falls back to a
  // message rather than breaking the page (AC "a list view must remain
  // available if the map cannot load" — the list view above the toggle
  // is always rendered regardless).
  function renderMap(containerId, listings, hashBase) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!window.L) {
      el.innerHTML = '<p class="empty-state">The map couldn\'t load — use the list view above instead.</p>';
      return;
    }
    const withCoords = listings.filter((l) => l.latitude != null && l.longitude != null);
    if (withCoords.length === 0) {
      el.innerHTML = '<p class="empty-state">None of these listings have a map pin yet.</p>';
      return;
    }
    const map = window.L.map(el).setView([withCoords[0].latitude, withCoords[0].longitude], 11);
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);
    const markers = withCoords.map((l) => {
      const marker = window.L.marker([l.latitude, l.longitude]).addTo(map);
      marker.bindPopup(`<strong>${escapeHtml(l.title)}</strong><br>${escapeHtml(priceLabel(l))}<br><a href="#/${hashBase}/${l.id}">View listing</a>`);
      return marker;
    });
    if (markers.length > 1) {
      map.fitBounds(window.L.featureGroup(markers).getBounds().pad(0.2));
    }
  }

  async function renderMarketBrowse(Api, filters, hashBase) {
    const query = new URLSearchParams(
      Object.entries({
        listingType: filters.listingType,
        countryCode: filters.countryCode,
        location: filters.location,
        search: filters.search,
        sort: filters.sort,
        minPrice: filters.minPrice,
        maxPrice: filters.maxPrice,
        lat: filters.lat,
        lng: filters.lng,
        radiusKm: filters.radiusKm,
      }).filter(([, v]) => v),
    ).toString();

    let listings = [];
    let loadError = null;
    try {
      listings = await Api.searchListings(query);
    } catch (err) {
      loadError = err.message;
    }

    let googleAvailable = false;
    let googleResults = [];
    try {
      const g = await Api.searchGoogle(query);
      googleAvailable = g.available;
      googleResults = g.results || [];
    } catch {
      // Non-fatal — the platform-listing search above is what matters;
      // the Google section just shows as unavailable.
    }

    const body = `
      ${aiSearchBoxHtml()}
      <h1 class="page-title">Marketplace</h1>
      <form class="marketplace-filters filters-bar" novalidate>
        <div class="field">
          <label>Search</label>
          <input class="mf-search" placeholder="What are you looking for?" value="${escapeHtml(filters.search || '')}" />
        </div>
        <div class="field">
          <label>Type</label>
          <select class="mf-type tenant-select">
            <option value="" ${!filters.listingType ? 'selected' : ''}>All types</option>
            <option value="product" ${filters.listingType === 'product' ? 'selected' : ''}>Products</option>
            <option value="service" ${filters.listingType === 'service' ? 'selected' : ''}>Services</option>
            <option value="invention" ${filters.listingType === 'invention' ? 'selected' : ''}>Inventions</option>
          </select>
        </div>
        <div class="field">
          <label>Country</label>
          <select class="mf-country tenant-select">
            <option value="" ${!filters.countryCode ? 'selected' : ''}>All countries</option>
            ${Object.entries(COUNTRY_LABELS)
              .map(([code, label]) => `<option value="${code}" ${filters.countryCode === code ? 'selected' : ''}>${label}</option>`)
              .join('')}
          </select>
        </div>
        <div class="field">
          <label>Location</label>
          <input class="mf-location" placeholder="e.g. Lagos" value="${escapeHtml(filters.location || '')}" />
        </div>
        <div class="field">
          <label>Min price</label>
          <input class="mf-min-price" type="number" min="0" placeholder="0" value="${escapeHtml(filters.minPrice || '')}" />
        </div>
        <div class="field">
          <label>Max price</label>
          <input class="mf-max-price" type="number" min="0" placeholder="Any" value="${escapeHtml(filters.maxPrice || '')}" />
        </div>
        <div class="field">
          <label>Sort by</label>
          <select class="mf-sort tenant-select">
            <option value="" ${!filters.sort ? 'selected' : ''}>Relevance</option>
            <option value="newest" ${filters.sort === 'newest' ? 'selected' : ''}>Newest</option>
            <option value="price_asc" ${filters.sort === 'price_asc' ? 'selected' : ''}>Price: low to high</option>
            <option value="price_desc" ${filters.sort === 'price_desc' ? 'selected' : ''}>Price: high to low</option>
            <option value="distance" ${filters.sort === 'distance' ? 'selected' : ''}>Distance</option>
          </select>
        </div>
        <button type="button" class="small mf-near-me">${filters.lat ? 'Update my location' : 'Search near me'}</button>
        <button class="small primary" type="submit">Search</button>
      </form>
      ${filters.lat ? '<p style="color:var(--color-text-muted);font-size:0.78rem">Showing results near your current location.</p>' : ''}

      ${loadError ? `<div class="alert error" role="alert">${escapeHtml(loadError)}</div>` : ''}

      <div class="market-view-toggle" style="margin:var(--space-3) 0">
        <button type="button" class="small mv-list active" data-view="list">List</button>
        <button type="button" class="small mv-map" data-view="map">Map</button>
      </div>
      <div class="market-list-view">
        ${!loadError ? listingGridHtml(listings, hashBase, 'No listings match these filters yet. Try broadening your search.') : ''}
      </div>
      <div class="market-map-view" style="display:none">
        <div id="market-map" style="height:420px;border-radius:8px;overflow:hidden"></div>
      </div>

      ${googleSectionHtml(googleAvailable, googleResults)}
    `;

    const after = () => {
      wireAiSearchBox(document.querySelector('.ai-search-panel'), Api, filters, hashBase);

      document.querySelector('.marketplace-filters').addEventListener('submit', (event) => {
        event.preventDefault();
        const q = new URLSearchParams(
          Object.entries({
            type: document.querySelector('.mf-type').value,
            country: document.querySelector('.mf-country').value,
            location: document.querySelector('.mf-location').value.trim(),
            q: document.querySelector('.mf-search').value.trim(),
            sort: document.querySelector('.mf-sort').value,
            minPrice: document.querySelector('.mf-min-price').value,
            maxPrice: document.querySelector('.mf-max-price').value,
            lat: filters.lat || '',
            lng: filters.lng || '',
            radius: filters.radiusKm || '',
          }).filter(([, v]) => v),
        ).toString();
        const newHash = `#/${hashBase}${q ? `?${q}` : ''}`;
        if (window.location.hash === newHash) {
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        } else {
          window.location.hash = newHash;
        }
      });

      document.querySelector('.mf-near-me').addEventListener('click', () => {
        if (!navigator.geolocation) {
          window.alert('Location is not available in this browser.');
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const q = new URLSearchParams(
              Object.entries({
                type: filters.listingType || '',
                country: filters.countryCode || '',
                location: filters.location || '',
                q: filters.search || '',
                sort: filters.sort || 'distance',
                minPrice: filters.minPrice || '',
                maxPrice: filters.maxPrice || '',
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                radius: filters.radiusKm || '',
              }).filter(([, v]) => v),
            ).toString();
            const newHash = `#/${hashBase}?${q}`;
            if (window.location.hash === newHash) {
              window.dispatchEvent(new HashChangeEvent('hashchange'));
            } else {
              window.location.hash = newHash;
            }
          },
          () => window.alert('Could not get your location — check your browser/device permissions.'),
        );
      });

      let mapInitialized = false;
      document.querySelectorAll('.market-view-toggle button').forEach((btn) => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.market-view-toggle button').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          const showMap = btn.dataset.view === 'map';
          document.querySelector('.market-list-view').style.display = showMap ? 'none' : '';
          document.querySelector('.market-map-view').style.display = showMap ? '' : 'none';
          if (showMap && !mapInitialized) {
            mapInitialized = true;
            renderMap('market-map', listings, hashBase);
          }
        });
      });
    };

    return { title: 'Marketplace', body, after };
  }

  async function renderMarketDetail(Api, listingId, backHash) {
    let listing;
    try {
      listing = await Api.getPublicListing(listingId);
    } catch (err) {
      return { title: 'Listing', body: `<div class="alert error" role="alert">${escapeHtml(err.message)}</div>` };
    }

    const contactLabel = { phone: 'Phone', whatsapp: 'WhatsApp', email: 'Email' }[listing.contactMethod] || 'Contact';

    const body = `
      <a class="back-link" href="#/${backHash}">&larr; Back to marketplace</a>
      <h1 class="page-title">${escapeHtml(listing.title)}</h1>
      <div class="panel">
        ${
          listing.images.length
            ? `<div class="listing-images">${listing.images
                .map((img) => `<div class="listing-image-thumb"><img src="${escapeHtml(img.url)}" alt="" /></div>`)
                .join('')}</div>`
            : ''
        }
        <div class="tenant" style="margin:var(--space-2) 0">${LISTING_TYPE_LABELS[listing.listingType] ?? ''} · ${escapeHtml(listing.category)}</div>
        <p>${escapeHtml(listing.description ?? '')}</p>
        <div class="price" style="font-size:1.1rem;margin:var(--space-2) 0">${priceLabel(listing)}</div>
        ${listing.locationText ? `<p style="color:var(--color-text-muted)">${escapeHtml(listing.locationText)}${listing.countryCode ? `, ${COUNTRY_LABELS[listing.countryCode] ?? escapeHtml(listing.countryCode)}` : ''}</p>` : ''}
      </div>
      <div class="panel">
        <h2>Contact</h2>
        <p><strong>${contactLabel}:</strong> ${escapeHtml(listing.contactValue)}</p>
      </div>
    `;

    return { title: listing.title, body };
  }

  window.ListingUI = { renderMyListings, renderMarketBrowse, renderMarketDetail };
})();
