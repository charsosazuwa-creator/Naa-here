/**
 * The boundary a real email-sending integration implements — same
 * pattern as PaymentProvider (see payments/payment-provider.interface.ts):
 * everything that needs to send an email (right now, just
 * VerificationCodeService) talks to EmailProvider, never to a
 * specific vendor's SDK/API directly, so swapping providers means
 * writing one new class against this interface and changing one
 * binding in notifications.module.ts.
 */

export const EMAIL_PROVIDER = 'EMAIL_PROVIDER';

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain-text body. Always provided, even when `html` is also set, so a client with HTML disabled still gets a readable message. */
  text: string;
  html?: string;
}

export interface EmailProvider {
  /** Short identifier for logs (e.g. 'mock', 'resend'). */
  readonly name: string;

  send(message: EmailMessage): Promise<void>;
}
