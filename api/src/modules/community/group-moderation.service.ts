import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { GroupService } from './group.service';
import { GroupPostService } from './group-post.service';
import { CreateReportDto, DecideReportDto } from './dto/group-moderation.dto';

export interface ModerationReportSummary {
  id: string;
  groupId: string;
  targetType: 'post' | 'comment';
  targetId: string;
  reportedBy: string;
  reason: string;
  status: 'open' | 'reviewed';
  decision: 'retained' | 'hidden' | 'removed' | null;
  decisionReason: string | null;
  createdAt: string;
}

function toReportSummary(row: Record<string, unknown>): ModerationReportSummary {
  return {
    id: row.id as string,
    groupId: row.group_id as string,
    targetType: row.target_type as ModerationReportSummary['targetType'],
    targetId: row.target_id as string,
    reportedBy: row.reported_by as string,
    reason: row.reason as string,
    status: row.status as ModerationReportSummary['status'],
    decision: (row.decision as ModerationReportSummary['decision']) ?? null,
    decisionReason: (row.decision_reason as string) ?? null,
    createdAt: row.created_at as string,
  };
}

/**
 * AC: "users can report content ... routed to authorized moderators
 * ... moderators can retain/hide/remove ... and record the decision
 * and reason." Reports and the resulting content-status change are
 * two different concerns living in two different tables/services
 * (group_moderation_report here, group_post/.status via
 * GroupPostService) but always change together inside one
 * transaction-backed decide() call.
 */
@Injectable()
export class GroupModerationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly groups: GroupService,
    private readonly posts: GroupPostService,
  ) {}

  async report(groupId: string, userId: string, dto: CreateReportDto): Promise<ModerationReportSummary> {
    await this.groups.requireActiveMembership(groupId, userId);
    const exists = await this.posts.contentExists(dto.targetType, dto.targetId, groupId);
    if (!exists) {
      throw new NotFoundException('The content you are reporting no longer exists.');
    }

    return this.db.withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO group_moderation_report (group_id, target_type, target_id, reported_by, reason)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [groupId, dto.targetType, dto.targetId, userId, dto.reason],
      );
      await this.audit.record(
        { actorUserId: userId, action: 'group.report.create', targetType: 'group_moderation_report', targetId: rows[0].id, metadata: { groupId, contentType: dto.targetType, contentId: dto.targetId } },
        client,
      );
      return toReportSummary(rows[0]);
    });
  }

  async listOpen(groupId: string, userId: string): Promise<ModerationReportSummary[]> {
    await this.groups.requireModerator(groupId, userId);
    const rows = await this.db.query(`SELECT * FROM group_moderation_report WHERE group_id = $1 AND status = 'open' ORDER BY created_at ASC`, [
      groupId,
    ]);
    return rows.map(toReportSummary);
  }

  async decide(groupId: string, reportId: string, userId: string, dto: DecideReportDto): Promise<ModerationReportSummary> {
    await this.groups.requireModerator(groupId, userId);
    const [report] = await this.db.query<Record<string, unknown>>(`SELECT * FROM group_moderation_report WHERE id = $1 AND group_id = $2`, [
      reportId,
      groupId,
    ]);
    if (!report) {
      throw new NotFoundException('Report not found.');
    }
    if (report.status !== 'open') {
      throw new ConflictException('This report has already been reviewed.');
    }

    const contentStatus = dto.decision === 'retained' ? 'visible' : dto.decision === 'hidden' ? 'hidden' : 'removed';

    return this.db.withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE group_moderation_report SET status = 'reviewed', decision = $1, decision_reason = $2, decided_by = $3, decided_at = now() WHERE id = $4 RETURNING *`,
        [dto.decision, dto.reason, userId, reportId],
      );
      await this.audit.record(
        {
          actorUserId: userId,
          action: 'group.report.decide',
          targetType: 'group_moderation_report',
          targetId: reportId,
          metadata: { groupId, decision: dto.decision, reason: dto.reason },
        },
        client,
      );
      await this.posts.setContentStatus(report.target_type as 'post' | 'comment', report.target_id as string, contentStatus);
      return toReportSummary(rows[0]);
    });
  }
}
