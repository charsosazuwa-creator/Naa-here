/**
 * In-app voice calling (User Story 1's group-member calls, User
 * Stories 2 & 3's calling halves) -- the WebRTC half of
 * web/shared/realtime-ws.js's signaling channel. Shared by the
 * customer and provider portals; each calls CallUI.init() once at
 * app startup (not per-view) so an incoming call can ring no matter
 * what page the person is looking at, then StartCall(...) from
 * wherever a Call button lives.
 *
 * Design, matching direct-message.service.ts / call.service.ts on the
 * server: REST calls (Api.accept/decline/end/timeoutCall) are what
 * actually change a call's status and are always the source of truth;
 * the WebSocket only carries the real-time SDP/ICE handshake and the
 * "ring"/"answered"/"ended" nudges telling each side when to update
 * its own UI. A dropped connection mid-handshake just fails the call
 * with a friendly message (AC10) rather than silently pretending it
 * connected.
 *
 * No TURN server is configured (STUN only) -- calls work whenever
 * either side isn't behind a symmetric/restrictive NAT, which covers
 * most home and office networks but not all; a failed ICE connection
 * surfaces as "Call failed" rather than hanging silently.
 */
(function () {
  const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
  const RING_TIMEOUT_MS = 30000;

  let api = null; // { accept, decline, end, timeout } -- bound to callId
  let getCurrentUserId = () => null;
  let conn = null;
  let overlayEl = null;
  let toastTimer = null;

  const call = {
    id: null,
    role: null, // 'caller' | 'callee'
    otherUserId: null,
    otherName: '',
    pc: null,
    localStream: null,
    remoteAudioEl: null,
    pendingCandidates: [],
    pendingOffer: null,
    ringTimer: null,
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function ensureOverlay() {
    if (overlayEl) return overlayEl;
    overlayEl = document.createElement('div');
    overlayEl.className = 'call-overlay';
    overlayEl.hidden = true;
    document.body.appendChild(overlayEl);
    return overlayEl;
  }

  function showToast(text) {
    clearTimeout(toastTimer);
    let el = document.querySelector('.call-toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'call-toast';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.hidden = false;
    toastTimer = setTimeout(() => el.remove(), 5000);
  }

  function renderOverlay(html) {
    const el = ensureOverlay();
    el.innerHTML = html;
    el.hidden = false;
  }

  function hideOverlay() {
    if (overlayEl) overlayEl.hidden = true;
  }

  function resetCallState() {
    if (call.ringTimer) clearTimeout(call.ringTimer);
    if (call.pc) {
      try {
        call.pc.close();
      } catch {
        /* already closed */
      }
    }
    if (call.localStream) {
      call.localStream.getTracks().forEach((t) => t.stop());
    }
    if (call.remoteAudioEl) {
      call.remoteAudioEl.remove();
    }
    call.id = null;
    call.role = null;
    call.otherUserId = null;
    call.otherName = '';
    call.pc = null;
    call.localStream = null;
    call.remoteAudioEl = null;
    call.pendingCandidates = [];
    call.pendingOffer = null;
    call.ringTimer = null;
    hideOverlay();
  }

  function endCall(reasonForToast) {
    if (!call.id) return;
    if (reasonForToast) showToast(reasonForToast);
    resetCallState();
  }

  function sendSignal(toUserId, data) {
    conn?.send?.('call:signal', { callId: call.id, toUserId, data });
  }

  async function createPeerConnection(toUserId) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pc.onicecandidate = (event) => {
      if (event.candidate) sendSignal(toUserId, { type: 'candidate', candidate: event.candidate });
    };
    pc.ontrack = (event) => {
      const audio = document.createElement('audio');
      audio.autoplay = true;
      audio.srcObject = event.streams[0];
      audio.style.display = 'none';
      document.body.appendChild(audio);
      call.remoteAudioEl = audio;
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        renderInCall();
      } else if (pc.connectionState === 'failed') {
        endCall('Call failed — check your connection and try again.');
      }
    };
    return pc;
  }

  async function getMic() {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch {
      throw new Error('Microphone access is needed to make a call — check your browser permissions.');
    }
  }

  function renderRinging(otherName) {
    renderOverlay(`
      <div class="call-title">Incoming call</div>
      <div class="call-status">${escapeHtml(otherName)}</div>
      <div class="call-actions">
        <button class="small primary" id="call-accept-btn">Accept</button>
        <button class="small danger" id="call-decline-btn">Decline</button>
      </div>
    `);
    document.getElementById('call-accept-btn').addEventListener('click', onAcceptClicked);
    document.getElementById('call-decline-btn').addEventListener('click', onDeclineClicked);
  }

  function renderCalling(otherName) {
    renderOverlay(`
      <div class="call-title">Calling…</div>
      <div class="call-status">${escapeHtml(otherName)}</div>
      <div class="call-actions">
        <button class="small danger" id="call-cancel-btn">Cancel</button>
      </div>
    `);
    document.getElementById('call-cancel-btn').addEventListener('click', () => {
      api.end(call.id).catch(() => {});
      endCall();
    });
  }

  function renderInCall() {
    if (!call.id) return;
    renderOverlay(`
      <div class="call-title">In call</div>
      <div class="call-status">${escapeHtml(call.otherName)}</div>
      <div class="call-actions">
        <button class="small danger" id="call-end-btn">End call</button>
      </div>
    `);
    document.getElementById('call-end-btn').addEventListener('click', () => {
      api.end(call.id).catch(() => {});
      endCall('Call ended.');
    });
  }

  async function onAcceptClicked() {
    const acceptedCallId = call.id;
    try {
      await api.accept(acceptedCallId);
    } catch (err) {
      showToast(err.message);
      resetCallState();
      return;
    }
    renderOverlay(`<div class="call-title">Connecting…</div><div class="call-status">${escapeHtml(call.otherName)}</div>`);
    try {
      call.localStream = await getMic();
      call.pc = await createPeerConnection(call.otherUserId);
      call.localStream.getTracks().forEach((track) => call.pc.addTrack(track, call.localStream));
      // The caller's offer (and any ICE candidates trickled after it)
      // may have arrived over the WebSocket while we were still
      // waiting on the mic permission prompt above -- apply it now
      // rather than silently dropping it.
      if (call.pendingOffer) {
        const offerData = call.pendingOffer;
        call.pendingOffer = null;
        await applyOffer(call.otherUserId, offerData);
      }
      call.pendingCandidates.forEach((c) => call.pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}));
      call.pendingCandidates = [];
    } catch (err) {
      showToast(err.message || 'Could not connect the call.');
      api.end(acceptedCallId).catch(() => {});
      resetCallState();
    }
  }

  function onDeclineClicked() {
    api.decline(call.id).catch(() => {});
    resetCallState();
  }

  /** payload: { callId, contextType, groupId?, tenantId?, callerUserId, callerName } */
  function handleIncoming(payload) {
    if (call.id) {
      // Already on a call -- silently let it ring out server-side
      // (the caller's own timeout handles "no answer").
      return;
    }
    call.id = payload.callId;
    call.role = 'callee';
    call.otherUserId = payload.callerUserId;
    call.otherName = payload.callerName;
    renderRinging(payload.callerName);
  }

  /** payload: { callId, acceptedByUserId, acceptedByName } */
  async function handleAccepted(payload) {
    if (payload.callId !== call.id || call.role !== 'caller') return;
    if (call.ringTimer) clearTimeout(call.ringTimer);
    call.otherUserId = payload.acceptedByUserId;
    call.otherName = payload.acceptedByName || call.otherName;
    renderOverlay(`<div class="call-title">Connecting…</div><div class="call-status">${escapeHtml(call.otherName)}</div>`);

    try {
      call.localStream = await getMic();
      call.pc = await createPeerConnection(call.otherUserId);
      call.localStream.getTracks().forEach((track) => call.pc.addTrack(track, call.localStream));
      const offer = await call.pc.createOffer();
      await call.pc.setLocalDescription(offer);
      sendSignal(call.otherUserId, { type: 'offer', sdp: offer.sdp });
    } catch (err) {
      showToast(err.message || 'Could not connect the call.');
      api.end(call.id).catch(() => {});
      resetCallState();
    }
  }

  /** payload: { callId, reason } */
  function handleEnded(payload) {
    if (payload.callId !== call.id) return;
    const messages = {
      declined: 'Call declined.',
      no_answer: 'No answer.',
      taken: 'Call answered by a colleague.',
      ended: 'Call ended.',
    };
    endCall(messages[payload.reason] || 'Call ended.');
  }

  /** Sets the remote offer, creates and sends our answer. Shared by handleSignal (offer arrives after the peer connection exists) and onAcceptClicked (a queued offer that arrived before it did). */
  async function applyOffer(fromUserId, data) {
    await call.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
    const answer = await call.pc.createAnswer();
    await call.pc.setLocalDescription(answer);
    sendSignal(fromUserId, { type: 'answer', sdp: answer.sdp });
  }

  /** payload: { callId, fromUserId, data } */
  async function handleSignal(payload) {
    if (payload.callId !== call.id) return;
    const { data } = payload;

    if (data.type === 'offer') {
      // The callee's peer connection is created inside onAcceptClicked,
      // which is racing this same message over the WebSocket (mic
      // permission prompts can take a while) -- queue rather than drop.
      if (!call.pc) {
        call.pendingOffer = data;
        return;
      }
      await applyOffer(payload.fromUserId, data);
    } else if (data.type === 'answer') {
      if (!call.pc) return;
      await call.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
    } else if (data.type === 'candidate') {
      if (!call.pc) {
        call.pendingCandidates.push(data.candidate);
      } else {
        call.pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {});
      }
    }
  }

  /**
   * Starts an outgoing call. `initiate` is an async function that
   * POSTs to the right endpoint (customer→business, business→customer,
   * or group member→member) and resolves to { id, ... }; `otherLabel`
   * is shown in the "Calling…" UI before the callee has a name to give
   * back (a group member's name, or "this business").
   */
  async function startCall(initiate, otherLabel) {
    if (call.id) {
      showToast('You are already on a call.');
      return;
    }
    call.role = 'caller';
    call.otherName = otherLabel;
    renderCalling(otherLabel);

    let created;
    try {
      created = await initiate();
    } catch (err) {
      showToast(err.message || 'Could not start the call.');
      resetCallState();
      return;
    }
    call.id = created.id;
    call.otherUserId = created.calleeUserId || null;

    call.ringTimer = setTimeout(() => {
      api.timeout(call.id).catch(() => {});
      endCall('No answer.');
    }, RING_TIMEOUT_MS);
  }

  function init(options) {
    api = options.api;
    getCurrentUserId = options.getCurrentUserId;
    conn = window.RealtimeWS.connect(options.getAccessToken);
    conn.on('call:incoming', handleIncoming);
    conn.on('call:accepted', handleAccepted);
    conn.on('call:ended', handleEnded);
    conn.on('call:signal', handleSignal);
  }

  window.CallUI = { init, startCall };
})();
