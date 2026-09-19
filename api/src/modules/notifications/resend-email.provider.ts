import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailProvider, EmailMessage } from './email-provider.interface';
import { AppConfig } from '../../config/configuration';

/**
 * Real sender, used when EMAIL_PROVIDER=resend. Talks to Resend's
 * HTTP API directly with the platform's built-in fetch (Node 18+,
 * matching this project's engine) rather than pulling in the `resend`
 * npm package — one fewer dependency for a single POST request.
 *
 * Deliberately does not catch/swallow errors: a failed send throws,
 * and VerificationCodeService.issue() decides what that means for the
 * caller (see the comment there) rather than this class silently
 * pretending to have succeeded.
 */
@Injectable()
export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';

  private readonly logger = new Logger('ResendEmailProvider');

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  async send(message: EmailMessage): Promise<void> {
    const { apiKey, fromAddress, fromName } = this.config.get('notifications', { infer: true }).email;

    if (!apiKey) {
      throw new Error('EMAIL_PROVIDER=resend but RESEND_API_KEY is not set.');
    }

    const from = fromName ? `${fromName} <${fromAddress}>` : fromAddress;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '<unreadable response body>');
      throw new Error(`Resend API responded ${response.status} ${response.statusText}: ${body}`);
    }

    this.logger.log(`Sent email via Resend to ${message.to}`);
  }
}
