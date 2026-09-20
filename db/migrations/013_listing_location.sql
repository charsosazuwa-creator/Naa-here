-- 013_listing_location.sql
--
-- User Story 3 (Location, Google and AI Discovery): adds an optional
-- map pin to a listing so it can be found/sorted by distance
-- (US-004, US-008, US-009). Nullable and with no backfill — an
-- existing listing simply won't appear in a distance-limited or
-- distance-sorted search until its owner edits it and sets a
-- location (e.g. via the "use my current location" button on the
-- listing form). No PostGIS/earth_distance extension: at this data
-- volume a plain haversine formula computed in ListingService.search()
-- is simpler to deploy on Render's managed Postgres (no extension
-- approval needed) and fast enough; revisit only if/when the listing
-- table gets large enough for that to matter.

BEGIN;

ALTER TABLE listing
  ADD COLUMN latitude  DOUBLE PRECISION,
  ADD COLUMN longitude DOUBLE PRECISION;

COMMIT;
