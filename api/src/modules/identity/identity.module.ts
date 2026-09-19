import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { MeController } from './me.controller';
import { AuthService } from './auth.service';
import { VerificationCodeService } from './verification-code.service';
import { SessionService } from './session.service';

@Module({
  controllers: [AuthController, MeController],
  providers: [AuthService, VerificationCodeService, SessionService],
})
export class IdentityModule {}
