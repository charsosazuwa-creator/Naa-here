-- 015_customer_invitation.sql
--
-- User Story 6: "Enable Service Providers to Invite Customers to Their
-- Portal via Email". Extends the existing staff-invite capability
-- (migration 001's `membership` table, staff.service.ts) to customers,
-- but customers are deliberately NOT given a `membership` row -- that
-- would grant tenant-scoped Staff/Provider permissions, which the
-- acceptance criteria forbid. Instead this is a standalone, token-based
-- invitation that, on acceptance, links a `customer_profile` row to the
-- accepting app_user via its existing (until now unused) `linked_user_id`
-- column (see migration 002).
--
-- RLS is deliberately NOT enabled on this table, matching the existing
-- precedent for app_user/listing/oauth_identity: the accept/decline/
-- preview routes are reached by an opaque token from an email link,
-- before the caller's tenant is known, so there is no app.tenant_id to
-- scope a policy against at that point. Tenant isolation for the
-- provider-facing routes (create/list/resend/cancel) is instead
-- enforced in the application layer, the same way listing.service.ts
-- enforces ownership for the `listing` table.

BEGIN;

CREATE TABLE customer_invitation (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  invited_email         CITEXT NOT NULL,
  invited_by            UUID NOT NULL REFERENCES app_user(id),
  -- Set once accepted, to the customer_profile row the acceptance
  -- created or linked (never before acceptance).
  customer_profile_id   UUID REFERENCES customer_profile(id),
  accepted_by           UUID REFERENCES app_user(id),
  -- sha256 hex digest of the opaque bearer token mailed to the
  -- customer, same hashing approach as user_session.refresh_token_hash
  -- (session.service.ts) -- the plaintext token itself is never stored.
  token_hash            TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
  expires_at            TIMESTAMPTZ NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX customer_invitation_token_hash_unique ON customer_invitation (token_hash);

-- AC15 / Definition of Done: prevent duplicate ACTIVE invitations to
-- the same email for the same provider. A partial unique index (rather
-- than an app-only check) makes this hold even under concurrent
-- requests, the same defence-in-depth the design calls for elsewhere.
CREATE UNIQUE INDEX customer_invitation_one_pending_per_email
  ON customer_invitation (tenant_id, invited_email)
  WHERE status = 'pending';

CREATE INDEX customer_invitation_tenant_idx ON customer_invitation (tenant_id, created_at DESC);

COMMIT;
