-- 011_oauth_identity.sql
--
-- Adds "Sign in with Google" / "Sign in with Facebook" support.
--
-- An OAuth-only account never sets a password of its own, so
-- app_user.password_hash (NOT NULL since migration 001) has to become
-- optional. Every existing row already has a real hash, so this is a
-- pure widening -- no backfill needed. AuthService.login() (password
-- sign-in) already fails closed on a NULL hash: argon2.verify() throws
-- on a non-argon2-format string, and a NULL there throws too, which
-- the login path treats the same as "wrong password" (generic
-- failure) rather than crashing.
--
-- oauth_identity links one or more third-party identities to an
-- app_user. A user can have both a Google and a Facebook identity (or
-- neither, if they signed up with a password); provider + the
-- provider's own subject id is what's actually unique, not the email
-- (an OAuth provider's email can be unverified or absent, so it's
-- stored for reference only, never used as the lookup key for
-- linking).

BEGIN;

ALTER TABLE app_user ALTER COLUMN password_hash DROP NOT NULL;

CREATE TABLE oauth_identity (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL CHECK (provider IN ('google', 'facebook')),
  provider_user_id  TEXT NOT NULL,
  email             CITEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_user_id)
);

CREATE INDEX oauth_identity_user_id_idx ON oauth_identity (user_id);

COMMIT;
