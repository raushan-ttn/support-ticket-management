import config from '../../config';
import { query } from '../../config/postgres';
import { deleteCache, getCache, setCache } from '../../config/redis';
import { sendCommentNotificationEmail } from '../../jobs/notifications';
import type { CommentNotificationJobData } from '../../types/jobs';
import type { UserRole } from '../auth/auth.schemas';
import {
  getAttachmentsByComment,
  toAttachmentUrl,
  uploadAttachments,
} from '../attachments/attachment.service';
import { AttachmentRow } from '../attachments/attachment.schemas';
import { getTicketById } from '../tickets/ticket.service';
import { CommentRow } from './comment.schemas';

function createHttpError(message: string, statusCode: number, code?: string): Error {
  const err = new Error(message) as Error & { statusCode: number; code?: string };
  err.statusCode = statusCode;
  if (code !== undefined) err.code = code;
  return err;
}

// DB-only comment row (no attachments field — not a DB column)
interface CommentDbRow {
  id: string;
  ticketId: string;
  message: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
}

// Row shape returned by the list query with aggregated attachments JSON
interface CommentListDbRow extends CommentDbRow {
  attachmentsJson: AttachmentDbRowJson[] | null;
}

// JSON shape of each attachment object from json_agg (all keys are snake_case from DB)
interface AttachmentDbRowJson {
  id: string;
  ticket_id: string;
  comment_id: string | null;
  filename: string;
  storage_key: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string;
  created_at: string;
}

const COMMENT_SELECT = `
  c.id,
  c.ticket_id  AS "ticketId",
  c.message,
  c.created_by AS "createdBy",
  u.name       AS "createdByName",
  c.created_at AS "createdAt"
`;

export async function addComment(
  ticketId: string,
  message: string,
  attachmentFiles: Express.Multer.File[] | undefined,
  callerId: string,
  callerRole: UserRole,
): Promise<CommentRow> {
  const ticket = await getTicketById(ticketId, callerId, callerRole);

  const result = await query<CommentDbRow>(
    `WITH inserted AS (
       INSERT INTO comments (ticket_id, message, created_by)
       VALUES ($1, $2, $3)
       RETURNING id, ticket_id, message, created_by, created_at
     )
     SELECT ${COMMENT_SELECT}
     FROM inserted c
     JOIN users u ON u.id = c.created_by`,
    [ticketId, message, callerId],
  );

  if (!result.rows[0]) {
    throw createHttpError('Failed to create comment', 500);
  }

  const commentId = result.rows[0].id;

  // Upload attachment files if provided (fire-and-forget on error)
  let attachments: AttachmentRow[] = [];
  if (attachmentFiles && attachmentFiles.length > 0) {
    try {
      attachments = await uploadAttachments(ticketId, attachmentFiles, callerId, commentId);
    } catch (uploadErr) {
      console.error('[Attachments] Upload error on addComment:', (uploadErr as Error).message);
    }
  }

  const comment: CommentRow = {
    ...result.rows[0],
    attachments,
  };

  try {
    await deleteCache(`ticket:${ticketId}:comments`);
  } catch (cacheErr) {
    console.error('[Cache] Failed to invalidate comments cache:', (cacheErr as Error).message);
  }

  let adminId = '';
  try {
    const cacheKey = 'admin:default';
    const cached = await getCache<string>(cacheKey);
    if (cached !== null) {
      adminId = cached;
    } else {
      const adminResult = await query<{ id: string }>(
        "SELECT id FROM users WHERE role = 'ADMIN' ORDER BY created_at ASC LIMIT 1",
      );
      if (!adminResult.rows[0]) {
        throw new Error('No admin user found — seed the database before adding comments');
      }
      adminId = adminResult.rows[0].id;
      await setCache(cacheKey, adminId, config.redis.ttlSeconds);
    }
  } catch (adminErr) {
    console.error('[Queue] Failed to resolve admin user:', (adminErr as Error).message);
  }

  try {
    const emailPayload: CommentNotificationJobData = {
      ticketId,
      ticketTitle: ticket.title,
      commentMessage: message,
      commentAuthorId: callerId,
      creatorId: ticket.createdBy,
      assigneeId: ticket.assignedTo,
      adminId,
    };
    await sendCommentNotificationEmail(emailPayload);
  } catch (emailErr) {
    console.error('[Notify] Failed to send comment-notification email:', (emailErr as Error).message);
  }

  return comment;
}

