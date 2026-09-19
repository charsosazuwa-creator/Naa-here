import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import configuration from './config/configuration';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { DatabaseModule } from './database/database.module';
import { AuthCommonModule } from './common/auth-common.module';
import { IdentityModule } from './modules/identity/identity.module';
import { TenancyModule } from './modules/tenancy/tenancy.module';
import { VerificationModule } from './modules/verification/verification.module';
import { CatalogueModule } from './modules/catalogue/catalogue.module';
import { DiscoveryModule } from './modules/discovery/discovery.module';
import { FilesModule } from './modules/files/files.module';
import { CrmModule } from './modules/crm/crm.module';
import { BookingModule } from './modules/booking/booking.module';
import { JobModule } from './modules/job/job.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { DisputeModule } from './modules/dispute/dispute.module';
import { FinanceModule } from './modules/finance/finance.module';
import { ModerationModule } from './modules/moderation/moderation.module';
import { AuditModule } from './modules/audit/audit.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    // Rate limiting protects auth routes from brute-force and enumeration
    // (BR-SEC-02, master prompt section 8 "Input and web attacks").
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    DatabaseModule,
    AuthCommonModule,
    AuditModule,
    NotificationsModule,
    TenancyModule,
    IdentityModule,
    VerificationModule,
    CatalogueModule,
    DiscoveryModule,
    FilesModule,
    CrmModule,
    BookingModule,
    JobModule,
    PaymentsModule,
    DisputeModule,
    FinanceModule,
    ModerationModule,
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
