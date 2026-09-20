-- 014_dispute_case_and_attachments.sql
--
-- Fills out US-056 ("Raise a complaint or dispute") on top of the
-- dispute backbone migration 005 already built (table, hold-on-raise/
-- release-on-resolve payment logic, dispute.view/dispute.resolve
-- permissions): a generated case reference, a free-text detail field
-- alongside the existing reason, and evidence attachments.

BEGIN;

ALTER TABLE dispute
  ADD COLUMN case_number TEXT,
  ADD COLUMN details TEXT;

-- Backfill any dispute raised before this migration (this demo app's
-- own test data) so case_number can become NOT NULL/UNIQUE below.
UPDATE dispute SET case_number = 'DSP-' || upper(substr(replace(id::text, '-', ''), 1, 8))
WHERE case_number IS NULL;

ALTER TABLE dispute
  ALTER COLUMN case_number SET NOT NULL,
  ADD CONSTRAINT dispute_case_number_key UNIQUE (case_number);

-- Two more permissive RLS policies alongside migration 005's original
-- dispute_visible_to_tenant_or_raiser (Postgres combines multiple
-- permissive policies with OR, so this only ever widens visibility):
--
-- 1) A customer must see a dispute on their own booking even when the
--    PROVIDER raised it, not only ones they raised themselves — same
--    "owning customer" pattern as booking's own RLS policy (migration
--    004).
-- 2) Platform staff holding dispute.view must see every dispute, not
--    only ones tied to a tenant they happen to be scoped into — same
--    pattern as verification_submission's platform-reviewer policy
--    (migration 010), used for the admin dispute queue.
CREATE POLICY dispute_visible_to_owning_customer ON dispute
  USING (
    EXISTS (
      SELECT 1 FROM booking b
      JOIN customer_profile cp ON cp.id = b.customer_id
      WHERE b.id = dispute.booking_id
        AND cp.linked_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    )
  );

CREATE POLICY dispute_visible_to_platform_dispute_staff ON dispute
  USING (
    EXISTS (
      SELECT 1
      FROM platform_role_assignment pra
      JOIN role_permission rp ON rp.role_id = pra.role_id
      JOIN permission p ON p.id = rp.permission_id
      WHERE pra.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND p.code = 'dispute.view'
    )
  );

CREATE TABLE dispute_attachment (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id    UUID NOT NULL REFERENCES dispute(id) ON DELETE CASCADE,
  -- Real bytes on disk under UPLOADS_DIR (see
  -- dispute-attachment.service.ts), same pattern as
  -- listing_image.storage_key from migration 012 — evidence needs
  -- actual retrievable files, not just a metadata record pointing at
  -- storage this project doesn't have wired up (see attachment.storage_key
  -- from migration 002, which is metadata-only).
  storage_key   TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  byte_size     INTEGER NOT NULL,
  uploaded_by   UUID NOT NULL REFERENCES app_user(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX dispute_attachment_dispute_idx ON dispute_attachment (dispute_id);

ALTER TABLE dispute_attachment ENABLE ROW LEVEL SECURITY;
-- Visible to whoever can see the parent dispute — the subquery is
-- itself subject to dispute's own (three-way-OR) RLS policy, so this
-- doesn't need to repeat all three conditions.
CREATE POLICY dispute_attachment_visible_with_dispute ON dispute_attachment
  USING (dispute_id IN (SELECT id FROM dispute));

COMMIT;
