import { Injectable, Logger } from '@nestjs/common';
import { EmailProvider, EmailMessage } from './email-provider.interface';

/**
 * Default provider when EMAIL_PROVIDER is unset (or set to 'mock').
 * Never calls a real service — writes the message to the server log
 * at `warn` level, clearly labelled, so it can't be mistaken for a
 * real send. This is what every environment used before the Resend
 * integration was wired up, and what a fresh/local environment still
 * gets out of the box with no email-provider env vars configured.
 */
@Injectable()
export class MockEmailProvider implements EmailProvider {
  readonly name = 'mock';

  private readonly logger = new Logger('MockEmailProvider');

  async send(message: EmailMessage): Promise<void> {
    this.logger.warn(
      `[MOCK EMAIL SEND — NOT ACTUALLY SENT] to=${message.to} subject="${message.subject}"\n${message.text}`,
    );
  }
}
