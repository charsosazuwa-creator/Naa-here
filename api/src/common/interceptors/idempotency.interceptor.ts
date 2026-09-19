import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Observable, from, of } from 'rxjs';
import { switchMap, tap } from 'rxjs/operators';
import type { Request } from 'express';
import { DatabaseService } from '../../database/database.service';
import type { AuthenticatedRequest } from '../guards/jwt-auth.guard';

/**
 * The idempotency-key pattern from design section 5: a client retrying
 * a booking-creation POST (after a timeout, a flaky connection) must
 * never create two bookings. The client sends an `Idempotency-Key`
 * header; the first request with a given key executes normally and its
 * response is cached against that key. Any later request with the
 * same key (from the same user) short-circuits and replays the cached
 * response instead of running the handler again.
 *
 * Deliberately narrow for this milestone: it does not hash and compare
 * the request body against the key's first use (a mismatched retry
 * would just replay the original response) — that stricter check is
 * straightforward to add once a real client's retry behaviour is
 * observed, and is noted as a follow-up rather than guessed at here.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly db: DatabaseService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest & Request>();
    const key = request.headers['idempotency-key'];

    if (!key || typeof key !== 'string') {
      throw new BadRequestException('An Idempotency-Key header is required for this request.');
    }

    const requestHash = createHash('sha256').update(JSON.stringify(request.body ?? {})).digest('hex');

    return from(this.checkExisting(key, request.userId)).pipe(
      switchMap((existing) => {
        if (existing) {
          if (existing.request_hash !== requestHash) {
            throw new ConflictException('This idempotency key was already used with a different request body.');
          }
          return of(existing.response_body);
        }

        return next.handle().pipe(
          tap({
            next: (body: unknown) => {
              void this.store(key, request.userId, request.method + ' ' + request.route?.path, requestHash, 201, body);
            },
          }),
        );
      }),
    );
  }

  private async checkExisting(
    key: string,
    userId: string,
  ): Promise<{ request_hash: string; response_body: unknown } | undefined> {
    const [row] = await this.db.query<{ request_hash: string; response_body: unknown; user_id: string }>(
      `SELECT request_hash, response_body, user_id FROM idempotency_key WHERE key = $1 AND expires_at > now()`,
      [key],
    );
    if (row && row.user_id !== userId) {
      // A key is scoped to the user who first used it; a collision
      // from someone else is treated as "no existing record" rather
      // than leaking whether that key exists for another account.
      return undefined;
    }
    return row;
  }

  private async store(
    key: string,
    userId: string,
    route: string,
    requestHash: string,
    status: number,
    body: unknown,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO idempotency_key (key, user_id, route, request_hash, response_status, response_body)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (key) DO NOTHING`,
      [key, userId, route, requestHash, status, JSON.stringify(body ?? null)],
    );
  }
}
