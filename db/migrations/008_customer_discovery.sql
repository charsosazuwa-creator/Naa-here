-- 008_customer_discovery.sql
-- Milestone 3 (customer-facing booking flow): a customer browsing
-- services has no tenant membership and no app.tenant_id in scope, so
-- the existing RLS policies on service/location (migrations 002),
-- which only ever match a single tenant_id, correctly return zero
-- rows for this case — by design, not by accident (see
-- catalogue.controller.ts's comment on why a public browse route was
-- deliberately left out of Milestone 2).
--
-- Postgres RLS policies are permissive by default and OR together, so
-- each new policy here only ever WIDENS access beyond what the
-- existing tenant-scoped policy already allows; it can't narrow it.
--
-- service: publicly readable once — and only once — it is both
-- published (the provider's own choice) and not suspended by a
-- platform moderator (migration 005's moderation_status). A draft or
-- archived service, or one a moderator suspended, stays invisible to
-- everyone outside its own tenant.
CREATE POLICY service_public_read ON service
  FOR SELECT
  USING (status = 'published' AND moderation_status = 'active');

-- location: a location is only worth showing publicly if it belongs
-- to a tenant that actually has at least one publicly-visible service
-- there — otherwise this would leak the address book of every
-- business on the platform, verified or not, service or no service.
CREATE POLICY location_public_read ON location
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM service s
      WHERE s.location_id = location.id
        AND s.status = 'published'
        AND s.moderation_status = 'active'
    )
  );
