import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { MeController } from './me.controller';
import { OAuthController } from './oauth.controller';
import { AuthService } from './auth.service';
import { VerificationCodeService } from './verification-code.service';
import { SessionService } from './session.service';
import { OAuthService } from './oauth.service';
import { SsoService } from './sso.service';
import { SsoController } from './sso.controller';
import { TenancyModule } from '../tenancy/tenancy.module';

@Module({
  imports: [TenancyModule],
  controllers: [AuthController, MeController, OAuthController, SsoController],
  providers: [AuthService, VerificationCodeService, SessionService, OAuthService, SsoService],
})
export class IdentityModule {}
