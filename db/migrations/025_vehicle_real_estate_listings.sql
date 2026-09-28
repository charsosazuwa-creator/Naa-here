-- 025_vehicle_real_estate_listings.sql
--
-- Extends the existing general marketplace (migration 012, "Post,
-- Advertise and Publish Products, Services and Inventions") with two
-- new listing types aimed at auto dealers and real estate businesses:
-- 'vehicle' and 'real_estate', alongside the existing
-- product/service/invention. Reuses everything already built for a
-- listing -- ownership, images, pricing, contact info, admin
-- moderation -- rather than a separate section, per scoping decision.
--
-- Structured, type-specific fields live in their own one-to-one
-- tables (listing_vehicle_detail / listing_property_detail) rather
-- than as extra nullable columns on `listing` itself, since they only
-- ever apply to one listing type each and would otherwise leave most
-- rows with a wide stripe of always-NULL columns. Every field in both
-- tables is optional -- a dealer can still post with just the
-- existing free-text title/description/category if they don't have
-- these details handy (see ListingService.upsertVehicleDetail /
-- upsertPropertyDetail).

BEGIN;

-- Widen the existing listing_type CHECK constraint. Looked up by
-- inspecting its actual definition rather than assuming Postgres's
-- default auto-generated name, so this doesn't break if that ever
-- changes.
DO $$
DECLARE
  existing_check text;
BEGIN
  SELECT conname INTO existing_check
  FROM pg_constraint
  WHERE conrelid = 'listing'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%listing_type%';

  IF existing_check IS NOT NULL THEN
    EXECUTE format('ALTER TABLE listing DROP CONSTRAINT %I', existing_check);
  END IF;
END $$;

ALTER TABLE listing ADD CONSTRAINT listing_listing_type_check
  CHECK (listing_type IN ('product', 'service', 'invention', 'vehicle', 'real_estate'));

CREATE TABLE listing_vehicle_detail (
  listing_id    UUID PRIMARY KEY REFERENCES listing(id) ON DELETE CASCADE,
  make          TEXT,
  model         TEXT,
  year          INTEGER CHECK (year IS NULL OR (year >= 1900 AND year <= 2100)),
  mileage_km    INTEGER CHECK (mileage_km IS NULL OR mileage_km >= 0),
  transmission  TEXT CHECK (transmission IS NULL OR transmission IN ('manual', 'automatic')),
  fuel_type     TEXT CHECK (fuel_type IS NULL OR fuel_type IN ('petrol', 'diesel', 'electric', 'hybrid')),
  condition     TEXT CHECK (condition IS NULL OR condition IN ('new', 'used')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX listing_vehicle_detail_make_idx ON listing_vehicle_detail (make);
CREATE INDEX listing_vehicle_detail_year_idx ON listing_vehicle_detail (year);

CREATE TABLE listing_property_detail (
  listing_id     UUID PRIMARY KEY REFERENCES listing(id) ON DELETE CASCADE,
  property_type  TEXT CHECK (property_type IS NULL OR property_type IN ('house', 'apartment', 'land', 'commercial', 'other')),
  bedrooms       INTEGER CHECK (bedrooms IS NULL OR bedrooms >= 0),
  bathrooms      INTEGER CHECK (bathrooms IS NULL OR bathrooms >= 0),
  area_sqm       NUMERIC CHECK (area_sqm IS NULL OR area_sqm >= 0),
  sale_or_rent   TEXT CHECK (sale_or_rent IS NULL OR sale_or_rent IN ('sale', 'rent')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX listing_property_detail_bedrooms_idx ON listing_property_detail (bedrooms);
CREATE INDEX listing_property_detail_sale_or_rent_idx ON listing_property_detail (sale_or_rent);

COMMIT;
