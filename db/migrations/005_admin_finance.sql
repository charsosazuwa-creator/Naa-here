-- 005_admin_finance.sql
-- Milestone 4: Phase 5, "Administration and support" (design section
-- 11's phase table): "Provider verification, listing moderation,
-- complaints and disputes, reconciliation, refund and payout
-- management, configuration, reports." "Done when: Finance reconciles
-- and resolves a dispute, and reports match the ledger."
--
-- Two scope decisions the user made explicitly before this migration
-- was written:
--
-- 1. The phase table says phase 5 depends on phase 4 (Payments), which
--    has not been built. Rather than block on that, this migration
--    adds a deliberately minimal, dormant escrow ledger: just enough
--    for reconciliation, refunds, and payouts to operate against real
--    rows, with commission/fees enforced at zero (matching the earlier
--    zero-fee decision recorded in the design package). A real PSP
--    integration is still phase 4's job later; nothing here talks to
--    an actual payment provider, and a booking's "charge" entry is a
--    bookkeeping record of funds assumed already held, not a real
--    transaction.
-- 2. This migration also builds the "fuller admin/permission model"
--    that migration 002 (and platform-admin.guard.ts) always said
--    phase 5 would build, retiring Milestone 2's placeholder
--    `app_user.is_platform_admin` boolean in favour of the same
--    role/permission machinery tenant members already use.

BEGIN;

-- ---------------------------------------------------------------------
-- Platform role assignment: the fuller admin/permission model.
--
-- Milestone 2's `is_platform_admin` boolean was explicitly a stand-in
-- (see that column's own comment in 002_provider_crm.sql). Platform
-- staff — administrators, finance administrators, support agents —
-- act across every tenant, so (as that comment already noted) they
-- cannot be modeled as a `membership` row scoped to one tenant. This
-- table is the tenant-independent equivalent of `membership`: it
-- assigns a user one of the platform-wide roles already seeded in
-- `role` back in migration 001 (support_agent=5, administrator=6,
-- finance_administrator=7), and the new PlatformPermissionGuard checks
-- it the same way TenantRoleGuard checks `membership` — by joining
-- through role_permission for the permission a route declares.
-- ---------------------------------------------------------------------

CREATE TABLE platform_role_assignment (
  user_id     UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role_id     SMALLINT NOT NULL REFERENCES role(id),
  assigned_by UUID REFERENCES app_user(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id),
  CONSTRAINT platform_role_assignment_platform_role_only
    CHECK (role_id IN (5, 6, 7))  -- support_agent, administrator, finance_administrator
);

-- Backward-compatible data migration: anyone already flagged
-- is_platform_admin under the old model becomes an `administrator`
-- under the new one, so an existing deployment doesn't lose its admins
-- when this migration lands.
INSERT INTO platform_role_assignment (user_id, role_id)
  SELECT id, 6 FROM app_user WHERE is_platform_admin = true
  ON CONFLICT DO NOTHING;

COMMENT ON COLUMN app_user.is_platform_admin IS
  'Superseded by platform_role_assignment (migration 005, phase 5''s fuller admin/permission model). Left in place for backward compatibility; no guard reads it as of this migration.';

-- ---------------------------------------------------------------------
-- New permissions for phase 5, granted to the platform roles.
-- ---------------------------------------------------------------------

INSERT INTO permission (id, code) VALUES
  (12, 'dispute.view'),
  (13, 'dispute.resolve'),
  (14, 'listing.moderate'),
  (15, 'refund.issue'),
  (16, 'payout.decide'),
  (17, 'report.view'),
  (18, 'config.manage'),
  (19, 'payout.request');

-- administrator: verification decisions (already granted in migration
-- 002), disputes, listing moderation, platform configuration, reports.
INSERT INTO role_permission (role_id, permission_id)
  SELECT 6, id FROM permission WHERE code IN
    ('dispute.view', 'dispute.resolve', 'listing.moderate', 'config.manage', 'report.view');

-- finance_administrator: money movement, and the numbers behind it.
-- Deliberately cannot resolve disputes or moderate listings — a
-- separation of duties between "decides what happened" and "moves
-- money" that the "dispute holds" test requirement (phase 5's test
-- list) exists to check isn't bypassable.
INSERT INTO role_permission (role_id, permission_id)
  SELECT 7, id FROM permission WHERE code IN
    ('dispute.view', 'refund.issue', 'payout.decide', 'report.view');

-- support_agent: can see disputes to help a customer, cannot resolve
-- them or touch money.
INSERT INTO role_permission (role_id, permission_id)
  SELECT 5, id FROM permission WHERE code = 'dispute.view';

-- payout.request is tenant-scoped (a provider asking to be paid out
-- of their own escrow balance) unlike the platform-role permissions
-- above — granted through role_permission the same way booking.manage
-- was in migration 004, checked by the existing TenantRoleGuard.
INSERT INTO role_permission (role_id, permission_id)
  SELECT r.id, p.id FROM role r, permission p
  WHERE r.code IN ('owner', 'artisan', 'host') AND p.code = 'payout.request';

-- ---------------------------------------------------------------------
-- Listing moderation
-- ---------------------------------------------------------------------

ALTER TABLE service
  ADD COLUMN moderation_status TEXT NOT NULL DEFAULT 'active'
    CHECK (moderation_status IN ('active', 'suspended'));

CREATE TABLE listing_moderation_action (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id    UUID NOT NULL REFERENCES service(id) ON DELETE CASCADE,
  tenant_id     UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  action        TEXT NOT NULL CHECK (action IN ('suspended', 'reinstated')),
  reason        TEXT,
  actor_user_id UUID NOT NULL REFERENCES app_user(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE listing_moderation_action ENABLE ROW LEVEL SECURITY;
CREATE POLICY listing_moderation_action_tenant_isolation ON listing_moderation_action
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
-- A platform administrator moderating a listing is not a member of
-- the tenant they're acting on, but the route still names that tenant
-- in its own :tenantId path param (the same shape verification.decide
-- already uses) — so the service still opens a normal
-- DatabaseService.withTenant(tenantId, ...) transaction for the write,
-- same as every tenant-scoped module. What's different from a tenant
-- member's own routes is only the guard in front of it
-- (PlatformPermissionGuard, not TenantRoleGuard's membership check).

-- ---------------------------------------------------------------------
-- Dormant escrow ledger. See the migration header for why this exists
-- ahead of a real phase-4 payment integration.
-- ---------------------------------------------------------------------

CREATE TABLE escrow_account (
  tenant_id           UUID PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
  balance_minor_units BIGINT NOT NULL DEFAULT 0,
  currency_code       CHAR(3) NOT NULL,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE dispute (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  booking_id        UUID NOT NULL REFERENCES booking(id),
  raised_by         UUID NOT NULL REFERENCES app_user(id),
  reason            TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'resolved_customer', 'resolved_provider', 'dismissed')),
  resolution_notes  TEXT,
  resolved_by       UUID REFERENCES app_user(id),
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE dispute ENABLE ROW LEVEL SECURITY;
-- Same pattern as booking's own RLS policy (migration 004): visible to
-- the tenant, or to the app_user who raised it, via the app.user_id
-- session variable DatabaseService.withUser() sets.
CREATE POLICY dispute_visible_to_tenant_or_raiser ON dispute
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR raised_by = NULLIF(current_setting('app.user_id', true), '')::uuid
  );

CREATE TABLE ledger_entry (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  booking_id          UUID REFERENCES booking(id),
  type                TEXT NOT NULL CHECK (type IN ('charge', 'refund', 'payout', 'adjustment')),
  amount_minor_units  BIGINT NOT NULL CHECK (amount_minor_units > 0),
  currency_code       CHAR(3) NOT NULL,
  -- Dormant: the design's approved decision keeps commission/fee
  -- features present but at zero. Enforced here at the database
  -- layer, not just left to application code, so this can't drift.
  fee_minor_units     BIGINT NOT NULL DEFAULT 0 CHECK (fee_minor_units = 0),
  held_for_dispute_id UUID REFERENCES dispute(id),
  created_by          UUID REFERENCES app_user(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ledger_entry ENABLE ROW LEVEL SECURITY;
CREATE POLICY ledger_entry_tenant_isolation ON ledger_entry
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Append-only, same reasoning (and the same table-owner-bypass caveat
-- resolved by migration 003's app_runtime role) as audit_event in
-- migration 001: a ledger you can edit after the fact is not a
-- ledger. Corrections are new 'adjustment' rows, never an UPDATE of
-- history.
REVOKE UPDATE, DELETE ON ledger_entry FROM app_runtime;

CREATE INDEX ledger_entry_tenant_created_idx ON ledger_entry (tenant_id, created_at DESC);
CREATE INDEX ledger_entry_booking_idx ON ledger_entry (booking_id);

CREATE TABLE payout (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  amount_minor_units  BIGINT NOT NULL CHECK (amount_minor_units > 0),
  currency_code       CHAR(3) NOT NULL,
  status              TEXT NOT NULL DEFAULT 'requested'
                        CHECK (status IN ('requested', 'paid', 'rejected')),
  requested_by        UUID NOT NULL REFERENCES app_user(id),
  decided_by          UUID REFERENCES app_user(id),
  decision_notes      TEXT,
  decided_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE payout ENABLE ROW LEVEL SECURITY;
CREATE POLICY payout_tenant_isolation ON payout
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
-- A finance administrator deciding a payout is, like an administrator
-- moderating a listing above, not a tenant member — but the payout row
-- already carries its own tenant_id, so the service still opens a
-- normal DatabaseService.withTenant(payout.tenantId, ...) transaction
-- once it has looked the payout up; only the guard in front differs.

-- ---------------------------------------------------------------------
-- Platform configuration: key/value, audited via updated_by. Seeded
-- with the design's approved decisions so they're inspectable data,
-- not just something asserted in a comment.
-- ---------------------------------------------------------------------

CREATE TABLE platform_config (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_by  UUID REFERENCES app_user(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO platform_config (key, value) VALUES
  ('commission_bps', '0'::jsonb),
  ('fees_enabled', 'false'::jsonb),
  ('cash_payments_enabled', 'false'::jsonb);

COMMIT;
