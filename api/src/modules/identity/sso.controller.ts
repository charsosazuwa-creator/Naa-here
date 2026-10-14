import { Body, Controller, Get, Header, HttpCode, HttpStatus, Post, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { SsoService } from './sso.service';
import { OAuthService } from './oauth.service';
import { SsoCallbackQueryDto, SsoLogoutQueryDto, SsoStartQueryDto } from './dto/oauth.dto';
import { AppConfig } from '../../config/configuration';

/**
 * Single sign-on with the CLOUD MEDIA account. Every route except the back-channel notice is a full
 * browser navigation. Successful sign-ins land on web/auth/oauth-callback.html (tokens in the URL
 * fragment, exactly like Google/Facebook), which stores them and continues to the right app.
 */
@Controller('auth/sso')
export class SsoController {
  constructor(
    private readonly sso: SsoService,
    private readonly oauth: OAuthService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  private base(): string {
    return this.config.get('publicBaseUrl', { infer: true }).replace(/\/+$/, '');
  }

  /** Lets the static pages know whether to show "Continue with your CLOUD MEDIA account". */
  @Get('config')
  @Header('Cache-Control', 'no-store')
  config_() {
    return { enabled: this.sso.enabled };
  }

  @Get()
  async start(@Query() q: SsoStartQueryDto, @Res() res: Response): Promise<void> {
    const role = q.role ?? 'customer';
    if (!this.sso.enabled) {
      res.redirect(`${this.base()}/${role === 'provider' ? 'provider' : 'customer'}/login.html`);
      return;
    }
    try {
      const business = this.oauth.parseBusinessParam(q.business);
      res.redirect(await this.sso.buildAuthorizationUrl(role, { business, prompt: q.prompt, next: q.next }));
    } catch (err) {
      this.fail(res, role, err);
    }
  }

  @Get('callback')
  async callback(@Query() q: SsoCallbackQueryDto, @Req() req: Request, @Res() res: Response): Promise<void> {
    let state;
    try {
      state = await this.sso.readState(q.state ?? '');
    } catch (err) {
      this.fail(res, undefined, err);
      return;
    }
    if (q.error) {
      // A silent check found no CLOUD MEDIA sign-in: carry on to the page as a visitor.
      if (state.prompt === 'none') {
        res.redirect(`${this.base()}${SsoService.safeNext(state.next) ?? `/${state.role}/index.html`}`);
        return;
      }
      this.fail(res, state.role, new Error(q.error === 'access_denied' ? 'Sign-in was cancelled.' : 'Sign-in did not complete. Please try again.'));
      return;
    }
    try {
      const result = await this.sso.completeSignIn(q.code ?? '', state, req.headers['user-agent'], req.ip);
      const params = new URLSearchParams({
        accessToken: result.tokens.accessToken,
        refreshToken: result.tokens.refreshToken,
        role: result.role,
        user: JSON.stringify(result.user),
      });
      if (result.tenantId) params.set('tenantId', result.tenantId);
      if (result.next) params.set('next', result.next);
      res.redirect(`${this.base()}/auth/oauth-callback.html#${params.toString()}`);
    } catch (err) {
      this.fail(res, state.role, err);
    }
  }

  /** Sign-out started on Naa here: end the CLOUD MEDIA session too (which signs out of every group app). */
  @Get('logout')
  async logout(@Query() q: SsoLogoutQueryDto, @Res() res: Response): Promise<void> {
    if (!this.sso.enabled) {
      res.redirect(`${this.base()}/${q.role === 'provider' ? 'provider' : 'customer'}/login.html`);
      return;
    }
    try {
      res.redirect(await this.sso.endSessionUrl());
    } catch {
      res.redirect(`${this.base()}/auth/signin.html?signedout=1`);
    }
  }

  /** Back-channel sign-out notice from the CLOUD MEDIA account (server to server). */
  @Post('backchannel')
  @HttpCode(HttpStatus.OK)
  @SkipThrottle()
  @Header('Cache-Control', 'no-store')
  async backchannel(@Body() body: { logout_token?: string }): Promise<{ ok: true }> {
    await this.sso.handleLogoutToken(String(body?.logout_token ?? ''));
    return { ok: true };
  }

  private fail(res: Response, role: 'customer' | 'provider' | undefined, err: unknown): void {
    const message = err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string'
      ? (err as { message: string }).message
      : 'Something went wrong during sign-in. Please try again.';
    const params = new URLSearchParams({ error: message });
    if (role) params.set('role', role);
    res.redirect(`${this.base()}/auth/oauth-callback.html#${params.toString()}`);
  }
}
