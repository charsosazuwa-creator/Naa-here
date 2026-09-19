import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { MediaService } from '../files/media.service';

export interface VerificationSubmission {
  id: string;
  documentType: string;
  attachmentId: string;
  status: 'pending' | 'approved' | 'rejected';
  decisionNote: string | null;
}

/**
 * Phase-2 verification: a provider submits documents, an administrator
 * decides. The fuller review console (queue, filters, escalation) is
 * phase 5 ("Administration and support"); this module only provides
 * enough surface for the phase-2 "Done when" criterion — a provider
 * can be verified at all — to be met without waiting on phase 5.
 */
@Injectable()
export class VerificationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly media: MediaService,
  ) {}

  async submit(tenantId: string, submittedBy: string, documentType: string, attachmentId: string): Promise<VerificationSubmission> {
    // Confirms the attachment exists, belongs to this tenant, and
    // passed the (mock) scan before it can back a verification claim.
    const attachment = await this.media.findById(tenantId, attachmentId);
    if (attachment.scanStatus !== 'clean') {
      throw new BadRequestException('This file has not passed the content scan and cannot be submitted.');
    }

    return this.db.withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO verification_submission (tenant_id, submitted_by, document_type, attachment_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, document_type, attachment_id, status, decision_note`,
        [tenantId, submittedBy, documentType, attachmentId],
      );

      await client.query(`UPDATE tenant SET verification_status = 'pending', updated_at = now() WHERE id = $1`, [
        tenantId,
      ]);

      await this.audit.record({
        tenantId,
        actorUserId: submittedBy,
        action: 'verification.submit',
        targetType: 'verification_submission',
        targetId: rows[0].id,
      }, client);

      return toSubmission(rows[0]);
    });
  }

  async decide(
    tenantId: string,
    submissionId: string,
    decidedBy: string,
    decision: 'approved' | 'rejected',
    note: string | undefined,
  ): Promise<VerificationSubmission> {
    return this.db.withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `UPDATE verification_submission
         SET status = $3, decided_by = $2, decided_at = now(), decision_note = $4
         WHERE id = $1 AND tenant_id = $5 AND status = 'pending'
         RETURNING id, document_type, attachment_id, status, decision_note`,
        [submissionId, decidedBy, decision, note ?? null, tenantId],
      );

      if (rows.length === 0) {
        throw new NotFoundException('No pending verification submission found with that id.');
      }

      await client.query(`UPDATE tenant SET verification_status = $2, updated_at = now() WHERE id = $1`, [
        tenantId,
        decision === 'approved' ? 'verified' : 'rejected',
      ]);

      await this.audit.record({
        tenantId,
        actorUserId: decidedBy,
        action: 'verification.decide',
        targetType: 'verification_submission',
        targetId: submissionId,
        metadata: { decision, note },
      }, client);

      return toSubmission(rows[0]);
    });
  }

  async listForTenant(tenantId: string): Promise<VerificationSubmission[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT id, document_type, attachment_id, status, decision_note
         FROM verification_submission WHERE tenant_id = $1 ORDER BY created_at DESC`,
        [tenantId],
      );
      return rows.map(toSubmission);
    });
  }
}

function toSubmission(row: Record<string, unknown>): VerificationSubmission {
  return {
    id: row.id as string,
    documentType: row.document_type as string,
    attachmentId: row.attachment_id as string,
    status: row.status as VerificationSubmission['status'],
    decisionNote: (row.decision_note as string) ?? null,
  };
}
