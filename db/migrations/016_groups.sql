-- 016_groups.sql
--
-- User Story 5: "Create a Service Provider and Business Owner Group" --
-- a community-group subsystem: groups, membership (with roles and
-- moderation actions), posts with attachments, comments/replies,
-- reactions, and content moderation reports.
--
-- Like `customer_invitation` (migration 015) and `listing` (migration
-- 012), a group is a cross-tenant, user-level entity -- it is not
-- owned by any one business/tenant, it is owned by a user (who may
-- run several businesses) and its members are individual people, not
-- tenants. So, following that same established precedent, RLS is NOT
-- applied here: isolation and every eligibility/role/moderation rule
-- is enforced in the application layer (group.service.ts and friends),
-- the same way listing.service.ts enforces listing ownership.

BEGIN;

CREATE TABLE "group" (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  description       TEXT,
  industry_category TEXT,
  location_text     TEXT,
  image_url         TEXT,
  visibility        TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private', 'hidden')),
  -- 'open' = anyone eligible can join directly; 'request' = join
  -- requests need admin approval; 'invite_only' = never self-joinable.
  membership_type   TEXT NOT NULL DEFAULT 'open' CHECK (membership_type IN ('open', 'request', 'invite_only')),
  rules             TEXT,
  owner_user_id     UUID NOT NULL REFERENCES app_user(id),
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX group_name_idx ON "group" (name);
CREATE INDEX group_category_idx ON "group" (industry_category);
CREATE INDEX group_visibility_idx ON "group" (visibility) WHERE status = 'active';

CREATE TABLE group_member (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id          UUID NOT NULL REFERENCES "group"(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES app_user(id),
  role              TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'administrator', 'moderator', 'member')),
  -- 'pending' = awaiting admin approval of a join request; 'invited' =
  -- awaiting the invitee's accept/decline; 'active' = a full member;
  -- 'suspended'/'muted' = restricted but still a member (moderation
  -- actions); 'removed'/'declined'/'left' = no longer participating.
  status            TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('pending', 'invited', 'active', 'suspended', 'muted', 'removed', 'declined', 'left')),
  invited_by        UUID REFERENCES app_user(id),
  muted_until       TIMESTAMPTZ,
  suspended_until   TIMESTAMPTZ,
  last_status_reason TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, user_id)
);

CREATE INDEX group_member_group_idx ON group_member (group_id, status);
CREATE INDEX group_member_user_idx ON group_member (user_id, status);

CREATE TABLE group_post (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id          UUID NOT NULL REFERENCES "group"(id) ON DELETE CASCADE,
  author_user_id    UUID NOT NULL REFERENCES app_user(id),
  topic             TEXT NOT NULL DEFAULT 'general' CHECK (topic IN (
                      'service', 'product', 'invention', 'business_idea', 'industry_knowledge',
                      'opportunity', 'event', 'training', 'question', 'general'
                    )),
  body              TEXT NOT NULL,
  -- AC: posts about products/inventions must show an IP-disclosure
  -- reminder and require acknowledgment where configured.
  ip_ack_required   BOOLEAN NOT NULL DEFAULT false,
  ip_ack_at         TIMESTAMPTZ,
  share_count       INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden', 'removed')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX group_post_group_idx ON group_post (group_id, created_at DESC);

-- Real bytes on disk under UPLOADS_DIR, served at /uploads/<storage_key>
-- (main.ts) -- same pattern as dispute_attachment (migration 014) and
-- listing_image (migration 012), not the metadata-only `attachment`
-- table from migration 002. A 'link' attachment (a URL to something
-- elsewhere, e.g. a video hosted off-platform) has no file on disk, so
-- storage_key doubles as the link target in that one case instead of
-- a path -- see group-post-attachment.service.ts.
CREATE TABLE group_post_attachment (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id           UUID NOT NULL REFERENCES group_post(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL CHECK (kind IN ('image', 'video', 'document', 'link')),
  storage_key       TEXT NOT NULL,
  content_type      TEXT,
  byte_size         INTEGER,
  uploaded_by       UUID NOT NULL REFERENCES app_user(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX group_post_attachment_post_idx ON group_post_attachment (post_id);

CREATE TABLE group_post_comment (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id           UUID NOT NULL REFERENCES group_post(id) ON DELETE CASCADE,
  author_user_id    UUID NOT NULL REFERENCES app_user(id),
  parent_comment_id UUID REFERENCES group_post_comment(id) ON DELETE CASCADE,
  body              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden', 'removed')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX group_post_comment_post_idx ON group_post_comment (post_id, created_at ASC);

CREATE TABLE group_post_reaction (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id           UUID NOT NULL REFERENCES group_post(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES app_user(id),
  reaction_type     TEXT NOT NULL DEFAULT 'like',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (post_id, user_id)
);

-- Moderation reports on either a post or a comment -- one table with a
-- polymorphic target, same shape group_post_attachment style tables
-- elsewhere in this schema avoid, but here the two target types share
-- literally every other column and workflow, so one table with a
-- target_type/target_id pair (checked, not FK-enforced, exactly like
-- audit_event.target_type/target_id) is simpler than two near-
-- identical tables.
CREATE TABLE group_moderation_report (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id          UUID NOT NULL REFERENCES "group"(id) ON DELETE CASCADE,
  target_type       TEXT NOT NULL CHECK (target_type IN ('post', 'comment')),
  target_id         UUID NOT NULL,
  reported_by       UUID NOT NULL REFERENCES app_user(id),
  reason            TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed')),
  decision          TEXT CHECK (decision IN ('retained', 'hidden', 'removed')),
  decision_reason   TEXT,
  decided_by        UUID REFERENCES app_user(id),
  decided_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX group_moderation_report_group_idx ON group_moderation_report (group_id, status);

COMMIT;
