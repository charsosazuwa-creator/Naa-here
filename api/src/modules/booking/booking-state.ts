import { BadRequestException } from '@nestjs/common';

export type BookingStatus = 'confirmed' | 'in_progress' | 'completed' | 'no_show' | 'cancelled';

/**
 * The subset of the design's full booking state diagram (section 6)
 * reachable in this milestone. Every booking still starts 'confirmed'
 * even after Phase 4's mock payment provider landed: the mock always
 * settles a charge synchronously (see mock-payment.provider.ts), so
 * there is still no observable 'pending_payment' gate to model here. A
 * real, asynchronous PSP integration confirming a charge later via
 * /v1/payments/webhook is exactly the case that would need one — and
 * the escrow ledger's own 'disputed'/'refunded' history already lives
 * in ledger_entry/dispute (migration 005), not on the booking row
 * itself. Reintroducing the full diagram here would be a deliberate
 * later change, not a gap this milestone left accidentally.
 */
const ALLOWED_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  confirmed: ['in_progress', 'cancelled', 'no_show'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  no_show: [],
  cancelled: [],
};

export function assertValidTransition(from: BookingStatus, to: BookingStatus): void {
  if (from === to) {
    throw new BadRequestException(`Booking is already '${from}'.`);
  }
  if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
    throw new BadRequestException(`Cannot move a booking from '${from}' to '${to}'.`);
  }
}
