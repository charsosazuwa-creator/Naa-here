import { randomUUID } from 'crypto';
import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export interface RequestWithId extends Request {
  requestId: string;
}

/**
 * Phase 6 hardening (design section 11: "monitoring, alerting"). This
 * is deliberately small: a real monitoring/alerting stack (log
 * shipping, metrics, paging) is infrastructure this sandbox cannot
 * stand up, but a request correlation id is the one piece of groundwork
 * that has to live in the application code itself, not the deployment —
 * every log line for one request can be tied together once this
 * exists, and it costs nothing to add later. Honors an inbound
 * X-Request-Id from a trusted upstream proxy/load balancer; otherwise
 * mints one.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = (req.headers['x-request-id'] as string | undefined) || randomUUID();
    (req as RequestWithId).requestId = requestId;
    res.setHeader('X-Request-Id', requestId);

    const startedAt = Date.now();
    res.on('finish', () => {
      this.logger.log(
        JSON.stringify({
          requestId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Date.now() - startedAt,
        }),
      );
    });

    next();
  }
}
