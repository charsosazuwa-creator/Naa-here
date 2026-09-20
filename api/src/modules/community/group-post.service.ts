import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdirSync, unlinkSync } from 'fs';
import { writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { GroupService, assertNoProhibitedContent } from './group.service';
import { CreateCommentDto, CreatePostDto, IP_SENSITIVE_TOPICS, UpdatePostDto } from './dto/group-post.dto';

export interface UploadedGroupFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface GroupPostSummary {
  id: string;
  groupId: string;
  authorUserId: string;
  authorName: string;
  topic: string;
  body: string;
  ipAckRequired: boolean;
  ipAckAt: string | null;
  shareCount: number;
  status: string;
  reactionCount: number;
  myReaction: boolean;
  commentCount: number;
  attachments: { id: string; kind: string; url: string; contentType: string | null; byteSize: number | null }[];
  createdAt: string;
  updatedAt: string;
}

export interface GroupCommentSummary {
  id: string;
  postId: string;
  authorUserId: string;
  authorName: string;
  parentCommentId: string | null;
  body: string;
  status: string;
  createdAt: string;
}

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'application/pdf']);
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_POST = 6;
const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'application/pdf': 'pdf',
};
const KIND_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'video/mp4': 'video',
  'application/pdf': 'document',
};

/**
 * Posts, comments/replies, reactions, shares and file attachments
 * within a group. Membership/role checks are delegated to
 * GroupService (requireActiveMembership/requireModerator) so both
 * services agree on exactly what "an active member" or "a moderator"
 * means, rather than re-deriving it here.
 */
