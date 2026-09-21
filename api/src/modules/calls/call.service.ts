import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { DirectMessageService } from '../messaging/direct-message.service';

export interface CallSummary {
  id: string;
  contextType: 'group' | 'customer_provider';
  groupId: string | null;
  groupName: string | null;
  tenantId: string | null;
  tenantName: string | null;
  callerUserId: string;
  callerName: string;
  calleeUserId: string | null;
  calleeName: string | null;
  acceptedByUserId: string | null;
  acceptedByName: string | null;
  status: 'ringing' | 'accepted' | 'declined' | 'ended' | 'no_answer' | 'failed';
  endReason: string | null;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
}

interface CallRow extends Record<string, unknown> {
  id: string;
  context_type: 'group' | 'customer_provider';
  group_id: string | null;
  tenant_id: string | null;
  conversation_id: string | null;
  caller_user_id: string;
  callee_user_id: string | null;
  accepted_by_user_id: string | null;
  status: CallSummary['status'];
  end_reason: string | null;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
}

/**
 * User Story 1's group-member calls, and the calling halves of User
 * Stories 2 & 3 -- Direct-message's sibling module (same eligibility
 * rules, same push-then-persist-first discipline) but for WebRTC
 * voice instead of text. See db/migrations/020_calls.sql's header for
 * the full design.
 *
 * REST here only ever changes the call row's STATUS (ringing ->
 * accepted/declined/no_answer, accepted -> ended) -- the actual SDP
 * offer/answer/ICE exchange never touches this service; it's relayed
 * directly by RealtimeGateway.onInbound('call:signal', ...), wired up
 * in this class's constructor, with this service only checked as the
 * authority on "are these two userIds actually the two participants
 * of this call".
 */
