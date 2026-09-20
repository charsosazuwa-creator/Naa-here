/**
 * Shared dispute/complaint UI (User Story US-056), used by the
 * customer portal ("Report a problem" from a booking + "My Disputes"),
 * the provider portal (upgraded "Disputes" tab, replacing the old
 * window.prompt() raise flow), and the admin console (the platform
 * dispute queue). Deliberately just a toolbox of small pieces — badge/
 * label helpers, the raise-a-dispute form, and a detail/attachments
 * renderer — rather than a full page renderer like listing-ui.js,
 * since the three portals' surrounding pages differ enough (a booking
 * table here, a queue there) that sharing the whole page would fight
 * each one's own layout more than it would save.
 */
(function () {
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const REASON_LABELS = {
    service_not_provided: 'Service not provided',
    quality_issue: 'Quality issue',
    no_show: 'No-show',
    payment_issue: 'Payment issue',
    safety_concern: 'Safety concern',
    other: 'Other',
  };

  function reasonLabel(reason) {
    return REASON_LABELS[reason] || escapeHtml(reason);
  }

  function badge(status) {
    return `<span class="badge status-${escapeHtml(status)}">${escapeHtml(String(status).replace(/_/g, ' '))}</span>`;
  }

  function formatDateTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  // -- Raise a dispute (AC1: select a reason, provide details, attach files) --

  function disputeFormHtml() {
    return `
      <div class="dispute-form-alert alert error" role="alert" hidden></div>
      <form class="dispute-form" novalidate>
        <div class="field">
          <label>Reason</label>
          <select class="df-reason tenant-select">
            ${Object.entries(REASON_LABELS).map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Details</label><textarea class="df-details" rows="3" placeholder="Tell us what happened"></textarea></div>
        <div class="field"><label>Attach evidence (optional)</label><input class="df-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" /></div>
        <div class="actions-row">
          <button class="primary small" type="submit">Submit report</button>
          <button class="small" type="button" data-action="cancel-dispute">Cancel</button>
        </div>
      </form>
    `;
  }

  function wireDisputeForm(container, Api, tenantId, bookingId, onRaised) {
    const form = container.querySelector('.dispute-form');
    const alertBox = container.querySelector('.dispute-form-alert');

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      alertBox.hidden = true;
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;

      try {
        const dispute = await Api.raiseDispute(tenantId, bookingId, {
          reason: form.querySelector('.df-reason').value,
          details: form.querySelector('.df-details').value.trim() || undefined,
        });

        const file = form.querySelector('.df-file').files[0];
        if (file) {
          try {
            await Api.uploadDisputeAttachment(tenantId, dispute.id, file);
          } catch (err) {
            // The case itself was raised fine — an attachment failing
            // to upload shouldn't look like the whole report failed.
            window.alert(`Your case ${dispute.caseNumber} was submitted, but the attached file failed to upload: ${err.message}`);
          }
        }

        onRaised(dispute);
      } catch (err) {
        alertBox.textContent = err.message;
        alertBox.hidden = false;
        submitBtn.disabled = false;
      }
    });

    const cancelBtn = form.querySelector('[data-action="cancel-dispute"]');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        container.innerHTML = '';
      });
    }
  }

  // -- Detail / attachments (shared by "My Disputes", the provider tab, and the admin queue) --

  function attachmentsHtml(dispute) {
    if (!dispute.attachments || dispute.attachments.length === 0) {
      return '<p style="color:var(--color-text-muted);font-size:0.78rem">No files attached.</p>';
    }
    return `
      <ul class="dispute-attachment-list">
        ${dispute.attachments
          .map(
            (a) => `
          <li>
            <a href="${escapeHtml(a.url)}" target="_blank" rel="noopener">
              ${a.contentType.startsWith('image/') ? 'Image' : 'File'} (${Math.round(a.byteSize / 1024)} KB)
            </a>
          </li>`,
          )
          .join('')}
      </ul>
    `;
  }

  function disputeDetailHtml(d, extraHtml) {
    return `
      <p><strong>Reason:</strong> ${reasonLabel(d.reason)}</p>
      ${d.details ? `<p>${escapeHtml(d.details)}</p>` : ''}
      <p style="color:var(--color-text-muted);font-size:0.85rem">
        Raised ${formatDateTime(d.createdAt)}${d.resolvedAt ? ` · Resolved ${formatDateTime(d.resolvedAt)}` : ''}
      </p>
      ${d.resolutionNotes ? `<p><strong>Resolution note:</strong> ${escapeHtml(d.resolutionNotes)}</p>` : ''}
      <div class="dispute-attachments">${attachmentsHtml(d)}</div>
      ${extraHtml || ''}
    `;
  }

  window.DisputeUI = {
    escapeHtml,
    reasonLabel,
    badge,
    formatDateTime,
    disputeFormHtml,
    wireDisputeForm,
    disputeDetailHtml,
    attachmentsHtml,
  };
})();
