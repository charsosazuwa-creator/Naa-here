import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { PaymentsService } from '../../src/modules/payments/payments.service';
import { PaymentProvider } from '../../src/modules/payments/payment-provider.interface';
import { DatabaseService } from '../../src/database/database.service';

/**
 * A minimal fake PoolClient that answers exactly the queries
 * PaymentsService and ledger.repository.ts's recordLedgerEntry are
 * known to issue, and records every call so assertions can check what
 * ran and in what order — mirroring the fake-DB style already used in
 * test/e2e/admin-finance.e2e-spec.ts, scaled down to one service.
 */
function makeFakeClient() {
  const calls: { sql: string; params: unknown[] }[] = [];
  const client = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.startsWith('INSERT INTO ledger_entry')) {
        return { rows: [{ id: 'ledger-1', tenant_id: params[0], booking_id: params[1], type: params[2], amount_minor_units: params[3], currency_code: params[4], fee_minor_units: 0, held_for_dispute_id: null, created_at: '2026-01-01T00:00:00Z' }] };
      }
      if (sql.startsWith('INSERT INTO escrow_account')) {
        return { rows: [] };
      }
      if (sql.startsWith('INSERT INTO payment_intent')) {
        return { rows: [{ id: 'intent-1' }] };
      }
      throw new Error(`Unhandled query in test fake: ${sql}`);
    }),
  } as unknown as PoolClient;
  return { client, calls };
}

function makeProviderStub(overrides: Partial<PaymentProvider> = {}): PaymentProvider {
  return {
    name: 'mock',
    initiateCharge: jest.fn().mockResolvedValue({ providerReference: 'ref-charge-1', status: 'succeeded' }),
    initiateRefund: jest.fn().mockResolvedValue({ providerReference: 'ref-refund-1', status: 'succeeded' }),
    initiatePayout: jest.fn().mockResolvedValue({ providerReference: 'ref-payout-1', status: 'succeeded' }),
    verifyWebhookSignature: jest.fn().mockReturnValue(true),
    parseWebhookEvent: jest.fn(),
    ...overrides,
  };
}

