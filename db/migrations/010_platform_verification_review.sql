-- 010_platform_verification_review.sql
-- Admin/verification console milestone: a platform reviewer
-- (administrator role, via platform_role_assignment — migration 005)
-- needs to see pending verification submissions across every tenant
-- to actually review them, not just the one tenant they happen to
-- query by id. VerificationService.decide()/listForTenant() already
-- run inside DatabaseService.withTenant(tenantId, ...), which works
-- fine per-tenant — but there was no way to list "everything pending,
-- across all tenants" without already knowing every tenantId in
-- advance, and the existing verification_submission RLS policy
-- (migration 002) only ever matches a single app.tenant_id, so a
-- query with no tenant in scope correctly (if unhelpfully) returns
-- zero rows for every tenant at once.
--
-- Same shape as migration 007 (membership) and 009 (customer_profile):
-- add a second, permissive policy rather than touch the first — every
-- existing tenant-scoped query keeps working unchanged, and a caller
-- who holds a platform role carrying 'verification.decide' additionally
-- gets to see every submission, queried via
-- DatabaseService.withUser(callerUserId, ...) so app.user_id (not
-- app.tenant_id) is what's in scope for this query.
--
-- The `tenant` table itself has no RLS (it's already globally
-- readable — discovery/browse depends on that), so joining to it for
-- the business name needs no extra policy here.

BEGIN;

CREATE POLICY verification_submission_visible_to_platform_reviewers ON verification_submission
  USING (
    EXISTS (
      SELECT 1
      FROM platform_role_assignment pra
      JOIN role_permission rp ON rp.role_id = pra.role_id
      JOIN permission p ON p.id = rp.permission_id
      WHERE pra.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND p.code = 'verification.decide'
    )
  );

COMMIT;
