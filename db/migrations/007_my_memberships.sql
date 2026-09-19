-- 007_my_memberships.sql
-- Small, targeted addition needed by the provider portal front end:
-- there was previously no way for a signed-in user to discover which
-- businesses they belong to without already knowing a tenantId (from
-- having created it themselves, or been invited into one out of band
-- and told the id separately). GET /v1/tenants/mine (tenancy.controller.ts)
-- is the new route; this migration is the RLS policy it depends on.
--
-- membership's only existing policy (migration 001) checks
-- tenant_id = current_setting('app.tenant_id'), which is exactly right
-- for every existing route (all of them run inside
-- DatabaseService.withTenant(tenantId, ...), where that setting is
-- already known) but blocks a genuinely cross-tenant "list my
-- memberships" query — the query business.service.ts's new
-- listForUser() runs inside withUser(userId, ...) instead, which sets
-- app.user_id, not app.tenant_id. Booking hit exactly this problem for
-- "my bookings" in migration 004 and solved it the same way: multiple
-- PERMISSIVE policies on the same table combine with OR, so adding
-- this second policy (rather than rewriting the first) means every
-- existing tenant-scoped membership query keeps working unchanged,
-- and the new self-scoped one now also passes.

BEGIN;

CREATE POLICY membership_visible_to_self ON membership
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

COMMIT;
