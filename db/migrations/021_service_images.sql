-- 021_service_images.sql
--
-- Photos for a tenant-scoped catalogue `service` (migration 002) --
-- Providers can now attach real images while creating/managing a
-- service, mirroring listing_image (migration 012) exactly: real
-- bytes on disk under the API's uploads directory
-- (service-image.service.ts), not just metadata. Deliberately its own
-- table rather than reusing listing_image, since a `service` and a
-- `listing` are two different owning entities with two different
-- access-control models (tenant membership + permission here, plain
-- owner_user_id there).

BEGIN;

CREATE TABLE service_image (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id    UUID NOT NULL REFERENCES service(id) ON DELETE CASCADE,
  -- Relative path under UPLOADS_DIR, e.g. "services/<serviceId>/<uuid>.jpg"
  -- -- served back at /uploads/<storage_key>, same convention as
  -- listing_image.storage_key.
  storage_key   TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  byte_size     INTEGER NOT NULL,
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX service_image_service_idx ON service_image (service_id);

COMMIT;
