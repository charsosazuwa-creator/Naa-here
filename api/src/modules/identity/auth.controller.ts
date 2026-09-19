import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyDto, ResendVerificationDto } from './dto/verify.dto';
import { LoginDto, RefreshDto, LogoutDto, ForgotPasswordDto, ResetPasswordDto } from './dto/login.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';

/**
 * Routes exactly as listed in design section 15:
 * POST /v1/auth/register, /auth/verify, /auth/verify/resend,
 * /auth/login, /auth/refresh, /auth/logout, /auth/password/forgot,
 * /auth/password/reset, GET/PATCH /v1/me.
 * (main.ts sets the global 'v1' prefix, so paths below omit it.)
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // Phase 6 hardening: tighter than the global 100/60s default
  // (app.module.ts) on every route below that an attacker could use
  // for enumeration or brute-forcing — registration abuse, guessing a
  // verification/reset code, or password-guessing a known account.
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.auth.register(dto, req.ip);
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verify(@Body() dto: VerifyDto) {
    await this.auth.verify(dto.userId, dto.purpose, dto.code);
    return { verified: true };
  }

  @Post('verify/resend')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async resend(@Body() dto: ResendVerificationDto) {
    await this.auth.resendVerification(dto.userId, dto.purpose);
    return { sent: true };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const { user, tokens } = await this.auth.login(
      { email: dto.email, phone: dto.phone },
      dto.password,
      req.headers['user-agent'],
      req.ip,
    );
    return { user, ...tokens };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, req.headers['user-agent'], req.ip);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: LogoutDto) {
    await this.auth.logout(dto.refreshToken);
  }

  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword({ email: dto.email, phone: dto.phone });
    // Always the same response, whether or not the account exists.
    return { message: 'If an account exists, a reset code has been sent.' };
  }

  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword({ email: dto.email, phone: dto.phone }, dto.code, dto.newPassword);
    return { reset: true };
  }
}
