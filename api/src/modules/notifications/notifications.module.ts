import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EMAIL_PROVIDER } from './email-provider.interface';
import { MockEmailProvider } from './mock-email.provider';
import { ResendEmailProvider } from './resend-email.provider';
import { AppConfig } from '../../config/configuration';

/**
 * The only file that needs to change to add a new email vendor, or to
 * switch which one is active — same shape as PaymentsModule's binding
 * of PAYMENT_PROVIDER. Both concrete providers are always constructed
 * (cheap — no network calls in their constructors); the factory just
 * picks which one EMAIL_PROVIDER resolves to based on config, so
 * toggling EMAIL_PROVIDER in the environment is enough to switch
 * senders with no code change and no redeploy-time branching logic
 * elsewhere.
 *
 * @Global(), matching DatabaseModule/AuditModule/PaymentsModule's own
 * pattern — IdentityModule needs EMAIL_PROVIDER and shouldn't need to
 * import NotificationsModule itself to get it.
 */
@Global()
@Module({
  providers: [
    MockEmailProvider,
    ResendEmailProvider,
    {
      provide: EMAIL_PROVIDER,
      useFactory: (config: ConfigService<AppConfig, true>, mock: MockEmailProvider, resend: ResendEmailProvider) => {
        const providerName = config.get('notifications', { infer: true }).email.provider;
        return providerName === 'resend' ? resend : mock;
      },
      inject: [ConfigService, MockEmailProvider, ResendEmailProvider],
    },
  ],
  exports: [EMAIL_PROVIDER],
})
export class NotificationsModule {}
