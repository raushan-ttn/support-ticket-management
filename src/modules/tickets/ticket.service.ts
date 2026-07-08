import { PoolClient } from 'pg';

import config from '../../config';
import { query, withTransaction } from '../../config/postgres';
import { deleteCache, deleteCacheByPattern, getCache, setCache } from '../../config/redis';
import { sendNewTicketEmail } from '../../jobs/notifications';
import { getAttachmentsByTicket, uploadAttachments } from '../attachments/attachment.service';
import {
  AssignPayload,
  CreateTicketPayload,
  ListTicketsQuery,
  TicketListResult,
  TicketRow,
  TicketStatus,
  UpdateTicketPayload,
} from './ticket.schemas';

// DB-only ticket shape: no attachments field (not a DB column)
interface TicketDbRow {
  id: string;
  title: string;
  description: string;
  type: string | null;
  subType: string | null;
  screenshot: string | null;
  priority: string;
  status: string;
  assignedTo: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

const SORT_COLUMN_MAP: Record<string, string> = {
  createdAt: 't.created_at',
  updatedAt: 't.updated_at',
  priority: 't.priority',
};

const VALID_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['RESOLVED', 'CANCELLED'],
  RESOLVED: ['CLOSED'],
  CLOSED: [],
  CANCELLED: [],
};

function createHttpError(message: string, statusCode: number, code?: string): Error {
  const err = new Error(message) as Error & { statusCode: number; code?: string };
  err.statusCode = statusCode;
  if (code !== undefined) err.code = code;
  return err;
}

const TICKET_SELECT = `
  t.id,
  t.title,
  t.description,
  t.type,
  t.sub_type AS "subType",
  t.screenshot,
  t.priority,
  t.status,
  t.assigned_to AS "assignedTo",
  t.created_by AS "createdBy",
  t.created_at AS "createdAt",
  t.updated_at AS "updatedAt"
`;

