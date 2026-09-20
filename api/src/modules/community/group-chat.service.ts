import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { GroupService, assertNoProhibitedContent } from './group.service';

export interface GroupChatMessage {
  id: string;
  groupId: string;
  authorUserId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

const HISTORY_PAGE_SIZE = 100;

function toMessage(row: Record<string, unknown>): GroupChatMessage {
  return {
    id: row.id as string,
    groupId: row.group_id as string,
    authorUserId: row.author_user_id as string,
    authorName: row.author_name as string,
    body: row.body as string,
    createdAt: row.created_at as string,
  };
}

/**
 * Group chat: a running conversation thread for a group's active
 * members, separate from the topic/attachment/reaction-carrying feed
 * posts in group-post.service.ts. Polled by the client (see
 * web/provider/app.js's group-chat panel) rather than pushed -- this
 * project has no websocket/SSE layer anywhere else to hang a
 * real-time channel off of, and a short poll interval is the
 * pragmatic fit here rather than introducing one just for this.
 */
@Injectable()
export class GroupChatService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly groups: GroupService,
  ) {}

  async send(groupId: string, userId: string, body: string): Promise<GroupChatMessage> {
    // requireActiveMembership already rejects a 'muted' member — the
    // same restriction that keeps a muted member from posting to the
    // feed applies to chat too.
    await this.groups.requireActiveMembership(groupId, userId);
    assertNoProhibitedContent(body);

    const [row] = await this.db.query<Record<string, unknown>>(
      `INSERT INTO group_message (group_id, author_user_id, body) VALUES ($1,$2,$3)
       RETURNING id, group_id, author_user_id, body, created_at`,
      [groupId, userId, body],
    );
    const [author] = await this.db.query<{ full_name: string }>(`SELECT full_name FROM app_user WHERE id = $1`, [userId]);
    return toMessage({ ...row, author_name: author?.full_name ?? '' });
  }

  /**
   * `after`: undefined/omitted returns the last HISTORY_PAGE_SIZE
   * messages (initial load, oldest-first for display); given a
   * message id, returns only messages strictly newer than it
   * (a poll tick) -- cheap even on a long-running group chat, since
   * it never rescans history the client already has.
   */
  async list(groupId: string, userId: string, after?: string): Promise<GroupChatMessage[]> {
    await this.groups.requireActiveMembershipReadOnly(groupId, userId);

    if (after) {
      const [cursor] = await this.db.query<{ created_at: string }>(`SELECT created_at FROM group_message WHERE id = $1 AND group_id = $2`, [
        after,
        groupId,
      ]);
      if (!cursor) {
        throw new NotFoundException('Unknown message cursor.');
      }
      const rows = await this.db.query<Record<string, unknown>>(
        `SELECT m.id, m.group_id, m.author_user_id, m.body, m.created_at, u.full_name AS author_name
         FROM group_message m JOIN app_user u ON u.id = m.author_user_id
         WHERE m.group_id = $1 AND m.status = 'visible' AND m.created_at > $2
         ORDER BY m.created_at ASC`,
        [groupId, cursor.created_at],
      );
      return rows.map(toMessage);
    }

    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT m.id, m.group_id, m.author_user_id, m.body, m.created_at, u.full_name AS author_name
       FROM group_message m JOIN app_user u ON u.id = m.author_user_id
       WHERE m.group_id = $1 AND m.status = 'visible'
       ORDER BY m.created_at DESC
       LIMIT ${HISTORY_PAGE_SIZE}`,
      [groupId],
    );
    return rows.map(toMessage).reverse();
  }

  async delete(groupId: string, messageId: string, userId: string): Promise<void> {
    const [message] = await this.db.query<{ id: string; author_user_id: string }>(
      `SELECT id, author_user_id FROM group_message WHERE id = $1 AND group_id = $2 AND status = 'visible'`,
      [messageId, groupId],
    );
    if (!message) {
      throw new NotFoundException('Message not found.');
    }

    const isAuthor = message.author_user_id === userId;
    if (!isAuthor) {
      // Not your own message -- only a moderator/administrator/owner
      // can remove someone else's, same authority as content
      // moderation elsewhere in this module.
      await this.groups.requireModerator(groupId, userId);
    }

    await this.db.withTransaction(async (client) => {
      await client.query(`UPDATE group_message SET status = 'removed' WHERE id = $1`, [messageId]);
      await this.audit.record(
        {
          actorUserId: userId,
          action: isAuthor ? 'group.chat.delete' : 'group.chat.moderate_delete',
          targetType: 'group_message',
          targetId: messageId,
          metadata: { groupId },
        },
        client,
      );
    });
  }
}
