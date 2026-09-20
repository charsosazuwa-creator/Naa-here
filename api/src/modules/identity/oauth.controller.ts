import { Controller, Get, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { OAuthService, OAuthProvider } from './oauth.service';
import { OAuthAuthorizeQueryDto, OAuthCallbackQueryDto } from './dto/oauth.dto';
import { AppConfig } from '../../config/configuration';

/**
 * "Sign in with Google" / "Sign in with Facebook" — both providers
 * follow the exact same two-hop shape (authorize redirect out,
 * callback redirect in), so each pair of routes below is a thin,
 * explicit wrapper naming its provider that defers to the same shared
 * private methods — rather than one route guessing the provider from
 * the matched path, which would be one string-matching bug away from
 * silently handling a request as the wrong provider.
 *
 * Every route here is a full browser navigation (redirects in, a
 * redirect back out), never a fetch call — see
 * web/auth/oauth-buttons.js and web/auth/oauth-callback.html.
 */
@Controller('auth')
export class OAuthController {
  constructor(
    private readonly oauth: OAuthService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  @Get('google')
  authorizeGoogle(@Query() query: OAuthAuthorizeQueryDto, @Res() res: Response) {
    return this.authorize('google', query, res);
  }

  @Get('facebook')
  authorizeFacebook(@Query() query: OAuthAuthorizeQueryDto, @Res() res: Response) {
    return this.authorize('facebook', query, res);
  }

  @Get('google/callback')
  callbackGoogle(@Query() query: OAuthCallbackQueryDto, @Res() res: Response) {
    return this.callback('google', query, res);
  }

  @Get('facebook/callback')
  callbackFacebook(@Query() query: OAuthCallbackQueryDto, @Res() res: Response) {
    return this.callback('facebook', query, res);
  }

  private async authorize(provider: OAuthProvider, query: OAuthAuthorizeQueryDto, res: Response): Promise<void> {
    if (!this.oauth.isConfigured(provider)) {
      this.redirectWithError(res, query.role, `${providerLabel(provider)} sign-in isn't set up yet. Please use email/password for now.`);
      return;
    }
    try {
      const business = this.oauth.parseBusinessParam(query.business);
      const url = await this.oauth.buildAuthorizationUrl(provider, query.role, business);
      res.redirect(url);
    } catch (err) {
      this.redirectWithError(res, query.role, errorMessage(err));
    }
  }

  private async callback(provider: OAuthProvider, query: OAuthCallbackQueryDto, res: Response): Promise<void> {
    if (query.error) {
      this.redirectWithError(res, undefined, 'Sign-in was cancelled.');
      return;
    }
    if (!query.code || !query.state) {
      this.redirectWithError(res, undefined, `${providerLabel(provider)} sign-in didn't complete. Please try again.`);
      return;
    }

    try {
      const result = await this.oauth.completeSignIn(provider, query.code, query.state);
      const base = this.config.get('publicBaseUrl', { infer: true }).replace(/\/+$/, '');
      const params = new URLSearchParams({
        accessToken: result.tokens.accessToken,
        refreshToken: result.tokens.refreshToken,
        role: result.role,
        user: JSON.stringify(result.user),
      });
      if (result.tenantId) {
        params.set('tenantId', result.tenantId);
      }
      res.redirect(`${base}/auth/oauth-callback.html#${params.toString()}`);
    } catch (err) {
      this.redirectWithError(res, undefined, errorMessage(err));
    }
  }

  private redirectWithError(res: Response, role: 'customer' | 'provider' | undefined, message: string): void {
    const base = this.config.get('publicBaseUrl', { infer: true }).replace(/\/+$/, '');
    const params = new URLSearchParams({ error: message });
    if (role) {
      params.set('role', role);
    }
    res.redirect(`${base}/auth/oauth-callback.html#${params.toString()}`);
  }
}

function providerLabel(provider: OAuthProvider): string {
  return provider === 'google' ? 'Google' : 'Facebook';
}

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = (err as { message: unknown }).message;
    if (typeof msg === 'string') {
      return msg;
    }
  }
  return 'Something went wrong during sign-in. Please try again.';
}
