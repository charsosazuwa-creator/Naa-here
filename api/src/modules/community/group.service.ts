import { ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { EMAIL_PROVIDER, EmailProvider } from '../notifications/email-provider.interface';
import {
  ChangeRoleDto,
  CreateGroupDto,
  DiscoverGroupsQueryDto,
  ModerateMemberDto,
  TransferOwnershipDto,
  UpdateGroupDto,
} from './dto/group.dto';

export type GroupRole = 'owner' | 'administrator' | 'moderator' | 'member';
export type GroupMemberStatus = 'pending' | 'invited' | 'active' | 'suspended' | 'muted' | 'removed' | 'declined' | 'left';

export interface GroupSummary {
  id: string;
  name: string;
  description: string | null;
  industryCategory: string | null;
  locationText: string | null;
  imageUrl: string | null;
  visibility: 'public' | 'private' | 'hidden';
  membershipType: 'open' | 'request' | 'invite_only';
  rules: string | null;
  ownerUserId: string;
  status: 'active' | 'closed';
  memberCount: number;
  myRole: GroupRole | null;
  myStatus: GroupMemberStatus | null;
  createdAt: string;
}

export interface GroupMemberSummary {
  membershipId: string;
  userId: string;
  fullName: string;
  role: GroupRole;
  status: GroupMemberStatus;
  createdAt: string;
}

const MANAGE_ROLES: GroupRole[] = ['owner', 'administrator'];
const MODERATE_ROLES: GroupRole[] = ['owner', 'administrator', 'moderator'];

function toGroupSummary(row: Record<string, unknown>): GroupSummary {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? null,
    industryCategory: (row.industry_category as string) ?? null,
    locationText: (row.location_text as string) ?? null,
    imageUrl: (row.image_url as string) ?? null,
    visibility: row.visibility as GroupSummary['visibility'],
    membershipType: row.membership_type as GroupSummary['membershipType'],
    rules: (row.rules as string) ?? null,
    ownerUserId: row.owner_user_id as string,
    status: row.status as GroupSummary['status'],
    memberCount: Number(row.member_count ?? 0),
    myRole: (row.my_role as GroupRole) ?? null,
    myStatus: (row.my_status as GroupMemberStatus) ?? null,
    createdAt: row.created_at as string,
  };
}

/**
 * User Story 5: Service Provider / Business Owner community groups.
 * Like ListingService/CustomerInvitationService, a group is a
 * cross-tenant, user-level entity with NO tenant-scoped RLS backing
 * it (see migration 016's header comment) -- every access, ownership
 * and moderation rule below is enforced here in the application
 * layer, the same way listing.service.ts enforces listing ownership.
 *
 * "Eligible" (AC: membership restricted to verified Service Providers
 * / Business Owners) means: an active membership in at least one
 * tenant, in a provider-side role, where that tenant has at least one
 * APPROVED verification_submission -- the same "verified" the
 * platform already tracks for businesses (see admin verification
 * review, migration 010).
 */
@Injectable()
export class GroupService {
  private readonly logger = new Logger(GroupService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
  ) {}

  private async assertEligible(userId: string): Promise<void> {
    // `membership` has RLS (migration 001) that only lets a plain
    // this.db.query() see rows once app.tenant_id is set -- which we
    // don't have yet here, that's the whole point of this check. Run
    // inside withUser() instead so the self-scoped policy from
    // migration 007 (`membership_visible_to_self`) applies.
    //
    // Checking `tenant.verification_status = 'verified'` rather than
    // joining verification_submission directly sidesteps the same
    // problem there: verification_submission's RLS (migration 002)
    // only matches a specific app.tenant_id or a platform-reviewer
    // role (migration 010), neither of which is in scope for an
    // ordinary member checking their own tenant. `tenant` itself has
    // no RLS (see migration 010's note -- discovery/browse depends on
    // it being globally readable), and verification.service.ts's
    // decide() already keeps this column in sync with the submission
    // it was derived from, so it's an equivalent, RLS-safe check.
    const rows = await this.db.withUser(userId, (client) =>
      client
        .query(
          `SELECT true AS ok
           FROM membership m
           JOIN role r ON r.id = m.role_id
           JOIN tenant t ON t.id = m.tenant_id
           WHERE m.user_id = $1 AND m.status = 'active' AND r.code IN ('owner', 'staff', 'artisan', 'host')
             AND t.verification_status = 'verified'
           LIMIT 1`,
          [userId],
        )
        .then((r) => r.rows),
    );
    if (!rows.length) {
      throw new ForbiddenException(
        'Community groups are for verified Service Providers and Business Owners. Complete business verification first.',
      );
    }
  }

