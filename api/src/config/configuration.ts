export interface AppConfig {
  env: string;
  port: number;
  databaseUrl: string;
  // Render's managed Postgres requires TLS with a certificate not in
  // Node's default trust store, so this is opt-in via the PGSSL env var
  // rather than inferred from NODE_ENV (see DatabaseService).
  pgSsl: boolean;
  jwt: {
    secret: string;
    accessTokenTtlSeconds: number;
    refreshTokenTtlDays: number;
  };
  verification: {
    codeTtlMinutes: number;
    maxAttempts: number;
  };
  login: {
    maxFailedAttempts: number;
    lockoutMinutes: number;
  };
  // Phase 6 hardening (design section 11): an explicit allowlist
  // instead of app.enableCors() with no options, which reflects every
  // Origin back and allows credentials from anywhere. Empty in
  // development (same-origin tools, curl, Postman all still work —
  // CORS only affects browser-enforced cross-origin requests); a real
  // deployment sets CORS_ALLOWED_ORIGINS to its actual front-end
  // origins before going live (see the production-readiness
  // checklist).
  corsAllowedOrigins: string[];
  // Phase 4 (Payments): the shared secret the mock payment provider
  // signs webhook bodies with (HMAC-SHA256), and that
  // PaymentsController verifies against. A real provider swap replaces
  // MockPaymentProvider and this secret with that provider's own
  // signing scheme — nothing else in payments.module.ts changes.
  payments: {
    webhookSecret: string;
  };
  // Verification-code delivery (see identity/verification-code.service.ts
  // and notifications/*). 'mock' (the default) just logs codes to the
  // server log, same as always; 'resend' sends real email through
  // Resend's API using RESEND_API_KEY. SMS delivery is still mock-only
  // — a real SMS provider (Termii/Twilio/etc.) is a separate,
  // follow-up integration behind the same shape once one is chosen.
  notifications: {
    email: {
      provider: 'mock' | 'resend';
      apiKey: string;
      fromAddress: string;
      fromName: string;
    };
  };
  // This deployment's own public origin (e.g.
  // https://naa-here-app.onrender.com), used only to build OAuth
  // redirect_uri values and the final browser redirect back to the
  // front end after a Google/Facebook sign-in completes (see
  // oauth.service.ts). Falls back to localhost for local dev, where
  // an OAuth provider is unlikely to be configured anyway.
  publicBaseUrl: string;
  // "Sign in with Google" / "Sign in with Facebook" (see
  // modules/identity/oauth.*). Each provider's credentials come from
  // its own developer console (Google Cloud Console / Facebook for
  // Developers) and are optional: a provider whose clientId is empty
  // simply has its authorize route return 501, so the rest of the API
  // works unchanged before these are configured.
  oauth: {
    google: { clientId: string; clientSecret: string };
    facebook: { clientId: string; clientSecret: string };
  };
}

export default (): AppConfig => ({
  env: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://localhost:5432/marketplace_dev',
  pgSsl: process.env.PGSSL === 'true',
  jwt: {
    secret: process.env.JWT_SECRET ?? '',
    accessTokenTtlSeconds: Number(process.env.JWT_ACCESS_TOKEN_TTL_SECONDS ?? 900),
    refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30),
  },
  verification: {
    codeTtlMinutes: Number(process.env.VERIFICATION_CODE_TTL_MINUTES ?? 15),
    maxAttempts: Number(process.env.VERIFICATION_CODE_MAX_ATTEMPTS ?? 5),
  },
  login: {
    maxFailedAttempts: Number(process.env.LOGIN_MAX_FAILED_ATTEMPTS ?? 5),
    lockoutMinutes: Number(process.env.LOGIN_LOCKOUT_MINUTES ?? 15),
  },
  corsAllowedOrigins: (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0),
  payments: {
    webhookSecret: process.env.PAYMENT_WEBHOOK_SECRET ?? '',
  },
  notifications: {
    email: {
      provider: (process.env.EMAIL_PROVIDER ?? 'mock') as 'mock' | 'resend',
      apiKey: process.env.RESEND_API_KEY ?? '',
      fromAddress: process.env.EMAIL_FROM_ADDRESS ?? 'onboarding@resend.dev',
      fromName: process.env.EMAIL_FROM_NAME ?? 'Naa here',
    },
  },
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000',
  oauth: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    },
    facebook: {
      clientId: process.env.FACEBOOK_CLIENT_ID ?? '',
      clientSecret: process.env.FACEBOOK_CLIENT_SECRET ?? '',
    },
  },
});
