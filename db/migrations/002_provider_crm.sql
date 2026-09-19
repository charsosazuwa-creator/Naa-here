-- 002_provider_crm.sql
-- Milestone 2: Provider CRM (design package section 11, phase 2).
-- "Done when: a provider registers, is verified, and publishes a
-- bookable service." Requirement families covered: BR-PRO-*, IR-CRM-*,
-- BR-LST-*, BR-010, BR-015, BR-SEC-01, UX-BE-02 to 04.

BEGIN;

-- ---------------------------------------------------------------------
-- Business profile fields on tenant, and verification status
-- ---------------------------------------------------------------------

ALTER TABLE tenant
  ADD COLUMN category TEXT CHECK (category IN ('barber_salon', 'accommodation', 'artisan')),
  ADD COLUMN description TEXT,
  ADD COLUMN contact_phone TEXT,
  ADD COLUMN contact_email CITEXT,
  ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'pending', 'verified', 'rejected'));

-- Platform administrators are not members of any one tenant, so they
-- cannot be represented as a per-tenant `membership` row. This is a
-- deliberately minimal stand-in for the fuller admin/permission model
-- phase 5 builds; it exists only so verification decisions have
-- someone authorized to make them in this milestone.
ALTER TABLE app_user ADD COLUMN is_platform_admin BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------
-- Permissions used by Milestone 2's role/permission guard. Assigned to
-- roles below; the guard (tenant-role.guard.ts) checks role_permission
-- for the caller's membership role in the target tenant.
-- ---------------------------------------------------------------------

INSERT INTO permission (id, code) VALUES
  (1,  'business.manage'),
  (2,  'staff.manage'),
  (3,  'service.manage'),
  (4,  'service.publish'),
  (5,  'availability.manage'),
  (6,  'customer.manage'),
  (7,  'media.upload'),
  (8,  'verification.submit'),
  (9,  'verification.decide');

-- owner: full control of their own business
INSERT INTO role_permission (role_id, permission_id)
  SELECT 1, id FROM permission WHERE code IN
    ('business.manage','staff.manage','service.manage','service.publish',
     'availability.manage','customer.manage','media.upload','verification.submit');

-- staff: day-to-day CRM and catalogue work, no publishing, no staff/verification management
INSERT INTO role_permission (role_id, permission_id)
  SELECT 2, id FROM permission WHERE code IN
    ('service.manage','availability.manage','customer.manage','media.upload');

-- artisan and host behave like an owner of their own single-person business
INSERT INTO role_permission (role_id, permission_id)
  SELECT 3, id FROM permission WHERE code IN
    ('business.manage','service.manage','service.publish','availability.manage','customer.manage','media.upload','verification.submit');
INSERT INTO role_permission (role_id, permission_id)
  SELECT 4, id FROM permission WHERE code IN
    ('business.manage','service.manage','service.publish','availability.manage','customer.manage','media.upload','verification.submit');

-- administrator: decides verification outcomes (a stand-in for the fuller admin console in phase 5)
INSERT INTO role_permission (role_id, permission_id)
  SELECT 6, id FROM permission WHERE code IN ('verification.decide');

-- ---------------------------------------------------------------------
-- Locations
-- ---------------------------------------------------------------------

