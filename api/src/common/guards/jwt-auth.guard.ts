import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AppConfig } from '../../config/configuration';
import { DatabaseService } from '../../database/database.service';
import { sessionIsActive } from '../../modules/identity/session.service';

export interface AuthenticatedRequest extends Request {
  userId: string;
}

/**
 * The first of the five authorization steps in design section 10
 * ("signed-in -> tenant membership -> role permission -> object rule
 * -> field rule"). This guard only answers "is there a valid access
 * token", nothing more — tenant/role checks belong to later modules
 * once there is a resource that needs them.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly db: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or malformed Authorization header.');
    }

    const token = header.slice('Bearer '.length);

    let payload: { sub: string; sid?: string };
    try {
      payload = await this.jwt.verifyAsync<{ sub: string; sid?: string }>(token, {
        secret: this.config.get('jwt', { infer: true }).secret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired access token.');
    }
    // A signed-out session (including one ended by a CLOUD MEDIA account sign-out) stops working at once.
    if (payload.sid && !(await sessionIsActive(this.db, payload.sid))) {
      throw new UnauthorizedException('This session has ended. Please sign in again.');
    }
    request.userId = payload.sub;
    return true;
  }
}