@Injectable()
export class GroupPostService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly groups: GroupService,
  ) {}

  private uploadsDir(): string {
    const dir = process.env.UPLOADS_DIR;
    if (!dir) {
      throw new Error('UPLOADS_DIR is not set — main.ts should have set it during bootstrap.');
    }
    return dir;
  }

  async createPost(groupId: string, userId: string, dto: CreatePostDto): Promise<GroupPostSummary> {
    await this.groups.requireActiveMembership(groupId, userId);
    assertNoProhibitedContent(dto.body);

    const ipSensitive = IP_SENSITIVE_TOPICS.has(dto.topic);
    if (ipSensitive && !dto.ipAck) {
      throw new BadRequestException(
        'Posts about products or inventions require acknowledging the intellectual-property disclosure reminder before posting.',
      );
    }

    return this.db.withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO group_post (group_id, author_user_id, topic, body, ip_ack_required, ip_ack_at)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING *`,
        [groupId, userId, dto.topic, dto.body, ipSensitive, ipSensitive ? new Date().toISOString() : null],
      );
      await this.audit.record(
        { actorUserId: userId, action: 'group.post.create', targetType: 'group_post', targetId: rows[0].id, metadata: { groupId, topic: dto.topic } },
        client,
      );
      return this.toPostSummary(rows[0], userId, await this.fullName(userId), []);
    });
  }

  async listPosts(groupId: string, userId: string): Promise<GroupPostSummary[]> {
    await this.groups.get(groupId, userId); // enforces visibility (hidden groups need membership)
    const membership = await this.tryMembership(groupId, userId);
    if (!membership) {
      // Non-members may only browse a public group's posts read-only style is out of MVP scope; require membership to see posts at all.
      throw new ForbiddenException('Join this group to see its posts.');
    }

    const rows = await this.db.query(
      `SELECT p.*, u.full_name AS author_name,
              (SELECT count(*) FROM group_post_reaction r WHERE r.post_id = p.id) AS reaction_count,
              EXISTS(SELECT 1 FROM group_post_reaction r WHERE r.post_id = p.id AND r.user_id = $2) AS my_reaction,
              (SELECT count(*) FROM group_post_comment c WHERE c.post_id = p.id AND c.status = 'visible') AS comment_count
       FROM group_post p
       JOIN app_user u ON u.id = p.author_user_id
       WHERE p.group_id = $1 AND p.status != 'removed'
       ORDER BY p.created_at DESC`,
      [groupId, userId],
    );

    const posts = await Promise.all(
      rows.map(async (row: Record<string, unknown>) => {
        const attachments = await this.listAttachments(row.id as string);
        return {
          id: row.id as string,
          groupId: row.group_id as string,
          authorUserId: row.author_user_id as string,
          authorName: row.author_name as string,
          topic: row.topic as string,
          body: row.body as string,
          ipAckRequired: row.ip_ack_required as boolean,
          ipAckAt: (row.ip_ack_at as string) ?? null,
          shareCount: row.share_count as number,
          status: row.status as string,
          reactionCount: Number(row.reaction_count),
          myReaction: Boolean(row.my_reaction),
          commentCount: Number(row.comment_count),
          attachments,
          createdAt: row.created_at as string,
          updatedAt: row.updated_at as string,
        } as GroupPostSummary;
      }),
    );
    return posts;
  }

  async updatePost(groupId: string, postId: string, userId: string, dto: UpdatePostDto): Promise<GroupPostSummary> {
    const post = await this.requirePost(groupId, postId);
    if (post.author_user_id !== userId) {
      throw new ForbiddenException('You can only edit your own posts.');
    }
    assertNoProhibitedContent(dto.body);

    return this.db.withTransaction(async (client) => {
      const { rows } = await client.query(`UPDATE group_post SET body = $1, updated_at = now() WHERE id = $2 RETURNING *`, [dto.body, postId]);
      await this.audit.record({ actorUserId: userId, action: 'group.post.update', targetType: 'group_post', targetId: postId, metadata: { groupId } }, client);
      return this.toPostSummary(rows[0], userId, await this.fullName(userId), await this.listAttachments(postId));
    });
  }

  async deletePost(groupId: string, postId: string, userId: string): Promise<void> {
    const post = await this.requirePost(groupId, postId);
    if (post.author_user_id !== userId) {
      throw new ForbiddenException('You can only delete your own posts.');
    }
    await this.db.withTransaction(async (client) => {
      await client.query(`UPDATE group_post SET status = 'removed', updated_at = now() WHERE id = $1`, [postId]);
      await this.audit.record({ actorUserId: userId, action: 'group.post.delete', targetType: 'group_post', targetId: postId, metadata: { groupId } }, client);
    });
  }

  async react(groupId: string, postId: string, userId: string): Promise<void> {
    await this.groups.requireActiveMembership(groupId, userId);
    await this.requirePost(groupId, postId);
    await this.db.query(
      `INSERT INTO group_post_reaction (post_id, user_id) VALUES ($1,$2) ON CONFLICT (post_id, user_id) DO NOTHING`,
      [postId, userId],
    );
  }

  async unreact(groupId: string, postId: string, userId: string): Promise<void> {
    await this.requirePost(groupId, postId);
    await this.db.query(`DELETE FROM group_post_reaction WHERE post_id = $1 AND user_id = $2`, [postId, userId]);
  }

  async share(groupId: string, postId: string, userId: string): Promise<{ shareCount: number }> {
    await this.groups.requireActiveMembership(groupId, userId);
    await this.requirePost(groupId, postId);
    const [row] = await this.db.query<{ share_count: number }>(
      `UPDATE group_post SET share_count = share_count + 1, updated_at = now() WHERE id = $1 RETURNING share_count`,
      [postId],
    );
    await this.db.withTransaction((client) => this.audit.record({ actorUserId: userId, action: 'group.post.share', targetType: 'group_post', targetId: postId, metadata: { groupId } }, client));
    return { shareCount: row.share_count };
  }

  async addComment(groupId: string, postId: string, userId: string, dto: CreateCommentDto): Promise<GroupCommentSummary> {
    await this.groups.requireActiveMembership(groupId, userId);
    await this.requirePost(groupId, postId);
    assertNoProhibitedContent(dto.body);

    if (dto.parentCommentId) {
      const [parent] = await this.db.query<{ id: string }>(`SELECT id FROM group_post_comment WHERE id = $1 AND post_id = $2`, [
        dto.parentCommentId,
        postId,
      ]);
      if (!parent) {
        throw new NotFoundException('The comment you are replying to no longer exists.');
      }
    }

    return this.db.withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO group_post_comment (post_id, author_user_id, parent_comment_id, body) VALUES ($1,$2,$3,$4) RETURNING *`,
        [postId, userId, dto.parentCommentId ?? null, dto.body],
      );
      await this.audit.record({ actorUserId: userId, action: 'group.comment.create', targetType: 'group_post_comment', targetId: rows[0].id, metadata: { groupId, postId } }, client);
      return this.toCommentSummary(rows[0], await this.fullName(userId));
    });
  }

  async listComments(groupId: string, postId: string, userId: string): Promise<GroupCommentSummary[]> {
    await this.groups.requireActiveMembership(groupId, userId);
    await this.requirePost(groupId, postId);
    const rows = await this.db.query(
      `SELECT c.*, u.full_name AS author_name FROM group_post_comment c
       JOIN app_user u ON u.id = c.author_user_id
       WHERE c.post_id = $1 AND c.status != 'removed'
       ORDER BY c.created_at ASC`,
      [postId],
    );
    return rows.map((r: Record<string, unknown>) => this.toCommentSummary(r, r.author_name as string));
  }

  async deleteComment(groupId: string, postId: string, commentId: string, userId: string): Promise<void> {
    const [comment] = await this.db.query<{ id: string; author_user_id: string }>(
      `SELECT id, author_user_id FROM group_post_comment WHERE id = $1 AND post_id = $2`,
      [commentId, postId],
    );
    if (!comment) {
      throw new NotFoundException('Comment not found.');
    }
    if (comment.author_user_id !== userId) {
      throw new ForbiddenException('You can only delete your own comments.');
    }
    await this.db.withTransaction(async (client) => {
      await client.query(`UPDATE group_post_comment SET status = 'removed', updated_at = now() WHERE id = $1`, [commentId]);
      await this.audit.record({ actorUserId: userId, action: 'group.comment.delete', targetType: 'group_post_comment', targetId: commentId, metadata: { groupId, postId } }, client);
    });
  }

  // -------------------------------------------------------------
  // Attachments -- same real-file-on-disk pattern as
  // dispute-attachment.service.ts (type/size validated, served at
  // /uploads/<storage_key> per main.ts's static mount).
  // -------------------------------------------------------------

  async addAttachment(groupId: string, postId: string, userId: string, file: UploadedGroupFile | undefined): Promise<void> {
    const post = await this.requirePost(groupId, postId);
    if (post.author_user_id !== userId) {
      throw new ForbiddenException('You can only add attachments to your own posts.');
    }
    if (!file) {
      throw new BadRequestException('No file was provided (expected multipart field "file").');
    }
    if (!ALLOWED_TYPES.has(file.mimetype)) {
      throw new UnprocessableEntityException('Only JPEG, PNG, WebP images, MP4 video, or PDF documents are accepted.');
    }
    if (file.size > MAX_BYTES) {
      throw new UnprocessableEntityException('Files must be 25MB or smaller.');
    }

    const [{ count }] = await this.db.query<{ count: number }>(`SELECT count(*)::int AS count FROM group_post_attachment WHERE post_id = $1`, [
      postId,
    ]);
    if (count >= MAX_ATTACHMENTS_PER_POST) {
      throw new UnprocessableEntityException(`A post can have at most ${MAX_ATTACHMENTS_PER_POST} attachments.`);
    }

    const extension = EXTENSION_BY_TYPE[file.mimetype];
    const storageKey = `groups/${groupId}/posts/${postId}/${randomUUID()}.${extension}`;
    const fullPath = join(this.uploadsDir(), storageKey);
    mkdirSync(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, file.buffer);

    await this.db.withTransaction(async (client) => {
      await client.query(
        `INSERT INTO group_post_attachment (post_id, kind, storage_key, content_type, byte_size, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6)`,
        [postId, KIND_BY_TYPE[file.mimetype], storageKey, file.mimetype, file.size, userId],
      );
      await this.audit.record({ actorUserId: userId, action: 'group.post.attachment.add', targetType: 'group_post', targetId: postId, metadata: { groupId } }, client);
    });
  }

  async removeAttachment(groupId: string, postId: string, attachmentId: string, userId: string): Promise<void> {
    const post = await this.requirePost(groupId, postId);
    if (post.author_user_id !== userId) {
      throw new ForbiddenException('You can only remove attachments from your own posts.');
    }
    const [attachment] = await this.db.query<{ id: string; storage_key: string }>(
      `SELECT id, storage_key FROM group_post_attachment WHERE id = $1 AND post_id = $2`,
      [attachmentId, postId],
    );
    if (!attachment) return;

    await this.db.query(`DELETE FROM group_post_attachment WHERE id = $1`, [attachmentId]);
    try {
      unlinkSync(join(this.uploadsDir(), attachment.storage_key));
    } catch {
      // best-effort disk cleanup; the DB row is the source of truth.
    }
  }

  // -------------------------------------------------------------
  // Content-moderation hooks (used by GroupModerationService).
  // -------------------------------------------------------------

  async setContentStatus(targetType: 'post' | 'comment', targetId: string, status: 'visible' | 'hidden' | 'removed'): Promise<void> {
    const table = targetType === 'post' ? 'group_post' : 'group_post_comment';
    await this.db.query(`UPDATE ${table} SET status = $1, updated_at = now() WHERE id = $2`, [status, targetId]);
  }

  async contentExists(targetType: 'post' | 'comment', targetId: string, groupId: string): Promise<boolean> {
    if (targetType === 'post') {
      const [row] = await this.db.query<{ id: string }>(`SELECT id FROM group_post WHERE id = $1 AND group_id = $2`, [targetId, groupId]);
      return Boolean(row);
    }
    const [row] = await this.db.query<{ id: string }>(
      `SELECT c.id FROM group_post_comment c JOIN group_post p ON p.id = c.post_id WHERE c.id = $1 AND p.group_id = $2`,
      [targetId, groupId],
    );
    return Boolean(row);
  }

  // -------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------

  private async requirePost(groupId: string, postId: string): Promise<Record<string, unknown>> {
    const [post] = await this.db.query(`SELECT * FROM group_post WHERE id = $1 AND group_id = $2`, [postId, groupId]);
    if (!post || post.status === 'removed') {
      throw new NotFoundException('Post not found.');
    }
    return post;
  }

  private async tryMembership(groupId: string, userId: string): Promise<boolean> {
    try {
      await this.groups.requireActiveMembership(groupId, userId);
      return true;
    } catch {
      return false;
    }
  }

  private async listAttachments(postId: string): ReturnType<GroupPostService['listAttachmentsImpl']> {
    return this.listAttachmentsImpl(postId);
  }

  private async listAttachmentsImpl(postId: string) {
    const rows = await this.db.query<{ id: string; kind: string; storage_key: string; content_type: string | null; byte_size: number | null }>(
      `SELECT id, kind, storage_key, content_type, byte_size FROM group_post_attachment WHERE post_id = $1 ORDER BY created_at ASC`,
      [postId],
    );
    return rows.map((r) => ({ id: r.id, kind: r.kind, url: `/uploads/${r.storage_key}`, contentType: r.content_type, byteSize: r.byte_size }));
  }

  private async fullName(userId: string): Promise<string> {
    const [row] = await this.db.query<{ full_name: string }>(`SELECT full_name FROM app_user WHERE id = $1`, [userId]);
    return row?.full_name ?? '';
  }

  private toPostSummary(
    row: Record<string, unknown>,
    _userId: string,
    authorName: string,
    attachments: { id: string; kind: string; url: string; contentType: string | null; byteSize: number | null }[],
  ): GroupPostSummary {
    return {
      id: row.id as string,
      groupId: row.group_id as string,
      authorUserId: row.author_user_id as string,
      authorName,
      topic: row.topic as string,
      body: row.body as string,
      ipAckRequired: row.ip_ack_required as boolean,
      ipAckAt: (row.ip_ack_at as string) ?? null,
      shareCount: (row.share_count as number) ?? 0,
      status: row.status as string,
      reactionCount: 0,
      myReaction: false,
      commentCount: 0,
      attachments,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  private toCommentSummary(row: Record<string, unknown>, authorName: string): GroupCommentSummary {
    return {
      id: row.id as string,
      postId: row.post_id as string,
      authorUserId: row.author_user_id as string,
      authorName,
      parentCommentId: (row.parent_comment_id as string) ?? null,
      body: row.body as string,
      status: row.status as string,
      createdAt: row.created_at as string,
    };
  }
}
