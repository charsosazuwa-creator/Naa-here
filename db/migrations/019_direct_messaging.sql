-- 019_direct_messaging.sql
--
-- User Stories 2 & 3: direct in-app chat between a Customer and a
-- Service Provider (business). This is deliberately a separate model
-- from group_message (migration 017) -- a group conversation is
-- many-to-many among group members with no access gate beyond active
-- membership, while a Customer<->Provider conversation is strictly
-- two-party and, when the PROVIDER initiates it, gated behind an
-- eligible relationship (see DirectMessageService.assertEligible...
-- in the app layer): "a Service Provider should not automatically be
-- allowed to call or message every Customer simply because the
-- Customer appears in search results" (per the user stories' own
-- note). A Customer can always initiate contact with an eligible
-- (published/verified) Provider -- only Provider-initiated first
-- contact is gated.
--
-- One conversation per (customer, tenant) pair -- like most messaging
-- apps, threads are organized by "who", not by "which booking", so a
-- customer and a business share a single running conversation across
-- however many bookings/enquiries they've had; `context_type`/
-- `context_id` record what the conversation was first opened about,
-- for display, not as a boundary.
--
-- No RLS: matches the existing customer_invitation/group* precedent
-- for a cross-tenant, user-level entity -- a conversation's own two
-- participants (one customer app_user, one provider tenant) are
-- exactly who app-layer checks already need to authorize against, and
-- "signed-in customer, no tenant known yet" is the same shape that
-- made a plain RLS policy insufficient for group eligibility earlier
-- (see that migration's and the Config & Deployment Guide's notes).

BEGIN;

CREATE TABLE conversation (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id  UUID NOT NULL REFERENCES app_user(id),
  tenant_id         UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  -- What first opened this thread, for display only (see header comment).
  context_type      TEXT CHECK (context_type IN ('booking', 'job_request', 'customer_invitation', 'general')),
  context_id        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX conversation_customer_tenant_unique ON conversation (customer_user_id, tenant_id);
CREATE INDEX conversation_tenant_idx ON conversation (tenant_id, last_message_at DESC);
CREATE INDEX conversation_customer_idx ON conversation (customer_user_id, last_message_at DESC);

CREATE TABLE direct_message (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  sender_user_id   UUID NOT NULL REFERENCES app_user(id),
  body             TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at          TIMESTAMPTZ
);

CREATE INDEX direct_message_conversation_idx ON direct_message (conversation_id, created_at ASC);

-- A Customer blocking a Provider business (AC12/US3, AC11/US2): once
-- blocked, that tenant's staff can no longer send the Customer new
-- messages (or, in a later migration, calls) -- checked in the app
-- layer, same pattern as everything else here.
CREATE TABLE customer_provider_block (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id  UUID NOT NULL REFERENCES app_user(id),
  tenant_id         UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX customer_provider_block_unique ON customer_provider_block (customer_user_id, tenant_id);

COMMIT;
