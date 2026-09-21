import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { StartConversationAsCustomerDto, StartConversationAsProviderDto } from './dto/messaging.dto';

export interface ConversationSummary {
  id: string;
  tenantId: string;
  tenantName: string;
  customerUserId: string;
  customerName: string;
  contextType: string | null;
  contextId: string | null;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  unreadCount: number;
}

export interface DirectMessageRecord {
  id: string;
  conversationId: string;
  senderUserId: string;
  senderIsCustomer: boolean;
  body: string;
  createdAt: string;
  readAt: string | null;
}

const MESSAGE_PREVIEW_LENGTH = 120;

/**
 * User Stories 2 & 3's chat half. The one asymmetry throughout this
 * service: a Customer can always start a new conversation with any
 * tenant, but a Provider (tenant staff) can only start a NEW one when
 * an eligible relationship already exists -- see assertProviderCan
 * Initiate(). Once a conversation exists (whichever side opened it),
 * replying within it is symmetric for both sides, gated only by
 * blocking, not by the eligibility check again -- that check is about
 * first contact, not about being allowed to have a conversation.
 */
@Injectable()
export class DirectMessageService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /**
   * "A Service Provider should not automatically be allowed to call or
   * message every Customer simply because the Customer appears in
   * search results" (the user stories' own note). Eligible means: an
   * existing booking, an existing job request, an accepted customer
   * invitation, or the Customer having messaged this tenant first.
   * Runs inside withTenant() because booking/job_request/
   * customer_profile all carry RLS scoped to app.tenant_id -- exactly
   * the mistake fixed elsewhere in this codebase (see group.service.ts
   * and the Config & Deployment Guide's RLS gotcha note): the tenant
   * IS known here, so there's no excuse for a plain, contextless query.
   */
  private async assertProviderCanInitiate(tenantId: string, customerUserId: string): Promise<void> {
    const eligible = await this.db.withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT
           EXISTS (
             SELECT 1 FROM booking b JOIN customer_profile cp ON cp.id = b.customer_id
             WHERE b.tenant_id = $1 AND cp.linked_user_id = $2
           ) AS has_booking,
           EXISTS (
             SELECT 1 FROM job_request jr JOIN customer_profile cp ON cp.id = jr.customer_id
             WHERE jr.tenant_id = $1 AND cp.linked_user_id = $2
           ) AS has_job_request,
           EXISTS (
             SELECT 1 FROM customer_invitation
             WHERE tenant_id = $1 AND accepted_by = $2 AND status = 'accepted'
           ) AS has_accepted_invitation,
           EXISTS (
             SELECT 1 FROM conversation c JOIN direct_message dm ON dm.conversation_id = c.id
             WHERE c.tenant_id = $1 AND c.customer_user_id = $2 AND dm.sender_user_id = $2
           ) AS customer_messaged_first`,
        [tenantId, customerUserId],
      );
      const row = rows[0];
      return row.has_booking || row.has_job_request || row.has_accepted_invitation || row.customer_messaged_first;
    });

    if (!eligible) {
      throw new ForbiddenException(
        'You can message a customer only once there is an existing booking, job request, accepted invitation, or the customer has contacted you first.',
      );
    }
  }

  private async assertNotBlocked(tenantId: string, customerUserId: string): Promise<void> {
    const [row] = await this.db.query<{ id: string }>(
      `SELECT id FROM customer_provider_block WHERE customer_user_id = $1 AND tenant_id = $2`,
      [customerUserId, tenantId],
    );
    if (row) {
      throw new ForbiddenException('This customer has blocked messages from your business.');
    }
  }

  private async requireActiveTenantMember(tenantId: string, userId: string): Promise<void> {
    const isMember = await this.db.withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT 1 FROM membership WHERE tenant_id = $1 AND user_id = $2 AND status = 'active'`,
        [tenantId, userId],
      );
      return rows.length > 0;
    });
    if (!isMember) {
      throw new ForbiddenException('You are not an active member of this business.');
    }
  }

  private async getOrCreateConversation(
    tenantId: string,
    customerUserId: string,
    context: { contextType?: string; contextId?: string },
  ): Promise<{ id: string; isNew: boolean }> {
    const rows = await this.db.query<{ id: string; created_at: string; updated: boolean }>(
      `INSERT INTO conversation (customer_user_id, tenant_id, context_type, context_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (customer_user_id, tenant_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id
       RETURNING id, created_at, (xmax <> 0) AS updated`,
      [customerUserId, tenantId, context.contextType ?? 'general', context.contextId ?? null],
    );
    return { id: rows[0].id, isNew: !rows[0].updated };
  }

  private async insertMessage(conversationId: string, senderUserId: string, body: string): Promise<DirectMessageRecord> {
    const [row] = await this.db.query<Record<string, unknown>>(
      `WITH inserted AS (
         INSERT INTO direct_message (conversation_id, sender_user_id, body) VALUES ($1, $2, $3)
         RETURNING id, conversation_id, sender_user_id, body, created_at, read_at
       )
       UPDATE conversation SET last_message_at = now() WHERE id = $1
       RETURNING (SELECT id FROM inserted), (SELECT sender_user_id FROM inserted), (SELECT body FROM inserted),
                 (SELECT created_at FROM inserted), (SELECT read_at FROM inserted)`,
      [conversationId, senderUserId, body],
    );
    return {
      id: row.id as string,
      conversationId,
      senderUserId: row.sender_user_id as string,
      senderIsCustomer: false, // filled in by the caller, which knows the role
      body: row.body as string,
      createdAt: row.created_at as string,
      readAt: (row.read_at as string) ?? null,
    };
  }

  async startAsCustomer(customerUserId: string, dto: StartConversationAsCustomerDto): Promise<ConversationSummary> {
    const [tenant] = await this.db.query<{ id: string; name: string }>(`SELECT id, name FROM tenant WHERE id = $1`, [dto.tenantId]);
    if (!tenant) {
      throw new NotFoundException('Business not found.');
    }

    const { id: conversationId } = await this.getOrCreateConversation(dto.tenantId, customerUserId, {
      contextType: dto.contextType,
      contextId: dto.contextId,
    });
    const message = await this.insertMessage(conversationId, customerUserId, dto.body);

    await this.audit.record({
      tenantId: dto.tenantId,
      actorUserId: customerUserId,
      action: 'conversation.message.customer',
      targetType: 'conversation',
      targetId: conversationId,
    });

    await this.notifyTenantStaff(dto.tenantId, conversationId, message);

    return this.getConversationSummary(conversationId);
  }

  async startAsProvider(tenantId: string, actorUserId: string, dto: StartConversationAsProviderDto): Promise<ConversationSummary> {
    await this.assertNotBlocked(tenantId, dto.customerUserId);

    const { id: conversationId, isNew } = await this.getOrCreateConversation(tenantId, dto.customerUserId, {
      contextType: dto.contextType,
      contextId: dto.contextId,
    });

    // Only a brand-new conversation needs the eligibility gate -- see
    // this service's class comment.
    if (isNew) {
      await this.assertProviderCanInitiate(tenantId, dto.customerUserId);
    }

    const message = await this.insertMessage(conversationId, actorUserId, dto.body);

    await this.audit.record({
      tenantId,
      actorUserId,
      action: 'conversation.message.provider',
      targetType: 'conversation',
      targetId: conversationId,
      metadata: { customerUserId: dto.customerUserId },
    });

    this.realtime.sendToUser(dto.customerUserId, 'message:new', {
      conversationId,
      message: { ...message, senderIsCustomer: false },
    });

    return this.getConversationSummary(conversationId);
  }

  async reply(conversationId: string, actorUserId: string, body: string): Promise<DirectMessageRecord> {
    const conversation = await this.requireConversation(conversationId);
    const isCustomer = conversation.customer_user_id === actorUserId;

    if (isCustomer) {
      // A Customer can always reply, no eligibility or block check --
      // blocking only ever restricts the Provider's side.
    } else {
      await this.requireActiveTenantMember(conversation.tenant_id, actorUserId);
      await this.assertNotBlocked(conversation.tenant_id, conversation.customer_user_id);
    }

    const message = await this.insertMessage(conversationId, actorUserId, body);
    const full: DirectMessageRecord = { ...message, senderIsCustomer: isCustomer };

    await this.audit.record({
      tenantId: conversation.tenant_id,
      actorUserId,
      action: isCustomer ? 'conversation.message.customer' : 'conversation.message.provider',
      targetType: 'conversation',
      targetId: conversationId,
    });

    if (isCustomer) {
      await this.notifyTenantStaff(conversation.tenant_id, conversationId, full);
    } else {
      this.realtime.sendToUser(conversation.customer_user_id, 'message:new', { conversationId, message: full });
    }

    return full;
  }

  async listMessages(conversationId: string, actorUserId: string): Promise<DirectMessageRecord[]> {
    const conversation = await this.requireConversation(conversationId);
    const isCustomer = conversation.customer_user_id === actorUserId;
    if (!isCustomer) {
      await this.requireActiveTenantMember(conversation.tenant_id, actorUserId);
    }

    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT id, conversation_id, sender_user_id, body, created_at, read_at
       FROM direct_message WHERE conversation_id = $1 ORDER BY created_at ASC`,
      [conversationId],
    );

    // Mark the other party's messages as read now that this participant
    // is looking at the conversation.
    await this.db.query(
      `UPDATE direct_message SET read_at = now()
       WHERE conversation_id = $1 AND sender_user_id <> $2 AND read_at IS NULL`,
      [conversationId, actorUserId],
    );

    return rows.map((row) => ({
      id: row.id as string,
      conversationId: row.conversation_id as string,
      senderUserId: row.sender_user_id as string,
      senderIsCustomer: row.sender_user_id === conversation.customer_user_id,
      body: row.body as string,
      createdAt: row.created_at as string,
      readAt: (row.read_at as string) ?? null,
    }));
  }

  async listForCustomer(customerUserId: string): Promise<ConversationSummary[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT c.id, c.tenant_id, t.name AS tenant_name, c.customer_user_id, c.context_type, c.context_id, c.last_message_at,
              (SELECT body FROM direct_message dm WHERE dm.conversation_id = c.id ORDER BY dm.created_at DESC LIMIT 1) AS last_body,
              (SELECT count(*) FROM direct_message dm WHERE dm.conversation_id = c.id AND dm.sender_user_id <> c.customer_user_id AND dm.read_at IS NULL) AS unread_count
       FROM conversation c JOIN tenant t ON t.id = c.tenant_id
       WHERE c.customer_user_id = $1
       ORDER BY c.last_message_at DESC`,
      [customerUserId],
    );
    return rows.map((row) => toSummary(row, ''));
  }

  async listForTenant(tenantId: string): Promise<ConversationSummary[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT c.id, c.tenant_id, t.name AS tenant_name, c.customer_user_id, u.full_name AS customer_name,
              c.context_type, c.context_id, c.last_message_at,
              (SELECT body FROM direct_message dm WHERE dm.conversation_id = c.id ORDER BY dm.created_at DESC LIMIT 1) AS last_body,
              (SELECT count(*) FROM direct_message dm WHERE dm.conversation_id = c.id AND dm.sender_user_id = c.customer_user_id AND dm.read_at IS NULL) AS unread_count
       FROM conversation c JOIN tenant t ON t.id = c.tenant_id JOIN app_user u ON u.id = c.customer_user_id
       WHERE c.tenant_id = $1
       ORDER BY c.last_message_at DESC`,
      [tenantId],
    );
    return rows.map((row) => toSummary(row, row.customer_name as string));
  }

  async block(conversationId: string, customerUserId: string): Promise<void> {
    const conversation = await this.requireConversation(conversationId);
    if (conversation.customer_user_id !== customerUserId) {
      throw new ForbiddenException('Only the customer in this conversation can block this business.');
    }
    await this.db.query(
      `INSERT INTO customer_provider_block (customer_user_id, tenant_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [customerUserId, conversation.tenant_id],
    );
    await this.audit.record({
      tenantId: conversation.tenant_id,
      actorUserId: customerUserId,
      action: 'conversation.block',
      targetType: 'conversation',
      targetId: conversationId,
    });
  }

  async unblock(conversationId: string, customerUserId: string): Promise<void> {
    const conversation = await this.requireConversation(conversationId);
    if (conversation.customer_user_id !== customerUserId) {
      throw new ForbiddenException('Only the customer in this conversation can unblock this business.');
    }
    await this.db.query(`DELETE FROM customer_provider_block WHERE customer_user_id = $1 AND tenant_id = $2`, [
      customerUserId,
      conversation.tenant_id,
    ]);
    await this.audit.record({
      tenantId: conversation.tenant_id,
      actorUserId: customerUserId,
      action: 'conversation.unblock',
      targetType: 'conversation',
      targetId: conversationId,
    });
  }

  async isBlocked(tenantId: string, customerUserId: string): Promise<boolean> {
    const [row] = await this.db.query<{ id: string }>(
      `SELECT id FROM customer_provider_block WHERE customer_user_id = $1 AND tenant_id = $2`,
      [customerUserId, tenantId],
    );
    return Boolean(row);
  }

  private async requireConversation(conversationId: string): Promise<{ id: string; tenant_id: string; customer_user_id: string }> {
    const [row] = await this.db.query<{ id: string; tenant_id: string; customer_user_id: string }>(
      `SELECT id, tenant_id, customer_user_id FROM conversation WHERE id = $1`,
      [conversationId],
    );
    if (!row) {
      throw new NotFoundException('Conversation not found.');
    }
    return row;
  }

  private async notifyTenantStaff(tenantId: string, conversationId: string, message: DirectMessageRecord): Promise<void> {
    const staff = await this.db.withTenant(tenantId, async (client) => {
      const { rows } = await client.query<{ user_id: string }>(
        `SELECT user_id FROM membership WHERE tenant_id = $1 AND status = 'active'`,
        [tenantId],
      );
      return rows.map((row) => row.user_id);
    });
    for (const userId of staff) {
      this.realtime.sendToUser(userId, 'message:new', { conversationId, message: { ...message, senderIsCustomer: true } });
    }
  }

  private async getConversationSummary(conversationId: string): Promise<ConversationSummary> {
    const [row] = await this.db.query<Record<string, unknown>>(
      `SELECT c.id, c.tenant_id, t.name AS tenant_name, c.customer_user_id, u.full_name AS customer_name,
              c.context_type, c.context_id, c.last_message_at,
              (SELECT body FROM direct_message dm WHERE dm.conversation_id = c.id ORDER BY dm.created_at DESC LIMIT 1) AS last_body,
              0 AS unread_count
       FROM conversation c JOIN tenant t ON t.id = c.tenant_id JOIN app_user u ON u.id = c.customer_user_id
       WHERE c.id = $1`,
      [conversationId],
    );
    return toSummary(row, (row.customer_name as string) ?? '');
  }
}

function toSummary(row: Record<string, unknown>, customerName: string): ConversationSummary {
  const preview = (row.last_body as string) ?? null;
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    tenantName: row.tenant_name as string,
    customerUserId: row.customer_user_id as string,
    customerName: (row.customer_name as string) ?? customerName,
    contextType: (row.context_type as string) ?? null,
    contextId: (row.context_id as string) ?? null,
    lastMessageAt: row.last_message_at as string,
    lastMessagePreview: preview ? preview.slice(0, MESSAGE_PREVIEW_LENGTH) : null,
    unreadCount: Number(row.unread_count ?? 0),
  };
}