describe('PaymentsService', () => {
  describe('chargeAndRecord', () => {
    it('records a ledger entry and a succeeded payment_intent when the provider settles synchronously', async () => {
      const provider = makeProviderStub();
      const db = {} as DatabaseService;
      const service = new PaymentsService(provider, db);
      const { client, calls } = makeFakeClient();

      const outcome = await service.chargeAndRecord(client, {
        tenantId: 't1',
        bookingId: 'b1',
        amountMinorUnits: 500,
        currencyCode: 'NGN',
        createdBy: 'u1',
      });

      expect(provider.initiateCharge).toHaveBeenCalledWith({ tenantId: 't1', bookingId: 'b1', amountMinorUnits: 500, currencyCode: 'NGN' });
      expect(outcome.ledgerEntry?.id).toBe('ledger-1');
      expect(outcome.paymentIntentId).toBe('intent-1');

      const ledgerInsert = calls.find((c) => c.sql.startsWith('INSERT INTO ledger_entry'));
      expect(ledgerInsert?.params).toEqual(['t1', 'b1', 'charge', 500, 'NGN', 'u1', null]);

      const intentInsert = calls.find((c) => c.sql.startsWith('INSERT INTO payment_intent'));
      // tenant_id, booking_id, payout_id, kind, provider, provider_reference, amount, currency, status, ledger_entry_id, created_by
      expect(intentInsert?.params).toEqual(['t1', 'b1', null, 'charge', 'mock', 'ref-charge-1', 500, 'NGN', 'succeeded', 'ledger-1', 'u1']);
    });

    it('records only a pending payment_intent, and no ledger entry, when the provider does not settle synchronously', async () => {
      const provider = makeProviderStub({
        initiateCharge: jest.fn().mockResolvedValue({ providerReference: 'ref-charge-pending', status: 'pending' }),
      });
      const db = {} as DatabaseService;
      const service = new PaymentsService(provider, db);
      const { client, calls } = makeFakeClient();

      const outcome = await service.chargeAndRecord(client, {
        tenantId: 't1',
        bookingId: 'b1',
        amountMinorUnits: 500,
        currencyCode: 'NGN',
      });

      expect(outcome.ledgerEntry).toBeNull();
      expect(calls.some((c) => c.sql.startsWith('INSERT INTO ledger_entry'))).toBe(false);
      const intentInsert = calls.find((c) => c.sql.startsWith('INSERT INTO payment_intent'));
      expect(intentInsert?.params[8]).toBe('pending');
      expect(intentInsert?.params[9]).toBeNull();
    });
  });

  describe('handleWebhook', () => {
    function makeDbStub(client: PoolClient): DatabaseService {
      return { withTenant: jest.fn(async (_tenantId: string, fn: (c: PoolClient) => Promise<unknown>) => fn(client)) } as unknown as DatabaseService;
    }

    it('rejects a webhook with an invalid signature before looking anything up', async () => {
      const provider = makeProviderStub({ verifyWebhookSignature: jest.fn().mockReturnValue(false) });
      const db = { withTenant: jest.fn() } as unknown as DatabaseService;
      const service = new PaymentsService(provider, db);

      await expect(service.handleWebhook('{}', 'bad-signature')).rejects.toThrow(UnauthorizedException);
      expect((db.withTenant as jest.Mock).mock.calls.length).toBe(0);
    });

    it('confirms a pending intent and records the ledger entry on a succeeded event', async () => {
      const provider = makeProviderStub({
        parseWebhookEvent: jest.fn().mockReturnValue({ tenantId: 't1', providerReference: 'ref-charge-pending', status: 'succeeded' }),
      });

      const queryLog: { sql: string; params: unknown[] }[] = [];
      const client = {
        query: jest.fn(async (sql: string, params: unknown[] = []) => {
          queryLog.push({ sql, params });
          if (sql.startsWith('SELECT id, tenant_id, booking_id, payout_id, kind')) {
            return { rows: [{ id: 'intent-1', tenant_id: 't1', booking_id: 'b1', payout_id: null, kind: 'charge', amount_minor_units: 500, currency_code: 'NGN', status: 'pending' }] };
          }
          if (sql.startsWith('INSERT INTO ledger_entry')) {
            return { rows: [{ id: 'ledger-1', tenant_id: 't1', booking_id: 'b1', type: 'charge', amount_minor_units: 500, currency_code: 'NGN', fee_minor_units: 0, held_for_dispute_id: null, created_at: '2026-01-01T00:00:00Z' }] };
          }
          if (sql.startsWith('INSERT INTO escrow_account')) return { rows: [] };
          if (sql.startsWith('UPDATE payment_intent')) return { rows: [] };
          throw new Error(`Unhandled query in test fake: ${sql}`);
        }),
      } as unknown as PoolClient;

      const db = makeDbStub(client);
      const service = new PaymentsService(provider, db);

      const result = await service.handleWebhook('{"tenantId":"t1","providerReference":"ref-charge-pending","status":"succeeded"}', 'sig');

      expect(result).toEqual({ status: 'succeeded' });
      const update = queryLog.find((c) => c.sql.startsWith('UPDATE payment_intent'));
      expect(update?.params).toEqual(['intent-1', 'ledger-1']);
    });

    it('is idempotent: a webhook for an already-settled intent is a no-op that returns its current status', async () => {
      const provider = makeProviderStub({
        parseWebhookEvent: jest.fn().mockReturnValue({ tenantId: 't1', providerReference: 'ref-charge-1', status: 'succeeded' }),
      });
      const client = {
        query: jest.fn(async (sql: string) => {
          if (sql.startsWith('SELECT id, tenant_id, booking_id, payout_id, kind')) {
            return { rows: [{ id: 'intent-1', tenant_id: 't1', booking_id: 'b1', payout_id: null, kind: 'charge', amount_minor_units: 500, currency_code: 'NGN', status: 'succeeded' }] };
          }
          throw new Error(`Unhandled query in test fake: ${sql}`);
        }),
      } as unknown as PoolClient;

      const db = makeDbStub(client);
      const service = new PaymentsService(provider, db);

      const result = await service.handleWebhook('{"tenantId":"t1","providerReference":"ref-charge-1","status":"succeeded"}', 'sig');
      expect(result).toEqual({ status: 'succeeded' });
      expect((client.query as jest.Mock).mock.calls.length).toBe(1); // only the lookup, no update or ledger insert
    });

    it('throws NotFoundException when no payment_intent matches the event', async () => {
      const provider = makeProviderStub({
        parseWebhookEvent: jest.fn().mockReturnValue({ tenantId: 't1', providerReference: 'unknown-ref', status: 'succeeded' }),
      });
      const client = { query: jest.fn().mockResolvedValue({ rows: [] }) } as unknown as PoolClient;
      const db = makeDbStub(client);
      const service = new PaymentsService(provider, db);

      await expect(service.handleWebhook('{}', 'sig')).rejects.toThrow(NotFoundException);
    });

    it('marks the intent failed on a failed event, without recording a ledger entry', async () => {
      const provider = makeProviderStub({
        parseWebhookEvent: jest.fn().mockReturnValue({ tenantId: 't1', providerReference: 'ref-charge-pending', status: 'failed' }),
      });
      const queryLog: { sql: string; params: unknown[] }[] = [];
      const client = {
        query: jest.fn(async (sql: string, params: unknown[] = []) => {
          queryLog.push({ sql, params });
          if (sql.startsWith('SELECT id, tenant_id, booking_id, payout_id, kind')) {
            return { rows: [{ id: 'intent-1', tenant_id: 't1', booking_id: 'b1', payout_id: null, kind: 'charge', amount_minor_units: 500, currency_code: 'NGN', status: 'pending' }] };
          }
          if (sql.startsWith('UPDATE payment_intent')) return { rows: [] };
          throw new Error(`Unhandled query in test fake: ${sql}`);
        }),
      } as unknown as PoolClient;
      const db = makeDbStub(client);
      const service = new PaymentsService(provider, db);

      const result = await service.handleWebhook('{"tenantId":"t1","providerReference":"ref-charge-pending","status":"failed"}', 'sig');

      expect(result).toEqual({ status: 'failed' });
      expect(queryLog.some((c) => c.sql.startsWith('INSERT INTO ledger_entry'))).toBe(false);
      const update = queryLog.find((c) => c.sql.startsWith('UPDATE payment_intent'));
      expect(update?.params).toEqual(['intent-1']);
    });
  });
});
