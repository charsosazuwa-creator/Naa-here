import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { MeController } from './me.controller';
import { OAuthController } from './oauth.controller';
import { AuthService } from './auth.service';
import { VerificationCodeService } from './verification-code.service';
import { SessionService } from './session.service';
import { OAuthService } from './oauth.service';
import { TenancyModule } from '../tenancy/tenancy.module';

@Module({
  imports: [TenancyModule],
  controllers: [AuthController, MeController, OAuthController],
  providers: [AuthService, VerificationCodeService, SessionService, OAuthService],
})
export class IdentityModule {}
