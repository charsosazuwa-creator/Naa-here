/**
 * Thin client for RealtimeGateway (api/src/modules/realtime/realtime.gateway.ts),
 * shared by the customer and provider portals for direct-message push
 * (User Stories 2 & 3's chat halves; Phase 2 call signaling will reuse
 * this same connection). The server is a push-only notification
 * channel -- every event it sends is a nudge about something already
 * persisted via a normal REST call, so losing the connection only
 * costs real-time-ness, never data: a page reload always shows the
 * full, correct state regardless of whether this connected.
 *
 * Usage:
 *   const conn = RealtimeWS.connect(getAccessToken);
 *   conn.on('message:new', (payload) => { ... });
 *   // later, when the view goes away:
 *   conn.close();
 */
(function () {
  function connect(getToken) {
    const handlers = {};
    let socket = null;
    let closed = false;
    let retryDelayMs = 1000;

    function emit(event, payload) {
      (handlers[event] || []).forEach((fn) => {
        try {
          fn(payload);
        } catch (err) {
          console.error('RealtimeWS handler error', err);
        }
      });
    }

    function open() {
      if (closed) return;
      const token = getToken();
      if (!token) return;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`);

      socket.addEventListener('open', () => {
        retryDelayMs = 1000;
      });

      socket.addEventListener('message', (event) => {
        let parsed;
        try {
          parsed = JSON.parse(event.data);
        } catch {
          return;
        }
        if (parsed && parsed.event) emit(parsed.event, parsed.payload);
      });

      socket.addEventListener('close', () => {
        if (closed) return;
        // Reconnect with simple backoff -- the token may have been
        // refreshed, an idle proxy may have dropped the connection, or
        // this may just be a transient network blip.
        setTimeout(open, retryDelayMs);
        retryDelayMs = Math.min(retryDelayMs * 2, 15000);
      });

      socket.addEventListener('error', () => {
        socket?.close();
      });
    }

    open();

    return {
      on(event, fn) {
        (handlers[event] = handlers[event] || []).push(fn);
      },
      close() {
        closed = true;
        socket?.close();
      },
    };
  }

  window.RealtimeWS = { connect };
})();
