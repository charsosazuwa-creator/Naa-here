-- 006_payments.sql
-- Phase 4, "Payments" (design section 11's phase table), scoped per the
-- user's explicit decision on 2026-09-18: a generic payment-provider
-- adapter behind the dormant escrow ledger from migration 005, backed
-- by a mock provider standing in for a real PSP (Paystack, Flutterwave,
-- and similar are the obvious candidates for the launch markets) —
-- this sandbox has no network access to reach one. The adapter
-- interface (api/src/modules/payments/payment-provider.interface.ts)
-- is the thing a real integration implements; nothing in
-- booking/job/finance/dispute's application logic should need to
-- change when that swap happens, only which class payments.module.ts
-- binds to the PAYMENT_PROVIDER token.
--
-- payment_intent is the new thing this migration adds: a record of one
-- attempt to move money (charge, refund, or payout) through a
-- provider, tracked independently of ledger_entry so a provider's
-- asynchronous confirmation (a real PSP's webhook, arriving after the
-- HTTP request that started the charge has already returned) has
-- somewhere to land. ledger_entry itself is unchanged from migration
-- 005 — it's still the source of truth reconciliationReport() reads —
-- payment_intent is the provider-facing shadow of it, one row per
-- attempted charge/refund/payout, at most one successful
-- payment_intent contributing exactly one ledger_entry.

BEGIN;

CREATE TABLE payment_intent (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  booking_id          UUID REFERENCES booking(id),
  payout_id           UUID REFERENCES payout(id),
  kind                TEXT NOT NULL CHECK (kind IN ('charge', 'refund', 'payout')),
  provider            TEXT NOT NULL,
  provider_reference  TEXT NOT NULL,
  amount_minor_units  BIGINT NOT NULL CHECK (amount_minor_units > 0),
  currency_code       CHAR(3) NOT NULL,
  -- 'pending' until the provider confirms (synchronously, for the mock
  -- provider's default behaviour, or later via /v1/payments/webhook for
  -- a provider that confirms asynchronously); 'succeeded' or 'failed'
  -- are terminal. The mock provider currently always resolves
  -- synchronously to 'succeeded', preserving the exact ledger timing
  -- Milestone 4 already established — the 'pending' state and the
  -- webhook path exist so a real, asynchronous provider is a drop-in.
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed')),
  -- Set once (and only once) this attempt actually produces a ledger
  -- entry — i.e. on success. A failed or still-pending intent has none.
  ledger_entry_id     UUID REFERENCES ledger_entry(id),
  created_by          UUID REFERENCES app_user(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A provider's own reference is unique to that provider; this is
  -- also exactly the lookup key /v1/payments/webhook uses to find the
  -- intent a webhook event is about.
  CONSTRAINT payment_intent_provider_reference_unique UNIQUE (provider, provider_reference)
);

ALTER TABLE payment_intent ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_intent_tenant_isolation ON payment_intent
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
-- No append-only REVOKE here (unlike ledger_entry): a payment_intent
-- legitimately transitions pending -> succeeded/failed exactly once,
-- which is an UPDATE, not a correction of history. app_runtime's
-- default privileges (migration 003's ALTER DEFAULT PRIVILEGES) cover
-- the SELECT/INSERT/UPDATE/DELETE this table needs; DELETE is granted
-- but nothing in the application ever calls it.

CREATE INDEX payment_intent_tenant_created_idx ON payment_intent (tenant_id, created_at DESC);
CREATE INDEX payment_intent_booking_idx ON payment_intent (booking_id);
CREATE INDEX payment_intent_payout_idx ON payment_intent (payout_id);

COMMIT;
