-- 001_init_identity_tenancy.sql
-- Milestone 1: identity, tenancy, membership, roles/permissions, sessions,
-- verification codes and the append-only audit log.
--
-- Design references: design package sections 6 (Multi-tenancy), 7 (Data
-- model), 10 (Security controls). Requirement IDs: ACC-03, BR-016,
-- BR-SEC-02, UX-BE-01, BR-CFG-01, BR-SYS-01, BR-SYS-02, BR-DAT-01.
--
-- Every tenant-scoped table carries tenant_id and a row-level security
-- policy that only allows access when tenant_id matches the session's
-- current tenant (set per-request by the API via `SET LOCAL app.tenant_id`).
-- This is the second of the three independent isolation layers described
-- in section 10 (API layer + business rules layer + database layer).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- Needed before app_user's `email CITEXT` column below is declared —
-- this used to run after that CREATE TABLE, which fails with "type
-- citext does not exist" the moment this migration is actually
-- executed (never caught before because it never had been).
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------
-- Platform-wide configuration (not tenant-scoped)
-- ---------------------------------------------------------------------

CREATE TABLE configuration_version (
  id              SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  schema_version  INTEGER NOT NULL DEFAULT 1,
  applied_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO configuration_version (id, schema_version) VALUES (1, 1);

CREATE TABLE country_config (
  country_code    CHAR(2) PRIMARY KEY,          -- ISO 3166-1 alpha-2: NG, KE, GH, ZA
  currency_code   CHAR(3) NOT NULL,              -- ISO 4217: NGN, KES, GHS, ZAR
  default_language TEXT NOT NULL DEFAULT 'en',
  time_zone       TEXT NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO country_config (country_code, currency_code, default_language, time_zone) VALUES
  ('NG', 'NGN', 'en', 'Africa/Lagos'),
  ('KE', 'KES', 'en', 'Africa/Nairobi'),
  ('GH', 'GHS', 'en', 'Africa/Accra'),
  ('ZA', 'ZAR', 'en', 'Africa/Johannesburg');

-- ---------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------

CREATE TABLE tenant (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  country_code    CHAR(2) NOT NULL REFERENCES country_config(country_code),
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'suspended', 'closed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Identity: a person, independent of any tenant. A person becomes a
-- member of one or more tenants through `membership`.
-- ---------------------------------------------------------------------

CREATE TABLE app_user (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 CITEXT,
  phone                 TEXT,
  password_hash         TEXT NOT NULL,
  full_name             TEXT NOT NULL,
  preferred_language    TEXT NOT NULL DEFAULT 'en',
  status                TEXT NOT NULL DEFAULT 'pending_verification'
                          CHECK (status IN ('pending_verification', 'active', 'disabled')),
  email_verified_at     TIMESTAMPTZ,
  phone_verified_at     TIMESTAMPTZ,
  failed_login_count    INTEGER NOT NULL DEFAULT 0,
  locked_until          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT app_user_identifier_present CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE UNIQUE INDEX app_user_email_unique ON app_user (email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX app_user_phone_unique ON app_user (phone) WHERE phone IS NOT NULL;

-- One-time codes for email/phone verification and password reset.
-- The sender is mocked in this milestone: codes are written to the
-- server log, never actually sent (see identity/verification-code.service.ts).
CREATE TABLE verification_code (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  purpose       TEXT NOT NULL CHECK (purpose IN ('email_verify', 'phone_verify', 'password_reset')),
  code_hash     TEXT NOT NULL,          -- the code itself is never stored in the clear
  channel       TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_at   TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX verification_code_user_purpose_idx ON verification_code (user_id, purpose, expires_at DESC);

-- Refresh-token sessions. The access token is a short-lived signed JWT
-- and is never persisted; only its refresh-token family is.
CREATE TABLE user_session (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL,
  user_agent        TEXT,
  ip_address        INET,
  revoked_at        TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX user_session_token_hash_unique ON user_session (refresh_token_hash);
CREATE INDEX user_session_user_idx ON user_session (user_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------
-- Roles, permissions, and tenant membership
-- ---------------------------------------------------------------------

CREATE TABLE role (
  id            SMALLINT PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,   -- owner, staff, artisan, host, support_agent, administrator, finance_administrator
  description   TEXT NOT NULL
);

INSERT INTO role (id, code, description) VALUES
  (1, 'owner',                'Provider business owner'),
  (2, 'staff',                'Provider staff member'),
  (3, 'artisan',              'Independent artisan / on-demand worker'),
  (4, 'host',                 'Accommodation host'),
  (5, 'support_agent',        'Platform support agent'),
  (6, 'administrator',        'Platform administrator'),
  (7, 'finance_administrator','Platform finance administrator');

CREATE TABLE permission (
  id            SMALLINT PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE      -- e.g. booking.read, booking.write, staff.manage
);

CREATE TABLE role_permission (
  role_id       SMALLINT NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  permission_id SMALLINT NOT NULL REFERENCES permission(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- Membership ties a person to a tenant with a role. Tenant-scoped: RLS applies.
CREATE TABLE membership (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role_id       SMALLINT NOT NULL REFERENCES role(id),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'suspended', 'removed')),
  invited_by    UUID REFERENCES app_user(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

-- NULLIF(..., '') around every current_setting('app.*', true) in this
-- and every later migration guards against a real, previously-invisible
-- failure mode: current_setting(name, true) returns NULL only the very
-- first time a custom GUC name is referenced in a session. Once ANY
-- transaction on a pooled connection has done `SET LOCAL app.tenant_id
-- = ...` (as DatabaseService.withTenant() does), that connection's
-- app.tenant_id placeholder exists for the rest of the session — so
-- after the transaction ends and the connection is returned to the
-- pool, a later plain, non-tenant-scoped query reusing that SAME
-- connection (e.g. DatabaseService.query(), which grabs whatever
-- connection the pool hands it) sees current_setting(...) come back as
-- '' (empty string), not NULL. The bare `::uuid` cast then throws
-- "invalid input syntax for type uuid" instead of the intended
-- fail-closed NULL/false — only surfaces under a real connection pool
-- being reused across requests, which no fake-DB-backed test, and no
-- test that opens one connection per test, will ever exercise.
ALTER TABLE membership ENABLE ROW LEVEL SECURITY;
CREATE POLICY membership_tenant_isolation ON membership
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ---------------------------------------------------------------------
-- Audit log — append-only, tenant-scoped, never editable (BR-SEC-02, BR-015).
-- ---------------------------------------------------------------------

CREATE TABLE audit_event (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     UUID REFERENCES tenant(id),   -- nullable: platform-level events have no tenant
  actor_user_id UUID REFERENCES app_user(id),
  action        TEXT NOT NULL,                -- e.g. 'auth.register', 'auth.login', 'membership.role_change'
  target_type   TEXT,
  target_id     TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address    INET,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE audit_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_event_tenant_isolation ON audit_event
  USING (tenant_id IS NULL OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Enforce append-only at the database layer: no UPDATE or DELETE, ever.
-- NOTE: PostgreSQL table owners always bypass GRANT/REVOKE on their own
-- tables. This REVOKE only has teeth once the application connects as a
-- role that is NOT the table owner (e.g. an `app_runtime` role created
-- and granted INSERT/SELECT only) — create that role and re-point
-- DATABASE_URL at it before relying on this as a real control. Tracked
-- as a follow-up in the design package's risk register (section 13).
REVOKE UPDATE, DELETE ON audit_event FROM PUBLIC;

CREATE INDEX audit_event_tenant_created_idx ON audit_event (tenant_id, created_at DESC);
CREATE INDEX audit_event_actor_idx ON audit_event (actor_user_id, created_at DESC);

COMMIT;
