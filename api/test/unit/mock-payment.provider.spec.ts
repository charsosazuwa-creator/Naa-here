import { createHmac } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { MockPaymentProvider } from '../../src/modules/payments/mock-payment.provider';
import { AppConfig } from '../../src/config/configuration';

function makeConfig(secret: string | undefined): ConfigService<AppConfig, true> {
  return { get: () => ({ webhookSecret: secret }) } as unknown as ConfigService<AppConfig, true>;
}

describe('MockPaymentProvider', () => {
  it('resolves a charge synchronously to succeeded, with a unique provider reference', async () => {
    const provider = new MockPaymentProvider(makeConfig('shh'));
    const a = await provider.initiateCharge({ tenantId: 't1', bookingId: 'b1', amountMinorUnits: 500, currencyCode: 'NGN' });
    const b = await provider.initiateCharge({ tenantId: 't1', bookingId: 'b1', amountMinorUnits: 500, currencyCode: 'NGN' });

    expect(a.status).toBe('succeeded');
    expect(a.providerReference).toMatch(/^mock_charge_/);
    expect(a.providerReference).not.toBe(b.providerReference);
  });

  it('resolves refunds and payouts synchronously to succeeded too', async () => {
    const provider = new MockPaymentProvider(makeConfig('shh'));
    const refund = await provider.initiateRefund({ tenantId: 't1', bookingId: 'b1', amountMinorUnits: 500, currencyCode: 'NGN' });
    const payout = await provider.initiatePayout({ tenantId: 't1', payoutId: 'p1', amountMinorUnits: 500, currencyCode: 'NGN' });

    expect(refund.status).toBe('succeeded');
    expect(refund.providerReference).toMatch(/^mock_refund_/);
    expect(payout.status).toBe('succeeded');
    expect(payout.providerReference).toMatch(/^mock_payout_/);
  });

  describe('webhook signature verification', () => {
    const secret = 'test-webhook-secret';
    const body = JSON.stringify({ tenantId: 't1', providerReference: 'mock_charge_abc', status: 'succeeded' });

    it('accepts a correctly signed body', () => {
      const provider = new MockPaymentProvider(makeConfig(secret));
      const signature = createHmac('sha256', secret).update(body, 'utf8').digest('hex');

      expect(provider.verifyWebhookSignature(body, signature)).toBe(true);
    });

    it('rejects a body signed with the wrong secret', () => {
      const provider = new MockPaymentProvider(makeConfig(secret));
      const wrongSignature = createHmac('sha256', 'not-the-secret').update(body, 'utf8').digest('hex');

      expect(provider.verifyWebhookSignature(body, wrongSignature)).toBe(false);
    });

    it('rejects a tampered body even with a signature that was valid for the original body', () => {
      const provider = new MockPaymentProvider(makeConfig(secret));
      const signature = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
      const tamperedBody = body.replace('"succeeded"', '"failed"');

      expect(provider.verifyWebhookSignature(tamperedBody, signature)).toBe(false);
    });

    it('rejects when no signature header is present', () => {
      const provider = new MockPaymentProvider(makeConfig(secret));
      expect(provider.verifyWebhookSignature(body, undefined)).toBe(false);
    });

    it('fails closed when no webhook secret is configured', () => {
      const provider = new MockPaymentProvider(makeConfig(undefined));
      const signature = createHmac('sha256', 'anything').update(body, 'utf8').digest('hex');

      expect(provider.verifyWebhookSignature(body, signature)).toBe(false);
    });
  });

  describe('parseWebhookEvent', () => {
    it('parses a well-formed event', () => {
      const provider = new MockPaymentProvider(makeConfig('shh'));
      const event = provider.parseWebhookEvent(
        JSON.stringify({ tenantId: 't1', providerReference: 'mock_charge_abc', status: 'succeeded' }),
      );
      expect(event).toEqual({ tenantId: 't1', providerReference: 'mock_charge_abc', status: 'succeeded' });
    });

    it('throws on a body missing a required field', () => {
      const provider = new MockPaymentProvider(makeConfig('shh'));
      expect(() => provider.parseWebhookEvent(JSON.stringify({ tenantId: 't1', status: 'succeeded' }))).toThrow(
        'Malformed mock webhook event',
      );
    });
  });
});
