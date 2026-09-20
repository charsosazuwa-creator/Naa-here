-- 012_marketplace_listings.sql
--
-- User Story 2: "Post, Advertise and Publish Products, Services and
-- Inventions" — a general marketplace listing any registered user can
-- own (a Customer, a Service Provider, or a business owner), distinct
-- from the existing tenant-scoped `service` catalogue (002's
-- appointment-booking services, owned by a tenant/business and
-- managed through TenancyController's permission model). A listing
-- here is owned directly by an app_user, with no tenant/business
-- required — so a plain Customer account, with no business of their
-- own, can still post something for sale. Not tenant-scoped, so (like
-- app_user itself) there is no RLS policy on these tables; ownership
-- is enforced in the application layer by comparing owner_user_id to
-- the signed-in user, the same way AuthService/BusinessService.
--
-- Every new listing starts as 'draft', moves to 'pending_review' when
-- the owner submits/publishes it (AC13/AC14), and only becomes
-- 'published' once a platform admin approves it through the
-- 'listing.moderate' permission (already granted to the
-- administrator role in migration 005 — this reuses that exact
-- permission, since "moderating listings" is exactly what it was
-- named for, even though 005's own listing_moderation_action table
-- turned out to be hardcoded to the tenant `service` table and so
-- isn't reusable here; listing_moderation_decision below is this
-- table's own equivalent).

BEGIN;

CREATE TABLE listing (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id       UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  listing_type        TEXT NOT NULL CHECK (listing_type IN ('product', 'service', 'invention')),
  title               TEXT NOT NULL,
  category            TEXT NOT NULL,
  description         TEXT,
  -- Pricing is deliberately optional and separate from whether it's
  -- fixed: 'contact'/'negotiable' listings carry no price at all,
  -- 'starting_from' and 'fixed' both carry one (enforced by the DTO,
  -- not the database — same defence-in-depth split as
  -- password.util.ts's assertPasswordStrength).
  price_minor_units   INTEGER,
  currency_code       CHAR(3),
  price_type          TEXT NOT NULL DEFAULT 'fixed'
                        CHECK (price_type IN ('fixed', 'contact', 'negotiable', 'starting_from')),
  country_code        CHAR(2) REFERENCES country_config(country_code),
  location_text       TEXT,
  -- The owner explicitly chooses one value to expose for THIS
  -- listing, decoupled from their account's actual email/phone
  -- (app_user.email/phone are never read here) — satisfies AC27
  -- ("private account information shall not be exposed") by
  -- construction rather than by a display-time filter.
  contact_method      TEXT NOT NULL CHECK (contact_method IN ('phone', 'email', 'whatsapp')),
  contact_value       TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'pending_review', 'published', 'paused', 'rejected', 'archived')),
  rejection_reason    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX listing_owner_idx ON listing (owner_user_id);
CREATE INDEX listing_status_idx ON listing (status);
CREATE INDEX listing_type_idx ON listing (listing_type);
CREATE INDEX listing_country_idx ON listing (country_code);

CREATE TABLE listing_image (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id    UUID NOT NULL REFERENCES listing(id) ON DELETE CASCADE,
  -- Relative path under the API's uploads directory (see
  -- listing-image.service.ts), e.g. "listings/<listingId>/<uuid>.jpg"
  -- — served back at /uploads/<storage_key>. Real bytes on disk, not
  -- just metadata (unlike attachment.storage_key in 002, whose actual
  -- object-storage upload was left for a later phase — this feature
  -- needs a real, visible image today).
  storage_key   TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  byte_size     INTEGER NOT NULL,
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX listing_image_listing_idx ON listing_image (listing_id);

CREATE TABLE listing_moderation_decision (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id    UUID NOT NULL REFERENCES listing(id) ON DELETE CASCADE,
  decision      TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  reason        TEXT,
  actor_user_id UUID NOT NULL REFERENCES app_user(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX listing_moderation_decision_listing_idx ON listing_moderation_decision (listing_id);

COMMIT;
