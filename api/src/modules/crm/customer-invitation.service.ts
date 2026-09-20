import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createHash } from 'crypto';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { EMAIL_PROVIDER, EmailProvider } from '../notifications/email-provider.interface';
import { AppConfig } from '../../config/configuration';

export interface CustomerInvitationSummary {
  id: string;
  invitedEmail: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired' | 'cancelled';
  expiresAt: string;
  createdAt: string;
}

export interface CustomerInvitationPreview {
  businessName: string;
  invitedEmail: string;
  status: CustomerInvitationSummary['status'];
}

const TOKEN_VALIDITY_HOURS = 72;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A 'pending' row past its expires_at is treated as expired everywhere it's read, without needing a background job to flip it first. */
function effectiveStatus(row: { status: string; expires_at: string }): CustomerInvitationSummary['status'] {
  if (row.status === 'pending' && new Date(row.expires_at).getTime() < Date.now()) {
    return 'expired';
  }
  return row.status as CustomerInvitationSummary['status'];
}

function toSummary(row: { id: string; invited_email: string; status: string; expires_at: string; created_at: string }): CustomerInvitationSummary {
  return {
    id: row.id,
    invitedEmail: row.invited_email,
    status: effectiveStatus(row),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

/**
 * User Story 6: invites a Customer to a provider's portal by email,
 * covering both the "already has an account" and "no account yet"
 * scenarios (AC5/AC6, Scenarios A and B). Deliberately separate from
 * StaffService: unlike a staff invite, this never creates a
 * `membership` row (that would grant tenant-scoped Staff/Provider
 * permissions — AC22 forbids it), sends an actual email, and supports
 * inviting someone who has never signed up.
 */
@Injectable()
export class CustomerInvitationService {
  private readonly logger = new Logger(CustomerInvitationService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<AppConfig, true>,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
  ) {}

  async invite(tenantId: string, invitedByUserId: string, email: string): Promise<CustomerInvitationSummary> {
    const normalizedEmail = email.trim().toLowerCase();

    // AC15: one active (pending, unexpired) invitation per email per
    // provider at a time. The partial unique index backs this too
    // (belt and braces under concurrent requests) but this check is
    // what produces the friendly, specific message AC15 asks for.
    const [existingPending] = await this.db.query<{ id: string }>(
      `SELECT id FROM customer_invitation
       WHERE tenant_id = $1 AND invited_email = $2 AND status = 'pending' AND expires_at > now()`,
      [tenantId, normalizedEmail],
    );
    if (existingPending) {
      throw new ConflictException('An invitation to this email is already pending for this business.');
    }

    const [tenant] = await this.db.query<{ name: string }>(`SELECT name FROM tenant WHERE id = $1`, [tenantId]);
    if (!tenant) {
      throw new NotFoundException('Business not found.');
    }

    // AC25: used only to pick which email copy to send (so the two
    // scenarios read naturally); never returned to the provider, and
    // never exposed on any response from this method.
    const [existingAccount] = await this.db.query<{ id: string }>(`SELECT id FROM app_user WHERE email = $1`, [normalizedEmail]);

    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + TOKEN_VALIDITY_HOURS * 60 * 60 * 1000);

    const [inviteRow] = await this.db.query<{ id: string; invited_email: string; status: string; expires_at: string; created_at: string }>(
      `INSERT INTO customer_invitation (tenant_id, invited_email, invited_by, token_hash, status, expires_at)
       VALUES ($1, $2, $3, $4, 'pending', $5)
       RETURNING id, invited_email, status, expires_at, created_at`,
      [tenantId, normalizedEmail, invitedByUserId, tokenHash, expiresAt.toISOString()],
    );

    // AC22: a failed send must surface as a real error and allow
    // retry, NOT a false success — unlike VerificationCodeService's
    // send, which is deliberately best-effort because a code can be
    // resent from inside the app. An invitation the provider never
    // sees fail would instead sit there silently un-actionable, so the
    // half-created row is rolled back and the provider can just try
    // again (the duplicate-pending check above won't block the retry).
    try {
      await this.sendInvitationEmail(normalizedEmail, tenant.name, token, Boolean(existingAccount));
    } catch (err) {
      await this.db.query(`DELETE FROM customer_invitation WHERE id = $1`, [inviteRow.id]);
      this.logger.error(`Failed to send customer invitation email (provider=${this.emailProvider.name}) to ${normalizedEmail}: ${(err as Error).message}`);
      throw new ServiceUnavailableException('We could not send the invitation email. Please try again.');
    }

    await this.db.withTenant(tenantId, (client) =>
      this.audit.record(
        {
          tenantId,
          actorUserId: invitedByUserId,
          action: 'customer.invite.create',
          targetType: 'customer_invitation',
          targetId: inviteRow.id,
          metadata: { invitedEmail: normalizedEmail, existingAccount: Boolean(existingAccount) },
        },
        client,
      ),
    );

    return toSummary(inviteRow);
  }

  async listForTenant(tenantId: string): Promise<CustomerInvitationSummary[]> {
    const rows = await this.db.query<{ id: string; invited_email: string; status: string; expires_at: string; created_at: string }>(
      `SELECT id, invited_email, status, expires_at, created_at
       FROM customer_invitation WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return rows.map(toSummary);
  }

  async resend(tenantId: string, invitationId: string, actorUserId: string): Promise<CustomerInvitationSummary> {
    const [invite] = await this.db.query<{ id: string; invited_email: string; status: string; expires_at: string }>(
      `SELECT id, invited_email, status, expires_at FROM customer_invitation WHERE id = $1 AND tenant_id = $2`,
      [invitationId, tenantId],
    );
    if (!invite) {
      throw new NotFoundException('Invitation not found.');
    }
    if (effectiveStatus(invite) !== 'pending') {
      throw new ConflictException('Only a pending invitation can be resent.');
    }

    const [tenant] = await this.db.query<{ name: string }>(`SELECT name FROM tenant WHERE id = $1`, [tenantId]);
    const [existingAccount] = await this.db.query<{ id: string }>(`SELECT id FROM app_user WHERE email = $1`, [invite.invited_email]);

    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + TOKEN_VALIDITY_HOURS * 60 * 60 * 1000);

    // Rotate the token and push the expiry out rather than re-sending
    // the same link: an old copy of the email (e.g. in a shared inbox)
    // shouldn't still work once a resend was asked for.
    await this.sendInvitationEmail(invite.invited_email, tenant!.name, token, Boolean(existingAccount));

    const [updated] = await this.db.query<{ id: string; invited_email: string; status: string; expires_at: string; created_at: string }>(
      `UPDATE customer_invitation SET token_hash = $1, expires_at = $2, updated_at = now()
       WHERE id = $3 RETURNING id, invited_email, status, expires_at, created_at`,
      [tokenHash, expiresAt.toISOString(), invite.id],
    );

    await this.db.withTenant(tenantId, (client) =>
      this.audit.record(
        { tenantId, actorUserId, action: 'customer.invite.resend', targetType: 'customer_invitation', targetId: invite.id },
        client,
      ),
    );

    return toSummary(updated);
  }

  async cancel(tenantId: string, invitationId: string, actorUserId: string): Promise<void> {
    const [cancelled] = await this.db.query<{ id: string }>(
      `UPDATE customer_invitation SET status = 'cancelled', updated_at = now()
       WHERE id = $1 AND tenant_id = $2 AND status = 'pending'
       RETURNING id`,
      [invitationId, tenantId],
    );
    if (!cancelled) {
      throw new NotFoundException('No pending invitation found to cancel.');
    }

    await this.db.withTenant(tenantId, (client) =>
      this.audit.record(
        { tenantId, actorUserId, action: 'customer.invite.cancel', targetType: 'customer_invitation', targetId: cancelled.id },
        client,
      ),
    );
  }

  /** Public preview shown before sign-in/registration (AC7-ish): only what's needed to identify the inviting business, nothing else (AC18). */
  async previewByToken(token: string): Promise<CustomerInvitationPreview> {
    const row = await this.findByToken(token);
    return { businessName: row.business_name, invitedEmail: row.invited_email, status: effectiveStatus(row) };
  }

  async accept(token: string, userId: string): Promise<void> {
    const row = await this.findByToken(token);
    const status = effectiveStatus(row);

    if (status === 'expired' && row.status === 'pending') {
      await this.db.query(`UPDATE customer_invitation SET status = 'expired', updated_at = now() WHERE id = $1`, [row.id]);
    }
    if (status !== 'pending') {
      throw status === 'expired'
        ? new GoneException('This invitation link has expired. Ask the business to send a new one.')
        : new ConflictException(`This invitation is already ${status}.`);
    }

    const [user] = await this.db.query<{ email: string | null; full_name: string }>(
      `SELECT email, full_name FROM app_user WHERE id = $1`,
      [userId],
    );
    // AC9/AC10: never let an invitation be accepted by, or associated
    // with, an account other than the one it was actually sent to.
    if (!user?.email || user.email.toLowerCase() !== row.invited_email.toLowerCase()) {
      throw new ForbiddenException('This invitation was sent to a different email address. Sign in with that account to accept it.');
    }

    await this.db.withTenant(row.tenant_id, async (client) => {
      const { rows: linkedAlready } = await client.query<{ id: string }>(
        `SELECT id FROM customer_profile WHERE tenant_id = $1 AND linked_user_id = $2`,
        [row.tenant_id, userId],
      );

      let customerProfileId: string;
      if (linkedAlready.length > 0) {
        customerProfileId = linkedAlready[0].id;
      } else {
        // A provider may already have a walk-in customer_profile row
        // for this email (created via crm.service.ts's createCustomer,
        // never linked to an account) — claim it rather than creating
        // a duplicate customer record for the same person.
        const { rows: byEmail } = await client.query<{ id: string }>(
          `SELECT id FROM customer_profile WHERE tenant_id = $1 AND email = $2 AND linked_user_id IS NULL`,
          [row.tenant_id, user.email],
        );
        if (byEmail.length > 0) {
          customerProfileId = byEmail[0].id;
          await client.query(`UPDATE customer_profile SET linked_user_id = $1, updated_at = now() WHERE id = $2`, [
            userId,
            customerProfileId,
          ]);
        } else {
          const { rows: created } = await client.query<{ id: string }>(
            `INSERT INTO customer_profile (tenant_id, linked_user_id, full_name, email, created_by)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [row.tenant_id, userId, user.full_name, user.email, row.invited_by],
          );
          customerProfileId = created[0].id;
        }
      }

      await client.query(
        `UPDATE customer_invitation SET status = 'accepted', accepted_by = $1, customer_profile_id = $2, updated_at = now() WHERE id = $3`,
        [userId, customerProfileId, row.id],
      );

      await this.audit.record(
        {
          tenantId: row.tenant_id,
          actorUserId: userId,
          action: 'customer.invite.accept',
          targetType: 'customer_invitation',
          targetId: row.id,
          metadata: { customerProfileId },
        },
        client,
      );
    });
  }

  async decline(token: string, userId: string): Promise<void> {
    const row = await this.findByToken(token);
    const status = effectiveStatus(row);
    if (status !== 'pending') {
      throw new ConflictException(`This invitation is already ${status}.`);
    }

    await this.db.withTenant(row.tenant_id, async (client) => {
      await client.query(`UPDATE customer_invitation SET status = 'declined', updated_at = now() WHERE id = $1`, [row.id]);
      await this.audit.record(
        { tenantId: row.tenant_id, actorUserId: userId, action: 'customer.invite.decline', targetType: 'customer_invitation', targetId: row.id },
        client,
      );
    });
  }

  private async findByToken(token: string): Promise<{
    id: string;
    tenant_id: string;
    invited_email: string;
    invited_by: string;
    status: string;
    expires_at: string;
    business_name: string;
  }> {
    const [row] = await this.db.query<{
      id: string;
      tenant_id: string;
      invited_email: string;
      invited_by: string;
      status: string;
      expires_at: string;
      business_name: string;
    }>(
      `SELECT ci.id, ci.tenant_id, ci.invited_email, ci.invited_by, ci.status, ci.expires_at, t.name AS business_name
       FROM customer_invitation ci
       JOIN tenant t ON t.id = ci.tenant_id
       WHERE ci.token_hash = $1`,
      [hashToken(token)],
    );
    if (!row) {
      // Same message whether the token is malformed, unknown, or
      // belongs to a since-deleted invitation -- doesn't confirm or
      // deny anything about what a guessed token might correspond to.
      throw new NotFoundException('This invitation link is invalid.');
    }
    return row;
  }

  private async sendInvitationEmail(toEmail: string, businessName: string, token: string, accountExists: boolean): Promise<void> {
    const base = this.config.get('publicBaseUrl', { infer: true }).replace(/\/+$/, '');
    const acceptUrl = accountExists
      ? `${base}/customer/login.html?next=${encodeURIComponent(`#/invite/${token}`)}`
      : `${base}/auth/signup-customer.html?${new URLSearchParams({ email: toEmail, invite: token }).toString()}`;

    const safeBusinessName = escapeHtml(businessName);
    const subject = `${businessName} invited you to Naa here`;
    const actionLabel = accountExists ? 'Sign in to accept' : 'Create your account to accept';
    const text = `${businessName} has invited you to connect on Naa here.\n\n${actionLabel}: ${acceptUrl}\n\nThis link expires in ${TOKEN_VALIDITY_HOURS} hours. If you weren't expecting this, you can ignore this email.`;
    const html = `<p>${safeBusinessName} has invited you to connect on Naa here.</p>
<p><a href="${acceptUrl}">${actionLabel}</a></p>
<p style="color:#6b7280;font-size:0.85rem">This link expires in ${TOKEN_VALIDITY_HOURS} hours. If you weren't expecting this, you can ignore this email.</p>`;

    await this.emailProvider.send({ to: toEmail, subject, text, html });
  }
}
