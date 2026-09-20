import { IsIn, IsOptional, IsString } from 'class-validator';

/**
 * Query params for GET /auth/:provider — the link a "Continue with
 * Google/Facebook" button on the front end points to directly (a
 * plain navigation, not a fetch call, since the next hop is a
 * redirect to the provider's own consent screen).
 */
export class OAuthAuthorizeQueryDto {
  // Which app initiated this (customer vs provider portal) — decides
  // where the final redirect in oauth-callback.html sends the
  // browser, and which sessionStorage keys it writes to.
  @IsIn(['customer', 'provider'])
  role!: 'customer' | 'provider';

  // Only sent from web/auth/signup-provider.html, where the business
  // fields are collected before the OAuth handoff (there is no later
  // request in this flow where they could be collected, unlike the
  // password signup path's post-verify sessionStorage handoff — an
  // OAuth account is active immediately with no verification step to
  // hang a follow-up off of). JSON-encoded; shape validated in
  // OAuthService.parseBusinessParam against the same rules as
  // CreateBusinessDto.
  @IsOptional()
  @IsString()
  business?: string;
}

/** Query params Google/Facebook append to their redirect back to our callback route. */
export class OAuthCallbackQueryDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  state?: string;

  // Present instead of `code` when the user declined consent, or the
  // provider itself failed (e.g. access_denied).
  @IsOptional()
  @IsString()
  error?: string;
}