  private async getMembership(
    groupId: string,
    userId: string,
  ): Promise<{ id: string; role: GroupRole; status: GroupMemberStatus } | null> {
    const [row] = await this.db.query<{ id: string; role: GroupRole; status: GroupMemberStatus }>(
      `SELECT id, role, status FROM group_member WHERE group_id = $1 AND user_id = $2`,
      [groupId, userId],
    );
    return row ?? null;
  }

  private async requireGroup(groupId: string): Promise<Record<string, unknown>> {
    const [group] = await this.db.query(`SELECT * FROM "group" WHERE id = $1`, [groupId]);
    if (!group) {
      throw new NotFoundException('Group not found.');
    }
    return group;
  }

  private async requireActiveRole(groupId: string, userId: string, allowed: GroupRole[]): Promise<GroupMemberStatus | GroupRole> {
    const membership = await this.getMembership(groupId, userId);
    if (!membership || membership.status !== 'active') {
      throw new ForbiddenException('You are not an active member of this group.');
    }
    if (!allowed.includes(membership.role)) {
      throw new ForbiddenException('Your role in this group cannot do this.');
    }
    return membership.role;
  }

  private async notify(email: string | null, subject: string, text: string): Promise<void> {
    if (!email) return;
    try {
      await this.emailProvider.send({ to: email, subject, text });
    } catch (err) {
      this.logger.warn(`Group notification email failed (provider=${this.emailProvider.name}) to ${email}: ${(err as Error).message}`);
    }
  }

  // -------------------------------------------------------------
  // Group CRUD + discovery
  // -------------------------------------------------------------

