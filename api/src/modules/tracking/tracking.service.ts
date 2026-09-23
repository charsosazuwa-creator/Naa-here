import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

interface BookingPartiesRow extends Record<string, unknown> {
  status: string;
  tenant_id: string;
  customer_user_id: string;
  staff_user_id: string | null;
}

export interface TrackingStatus {
  bookingId: string;
  status: string;
  isActive: boolean;
  role: 'customer' | 'provider';
  counterpart: { userId: string; name: string } | null;
}

/**
 * Live location sharing between the two parties on an in-progress
 * booking (see the "Real-Time Location Tracking" build-scope doc).
 * Same design as CallService's signal relay: the location itself is
 * NEVER persisted or audited -- it's a push-only nudge relayed over
 * RealtimeGateway's existing channel, authorized against the booking
 * row on every message rather than trusted from the payload. Losing
 * an update just means the other side's dot goes a few seconds stale;
 * there is no "last known location" to recover, by design (see the
 * scope doc's Architecture section).
 */
@Injectable()
export class TrackingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly realtime: RealtimeGateway,
  ) {
    this.realtime.onInbound('location:update', (userId, payload) => {
      this.relayLocation(userId, payload).catch(() => {
        // Same "never throws" posture as CallService's signal relay --
        // an unauthorized or malformed ping is dropped silently; the
        // sender just won't see it delivered.
      });
    });
  }

  private async relayLocation(fromUserId: string, payload: unknown): Promise<void> {
    const body = payload as { bookingId?: string; lat?: number; lng?: number; accuracy?: number } | null;
    if (!body?.bookingId || typeof body.lat !== 'number' || typeof body.lng !== 'number') return;

    const booking = await this.findBookingParties(body.bookingId);
    if (!booking || booking.status !== 'in_progress') return;

    const providerUserId = await this.resolveProviderUserId(booking);
    const participants = [booking.customer_user_id, providerUserId].filter(Boolean) as string[];
    if (!participants.includes(fromUserId)) return;

    const toUserId = participants.find((id) => id !== fromUserId);
    if (!toUserId) return;

    this.realtime.sendToUser(toUserId, 'location:update', {
      bookingId: body.bookingId,
      fromUserId,
      lat: body.lat,
      lng: body.lng,
      accuracy: typeof body.accuracy === 'number' ? body.accuracy : null,
      ts: Date.now(),
    });
  }

  /** Who the requesting user should expect to see tracking with, and whether it's currently possible. */
  async getStatus(bookingId: string, actorUserId: string): Promise<TrackingStatus> {
    const booking = await this.findBookingParties(bookingId);
    if (!booking) {
      throw new NotFoundException('Booking not found.');
    }

    const providerUserId = await this.resolveProviderUserId(booking);
    const isCustomer = booking.customer_user_id === actorUserId;
    const isProvider = Boolean(providerUserId) && providerUserId === actorUserId;
    if (!isCustomer && !isProvider) {
      throw new ForbiddenException('You are not a party to this booking.');
    }

    const counterpartUserId = isCustomer ? providerUserId : booking.customer_user_id;
    let counterpart: TrackingStatus['counterpart'] = null;
    if (counterpartUserId) {
      const [row] = await this.db.query<{ full_name: string }>(`SELECT full_name FROM app_user WHERE id = $1`, [counterpartUserId]);
      counterpart = { userId: counterpartUserId, name: row?.full_name ?? (isCustomer ? 'Your provider' : 'Your customer') };
    }

    return {
      bookingId,
      status: booking.status,
      isActive: booking.status === 'in_progress',
      role: isCustomer ? 'customer' : 'provider',
      counterpart,
    };
  }

  private async findBookingParties(bookingId: string): Promise<BookingPartiesRow | null> {
    const [row] = await this.db.query<BookingPartiesRow>(
      `SELECT b.status, b.tenant_id, b.staff_user_id, cp.linked_user_id AS customer_user_id
       FROM booking b
       JOIN customer_profile cp ON cp.id = b.customer_id
       WHERE b.id = $1`,
      [bookingId],
    );
    return row ?? null;
  }

  /** The specific staff member if one was assigned at booking time, else the tenant's owner. */
  private async resolveProviderUserId(booking: BookingPartiesRow): Promise<string | null> {
    if (booking.staff_user_id) return booking.staff_user_id;

    const [owner] = await this.db.query<{ user_id: string }>(
      `SELECT m.user_id FROM membership m JOIN role r ON r.id = m.role_id
       WHERE m.tenant_id = $1 AND r.code = 'owner' AND m.status = 'active' LIMIT 1`,
      [booking.tenant_id],
    );
    return owner?.user_id ?? null;
  }
}
