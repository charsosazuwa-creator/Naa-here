/**
 * Live location sharing between the two parties on an in-progress
 * booking ("Real-Time Location Tracking" build-scope doc) -- the
 * client half of api/src/modules/tracking/tracking.service.ts.
 * Shared by the customer and provider portals; each booking row's
 * "Track" button calls LiveTracking.open(panelEl, opts) to render a
 * self-contained panel into an existing container (the same pattern
 * DisputeUI.wireDisputeForm already uses for its own panel).
 *
 * Design:
 *  - Positions are pushed over the existing RealtimeGateway WebSocket
 *    (web/shared/realtime-ws.js) as a 'location:update' event, never
 *    over REST and never persisted -- see the server-side service's
 *    header for why. A page reload simply starts a fresh live view;
 *    there is no history to restore.
 *  - Sharing is opt-in per person: nothing reads or sends a position
 *    until that person clicks "Share my location" and grants the
 *    browser permission prompt themselves.
 *  - The server independently stops relaying the moment the booking
 *    leaves 'in_progress' (checked on every relayed message), so
 *    tracking ends itself even if this view is left open.
 */
(function () {
  const SEND_THROTTLE_MS = 6000;
  const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  const TILE_ATTRIBUTION = '&copy; OpenStreetMap contributors';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function panelHtml() {
    return `
      <div class="panel tracking-panel">
        <h2>Live location</h2>
        <p class="tracking-status" id="tracking-status">Checking tracking status…</p>
        <div class="tracking-map" id="tracking-map" hidden></div>
        <div class="tracking-controls" id="tracking-controls" hidden>
          <button type="button" class="small primary" id="tracking-toggle">Share my location</button>
        </div>
        <p class="tracking-hint">Location is shared only while this booking is in progress, only with the other
          person on this booking, and is never stored — you can stop anytime.</p>
      </div>
    `;
  }

  /**
   * opts: { bookingId, getAccessToken, getStatus } where getStatus()
   * returns the Api.getTrackingStatus(bookingId) promise. Returns
   * { close() } -- callers MUST call close() when the panel goes away
   * (view navigation, hashchange) to stop the location watch and
   * close the socket.
   */
  function open(panelEl, opts) {
    panelEl.innerHTML = panelHtml();
    const statusEl = panelEl.querySelector('#tracking-status');
    const mapEl = panelEl.querySelector('#tracking-map');
    const controlsEl = panelEl.querySelector('#tracking-controls');
    const toggleBtn = panelEl.querySelector('#tracking-toggle');
    panelEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    let conn = null;
    let watchId = null;
    let lastSentAt = 0;
    let sharing = false;
    let map = null;
    let selfMarker = null;
    let otherMarker = null;
    let otherLastUpdateAt = null;
    let otherName = 'the other person';
    let otherUserId = null;
    let staleTimer = null;
    let closed = false;

    function ensureMap() {
      if (map || !window.L) return Boolean(map);
      mapEl.hidden = false;
      map = window.L.map(mapEl).setView([0, 0], 2);
      window.L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
      return true;
    }

    function fitToMarkers() {
      if (!map) return;
      if (selfMarker && otherMarker) {
        map.fitBounds(window.L.featureGroup([selfMarker, otherMarker]).getBounds().pad(0.3));
      } else if (selfMarker) {
        map.setView(selfMarker.getLatLng(), 14);
      } else if (otherMarker) {
        map.setView(otherMarker.getLatLng(), 14);
      }
    }

    function placeSelf(lat, lng) {
      if (!ensureMap()) return;
      if (!selfMarker) {
        selfMarker = window.L.marker([lat, lng], { title: 'You' }).addTo(map).bindPopup('You');
      } else {
        selfMarker.setLatLng([lat, lng]);
      }
      fitToMarkers();
    }

    function placeOther(lat, lng) {
      if (!ensureMap()) return;
      if (!otherMarker) {
        otherMarker = window.L.marker([lat, lng], { title: otherName }).addTo(map).bindPopup(escapeHtml(otherName));
      } else {
        otherMarker.setLatLng([lat, lng]);
      }
      otherLastUpdateAt = Date.now();
      renderStatus();
      fitToMarkers();
    }

    function renderStatus() {
      if (closed) return;
      if (otherLastUpdateAt == null) {
        statusEl.textContent = `Waiting for ${otherName} to share their location…`;
        return;
      }
      const seconds = Math.max(0, Math.round((Date.now() - otherLastUpdateAt) / 1000));
      const when = seconds < 8 ? 'just now' : `${seconds}s ago`;
      statusEl.textContent = `Tracking ${otherName} — updated ${when}.`;
    }

    function startSharing() {
      if (!navigator.geolocation) {
        statusEl.textContent = 'Your browser does not support location sharing.';
        return;
      }
      sharing = true;
      toggleBtn.textContent = 'Stop sharing my location';
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          placeSelf(pos.coords.latitude, pos.coords.longitude);
          const now = Date.now();
          if (now - lastSentAt < SEND_THROTTLE_MS) return;
          lastSentAt = now;
          conn?.send('location:update', {
            bookingId: opts.bookingId,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          });
        },
        () => {
          sharing = false;
          toggleBtn.textContent = 'Share my location';
          statusEl.textContent = `Location permission was denied — you can still see ${otherName} if they share theirs.`;
        },
        { enableHighAccuracy: false, maximumAge: 5000, timeout: 15000 },
      );
    }

    function stopSharing() {
      sharing = false;
      toggleBtn.textContent = 'Share my location';
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }

    function cleanup() {
      closed = true;
      stopSharing();
      if (conn) {
        conn.close();
        conn = null;
      }
      if (staleTimer) {
        clearInterval(staleTimer);
        staleTimer = null;
      }
    }

    async function init() {
      let status;
      try {
        status = await opts.getStatus();
      } catch (err) {
        statusEl.textContent = err.message || 'Could not load tracking status.';
        return;
      }
      if (closed) return;

      if (!status.isActive) {
        statusEl.textContent = 'Live tracking becomes available once this booking is in progress.';
        return;
      }
      if (!status.counterpart) {
        statusEl.textContent = 'We could not find the other person on this booking yet.';
        return;
      }

      otherName = status.counterpart.name;
      otherUserId = status.counterpart.userId;
      renderStatus();
      controlsEl.hidden = false;

      conn = window.RealtimeWS.connect(opts.getAccessToken);
      conn.on('location:update', (payload) => {
        if (closed) return;
        if (payload.bookingId !== opts.bookingId || payload.fromUserId !== otherUserId) return;
        placeOther(payload.lat, payload.lng);
      });

      toggleBtn.addEventListener('click', () => {
        if (sharing) {
          stopSharing();
        } else {
          startSharing();
        }
      });

      staleTimer = setInterval(renderStatus, 5000);
    }

    init();

    return { close: cleanup };
  }

  window.LiveTracking = { open };
})();
