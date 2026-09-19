-- 009_customer_profile_self_read.sql
-- Milestone 3 bugfix, same shape as migration 007's fix for
-- membership: booking.service.ts's listMine() and cancelOwnBooking()
-- both run inside DatabaseService.withUser(customerUserId, ...) (no
-- app.tenant_id in scope) and both JOIN customer_profile to find "my"
-- bookings via cp.linked_user_id = current caller. The booking table
-- itself already accounts for this (migration 004's
-- booking_visible_to_tenant_or_owning_customer policy explicitly ORs
-- in an "owning customer" clause) — but customer_profile (migration
-- 002) was only ever given a tenant-scoped policy, so with no
-- app.tenant_id set, RLS silently drops every customer_profile row
-- from that JOIN, including the customer's own. The booking row
-- itself passes its own policy, but the JOIN eliminates it anyway,
-- so GET /v1/bookings/mine always returned empty regardless of what
-- was actually in the booking table — this is what surfaced as an
-- empty "My bookings" page in the new customer app even right after a
-- booking was confirmed.
--
-- Same fix as migration 007: add a second, permissive policy rather
-- than rewrite the first — PostgreSQL ORs multiple permissive
-- policies together, so every existing tenant-scoped customer_profile
-- query (the provider portal's CRM views) keeps working unchanged,
-- and a customer can now also see their own linked profile row.

BEGIN;

CREATE POLICY customer_profile_visible_to_linked_user ON customer_profile
  USING (linked_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

COMMIT;
