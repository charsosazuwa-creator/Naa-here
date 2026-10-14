-- 027_sso.sql
-- Single sign-on with the CLOUD MEDIA account (api/src/modules/identity/sso.*).
--  * oauth_identity accepts the new 'cloudmedia' provider (the central account id is provider_user_id).
--  * user_session remembers which central session ("sid") it came from, so a sign-out notice from
--    the CLOUD MEDIA account can end exactly those Naa here sessions.

BEGIN;

ALTER TABLE oauth_identity DROP CONSTRAINT IF EXISTS oauth_identity_provider_check;
ALTER TABLE oauth_identity ADD CONSTRAINT oauth_identity_provider_check
  CHECK (provider IN ('google', 'facebook', 'cloudmedia'));

ALTER TABLE user_session ADD COLUMN sso_sid TEXT;
CREATE INDEX user_session_sso_sid_idx ON user_session (sso_sid) WHERE sso_sid IS NOT NULL;

COMMIT;