@Injectable()
export class CallService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
    private readonly messaging: DirectMessageService,
  ) {
    // Relay only -- never persisted (see class comment). The sender's
    // userId comes from the authenticated socket (RealtimeGateway),
    // never from the payload, so a client can't spoof who a signal is
    // "from".
    this.realtime.onInbound('call:signal', (userId, payload) => {
      this.relaySignal(userId, payload).catch(() => {
        // A malformed or unauthorized signal is dropped silently --
        // same "never throws" posture as sendToUser itself; the
        // sender just won't see their offer/answer/candidate arrive,
        // which surfaces to the user as a failed/stuck call (AC10,
        // User Story 1 -- "shall not incorrectly indicate ... connected").
      });
    });
  }

  private async relaySignal(fromUserId: string, payload: unknown): Promise<void> {
    const body = payload as { callId?: string; toUserId?: string; data?: unknown } | null;
    if (!body?.callId || !body.toUserId || body.data === undefined) return;

    const call = await this.requireCall(body.callId);
    const participants = [call.caller_user_id, call.callee_user_id, call.accepted_by_user_id].filter(Boolean);
    if (!participants.includes(fromUserId) || !participants.includes(body.toUserId)) {
      return;
    }

    this.realtime.sendToUser(body.toUserId, 'call:signal', { callId: call.id, fromUserId, data: body.data });
  }

  async initiateGroupCall(callerId: string, groupId: string, calleeUserId: string): Promise<CallSummary> {
    if (callerId === calleeUserId) {
      throw new ForbiddenException('You cannot call yourself.');
    }

    const members = await this.db.query<{ user_id: string }>(
      `SELECT user_id FROM group_member WHERE group_id = $1 AND user_id = ANY($2) AND status = 'active'`,
      [groupId, [callerId, calleeUserId]],
    );
    if (members.length < 2) {
      throw new ForbiddenException('Both members must be active in this group to call each other.');
    }

    const row = await this.insertCall({
      contextType: 'group',
      groupId,
      tenantId: null,
      callerUserId: callerId,
      calleeUserId,
    });

    await this.audit.record({ actorUserId: callerId, action: 'call.initiate', targetType: 'call', targetId: row.id, metadata: { groupId, calleeUserId } });

    const [caller] = await this.db.query<{ full_name: string }>(`SELECT full_name FROM app_user WHERE id = $1`, [callerId]);
    this.realtime.sendToUser(calleeUserId, 'call:incoming', {
      callId: row.id,
      contextType: 'group',
      groupId,
      callerUserId: callerId,
      callerName: caller?.full_name ?? 'Someone',
    });

    return this.toSummary(row);
  }

  async initiateCustomerCall(customerId: string, tenantId: string): Promise<CallSummary> {
    const [tenant] = await this.db.query<{ id: string; name: string }>(`SELECT id, name FROM tenant WHERE id = $1`, [tenantId]);
    if (!tenant) {
      throw new NotFoundException('Business not found.');
    }

    const row = await this.insertCall({
      contextType: 'customer_provider',
      groupId: null,
      tenantId,
      callerUserId: customerId,
      calleeUserId: null,
    });

    await this.audit.record({ tenantId, actorUserId: customerId, action: 'call.initiate', targetType: 'call', targetId: row.id });

    const [caller] = await this.db.query<{ full_name: string }>(`SELECT full_name FROM app_user WHERE id = $1`, [customerId]);
    const staff = await this.activeTenantStaff(tenantId);
    for (const userId of staff) {
      this.realtime.sendToUser(userId, 'call:incoming', {
        callId: row.id,
        contextType: 'customer_provider',
        tenantId,
        callerUserId: customerId,
        callerName: caller?.full_name ?? 'A customer',
      });
    }

    return this.toSummary(row);
  }

  async initiateProviderCall(actorUserId: string, tenantId: string, customerUserId: string): Promise<CallSummary> {
    await this.assertNotBlocked(tenantId, customerUserId);
    const eligible = await this.messaging.isProviderEligibleToInitiate(tenantId, customerUserId);
    if (!eligible) {
      throw new ForbiddenException(
        'You can call a customer only once there is an existing booking, job request, accepted invitation, or the customer has contacted you first.',
      );
    }

    const row = await this.insertCall({
      contextType: 'customer_provider',
      groupId: null,
      tenantId,
      callerUserId: actorUserId,
      calleeUserId: customerUserId,
    });

    await this.audit.record({ tenantId, actorUserId, action: 'call.initiate', targetType: 'call', targetId: row.id, metadata: { customerUserId } });

    const [tenant] = await this.db.query<{ name: string }>(`SELECT name FROM tenant WHERE id = $1`, [tenantId]);
    this.realtime.sendToUser(customerUserId, 'call:incoming', {
      callId: row.id,
      contextType: 'customer_provider',
      tenantId,
      callerUserId: actorUserId,
      callerName: tenant?.name ?? 'A business',
    });

    return this.toSummary(row);
  }

  async accept(callId: string, actorUserId: string): Promise<CallSummary> {
    const call = await this.requireCall(callId);
    if (call.status !== 'ringing') {
      throw new ForbiddenException('This call is no longer ringing.');
    }

    if (call.callee_user_id) {
      if (call.callee_user_id !== actorUserId) {
        throw new ForbiddenException('This call is not for you.');
      }
    } else {
      // Customer-initiated tenant call: any active staff member may accept.
      await this.assertNotBlocked(call.tenant_id as string, call.caller_user_id);
      const staff = await this.activeTenantStaff(call.tenant_id as string);
      if (!staff.includes(actorUserId)) {
        throw new ForbiddenException('You are not an active member of this business.');
      }
    }

    const [row] = await this.db.query<CallRow>(
      `UPDATE call SET status = 'accepted', accepted_by_user_id = $2, answered_at = now() WHERE id = $1 RETURNING *`,
      [callId, actorUserId],
    );

    await this.audit.record({ tenantId: call.tenant_id, actorUserId, action: 'call.accept', targetType: 'call', targetId: callId });

    const [accepter] = await this.db.query<{ full_name: string }>(`SELECT full_name FROM app_user WHERE id = $1`, [actorUserId]);
    this.realtime.sendToUser(call.caller_user_id, 'call:accepted', {
      callId,
      acceptedByUserId: actorUserId,
      acceptedByName: accepter?.full_name ?? 'Someone',
    });

    // Multi-ring (customer calling a tenant): every OTHER staff member
    // who was also ringing needs to be told the call was taken.
    if (!call.callee_user_id && call.tenant_id) {
      const staff = await this.activeTenantStaff(call.tenant_id);
      for (const userId of staff) {
        if (userId !== actorUserId) {
          this.realtime.sendToUser(userId, 'call:ended', { callId, reason: 'taken' });
        }
      }
    }

    return this.toSummary(row);
  }

  async decline(callId: string, actorUserId: string): Promise<CallSummary> {
    const call = await this.requireCall(callId);
    if (call.status !== 'ringing') {
      throw new ForbiddenException('This call is no longer ringing.');
    }

    if (!call.callee_user_id) {
      // Multi-ring (a Customer calling a tenant -- see this class's
      // header): one staff member declining is just that person
      // dismissing their own ringing phone, not the caller being
      // rejected -- other staff may still accept, so the call row
      // itself is untouched and the caller hears nothing.
      if (!call.tenant_id) {
        throw new ForbiddenException('This call is not for you.');
      }
      const staff = await this.activeTenantStaff(call.tenant_id);
      if (!staff.includes(actorUserId)) {
        throw new ForbiddenException('This call is not for you.');
      }
      return this.toSummary(call);
    }

    if (call.callee_user_id !== actorUserId) {
      throw new ForbiddenException('This call is not for you.');
    }

    const [row] = await this.db.query<CallRow>(
      `UPDATE call SET status = 'declined', end_reason = 'declined', ended_at = now() WHERE id = $1 RETURNING *`,
      [callId],
    );

    await this.audit.record({ tenantId: call.tenant_id, actorUserId, action: 'call.decline', targetType: 'call', targetId: callId });

    this.realtime.sendToUser(call.caller_user_id, 'call:ended', { callId, reason: 'declined' });

    return this.toSummary(row);
  }

  async timeout(callId: string, actorUserId: string): Promise<CallSummary> {
    const call = await this.requireCall(callId);
    if (call.caller_user_id !== actorUserId) {
      throw new ForbiddenException('Only the caller can report a call as unanswered.');
    }
    if (call.status !== 'ringing') {
      // Already resolved (accepted/declined) by the time the caller's
      // client-side timer fired -- nothing to do.
      return this.toSummary(call);
    }

    const [row] = await this.db.query<CallRow>(
      `UPDATE call SET status = 'no_answer', end_reason = 'no_answer', ended_at = now() WHERE id = $1 RETURNING *`,
      [callId],
    );

    if (call.callee_user_id) {
      this.realtime.sendToUser(call.callee_user_id, 'call:ended', { callId, reason: 'no_answer' });
    } else if (call.tenant_id) {
      const staff = await this.activeTenantStaff(call.tenant_id);
      for (const userId of staff) {
        this.realtime.sendToUser(userId, 'call:ended', { callId, reason: 'no_answer' });
      }
    }

    return this.toSummary(row);
  }

  async end(callId: string, actorUserId: string): Promise<CallSummary> {
    const call = await this.requireCall(callId);
    const participants = [call.caller_user_id, call.callee_user_id, call.accepted_by_user_id].filter(Boolean);
    if (!participants.includes(actorUserId)) {
      throw new ForbiddenException('You are not a participant in this call.');
    }
    if (call.status !== 'accepted' && call.status !== 'ringing') {
      return this.toSummary(call);
    }

    const [row] = await this.db.query<CallRow>(
      `UPDATE call SET status = 'ended', end_reason = 'ended', ended_at = now() WHERE id = $1 RETURNING *`,
      [callId],
    );

    await this.audit.record({ tenantId: call.tenant_id, actorUserId, action: 'call.end', targetType: 'call', targetId: callId });

    const other = [call.caller_user_id, call.accepted_by_user_id].filter((id): id is string => Boolean(id) && id !== actorUserId);
    for (const userId of other) {
      this.realtime.sendToUser(userId, 'call:ended', { callId, reason: 'ended' });
    }

    return this.toSummary(row);
  }

  async listMine(userId: string): Promise<CallSummary[]> {
    const rows = await this.db.query<CallRow>(
      `SELECT * FROM call WHERE caller_user_id = $1 OR callee_user_id = $1 OR accepted_by_user_id = $1
       ORDER BY started_at DESC LIMIT 100`,
      [userId],
    );
    return this.toSummaries(rows);
  }

  async listForTenant(tenantId: string): Promise<CallSummary[]> {
    const rows = await this.db.query<CallRow>(`SELECT * FROM call WHERE tenant_id = $1 ORDER BY started_at DESC LIMIT 100`, [tenantId]);
    return this.toSummaries(rows);
  }

  private async assertNotBlocked(tenantId: string, customerUserId: string): Promise<void> {
    if (await this.messaging.isBlocked(tenantId, customerUserId)) {
      throw new ForbiddenException('This customer has blocked calls from your business.');
    }
  }

  private async activeTenantStaff(tenantId: string): Promise<string[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const { rows } = await client.query<{ user_id: string }>(`SELECT user_id FROM membership WHERE tenant_id = $1 AND status = 'active'`, [
        tenantId,
      ]);
      return rows.map((r) => r.user_id);
    });
  }

  private async insertCall(input: {
    contextType: 'group' | 'customer_provider';
    groupId: string | null;
    tenantId: string | null;
    callerUserId: string;
    calleeUserId: string | null;
  }): Promise<CallRow> {
    const [row] = await this.db.query<CallRow>(
      `INSERT INTO call (context_type, group_id, tenant_id, caller_user_id, callee_user_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [input.contextType, input.groupId, input.tenantId, input.callerUserId, input.calleeUserId],
    );
    return row;
  }

  private async requireCall(callId: string): Promise<CallRow> {
    const [row] = await this.db.query<CallRow>(`SELECT * FROM call WHERE id = $1`, [callId]);
    if (!row) {
      throw new NotFoundException('Call not found.');
    }
    return row;
  }

  private async toSummaries(rows: CallRow[]): Promise<CallSummary[]> {
    if (rows.length === 0) return [];
    const userIds = Array.from(
      new Set(rows.flatMap((r) => [r.caller_user_id, r.callee_user_id, r.accepted_by_user_id].filter(Boolean) as string[])),
    );
    const tenantIds = Array.from(new Set(rows.map((r) => r.tenant_id).filter(Boolean) as string[]));
    const groupIds = Array.from(new Set(rows.map((r) => r.group_id).filter(Boolean) as string[]));

    const [users, tenants, groups] = await Promise.all([
      userIds.length ? this.db.query<{ id: string; full_name: string }>(`SELECT id, full_name FROM app_user WHERE id = ANY($1)`, [userIds]) : [],
      tenantIds.length ? this.db.query<{ id: string; name: string }>(`SELECT id, name FROM tenant WHERE id = ANY($1)`, [tenantIds]) : [],
      groupIds.length ? this.db.query<{ id: string; name: string }>(`SELECT id, name FROM "group" WHERE id = ANY($1)`, [groupIds]) : [],
    ]);
    const userName = new Map(users.map((u) => [u.id, u.full_name]));
    const tenantName = new Map(tenants.map((t) => [t.id, t.name]));
    const groupName = new Map(groups.map((g) => [g.id, g.name]));

    return rows.map((row) => this.toSummary(row, userName, tenantName, groupName));
  }

  private toSummary(
    row: CallRow,
    userName?: Map<string, string>,
    tenantName?: Map<string, string>,
    groupName?: Map<string, string>,
  ): CallSummary {
    return {
      id: row.id,
      contextType: row.context_type,
      groupId: row.group_id,
      groupName: row.group_id ? groupName?.get(row.group_id) ?? null : null,
      tenantId: row.tenant_id,
      tenantName: row.tenant_id ? tenantName?.get(row.tenant_id) ?? null : null,
      callerUserId: row.caller_user_id,
      callerName: userName?.get(row.caller_user_id) ?? '',
      calleeUserId: row.callee_user_id,
      calleeName: row.callee_user_id ? userName?.get(row.callee_user_id) ?? null : null,
      acceptedByUserId: row.accepted_by_user_id,
      acceptedByName: row.accepted_by_user_id ? userName?.get(row.accepted_by_user_id) ?? null : null,
      status: row.status,
      endReason: row.end_reason,
      startedAt: row.started_at,
      answeredAt: row.answered_at,
      endedAt: row.ended_at,
    };
  }
}
