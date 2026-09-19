import { Controller, Headers, Post, RawBodyRequest, Req } from '@nestjs/common';
import type { Request } from 'express';
import { PaymentsService } from './payments.service';

/**
 * The one route a real PSP would call. No JwtAuthGuard here — a
 * provider's webhook carries no user session, only its own signature
 * (verified inside PaymentsService.handleWebhook against the exact raw
 * bytes of the request body, which is why main.ts enables Nest's
 * `rawBody` option rather than letting the JSON body parser be the
 * only thing that ever sees this request).
 */
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('webhook')
  webhook(@Req() req: RawBodyRequest<Request>, @Headers('x-mock-signature') signature: string | undefined) {
    const rawBody = req.rawBody?.toString('utf8') ?? '';
    return this.payments.handleWebhook(rawBody, signature);
  }
}
