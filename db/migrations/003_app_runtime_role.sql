-- 003_app_runtime_role.sql
--
-- IMPORTANT CORRECTNESS FIX, not new functionality.
--
-- PostgreSQL row-level security policies NEVER apply to a table's
-- owner (or to a superuser), regardless of what any policy says. Every
-- RLS policy added in migrations 001 and 002 assumed the API's own
-- database connection would be subject to them — but if DATABASE_URL
-- connects as the same role that ran the migrations (which owns every
-- table it created), Postgres silently bypasses every one of those
-- policies for that connection. The tenant isolation the design
-- package calls "the database layer" of its three-layer authorization
-- model (section 10) would be a no-op in that setup: the guards and
-- business-rules checks in the API would still work, but the
-- database's own independent backstop would not.
--
-- This migration creates a dedicated, NON-OWNER runtime role that the
-- application should actually connect as. Run this (and every
-- migration) as an administrative/owning role; then point the API's
-- DATABASE_URL at `app_runtime` instead. See README "Database roles".

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    -- No password is set here: set one out of band (ALTER ROLE app_runtime
    -- WITH PASSWORD '...') from a secret, never committed to this file.
    CREATE ROLE app_runtime WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_runtime', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO app_runtime;

-- Ordinary read/write on everything except the append-only audit log.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;

-- Re-assert the append-only rule from migration 001, now against the
-- role that actually matters: app_runtime never gets UPDATE/DELETE on
-- audit_event. (The REVOKE FROM PUBLIC in 001 was a no-op for the
-- owner for the same reason this whole migration exists — but it was
-- never a no-op for app_runtime, which is the point.)
REVOKE UPDATE, DELETE ON audit_event FROM app_runtime;

-- New tables created by LATER migrations won't automatically grant to
-- app_runtime, so future migrations must either add an explicit GRANT
-- or rely on this: any table created by the same role that ran this
-- migration gets these default privileges from here on.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;

COMMIT;
