import { Readable } from 'stream';

import config from '../../config';
import { query } from '../../config/postgres';
import { deleteCache, getCache, setCache } from '../../config/redis';
import { autoCloseQueue, emailQueue } from '../../jobs/queues';
import { buildStorageKey, getStorageBackend } from '../../storage';
import type { AutoCloseJobData, CommentNotificationJobData } from '../../types/jobs';
import type { UserRole } from '../auth/auth.schemas';
import { getTicketById } from '../tickets/ticket.service';
import { CommentRow } from './comment.schemas';

function createHttpError(message: string, statusCode: number, code?: string): Error {
  const err = new Error(message) as Error & { statusCode: number; code?: string };
  err.statusCode = statusCode;
  if (code !== undefined) err.code = code;
  return err;
}

const ALLOWED_SCREENSHOT_MIMES = new Set(['image/jpeg', 'image/png']);
const NON_TERMINAL_STATUSES = ['OPEN', 'IN_PROGRESS'];

function toScreenshotUrl(key: string | null): string | null {
  if (!key) return null;
  if (config.storage.backend === 's3') {
    const { endpoint, bucket, region } = config.storage.s3;
    const base = endpoint ?? `https://${bucket}.s3.${region}.amazonaws.com`;
    return `${base}/${key}`;
  }
  return `/uploads/${key}`;
}

const COMMENT_SELECT = `
  c.id,
  c.ticket_id  AS "ticketId",
  c.message,
  c.screenshot,
  c.created_by AS "createdBy",
  u.name       AS "createdByName",
  c.created_at AS "createdAt"
`;

export async function addComment(
  ticketId: string,
  message: string,
  file: Express.Multer.File | undefined,
  callerId: string,
  callerRole: UserRole,
): Promise<CommentRow> {
  const ticket = await getTicketById(ticketId, callerId, callerRole);

  let screenshotKey: string | null = null;

  if (file !== undefined) {
    if (!ALLOWED_SCREENSHOT_MIMES.has(file.mimetype)) {
      throw createHttpError(
        `Screenshot must be image/jpeg or image/png, got ${file.mimetype}`,
        415,
        'UNSUPPORTED_MEDIA_TYPE',
      );
    }
    const key = buildStorageKey();
    const backend = await getStorageBackend();
    await backend.save(key, Readable.from(file.buffer), file.mimetype, file.size);
    screenshotKey = key;
  }

  let result: { rows: CommentRow[]; rowCount: number | null };
  try {
    result = await query<CommentRow>(
      `WITH inserted AS (
         INSERT INTO comments (ticket_id, message, screenshot, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id, ticket_id, message, screenshot, created_by, created_at
       )
       SELECT ${COMMENT_SELECT}
       FROM inserted c
       JOIN users u ON u.id = c.created_by`,
      [ticketId, message, screenshotKey, callerId],
    );
  } catch (dbErr) {
    if (screenshotKey !== null) {
      try {
        const backend = await getStorageBackend();
        await backend.delete(screenshotKey);
      } catch {
        // best-effort cleanup
      }
    }
    throw dbErr;
  }

  if (!result.rows[0]) {
    throw createHttpError('Failed to create comment', 500);
  }

  const comment = { ...result.rows[0], screenshot: toScreenshotUrl(result.rows[0].screenshot) };

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
    await emailQueue.add('comment-notification', emailPayload);
  } catch (emailErr) {
    console.error('[Queue] Failed to enqueue comment-notification email:', (emailErr as Error).message);
  }

  try {
    if (ticket.assignedTo === callerId && NON_TERMINAL_STATUSES.includes(ticket.status)) {
      const autoClosePayload: AutoCloseJobData = {
        ticketId,
        triggeringCommentId: comment.id,
        assigneeId: ticket.assignedTo,
        creatorId: ticket.createdBy,
        adminId,
      };
      await autoCloseQueue.add('auto-close', autoClosePayload, {
        delay: config.queue.autoCloseDelayMs,
        jobId: `auto-close:${ticketId}`,
        removeOnComplete: true,
        removeOnFail: false,
      });
    } else if (ticket.createdBy === callerId && NON_TERMINAL_STATUSES.includes(ticket.status)) {
      const job = await autoCloseQueue.getJob(`auto-close:${ticketId}`);
      await job?.remove();
    }
  } catch (queueErr) {
    console.error('[Queue] Failed to schedule/cancel auto-close job:', (queueErr as Error).message);
  }

  return comment;
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

  const result = await query<CommentRow>(
    `SELECT ${COMMENT_SELECT}
     FROM comments c
     JOIN users u ON u.id = c.created_by
     WHERE c.ticket_id = $1
     ORDER BY c.created_at ASC`,
    [ticketId],
  );

  const rows = result.rows.map((row) => ({ ...row, screenshot: toScreenshotUrl(row.screenshot) }));

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

  const result = await query<CommentRow>(
    `SELECT ${COMMENT_SELECT}
     FROM comments c
     JOIN users u ON u.id = c.created_by
     WHERE c.id = $1 AND c.ticket_id = $2`,
    [commentId, ticketId],
  );

  if (!result.rows[0]) {
    throw createHttpError('Comment not found', 404, 'INVALID_COMMENT_REFERENCE');
  }

  return { ...result.rows[0], screenshot: toScreenshotUrl(result.rows[0].screenshot) };
}
