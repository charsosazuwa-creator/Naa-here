import 'reflect-metadata';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { AppConfig } from './config/configuration';

async function bootstrap() {
  // rawBody: true keeps the exact request bytes around (on
  // req.rawBody) alongside Nest's usual parsed body — needed by
  // PaymentsController's webhook route, which must verify a payment
  // provider's signature against the bytes it actually signed, not a
  // reserialized JSON.stringify of the parsed object (which can differ
  // in key order or whitespace and would break the signature check).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  app.use(helmet());

  // Serve the static web front end from this same origin (the web/
  // folder alongside api/ at the repo root — see render.yaml), so no
  // browser cross-origin requests ever happen and corsAllowedOrigins
  // can stay empty in production. dist/main.js sits at api/dist/,
  // so web/ is two levels up from __dirname at runtime.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/') {
      res.redirect('/auth/index.html');
      return;
    }
    next();
  });
  app.useStaticAssets(join(__dirname, '..', '..', 'web'));

  // Phase 6 hardening: an explicit allowlist rather than
  // app.enableCors() with no options (which reflects every Origin
  // back and allows credentials from anywhere). See
  // configuration.ts's corsAllowedOrigins for the empty-in-development
  // reasoning.
  const config = app.get<ConfigService<AppConfig, true>>(ConfigService);
  const allowedOrigins = config.get('corsAllowedOrigins', { infer: true });
  app.enableCors(
    allowedOrigins.length > 0
      ? { origin: allowedOrigins, credentials: true }
      : {},
  );

  // Every route's DTOs are validated with class-validator; unknown
  // properties are stripped rather than silently accepted.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());
  app.setGlobalPrefix('v1', { exclude: ['health/live', 'health/ready'] });

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`API listening on port ${port}`);
}

bootstrap();
