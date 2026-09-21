-- 020_calls.sql
--
-- Phase 2 of the voice-call/chat user stories: in-app voice calling
-- (User Story 1's group-member calls, and the calling halves of User
-- Stories 2 & 3). Every call here is strictly pairwise -- even
-- Story 1's "group" calls are one member calling another *within* a
-- shared group, never a multi-party conference (see its ACs: Accept,
-- Decline, End Call are all two-party verbs).
--
-- WebRTC media itself is peer-to-peer between the two browsers; this
-- table is the call's durable record (what messaging's REST-first
-- design calls "the thing signaling is a nudge about") plus the
-- signaling handshake's state machine. The moment-to-moment SDP
-- offer/answer/ICE exchange is NOT stored here -- it's relayed
-- directly over RealtimeGateway's new onInbound() channel and is
-- gone the instant it's delivered, same as a phone call's actual
-- audio was never going to be recorded.
--
-- context_type discriminates two eligibility regimes (both enforced
-- in the app layer, see call.service.ts):
--   'group'             -- caller and callee are both active members
--                           of the same group (group_id set).
--   'customer_provider' -- a Customer<->Provider call, gated the same
--                           way DirectMessageService gates a NEW
--                           conversation (tenant_id set; conversation_id
--                           set once a conversation exists for
--                           call-history/context linkage).
--
-- callee_user_id is nullable: a Customer calling a business doesn't
-- pick one specific staff member -- every active staff member's
-- device rings (same "notify all tenant staff" pattern direct
-- messaging already uses), and whichever one accepts becomes
-- accepted_by_user_id. A group call or a Provider-initiated call to a
-- Customer always has exactly one specific callee, known up front.
--
-- No RLS: same cross-tenant/user-level-entity precedent as
-- conversation/direct_message (migration 019) and group* (016/017) --
-- a call's participants are exactly who the app-layer checks already
-- need to authorize against.

BEGIN;

CREATE TABLE call (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  context_type        TEXT NOT NULL CHECK (context_type IN ('group', 'customer_provider')),
  group_id            UUID REFERENCES "group"(id) ON DELETE CASCADE,
  tenant_id           UUID REFERENCES tenant(id) ON DELETE CASCADE,
  conversation_id     UUID REFERENCES conversation(id) ON DELETE SET NULL,
  caller_user_id      UUID NOT NULL REFERENCES app_user(id),
  callee_user_id      UUID REFERENCES app_user(id),
  accepted_by_user_id UUID REFERENCES app_user(id),
  status              TEXT NOT NULL DEFAULT 'ringing'
                         CHECK (status IN ('ringing', 'accepted', 'declined', 'ended', 'no_answer', 'failed')),
  end_reason          TEXT,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at         TIMESTAMPTZ,
  ended_at            TIMESTAMPTZ,
  -- A call row is only ever consistent one of two ways -- both context
  -- columns set appropriately for its type, never a mix.
  CHECK (
    (context_type = 'group' AND group_id IS NOT NULL AND tenant_id IS NULL) OR
    (context_type = 'customer_provider' AND tenant_id IS NOT NULL AND group_id IS NULL)
  )
);

CREATE INDEX call_caller_idx ON call (caller_user_id, started_at DESC);
CREATE INDEX call_callee_idx ON call (callee_user_id, started_at DESC);
CREATE INDEX call_accepted_by_idx ON call (accepted_by_user_id, started_at DESC);
CREATE INDEX call_tenant_idx ON call (tenant_id, started_at DESC);
CREATE INDEX call_group_idx ON call (group_id, started_at DESC);

COMMIT;
