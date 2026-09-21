import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { CreateCustomerDto, CreateNoteDto, CreateTaskDto } from './dto/customer.dto';

export interface CustomerProfile {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  // Only present once this customer_profile has been linked to a
  // registered app_user (via signup or an accepted customer
  // invitation) -- messaging.controller callers use this to decide
  // whether "Message" is even offered for a given row (see
  // direct-message.service.ts, which needs an app_user id, not a
  // customer_profile id).
  linkedUserId: string | null;
}

export interface CustomerNote {
  id: string;
  body: string;
  authorUserId: string;
  createdAt: string;
}

export interface CustomerTask {
  id: string;
  title: string;
  customerId: string | null;
  assignedTo: string | null;
  dueAt: string | null;
  status: 'open' | 'done' | 'cancelled';
}

/**
 * Provider CRM: customer records and staff-only notes/tasks
 * (design section 7, "Rules that cut across entities" —
 * notes are never surfaced through any customer-facing route).
 */
@Injectable()
export class CrmService {
  constructor(private readonly db: DatabaseService) {}

  async createCustomer(tenantId: string, createdBy: string, dto: CreateCustomerDto): Promise<CustomerProfile> {
    return this.db.withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO customer_profile (tenant_id, full_name, phone, email, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, full_name, phone, email, linked_user_id`,
        [tenantId, dto.fullName, dto.phone ?? null, dto.email ?? null, createdBy],
      );
      return toCustomer(rows[0]);
    });
  }

  async listCustomers(tenantId: string): Promise<CustomerProfile[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT id, full_name, phone, email, linked_user_id FROM customer_profile WHERE tenant_id = $1 ORDER BY created_at DESC`,
        [tenantId],
      );
      return rows.map(toCustomer);
    });
  }

  async addNote(tenantId: string, customerId: string, authorUserId: string, dto: CreateNoteDto): Promise<CustomerNote> {
    return this.db.withTenant(tenantId, async (client) => {
      const { rows: customerRows } = await client.query(`SELECT id FROM customer_profile WHERE id = $1 AND tenant_id = $2`, [
        customerId,
        tenantId,
      ]);
      if (customerRows.length === 0) {
        throw new NotFoundException('Customer not found.');
      }

      const { rows } = await client.query(
        `INSERT INTO customer_note (tenant_id, customer_id, author_user_id, body)
         VALUES ($1, $2, $3, $4)
         RETURNING id, body, author_user_id, created_at`,
        [tenantId, customerId, authorUserId, dto.body],
      );
      return toNote(rows[0]);
    });
  }

  async listNotes(tenantId: string, customerId: string): Promise<CustomerNote[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT id, body, author_user_id, created_at FROM customer_note
         WHERE tenant_id = $1 AND customer_id = $2 ORDER BY created_at DESC`,
        [tenantId, customerId],
      );
      return rows.map(toNote);
    });
  }

  async createTask(tenantId: string, createdBy: string, dto: CreateTaskDto): Promise<CustomerTask> {
    return this.db.withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO customer_task (tenant_id, customer_id, assigned_to, title, due_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, title, customer_id, assigned_to, due_at, status`,
        [tenantId, dto.customerId ?? null, dto.assignedTo ?? null, dto.title, dto.dueAt ?? null, createdBy],
      );
      return toTask(rows[0]);
    });
  }

  async setTaskStatus(tenantId: string, taskId: string, status: 'open' | 'done' | 'cancelled'): Promise<CustomerTask> {
    return this.db.withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `UPDATE customer_task SET status = $3, updated_at = now()
         WHERE id = $1 AND tenant_id = $2
         RETURNING id, title, customer_id, assigned_to, due_at, status`,
        [taskId, tenantId, status],
      );
      if (rows.length === 0) {
        throw new NotFoundException('Task not found.');
      }
      return toTask(rows[0]);
    });
  }

  async listTasks(tenantId: string): Promise<CustomerTask[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT id, title, customer_id, assigned_to, due_at, status FROM customer_task
         WHERE tenant_id = $1 ORDER BY due_at ASC NULLS LAST, created_at DESC`,
        [tenantId],
      );
      return rows.map(toTask);
    });
  }
}

function toCustomer(row: Record<string, unknown>): CustomerProfile {
  return {
    id: row.id as string,
    fullName: row.full_name as string,
    phone: (row.phone as string) ?? null,
    email: (row.email as string) ?? null,
    linkedUserId: (row.linked_user_id as string) ?? null,
  };
}

function toNote(row: Record<string, unknown>): CustomerNote {
  return {
    id: row.id as string,
    body: row.body as string,
    authorUserId: row.author_user_id as string,
    createdAt: row.created_at as string,
  };
}

function toTask(row: Record<string, unknown>): CustomerTask {
  return {
    id: row.id as string,
    title: row.title as string,
    customerId: (row.customer_id as string) ?? null,
    assignedTo: (row.assigned_to as string) ?? null,
    dueAt: (row.due_at as string) ?? null,
    status: row.status as CustomerTask['status'],
  };
}
