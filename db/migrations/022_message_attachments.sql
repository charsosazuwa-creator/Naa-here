-- 022_message_attachments.sql
--
-- Files/images a Customer or Provider attaches to a direct message
-- (User Stories 2 & 3's chat halves) -- e.g. a Customer showing a
-- Provider a reference photo, or a Provider sending back a document.
-- Same "real bytes on disk, dedicated table" pattern as
-- dispute_attachment (migration 014) and listing_image (migration
-- 012), not the generic metadata-only `attachment` table from
-- migration 002. A message's body stays required (direct_message's
-- own CHECK, untouched) -- a client sending an attachment with no
-- typed text fills in a short default caption rather than this
-- migration relaxing that constraint.

BEGIN;

CREATE TABLE direct_message_attachment (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id    UUID NOT NULL REFERENCES direct_message(id) ON DELETE CASCADE,
  storage_key   TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  byte_size     INTEGER NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX direct_message_attachment_message_idx ON direct_message_attachment (message_id);

COMMIT;
