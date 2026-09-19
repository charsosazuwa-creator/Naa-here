-- 004_booking_engine.sql
-- Milestone 3: booking engine (design package section 11, phase 3).
-- "Done when: no double booking under load, and every story in the
-- group passes its acceptance tests."
--
-- Scope for this milestone: single-service appointments and
-- accommodation bookings with database-enforced overlap prevention,
-- plus an artisan request/quotation flow. Deliberately deferred (see
-- README): multi-service composite bookings, staff-choice scheduling
-- beyond recording who is assigned, recurring appointments, waitlists,
-- and pre-job inspections.

BEGIN;

-- Needed for the exclusion constraint below: GiST indexes over a plain
-- equality column (service_id) plus a range type (tstzrange) require
-- btree_gist to supply the equality operator class for GiST.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------

INSERT INTO permission (id, code) VALUES
  (10, 'booking.manage'),
  (11, 'job.manage');

INSERT INTO role_permission (role_id, permission_id)
  SELECT r.id, p.id FROM role r, permission p
  WHERE r.code IN ('owner', 'staff', 'artisan', 'host') AND p.code IN ('booking.manage', 'job.manage');

-- ---------------------------------------------------------------------
-- Bookings: appointments and accommodation stays.
--
-- The EXCLUDE constraint is the design's chosen mechanism (section 6,
-- "Preventing double booking") for the "Done when" criterion: it is
-- enforced by PostgreSQL itself, atomically, under concurrent inserts
-- — no amount of application-level checking-then-inserting can race
-- around it the way a SELECT-then-INSERT in the API could.
-- ---------------------------------------------------------------------

CREATE TABLE booking (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  service_id          UUID NOT NULL REFERENCES service(id),
  customer_id         UUID NOT NULL REFERENCES customer_profile(id),
  created_by          UUID NOT NULL REFERENCES app_user(id),
  staff_user_id       UUID REFERENCES app_user(id),
  status              TEXT NOT NULL DEFAULT 'confirmed'
                        CHECK (status IN ('confirmed', 'in_progress', 'completed', 'no_show', 'cancelled')),
  -- Payment-driven statuses ('pending_payment', 'disputed', 'refunded')
  -- from the design's full state diagram are not reachable yet: phase 4
  -- (payments) has not landed, so every booking here starts 'confirmed'
  -- directly. The CHECK above only allows the subset this milestone's
  -- state machine (booking-state.ts) actually drives.
  starts_at           TIMESTAMPTZ NOT NULL,
  ends_at             TIMESTAMPTZ NOT NULL,
  notes               TEXT,
  cancellation_reason TEXT,
  -- A copy of the cancellation/deposit policy in force when the
  -- booking was made (Q6's templates: flexible, moderate, strict), so
  -- a later change to the tenant's policy never rewrites the terms a
  -- customer already booked under.
  policy_snapshot     JSONB NOT NULL DEFAULT '{"template": "flexible"}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT booking_time_order CHECK (starts_at < ends_at),
  -- Two bookings for the same service cannot occupy overlapping time,
  -- unless one of them is cancelled or a no-show (both free the slot).
  EXCLUDE USING gist (
    service_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status NOT IN ('cancelled', 'no_show'))
);

-- Tenant-scoped isolation (steps a provider's own view relies on) OR
-- visible to the customer who owns it, wherever they are. See
-- DatabaseService.withUser(); "my bookings" queries run under that,
-- with no app.tenant_id set, and rely entirely on the second clause.
ALTER TABLE booking ENABLE ROW LEVEL SECURITY;
CREATE POLICY booking_visible_to_tenant_or_owning_customer ON booking
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR EXISTS (
      SELECT 1 FROM customer_profile cp
      WHERE cp.id = booking.customer_id
        AND cp.linked_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    )
  );

CREATE INDEX booking_tenant_status_idx ON booking (tenant_id, status);
CREATE INDEX booking_customer_idx ON booking (customer_id);

-- ---------------------------------------------------------------------
-- Artisan flow: a customer requests a job, the provider quotes a
-- price, the customer accepts (which creates the booking above with
-- the agreed schedule) or declines.
-- ---------------------------------------------------------------------

CREATE TABLE job_request (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  service_id    UUID NOT NULL REFERENCES service(id),
  customer_id   UUID NOT NULL REFERENCES customer_profile(id),
  created_by    UUID NOT NULL REFERENCES app_user(id),
  description   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'requested'
                  CHECK (status IN ('requested', 'quoted', 'accepted', 'declined', 'cancelled')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE job_request ENABLE ROW LEVEL SECURITY;
CREATE POLICY job_request_visible_to_tenant_or_owning_customer ON job_request
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR EXISTS (
      SELECT 1 FROM customer_profile cp
      WHERE cp.id = job_request.customer_id
        AND cp.linked_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    )
  );

CREATE TABLE quotation (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  job_request_id    UUID NOT NULL REFERENCES job_request(id) ON DELETE CASCADE,
  amount_minor_units INTEGER NOT NULL CHECK (amount_minor_units >= 0),
  currency_code     CHAR(3) NOT NULL,
  proposed_starts_at TIMESTAMPTZ NOT NULL,
  proposed_ends_at  TIMESTAMPTZ NOT NULL,
  valid_until       TIMESTAMPTZ NOT NULL,
  created_by        UUID NOT NULL REFERENCES app_user(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT quotation_time_order CHECK (proposed_starts_at < proposed_ends_at)
);

ALTER TABLE quotation ENABLE ROW LEVEL SECURITY;
CREATE POLICY quotation_visible_to_tenant_or_owning_customer ON quotation
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR EXISTS (
      SELECT 1 FROM job_request jr
      JOIN customer_profile cp ON cp.id = jr.customer_id
      WHERE jr.id = quotation.job_request_id
        AND cp.linked_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    )
  );

-- ---------------------------------------------------------------------
-- Idempotency keys (design section 5's idempotency-key pattern):
-- booking creation is the first route in this codebase where a
-- retried request must never create a second booking.
-- ---------------------------------------------------------------------

CREATE TABLE idempotency_key (
  key             TEXT PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES app_user(id),
  route           TEXT NOT NULL,
  request_hash    TEXT NOT NULL,
  response_status INTEGER,
  response_body   JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours'
);

CREATE INDEX idempotency_key_expires_idx ON idempotency_key (expires_at);

COMMIT;