// Bare-column list for RETURNING clauses (no table alias prefix needed)
const TICKET_RETURNING = `
  id,
  title,
  description,
  type,
  sub_type AS "subType",
  screenshot,
  priority,
  status,
  assigned_to AS "assignedTo",
  created_by AS "createdBy",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

async function selectTicketById(
  client: PoolClient | null,
  id: string,
): Promise<TicketDbRow | null> {
  const sql = `SELECT ${TICKET_SELECT} FROM tickets t WHERE t.id = $1`;
  const result = client
    ? await client.query<TicketDbRow>(sql, [id])
    : await query<TicketDbRow>(sql, [id]);
  return result.rows[0] ?? null;
}

async function withAttachments(dbRow: TicketDbRow): Promise<TicketRow> {
  const attachments = await getAttachmentsByTicket(dbRow.id);
  return {
    id: dbRow.id,
    title: dbRow.title,
    description: dbRow.description,
    type: dbRow.type,
    subType: dbRow.subType,
    screenshot: dbRow.screenshot,
    priority: dbRow.priority as TicketRow['priority'],
    status: dbRow.status as TicketRow['status'],
    assignedTo: dbRow.assignedTo,
    createdBy: dbRow.createdBy,
    createdAt: dbRow.createdAt,
    updatedAt: dbRow.updatedAt,
    attachments,
  };
}

async function invalidateTicketCache(id: string): Promise<void> {
  try {
    await deleteCache(`ticket:${id}`);
    await deleteCacheByPattern('tickets:all*');
  } catch (err) {
    console.error('[Cache] Invalidation error:', (err as Error).message);
  }
}

export async function createTicket(
  payload: CreateTicketPayload,
  creatorId: string,
  files?: Express.Multer.File[],
): Promise<TicketRow> {
  const adminResult = await query<{ id: string }>(
    "SELECT id FROM users WHERE role = 'ADMIN' ORDER BY created_at ASC LIMIT 1",
  );
  if (!adminResult.rows[0]) {
    throw createHttpError('No admin user found to assign ticket', 500);
  }
  const adminId = adminResult.rows[0].id;

  const insertResult = await query<{ id: string }>(
    `INSERT INTO tickets (title, description, type, sub_type, screenshot, priority, status, assigned_to, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'OPEN', $7, $8)
     RETURNING id`,
    [
      payload.title,
      payload.description,
      payload.type ?? null,
      payload.subType ?? null,
      payload.screenshot ?? null,
      payload.priority,
      adminId,
      creatorId,
    ],
  );
  const ticketId = insertResult.rows[0].id;

  const dbRow = await selectTicketById(null, ticketId);
  if (!dbRow) throw createHttpError('Failed to retrieve created ticket', 500);

  // Upload files if provided (fire-and-forget on error — partial upload acceptable)
  if (files && files.length > 0) {
    try {
      await uploadAttachments(ticketId, files, creatorId);
    } catch (uploadErr) {
      console.error('[Attachments] Upload error on createTicket:', (uploadErr as Error).message);
    }
  }

  try {
    await invalidateTicketCache(ticketId);
  } catch (err) {
    console.error('[Cache] Post-create invalidation error:', (err as Error).message);
  }

  try {
    await sendNewTicketEmail({
      ticketId,
      ticketTitle: dbRow.title,
      creatorId,
      adminId,
    });
  } catch (emailErr) {
    console.error('[Notify] Failed to send new-ticket email:', (emailErr as Error).message);
  }

  return withAttachments(dbRow);
}

export async function listTickets(
  callerId: string,
  callerRole: string,
  filters: ListTicketsQuery,
): Promise<TicketListResult> {
  const { status, priority, assignedTo, type, search, page, limit, sortBy, order } = filters;

  const params: unknown[] = [];
  const conditions: string[] = [];

  if (callerRole === 'AGENT') {
    params.push(callerId);
    conditions.push(`(t.assigned_to = $${params.length} OR t.created_by = $${params.length})`);
  }

  if (status) {
    params.push(status);
    conditions.push(`t.status = $${params.length}`);
  }

  if (priority) {
    params.push(priority);
    conditions.push(`t.priority = $${params.length}`);
  }

  if (assignedTo) {
    params.push(assignedTo);
    conditions.push(`t.assigned_to = $${params.length}`);
  }

  if (type) {
    params.push(type);
    conditions.push(`t.type = $${params.length}`);
  }

  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(t.title ILIKE $${params.length} OR t.description ILIKE $${params.length})`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sortColumn = SORT_COLUMN_MAP[sortBy] ?? 't.created_at';
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

  const countResult = await query<{ total: string }>(
    `SELECT COUNT(*) AS total FROM tickets t ${whereClause}`,
    params,
  );
  const total = parseInt(countResult.rows[0]?.total ?? '0', 10);

  const offset = (page - 1) * limit;
  params.push(limit, offset);

  const ticketsResult = await query<TicketDbRow>(
    `SELECT ${TICKET_SELECT}
     FROM tickets t
     ${whereClause}
     ORDER BY ${sortColumn} ${sortOrder}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  // List endpoint returns tickets without inline attachments (only GET /:id embeds them)
  const tickets: TicketRow[] = ticketsResult.rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    type: row.type,
    subType: row.subType,
    screenshot: row.screenshot,
    priority: row.priority as TicketRow['priority'],
    status: row.status as TicketRow['status'],
    assignedTo: row.assignedTo,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    attachments: [],
  }));

  return { tickets, total, page, limit };
}

export async function getTicketById(
  id: string,
  callerId: string,
  callerRole: string,
): Promise<TicketRow> {
  let dbRow: TicketDbRow | null = null;

  try {
    const cached = await getCache<TicketDbRow>(`ticket:${id}`);
    if (cached) {
      if (
        callerRole === 'AGENT' &&
        cached.assignedTo !== callerId &&
        cached.createdBy !== callerId
      ) {
        throw createHttpError('Forbidden', 403, 'FORBIDDEN');
      }
      dbRow = cached;
    }
  } catch (err) {
    const e = err as Error & { statusCode?: number };
    if (e.statusCode) throw err;
    console.error('[Cache] Read error:', e.message);
  }

  if (!dbRow) {
    const found = await selectTicketById(null, id);
    if (!found) throw createHttpError('Ticket not found', 404, 'NOT_FOUND');

    if (callerRole === 'AGENT' && found.assignedTo !== callerId && found.createdBy !== callerId) {
      throw createHttpError('Forbidden', 403, 'FORBIDDEN');
    }

    try {
      await setCache(`ticket:${id}`, found, config.redis.ttlSeconds);
    } catch (err) {
      console.error('[Cache] Write error:', (err as Error).message);
    }

    dbRow = found;
  }

  return withAttachments(dbRow);
}

export async function updateTicket(
  id: string,
  payload: UpdateTicketPayload,
  callerId: string,
  callerRole: string,
  files?: Express.Multer.File[],
): Promise<TicketRow> {
  const dbRow = await withTransaction(async (client: PoolClient) => {
    const lockResult = await client.query<TicketDbRow>(
      `SELECT ${TICKET_SELECT} FROM tickets t WHERE t.id = $1 FOR UPDATE`,
      [id],
    );
    const existing = lockResult.rows[0];
    if (!existing) throw createHttpError('Ticket not found', 404, 'NOT_FOUND');

    if (
      callerRole === 'AGENT' &&
      existing.assignedTo !== callerId &&
      existing.createdBy !== callerId
    ) {
      throw createHttpError('Forbidden', 403, 'FORBIDDEN');
    }

    const setClauses: string[] = [];
    const params: unknown[] = [];

    if (payload.title !== undefined) {
      params.push(payload.title);
      setClauses.push(`title = $${params.length}`);
    }
    if (payload.description !== undefined) {
      params.push(payload.description);
      setClauses.push(`description = $${params.length}`);
    }
    if (payload.priority !== undefined) {
      params.push(payload.priority);
      setClauses.push(`priority = $${params.length}`);
    }
    if (payload.type !== undefined) {
      params.push(payload.type);
      setClauses.push(`type = $${params.length}`);
    }
    if (payload.subType !== undefined) {
      params.push(payload.subType);
      setClauses.push(`sub_type = $${params.length}`);
    }
    if (payload.screenshot !== undefined) {
      params.push(payload.screenshot);
      setClauses.push(`screenshot = $${params.length}`);
    }

    if (setClauses.length === 0)
      throw createHttpError('At least one field required', 400, 'VALIDATION_ERROR');

    params.push(id);
    const updateResult = await client.query<TicketDbRow>(
      `UPDATE tickets SET ${setClauses.join(', ')} WHERE id = $${params.length}
       RETURNING ${TICKET_RETURNING}`,
      params,
    );

    if (!updateResult.rowCount || updateResult.rowCount === 0)
      throw createHttpError('Ticket not found', 404, 'NOT_FOUND');

    await invalidateTicketCache(id);

    return updateResult.rows[0];
  });

  // Upload files if provided (after transaction commits)
  if (files && files.length > 0) {
    try {
      await uploadAttachments(id, files, callerId);
    } catch (uploadErr) {
      console.error('[Attachments] Upload error on updateTicket:', (uploadErr as Error).message);
    }
  }

  return withAttachments(dbRow);
}

export async function transitionStatus(
  id: string,
  newStatus: TicketStatus,
  callerId: string,
  callerRole: string,
): Promise<TicketRow> {
  const dbRow = await withTransaction(async (client: PoolClient) => {
    const lockResult = await client.query<{ status: TicketStatus; assigned_to: string }>(
      'SELECT status, assigned_to FROM tickets WHERE id = $1 FOR UPDATE',
      [id],
    );
    const row = lockResult.rows[0];
    if (!row) throw createHttpError('Ticket not found', 404, 'NOT_FOUND');

    // Authorization before state-machine: unauthorized agents must not learn ticket state
    if (callerRole === 'AGENT' && row.assigned_to !== callerId) {
      throw createHttpError('Forbidden', 403, 'FORBIDDEN');
    }

    const currentStatus = row.status;
    const allowed = VALID_TRANSITIONS[currentStatus];

    if (!allowed.includes(newStatus)) {
      throw createHttpError(
        `Invalid status transition from ${currentStatus} to ${newStatus}`,
        409,
        'INVALID_STATUS_TRANSITION',
      );
    }

    await client.query('UPDATE tickets SET status = $1 WHERE id = $2', [newStatus, id]);

    const ticketResult = await client.query<TicketDbRow>(
      `SELECT ${TICKET_SELECT} FROM tickets t WHERE t.id = $1`,
      [id],
    );
    const updated = ticketResult.rows[0];
    if (!updated) throw createHttpError('Failed to retrieve ticket after status transition', 500);

    await invalidateTicketCache(id);

    return updated;
  });

  return withAttachments(dbRow);
}

export async function assignTicket(ticketId: string, payload: AssignPayload): Promise<TicketRow> {
  const { assignedTo } = payload;

  const userResult = await query<{ id: string }>('SELECT id FROM users WHERE id = $1', [
    assignedTo,
  ]);
  if (!userResult.rows[0]) {
    throw createHttpError('User not found', 400, 'USER_NOT_FOUND');
  }

  const ticketResult = await query<{ id: string }>('SELECT id FROM tickets WHERE id = $1', [
    ticketId,
  ]);
  if (!ticketResult.rows[0]) {
    throw createHttpError('Ticket not found', 404, 'NOT_FOUND');
  }

  await query('UPDATE tickets SET assigned_to = $1 WHERE id = $2', [assignedTo, ticketId]);

  const dbRow = await selectTicketById(null, ticketId);
  if (!dbRow) throw createHttpError('Failed to retrieve ticket after assign', 500);

  await invalidateTicketCache(ticketId);

  return withAttachments(dbRow);
}
