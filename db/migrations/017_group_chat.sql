-- 017_group_chat.sql
--
-- Live group chat, alongside groups' existing feed-style posts
-- (migration 016): a running conversation thread every active member
-- can read and post to, separate from group_post because it's a
-- different shape entirely (no topic/attachments/reactions/edit
-- history -- just a timestamped line from a member, polled by the
-- client rather than pushed, since this project has no websocket/SSE
-- layer anywhere else to hang a real-time channel off of).
--
-- Same reasoning as the rest of migration 016: cross-tenant, user-
-- level, no RLS -- membership/role checks happen in
-- group-chat.service.ts exactly like group.service.ts's other checks.

BEGIN;

CREATE TABLE group_message (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id          UUID NOT NULL REFERENCES "group"(id) ON DELETE CASCADE,
  author_user_id    UUID NOT NULL REFERENCES app_user(id),
  body              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'removed')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Backs both "give me the last N messages" (initial load) and "give
-- me everything after message X" (poll) without a full table scan.
CREATE INDEX group_message_group_created_idx ON group_message (group_id, created_at ASC);

COMMIT;