function mapAttachmentJson(a: AttachmentDbRowJson): AttachmentRow {
  return {
    id: a.id,
    ticketId: a.ticket_id,
    commentId: a.comment_id,
    filename: a.filename,
    mimeType: a.mime_type,
    sizeBytes: a.size_bytes,
    uploadedBy: a.uploaded_by,
    createdAt: a.created_at,
    url: toAttachmentUrl(a.storage_key),
  };
}

export async function listComments(
  ticketId: string,
  callerId: string,
  callerRole: UserRole,
): Promise<CommentRow[]> {
  // Scope gate: throws 404 if ticket not found, 403 if caller out of scope
  await getTicketById(ticketId, callerId, callerRole);

  const cacheKey = `ticket:${ticketId}:comments`;

  try {
    const cached = await getCache<CommentRow[]>(cacheKey);
    if (cached !== null) return cached;
  } catch (cacheErr) {
    console.error('[Cache] Failed to read comments cache:', (cacheErr as Error).message);
  }

  // Use LEFT JOIN + json_agg to avoid N+1 queries when fetching per-comment attachments
  const result = await query<CommentListDbRow>(
    `SELECT
       c.id,
       c.ticket_id  AS "ticketId",
       c.message,
       c.created_by AS "createdBy",
       u.name       AS "createdByName",
       c.created_at AS "createdAt",
       COALESCE(
         json_agg(
           json_build_object(
             'id',          a.id,
             'ticket_id',   a.ticket_id,
             'comment_id',  a.comment_id,
             'filename',    a.filename,
             'storage_key', a.storage_key,
             'mime_type',   a.mime_type,
             'size_bytes',  a.size_bytes,
             'uploaded_by', a.uploaded_by,
             'created_at',  a.created_at
           ) ORDER BY a.created_at ASC
         ) FILTER (WHERE a.id IS NOT NULL),
         '[]'
       ) AS "attachmentsJson"
     FROM comments c
     JOIN users u ON u.id = c.created_by
     LEFT JOIN attachments a ON a.comment_id = c.id
     WHERE c.ticket_id = $1
     GROUP BY c.id, u.name
     ORDER BY c.created_at ASC`,
    [ticketId],
  );

  const rows: CommentRow[] = result.rows.map((row) => ({
    id: row.id,
    ticketId: row.ticketId,
    message: row.message,
    createdBy: row.createdBy,
    createdByName: row.createdByName,
    createdAt: row.createdAt,
    attachments: (row.attachmentsJson ?? []).map(mapAttachmentJson),
  }));

  try {
    await setCache(cacheKey, rows, config.redis.ttlSeconds);
  } catch (cacheErr) {
    console.error('[Cache] Failed to write comments cache:', (cacheErr as Error).message);
  }

  return rows;
}

export async function getCommentById(
  ticketId: string,
  commentId: string,
  callerId: string,
  callerRole: UserRole,
): Promise<CommentRow> {
  // Scope gate: throws 404 if ticket not found, 403 if caller out of scope
  await getTicketById(ticketId, callerId, callerRole);

  const result = await query<CommentDbRow>(
    `SELECT ${COMMENT_SELECT}
     FROM comments c
     JOIN users u ON u.id = c.created_by
     WHERE c.id = $1 AND c.ticket_id = $2`,
    [commentId, ticketId],
  );

  if (!result.rows[0]) {
    throw createHttpError('Comment not found', 404, 'INVALID_COMMENT_REFERENCE');
  }

  const dbRow = result.rows[0];
  const attachments = await getAttachmentsByComment(commentId);

  return {
    ...dbRow,
    attachments,
  };
}
