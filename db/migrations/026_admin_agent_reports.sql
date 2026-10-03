-- 026_admin_agent_reports.sql
--
-- Adds a reporting "Agent": a service account, not a human login, that
-- is assigned the existing `administrator` platform role (migration
-- 005) and is recorded as the generator of every report this feature
-- produces, regardless of which admin or provider clicked "Generate".
-- An admin or provider still triggers generation through the normal
-- authenticated API (see ReportsService) — this migration only seeds
-- the identity the resulting report_run rows are attributed to, plus
-- the table those reports are stored in and the report.view grant
-- that lets providers view their own tenant's reports (administrator
-- and finance_administrator already carry report.view from migration
-- 005; nothing to add there).

BEGIN;

-- ---------------------------------------------------------------------
-- The Agent service account.
--
-- `status = 'disabled'` is deliberate and load-bearing, not an
-- oversight: AuthService.login() (see auth.service.ts) refuses any
-- status other than 'active', so this account can never sign in no
-- matter what happens to its password hash. The hash itself is a
-- random value nobody is given — belt and braces alongside the status
-- check, same reasoning as the rest of this codebase's "fail closed
-- even if one layer is bypassed" posture (e.g. RLS underneath
-- role/permission checks).
--
-- Assigning it the `administrator` role (id 6) through the same
-- platform_role_assignment table real platform staff use is what
-- "grants it Admin functions" concretely: PlatformPermissionGuard
-- cannot tell this id apart from a human administrator's, so it
-- carries every permission migration 005 gave that role (dispute.view,
-- dispute.resolve, listing.moderate, config.manage, report.view) —
-- not just report.view. Report generation is the only capability
-- actually wired up to it yet (see ReportsService); the rest sit ready
-- for whatever admin automation is built on top of this account next.
-- ---------------------------------------------------------------------

INSERT INTO app_user (email, password_hash, full_name, preferred_language, status, email_verified_at)
VALUES (
  'reporting-agent@naahere.internal',
  crypt(gen_random_uuid()::text, gen_salt('bf')),
  'Naa here Reporting Agent',
  'en',
  'disabled',
  now()
)
ON CONFLICT (email) WHERE email IS NOT NULL DO NOTHING;

INSERT INTO platform_role_assignment (user_id, role_id)
SELECT id, 6 FROM app_user WHERE email = 'reporting-agent@naahere.internal'
ON CONFLICT DO NOTHING;

-- Providers viewing their own business's reports is a tenant-role
-- permission, same as booking.manage (migration 004) — report.view
-- already exists as a permission code (migration 005), it just wasn't
-- granted to any tenant role yet because nothing tenant-scoped used it.
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id FROM role r, permission p
WHERE r.code IN ('owner', 'staff', 'artisan', 'host') AND p.code = 'report.view'
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- report_run: one row per generated report. Stores the computed
-- result (not just parameters) so viewing history never re-runs the
-- underlying queries, and so "what did this report say at the time"
-- stays answerable even if the underlying data later changes.
-- ---------------------------------------------------------------------

CREATE TABLE report_run (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type   TEXT NOT NULL CHECK (report_type IN ('platform_summary', 'business_performance')),
  -- NULL for platform_summary (cross-tenant, by definition not scoped
  -- to one tenant); required for business_performance.
  tenant_id     UUID REFERENCES tenant(id) ON DELETE CASCADE,
  period_days   SMALLINT NOT NULL CHECK (period_days > 0),
  -- The human whose click actually triggered this run.
  requested_by  UUID NOT NULL REFERENCES app_user(id),
  -- Always the Agent account above — the "Agent generated this report"
  -- record the feature is built around, independent of who asked for it.
  generated_by  UUID NOT NULL REFERENCES app_user(id),
  result        JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT report_run_tenant_required_for_business_performance
    CHECK (report_type <> 'business_performance' OR tenant_id IS NOT NULL)
);

CREATE INDEX report_run_tenant_type_created_idx ON report_run (tenant_id, report_type, created_at DESC);
CREATE INDEX report_run_type_created_idx ON report_run (report_type, created_at DESC) WHERE tenant_id IS NULL;

ALTER TABLE report_run ENABLE ROW LEVEL SECURITY;

-- Two permissive policies, same "OR" composition as dispute's
-- (migration 014): platform staff holding report.view see every
-- report (both platform-wide and any tenant's); a tenant's own active
-- session (app.tenant_id, set by DatabaseService.withTenant()) sees
-- only that tenant's business_performance rows — platform_summary
-- rows have tenant_id NULL and so never match this second policy,
-- which is what actually keeps them out of the provider portal: no
-- route-level filtering is doing that work, the database is.
CREATE POLICY report_run_visible_to_platform_report_staff ON report_run
  USING (
    EXISTS (
      SELECT 1
      FROM platform_role_assignment pra
      JOIN role_permission rp ON rp.role_id = pra.role_id
      JOIN permission p ON p.id = rp.permission_id
      WHERE pra.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND p.code = 'report.view'
    )
  );

CREATE POLICY report_run_visible_to_tenant ON report_run
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

COMMIT;
