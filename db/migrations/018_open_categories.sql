-- 018_open_categories.sql
--
-- Providers can now create business and service categories on the fly
-- instead of being stuck picking the closest of a handful of
-- hardcoded options.
--
-- Business categories: migration 002 added `tenant.category` as plain
-- TEXT with a CHECK constraint limited to exactly three values
-- ('barber_salon', 'accommodation', 'artisan'). That constraint is
-- replaced here with `business_category`, a shared, growing lookup
-- table (same shape as `service_category` from migration 002) that
-- the app can insert into when a provider types a category that
-- doesn't exist yet -- so it becomes available for every other
-- provider too, the same way service_category already behaves.
--
-- Role assignment used to be inferred from that same category text
-- ('artisan' -> the Artisan role, everything else -> Owner), which
-- only worked because the category set was small and fixed, and left
-- the platform's 'host' role (migration 001) permanently unreachable.
-- With categories now open-ended, role assignment gets its own
-- explicit field instead: `tenant.business_type`, one of
-- ('provider', 'artisan', 'host'), chosen directly at business
-- creation rather than inferred from the category label.
--
-- No RLS on business_category, matching service_category and the
-- existing listing/oauth_identity precedent: this is shared reference
-- data, not tenant-scoped, and discovery/browse depends on it being
-- globally readable.

BEGIN;

CREATE TABLE business_category (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  created_by  UUID REFERENCES app_user(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO business_category (code, name) VALUES
  ('barber_salon', 'Barber & Salon'),
  ('accommodation', 'Accommodation'),
  ('artisan', 'Artisan Services');

ALTER TABLE tenant
  ADD COLUMN business_type TEXT NOT NULL DEFAULT 'provider'
    CHECK (business_type IN ('provider', 'artisan', 'host')),
  ADD COLUMN category_id UUID REFERENCES business_category(id);

UPDATE tenant t SET category_id = bc.id
  FROM business_category bc WHERE bc.code = t.category;

UPDATE tenant SET business_type = 'artisan' WHERE category = 'artisan';

-- Every existing row's `category` was constrained to one of the three
-- values just seeded above, so the backfill is total; safe to make
-- the new column required and drop the old one (which also drops its
-- now-orphaned CHECK constraint automatically).
ALTER TABLE tenant ALTER COLUMN category_id SET NOT NULL;
ALTER TABLE tenant DROP COLUMN category;

-- service_category (migration 002) already had the right shape for
-- an open, growing list -- it just had no way for the app to insert
-- into it, and its `id` was populated by hand (1, 2, 3) with no
-- sequence backing it. Give it one, seeded past the existing rows,
-- plus the same audit columns business_category just got.
ALTER TABLE service_category
  ADD COLUMN created_by  UUID REFERENCES app_user(id),
  ADD COLUMN created_at  TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE SEQUENCE service_category_id_seq OWNED BY service_category.id;
SELECT setval('service_category_id_seq', (SELECT COALESCE(MAX(id), 0) FROM service_category));
ALTER TABLE service_category ALTER COLUMN id SET DEFAULT nextval('service_category_id_seq');

COMMIT;
