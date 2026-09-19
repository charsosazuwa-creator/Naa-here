import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * Uniform error envelope for every route, per the API conventions in
 * design package section 9: { error: { code, message, requestId } }.
 * Never leaks a stack trace or an internal message to the client.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const isHttpException = exception instanceof HttpException;
    const rawResponse = isHttpException ? exception.getResponse() : null;

    // Never leaking the exception to the CLIENT (below) doesn't mean
    // never logging it: as written, this filter discarded every
    // non-HttpException error completely — nothing on either side ever
    // recorded why a request 500'd. Only real execution against a
    // running server surfaced this: every fake-DB-backed test asserts
    // on the response body, never on what the server itself logged, so
    // a silently-swallowed cause was invisible to the whole test suite.
    if (!isHttpException || status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.url}: ${
          exception instanceof Error ? exception.message : String(exception)
        }`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    let code = 'internal_error';
    let message = 'Something went wrong. Please try again.';

    if (isHttpException) {
      code = httpStatusToCode(status);
      if (typeof rawResponse === 'string') {
        message = rawResponse;
      } else if (rawResponse && typeof rawResponse === 'object' && 'message' in rawResponse) {
        const raw = (rawResponse as { message: unknown }).message;
        message = Array.isArray(raw) ? raw.join(' ') : String(raw);
      }
    }

    response.status(status).json({
      error: {
        code,
        message,
        requestId: request.headers['x-request-id'] ?? undefined,
      },
    });
  }
}

function httpStatusToCode(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'invalid_request';
    case HttpStatus.UNAUTHORIZED:
      return 'unauthorized';
    case HttpStatus.FORBIDDEN:
      return 'forbidden';
    case HttpStatus.NOT_FOUND:
      return 'not_found';
    case HttpStatus.CONFLICT:
      return 'conflict';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'rate_limited';
    default:
      return 'internal_error';
  }
}