CREATE TABLE location (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,           -- e.g. "Main branch"
  address_line  TEXT NOT NULL,
  city          TEXT NOT NULL,
  country_code  CHAR(2) NOT NULL REFERENCES country_config(country_code),
  latitude      DOUBLE PRECISION,
  longitude     DOUBLE PRECISION,
  is_primary    BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE location ENABLE ROW LEVEL SECURITY;
CREATE POLICY location_tenant_isolation ON location
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ---------------------------------------------------------------------
-- Files: attachment metadata. The bytes themselves live in object
-- storage (design section 6); this table is the record of what was
-- uploaded, by whom, and whether the mock scan passed (BR-SEC-01,
-- BR-015 "type, size and content checks").
-- ---------------------------------------------------------------------

CREATE TABLE attachment (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID REFERENCES tenant(id) ON DELETE CASCADE,  -- nullable: a user's own profile photo has no tenant
  uploaded_by     UUID NOT NULL REFERENCES app_user(id),
  storage_key     TEXT NOT NULL,           -- object-storage key; this milestone never writes real bytes, see media.service.ts
  content_type    TEXT NOT NULL,
  byte_size       INTEGER NOT NULL CHECK (byte_size > 0),
  scan_status     TEXT NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending', 'clean', 'rejected')),
  scan_reason     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE attachment ENABLE ROW LEVEL SECURITY;
CREATE POLICY attachment_tenant_isolation ON attachment
  USING (tenant_id IS NULL OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ---------------------------------------------------------------------
-- Provider verification
-- ---------------------------------------------------------------------

CREATE TABLE verification_submission (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  submitted_by    UUID NOT NULL REFERENCES app_user(id),
  document_type   TEXT NOT NULL,          -- configurable per country/category later (Q5); free text for this milestone
  attachment_id   UUID NOT NULL REFERENCES attachment(id),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by      UUID REFERENCES app_user(id),
  decided_at      TIMESTAMPTZ,
  decision_note   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE verification_submission ENABLE ROW LEVEL SECURITY;
CREATE POLICY verification_submission_tenant_isolation ON verification_submission
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ---------------------------------------------------------------------
-- Catalogue: categories, services
-- ---------------------------------------------------------------------

CREATE TABLE service_category (
  id      SMALLINT PRIMARY KEY,
  code    TEXT NOT NULL UNIQUE,
  name    TEXT NOT NULL
);

INSERT INTO service_category (id, code, name) VALUES
  (1, 'barber_salon', 'Barber and salon appointments'),
  (2, 'accommodation', 'Accommodation'),
  (3, 'artisan', 'Artisan and on-demand jobs');

CREATE TABLE service (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  location_id       UUID REFERENCES location(id),
  category_id       SMALLINT NOT NULL REFERENCES service_category(id),
  name              TEXT NOT NULL,
  description       TEXT,
  duration_minutes  INTEGER CHECK (duration_minutes IS NULL OR duration_minutes > 0),  -- null for stays priced per night
  price_minor_units INTEGER NOT NULL DEFAULT 0 CHECK (price_minor_units >= 0),
  currency_code     CHAR(3) NOT NULL,
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE service ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_tenant_isolation ON service
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE INDEX service_tenant_status_idx ON service (tenant_id, status);

-- A service can only ever be published while its tenant is verified.
-- Enforced again in application code (business-rules layer) but also
-- here at the database layer, per the three-layer isolation model.
CREATE OR REPLACE FUNCTION enforce_publish_requires_verified_tenant()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'published' THEN
    IF NOT EXISTS (
      SELECT 1 FROM tenant WHERE id = NEW.tenant_id AND verification_status = 'verified'
    ) THEN
      RAISE EXCEPTION 'Cannot publish a service for a tenant that is not verified (tenant %).', NEW.tenant_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER service_publish_requires_verified_tenant
  BEFORE INSERT OR UPDATE ON service
  FOR EACH ROW EXECUTE FUNCTION enforce_publish_requires_verified_tenant();

-- ---------------------------------------------------------------------
-- Availability: weekly working-hours rules, plus one-off blocked time
-- ---------------------------------------------------------------------

CREATE TABLE availability_rule (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  service_id    UUID REFERENCES service(id) ON DELETE CASCADE,  -- null = applies to the whole business
  day_of_week   SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),  -- 0 = Sunday
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  CONSTRAINT availability_rule_time_order CHECK (start_time < end_time)
);

ALTER TABLE availability_rule ENABLE ROW LEVEL SECURITY;
CREATE POLICY availability_rule_tenant_isolation ON availability_rule
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TABLE blocked_time (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  service_id    UUID REFERENCES service(id) ON DELETE CASCADE,
  starts_at     TIMESTAMPTZ NOT NULL,
  ends_at       TIMESTAMPTZ NOT NULL,
  reason        TEXT,
  CONSTRAINT blocked_time_order CHECK (starts_at < ends_at)
);

ALTER TABLE blocked_time ENABLE ROW LEVEL SECURITY;
CREATE POLICY blocked_time_tenant_isolation ON blocked_time
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ---------------------------------------------------------------------
-- CRM: customer profiles, notes (never customer-visible), tasks
-- ---------------------------------------------------------------------

CREATE TABLE customer_profile (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  linked_user_id UUID REFERENCES app_user(id),   -- set once the customer has their own account; nullable for a walk-in
  full_name     TEXT NOT NULL,
  phone         TEXT,
  email         CITEXT,
  created_by    UUID NOT NULL REFERENCES app_user(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE customer_profile ENABLE ROW LEVEL SECURITY;
CREATE POLICY customer_profile_tenant_isolation ON customer_profile
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Notes are staff-internal by construction: there is no customer-facing
-- API route anywhere in this module that reads this table (IR-CRM-07).
CREATE TABLE customer_note (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  customer_id     UUID NOT NULL REFERENCES customer_profile(id) ON DELETE CASCADE,
  author_user_id  UUID NOT NULL REFERENCES app_user(id),
  body            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE customer_note ENABLE ROW LEVEL SECURITY;
CREATE POLICY customer_note_tenant_isolation ON customer_note
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TABLE customer_task (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  customer_id     UUID REFERENCES customer_profile(id) ON DELETE CASCADE,
  assigned_to     UUID REFERENCES app_user(id),
  title           TEXT NOT NULL,
  due_at          TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'cancelled')),
  created_by      UUID NOT NULL REFERENCES app_user(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE customer_task ENABLE ROW LEVEL SECURITY;
CREATE POLICY customer_task_tenant_isolation ON customer_task
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

COMMIT;