  async create(userId: string, dto: CreateGroupDto): Promise<GroupSummary> {
    await this.assertEligible(userId);

    // AC: prevent duplicate/prohibited-content groups -- a same-name
    // active group is rejected outright; a lightweight banned-word
    // check on name/description covers the "prohibited content"
    // half without needing a full content-moderation pipeline here.
    const [dup] = await this.db.query<{ id: string }>(
      `SELECT id FROM "group" WHERE lower(name) = lower($1) AND status = 'active'`,
      [dto.name],
    );
    if (dup) {
      throw new ConflictException('A group with this name already exists.');
    }
    assertNoProhibitedContent(`${dto.name} ${dto.description ?? ''} ${dto.rules ?? ''}`);

    return this.db.withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO "group" (name, description, industry_category, location_text, image_url, visibility, membership_type, rules, owner_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [
          dto.name,
          dto.description ?? null,
          dto.industryCategory ?? null,
          dto.locationText ?? null,
          dto.imageUrl ?? null,
          dto.visibility ?? 'public',
          dto.membershipType ?? 'open',
          dto.rules ?? null,
          userId,
        ],
      );
      const group = rows[0];

      await client.query(
        `INSERT INTO group_member (group_id, user_id, role, status) VALUES ($1,$2,'owner','active')`,
        [group.id, userId],
      );

      await this.audit.record(
        { actorUserId: userId, action: 'group.create', targetType: 'group', targetId: group.id, metadata: { name: dto.name } },
        client,
      );

      return { ...toGroupSummary(group), memberCount: 1, myRole: 'owner' as GroupRole, myStatus: 'active' as GroupMemberStatus };
    });
  }

  async discover(userId: string, query: DiscoverGroupsQueryDto): Promise<GroupSummary[]> {
    const conditions: string[] = [`g.status = 'active'`, `g.visibility != 'hidden'`];
    const params: unknown[] = [userId];
    let i = 2;

    if (query.q) {
      conditions.push(`(g.name ILIKE $${i} OR g.description ILIKE $${i})`);
      params.push(`%${query.q}%`);
      i += 1;
    }
    if (query.category) {
      conditions.push(`g.industry_category ILIKE $${i}`);
      params.push(`%${query.category}%`);
      i += 1;
    }
    if (query.location) {
      conditions.push(`g.location_text ILIKE $${i}`);
      params.push(`%${query.location}%`);
      i += 1;
    }

    const rows = await this.db.query(
      `SELECT g.*,
              (SELECT count(*) FROM group_member gm WHERE gm.group_id = g.id AND gm.status = 'active') AS member_count,
              me.role AS my_role, me.status AS my_status
       FROM "group" g
       LEFT JOIN group_member me ON me.group_id = g.id AND me.user_id = $1
       WHERE ${conditions.join(' AND ')}
       ORDER BY g.created_at DESC`,
      params,
    );
    return rows.map(toGroupSummary);
  }

  async get(groupId: string, userId: string): Promise<GroupSummary> {
    const [row] = await this.db.query(
      `SELECT g.*,
              (SELECT count(*) FROM group_member gm WHERE gm.group_id = g.id AND gm.status = 'active') AS member_count,
              me.role AS my_role, me.status AS my_status
       FROM "group" g
       LEFT JOIN group_member me ON me.group_id = g.id AND me.user_id = $2
       WHERE g.id = $1`,
      [groupId, userId],
    );
    if (!row) {
      throw new NotFoundException('Group not found.');
    }
    const summary = toGroupSummary(row);
    // AC: hidden groups are discoverable only by their members; a
    // private group's existence/detail is fine to show, only its
    // posts stay member-only (see GroupPostService).
    if (summary.visibility === 'hidden' && summary.myStatus !== 'active') {
      throw new NotFoundException('Group not found.');
    }
    return summary;
  }

  async update(groupId: string, userId: string, dto: UpdateGroupDto): Promise<GroupSummary> {
    await this.requireActiveRole(groupId, userId, MANAGE_ROLES);
    const before = await this.requireGroup(groupId);

    if (dto.name) {
      assertNoProhibitedContent(`${dto.name} ${dto.description ?? ''} ${dto.rules ?? ''}`);
    }

    return this.db.withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE "group" SET
           name = COALESCE($1, name),
           description = COALESCE($2, description),
           industry_category = COALESCE($3, industry_category),
           location_text = COALESCE($4, location_text),
           image_url = COALESCE($5, image_url),
           visibility = COALESCE($6, visibility),
           membership_type = COALESCE($7, membership_type),
           rules = COALESCE($8, rules),
           updated_at = now()
         WHERE id = $9
         RETURNING *`,
        [
          dto.name ?? null,
          dto.description ?? null,
          dto.industryCategory ?? null,
          dto.locationText ?? null,
          dto.imageUrl ?? null,
          dto.visibility ?? null,
          dto.membershipType ?? null,
          dto.rules ?? null,
          groupId,
        ],
      );

      // AC: material-change audit logging -- record exactly what
      // changed, not just that an edit happened.
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const [key, column] of Object.entries({
        name: 'name',
        description: 'description',
        visibility: 'visibility',
        membershipType: 'membership_type',
        rules: 'rules',
      })) {
        const dtoVal = (dto as Record<string, unknown>)[key];
        if (dtoVal !== undefined && dtoVal !== before[column]) {
          changes[key] = { from: before[column], to: dtoVal };
        }
      }

      await this.audit.record(
        { actorUserId: userId, action: 'group.update', targetType: 'group', targetId: groupId, metadata: { changes } },
        client,
      );

      return toGroupSummary({ ...rows[0], member_count: 0 });
    });
  }

  // -------------------------------------------------------------
  // Membership
  // -------------------------------------------------------------

  async join(groupId: string, userId: string): Promise<GroupMemberSummary> {
    await this.assertEligible(userId);
    const group = await this.requireGroup(groupId);
    if (group.status !== 'active') {
      throw new ConflictException('This group is closed.');
    }
    if (group.membership_type === 'invite_only') {
      throw new ForbiddenException('This group is invite-only.');
    }

    const existing = await this.getMembership(groupId, userId);
    if (existing && ['active', 'pending', 'invited'].includes(existing.status)) {
      throw new ConflictException(`You already have a ${existing.status} membership in this group.`);
    }

    const status: GroupMemberStatus = group.membership_type === 'request' ? 'pending' : 'active';

    return this.db.withTransaction(async (client) => {
      const { rows } = await client.query(
        existing
          ? `UPDATE group_member SET status = $3, role = 'member', updated_at = now() WHERE group_id = $1 AND user_id = $2 RETURNING id, user_id, role, status, created_at`
          : `INSERT INTO group_member (group_id, user_id, role, status) VALUES ($1,$2,'member',$3) RETURNING id, user_id, role, status, created_at`,
        [groupId, userId, status],
      );

      await this.audit.record(
        { actorUserId: userId, action: status === 'pending' ? 'group.join.request' : 'group.join', targetType: 'group', targetId: groupId },
        client,
      );

      return toMemberSummary(rows[0], await this.fullName(userId));
    });
  }

  async decideJoinRequest(groupId: string, memberId: string, actorUserId: string, approve: boolean): Promise<void> {
    await this.requireActiveRole(groupId, actorUserId, MANAGE_ROLES);
    const [member] = await this.db.query<{ id: string; user_id: string; status: string }>(
      `SELECT id, user_id, status FROM group_member WHERE id = $1 AND group_id = $2`,
      [memberId, groupId],
    );
    if (!member || member.status !== 'pending') {
      throw new NotFoundException('No pending join request found.');
    }

    await this.db.withTransaction(async (client) => {
      await client.query(`UPDATE group_member SET status = $1, updated_at = now() WHERE id = $2`, [
        approve ? 'active' : 'declined',
        memberId,
      ]);
      await this.audit.record(
        {
          actorUserId,
          action: approve ? 'group.join.approve' : 'group.join.decline',
          targetType: 'group_member',
          targetId: memberId,
          metadata: { groupId },
        },
        client,
      );
    });

    const email = await this.email(member.user_id);
    const group = await this.requireGroup(groupId);
    await this.notify(
      email,
      `Your request to join ${group.name as string}`,
      approve
        ? `Your request to join "${group.name}" on Naa here was approved. You're in!`
        : `Your request to join "${group.name}" on Naa here was declined.`,
    );
  }

  async invite(groupId: string, actorUserId: string, email: string): Promise<GroupMemberSummary> {
    await this.requireActiveRole(groupId, actorUserId, MANAGE_ROLES);
    const [user] = await this.db.query<{ id: string; full_name: string; email: string | null }>(
      `SELECT id, full_name, email FROM app_user WHERE email = $1`,
      [email],
    );
    if (!user) {
      throw new NotFoundException('No account exists yet for that email.');
    }

    const existing = await this.getMembership(groupId, user.id);
    if (existing && ['active', 'pending', 'invited'].includes(existing.status)) {
      throw new ConflictException(`This person already has a ${existing.status} membership in this group.`);
    }

    const group = await this.requireGroup(groupId);

    const row = await this.db.withTransaction(async (client) => {
      const { rows } = await client.query(
        existing
          ? `UPDATE group_member SET status = 'invited', role = 'member', invited_by = $3, updated_at = now() WHERE group_id = $1 AND user_id = $2 RETURNING id, user_id, role, status, created_at`
          : `INSERT INTO group_member (group_id, user_id, role, status, invited_by) VALUES ($1,$2,'member','invited',$3) RETURNING id, user_id, role, status, created_at`,
        [groupId, user.id, actorUserId],
      );
      await this.audit.record(
        { actorUserId, action: 'group.invite', targetType: 'group_member', targetId: rows[0].id, metadata: { groupId, invitedUserId: user.id } },
        client,
      );
      return rows[0];
    });

    await this.notify(user.email, `Invitation to join ${group.name as string}`, `You've been invited to join "${group.name}" on Naa here. Sign in to accept or decline.`);

    return toMemberSummary(row, user.full_name);
  }

  async decideInvitation(groupId: string, userId: string, accept: boolean): Promise<void> {
    const membership = await this.getMembership(groupId, userId);
    if (!membership || membership.status !== 'invited') {
      throw new NotFoundException('No pending invitation found for this group.');
    }
    await this.db.withTransaction(async (client) => {
      await client.query(`UPDATE group_member SET status = $1, updated_at = now() WHERE id = $2`, [
        accept ? 'active' : 'declined',
        membership.id,
      ]);
      await this.audit.record(
        {
          actorUserId: userId,
          action: accept ? 'group.invite.accept' : 'group.invite.decline',
          targetType: 'group_member',
          targetId: membership.id,
          metadata: { groupId },
        },
        client,
      );
    });
  }

  async listMembers(groupId: string, userId: string): Promise<GroupMemberSummary[]> {
    await this.requireActiveRole(groupId, userId, ['owner', 'administrator', 'moderator', 'member']);
    // AC: members can view other members' business/professional info
    // only -- never private personal info (no email/phone here).
    const rows = await this.db.query(
      `SELECT gm.id, gm.user_id, gm.role, gm.status, gm.created_at, u.full_name
       FROM group_member gm JOIN app_user u ON u.id = gm.user_id
       WHERE gm.group_id = $1 AND gm.status IN ('active', 'suspended', 'muted')
       ORDER BY gm.created_at ASC`,
      [groupId],
    );
    return rows.map((r) => toMemberSummary(r, r.full_name as string));
  }

  async listPendingRequests(groupId: string, userId: string): Promise<GroupMemberSummary[]> {
    await this.requireActiveRole(groupId, userId, MANAGE_ROLES);
    const rows = await this.db.query(
      `SELECT gm.id, gm.user_id, gm.role, gm.status, gm.created_at, u.full_name
       FROM group_member gm JOIN app_user u ON u.id = gm.user_id
       WHERE gm.group_id = $1 AND gm.status = 'pending'
       ORDER BY gm.created_at ASC`,
      [groupId],
    );
    return rows.map((r) => toMemberSummary(r, r.full_name as string));
  }

  async myInvitations(userId: string): Promise<(GroupMemberSummary & { groupId: string; groupName: string })[]> {
    const rows = await this.db.query(
      `SELECT gm.id, gm.user_id, gm.role, gm.status, gm.created_at, gm.group_id, g.name AS group_name, u.full_name
       FROM group_member gm
       JOIN "group" g ON g.id = gm.group_id
       JOIN app_user u ON u.id = gm.user_id
       WHERE gm.user_id = $1 AND gm.status = 'invited'
       ORDER BY gm.created_at DESC`,
      [userId],
    );
    return rows.map((r) => ({ ...toMemberSummary(r, r.full_name as string), groupId: r.group_id as string, groupName: r.group_name as string }));
  }

  async changeRole(groupId: string, memberId: string, actorUserId: string, dto: ChangeRoleDto): Promise<void> {
    await this.requireActiveRole(groupId, actorUserId, ['owner']);
    const [member] = await this.db.query<{ id: string; user_id: string; role: string; status: string }>(
      `SELECT id, user_id, role, status FROM group_member WHERE id = $1 AND group_id = $2`,
      [memberId, groupId],
    );
    if (!member || member.status !== 'active') {
      throw new NotFoundException('Active member not found.');
    }
    if (member.role === 'owner') {
      throw new ForbiddenException("Use ownership transfer to change the group's owner.");
    }

    await this.db.withTransaction(async (client) => {
      await client.query(`UPDATE group_member SET role = $1, updated_at = now() WHERE id = $2`, [dto.role, memberId]);
      await this.audit.record(
        {
          actorUserId,
          action: 'group.member.role_change',
          targetType: 'group_member',
          targetId: memberId,
          metadata: { groupId, from: member.role, to: dto.role },
        },
        client,
      );
    });
  }

  async moderateMember(groupId: string, memberId: string, actorUserId: string, dto: ModerateMemberDto): Promise<void> {
    const actorRole = await this.requireActiveRole(groupId, actorUserId, MODERATE_ROLES);
    const [member] = await this.db.query<{ id: string; user_id: string; role: string; status: string }>(
      `SELECT id, user_id, role, status FROM group_member WHERE id = $1 AND group_id = $2`,
      [memberId, groupId],
    );
    if (!member || !['active', 'suspended', 'muted'].includes(member.status)) {
      throw new NotFoundException('Member not found.');
    }
    if (member.role === 'owner') {
      throw new ForbiddenException('The group owner cannot be moderated.');
    }
    // A moderator can act on ordinary members only, not administrators.
    if (actorRole === 'moderator' && member.role !== 'member') {
      throw new ForbiddenException('Moderators can only act on ordinary members.');
    }

    const statusByAction: Record<ModerateMemberDto['action'], GroupMemberStatus | null> = {
      warn: null, // no status change, just a recorded, notified warning
      suspend: 'suspended',
      mute: 'muted',
      remove: 'removed',
    };
    const newStatus = statusByAction[dto.action];

    await this.db.withTransaction(async (client) => {
      if (newStatus) {
        await client.query(`UPDATE group_member SET status = $1, last_status_reason = $2, updated_at = now() WHERE id = $3`, [
          newStatus,
          dto.reason,
          memberId,
        ]);
      } else {
        await client.query(`UPDATE group_member SET last_status_reason = $1, updated_at = now() WHERE id = $2`, [dto.reason, memberId]);
      }
      await this.audit.record(
        {
          actorUserId,
          action: `group.member.${dto.action}`,
          targetType: 'group_member',
          targetId: memberId,
          metadata: { groupId, reason: dto.reason },
        },
        client,
      );
    });

    const group = await this.requireGroup(groupId);
    const email = await this.email(member.user_id);
    await this.notify(
      email,
      `Moderation action in ${group.name as string}`,
      `A moderator of "${group.name}" took action on your membership (${dto.action}). Reason: ${dto.reason}`,
    );
  }

  async leave(groupId: string, userId: string): Promise<void> {
    const membership = await this.getMembership(groupId, userId);
    if (!membership || membership.status !== 'active') {
      throw new NotFoundException('You are not an active member of this group.');
    }
    if (membership.role === 'owner') {
      throw new ConflictException('The group owner must transfer ownership (or close the group) before leaving.');
    }

    await this.db.withTransaction(async (client) => {
      await client.query(`UPDATE group_member SET status = 'left', updated_at = now() WHERE id = $1`, [membership.id]);
      await this.audit.record({ actorUserId: userId, action: 'group.leave', targetType: 'group_member', targetId: membership.id, metadata: { groupId } }, client);
    });
  }

  async transferOwnership(groupId: string, currentOwnerId: string, dto: TransferOwnershipDto): Promise<void> {
    await this.requireActiveRole(groupId, currentOwnerId, ['owner']);
    const newOwner = await this.getMembership(groupId, dto.newOwnerUserId);
    if (!newOwner || newOwner.status !== 'active') {
      throw new NotFoundException('The new owner must be an active member of this group.');
    }

    await this.db.withTransaction(async (client) => {
      await client.query(`UPDATE "group" SET owner_user_id = $1, updated_at = now() WHERE id = $2`, [dto.newOwnerUserId, groupId]);
      await client.query(`UPDATE group_member SET role = 'administrator', updated_at = now() WHERE group_id = $1 AND user_id = $2`, [
        groupId,
        currentOwnerId,
      ]);
      await client.query(`UPDATE group_member SET role = 'owner', updated_at = now() WHERE id = $1`, [newOwner.id]);
      await this.audit.record(
        { actorUserId: currentOwnerId, action: 'group.ownership_transfer', targetType: 'group', targetId: groupId, metadata: { to: dto.newOwnerUserId } },
        client,
      );
    });
  }

  async close(groupId: string, ownerId: string): Promise<void> {
    await this.requireActiveRole(groupId, ownerId, ['owner']);
    await this.db.withTransaction(async (client) => {
      await client.query(`UPDATE "group" SET status = 'closed', updated_at = now() WHERE id = $1`, [groupId]);
      await this.audit.record({ actorUserId: ownerId, action: 'group.close', targetType: 'group', targetId: groupId }, client);
    });
  }

  // -------------------------------------------------------------
  // Shared helpers other group-* services also need.
  // -------------------------------------------------------------

  async requireActiveMembership(groupId: string, userId: string): Promise<{ id: string; role: GroupRole }> {
    const membership = await this.getMembership(groupId, userId);
    // 'muted' is checked, and reported, before the general active-only
    // check below -- a muted member IS still a member (they can read),
    // just not one currently allowed to post; folding it into the
    // generic "not an active member" branch would report the wrong
    // reason and imply re-joining rather than waiting out the mute.
    if (membership?.status === 'muted') {
      throw new ForbiddenException('You are muted in this group and cannot post right now.');
    }
    if (!membership || membership.status !== 'active') {
      throw new ForbiddenException('You are not an active member of this group.');
    }
    return membership;
  }

  /**
   * Like requireActiveMembership, but for reads (chat history, the
   * post feed) rather than writes: a muted member can still read
   * everything, only posting is restricted, so this accepts 'active'
   * OR 'muted' and never throws the muted-specific error.
   */
  async requireActiveMembershipReadOnly(groupId: string, userId: string): Promise<{ id: string; role: GroupRole }> {
    const membership = await this.getMembership(groupId, userId);
    if (!membership || !['active', 'muted'].includes(membership.status)) {
      throw new ForbiddenException('You are not a member of this group.');
    }
    return membership;
  }

  async requireModerator(groupId: string, userId: string): Promise<GroupRole> {
    return (await this.requireActiveRole(groupId, userId, MODERATE_ROLES)) as GroupRole;
  }

  async groupExists(groupId: string): Promise<Record<string, unknown>> {
    return this.requireGroup(groupId);
  }

  private async fullName(userId: string): Promise<string> {
    const [row] = await this.db.query<{ full_name: string }>(`SELECT full_name FROM app_user WHERE id = $1`, [userId]);
    return row?.full_name ?? '';
  }

  private async email(userId: string): Promise<string | null> {
    const [row] = await this.db.query<{ email: string | null }>(`SELECT email FROM app_user WHERE id = $1`, [userId]);
    return row?.email ?? null;
  }
}

function toMemberSummary(row: Record<string, unknown>, fullName: string): GroupMemberSummary {
  return {
    membershipId: row.id as string,
    userId: row.user_id as string,
    fullName,
    role: row.role as GroupRole,
    status: row.status as GroupMemberStatus,
    createdAt: row.created_at as string,
  };
}

// Deliberately small and explicit rather than an external word-list
// dependency -- enough to satisfy the AC's "prevent prohibited
// content" requirement for this milestone without over-promising a
// full moderation model.
const PROHIBITED_TERMS = ['fuck', 'shit', 'bitch', 'nigger', 'cunt'];

export function assertNoProhibitedContent(text: string): void {
  const lower = text.toLowerCase();
  for (const term of PROHIBITED_TERMS) {
    if (lower.includes(term)) {
      throw new ConflictException('This content includes language that is not allowed. Please revise it.');
    }
  }
}
