import { Readable } from 'stream';

import sanitizeFilename from 'sanitize-filename';

import config from '../../config';
import { query } from '../../config/postgres';
import { deleteCache, getCache, setCache } from '../../config/redis';
import { getStorageBackend, buildStorageKey } from '../../storage';
import { getTicketById } from '../tickets/ticket.service';
import { ALLOWED_ATTACHMENT_MIMES, AttachmentDbRow, AttachmentRow } from './attachment.schemas';

function createHttpError(message: string, statusCode: number, code?: string): Error {
  const err = new Error(message) as Error & { statusCode: number; code?: string };
  err.statusCode = statusCode;
  if (code !== undefined) err.code = code;
  return err;
}

/**
 * Compute the public URL for a stored file.
 * For local: {APP_URL}/${key} — absolute so it opens directly in a browser;
 *   served by express.static(config.storage.localDir)
 * For S3: https://{bucket}.s3.{region}.amazonaws.com/{key} (or custom endpoint)
 */
export function toAttachmentUrl(key: string): string {
  if (config.storage.backend === 's3') {
    const { endpoint, bucket, region } = config.storage.s3;
    const base = endpoint ?? `https://${bucket}.s3.${region}.amazonaws.com`;
    return `${base}/${key}`;
  }
  return `${config.appUrl}/${key}`;
}

function toAttachmentRow(db: AttachmentDbRow): AttachmentRow {
  const { storageKey, ...rest } = db;
  return { ...rest, url: toAttachmentUrl(storageKey) };
}

/**
 * Upload one or more files, persist metadata rows, and return AttachmentRow[].
 * Files are processed sequentially to avoid memory spikes.
 * If a storage save fails for a file, it is logged and skipped (partial success).
 * commentId, when provided, must belong to the given ticketId.
 */
export async function uploadAttachments(
  ticketId: string,
  files: Express.Multer.File[],
  uploadedBy: string,
  commentId?: string,
): Promise<AttachmentRow[]> {
  if (!files || files.length === 0) return [];

  // Defence-in-depth MIME check (multer already filtered, but service validates too)
  for (const file of files) {
    if (!ALLOWED_ATTACHMENT_MIMES.has(file.mimetype)) {
      throw createHttpError(
        `File type '${file.mimetype}' is not allowed. Only image/jpeg and image/png are accepted.`,
        415,
        'UNSUPPORTED_MEDIA_TYPE',
      );
    }
  }

  // Validate commentId belongs to this ticket
  if (commentId !== undefined) {
    const commentResult = await query<{ id: string }>(
      'SELECT id FROM comments WHERE id = $1 AND ticket_id = $2',
      [commentId, ticketId],
    );
    if (!commentResult.rows[0]) {
      throw createHttpError(
        'Comment does not belong to the specified ticket',
        400,
        'INVALID_COMMENT_REFERENCE',
      );
    }
  }

  const backend = await getStorageBackend();
  const results: AttachmentRow[] = [];

  for (const file of files) {
    const sanitized = sanitizeFilename(file.originalname) || 'unnamed';
    const storageKey = buildStorageKey(file.mimetype);

    try {
      await backend.save(storageKey, Readable.from(file.buffer), file.mimetype, file.size);
    } catch (saveErr) {
      console.error('[Storage] Failed to save file:', (saveErr as Error).message);
      // Skip this file — no DB row inserted, no orphaned metadata
      continue;
    }

    try {
      const insertResult = await query<AttachmentDbRow>(
        `INSERT INTO attachments (ticket_id, comment_id, filename, storage_key, mime_type, size_bytes, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING
           id,
           ticket_id   AS "ticketId",
           comment_id  AS "commentId",
           filename,
           storage_key AS "storageKey",
           mime_type   AS "mimeType",
           size_bytes  AS "sizeBytes",
           uploaded_by AS "uploadedBy",
           created_at  AS "createdAt"`,
        [ticketId, commentId ?? null, sanitized, storageKey, file.mimetype, file.size, uploadedBy],
      );

      if (insertResult.rows[0]) {
        results.push(toAttachmentRow(insertResult.rows[0]));
      }
    } catch (dbErr) {
      // Best-effort: attempt to clean up the already-saved file
      try {
        await backend.delete(storageKey);
      } catch {
        // ignore cleanup errors
      }
      console.error('[DB] Failed to insert attachment metadata:', (dbErr as Error).message);
    }
  }

  // Invalidate attachment cache for this ticket (fire-and-forget)
  try {
    await deleteCache(`ticket:${ticketId}:attachments`);
  } catch (cacheErr) {
    console.error('[Cache] Failed to invalidate attachments cache:', (cacheErr as Error).message);
  }

  return results;
}

/**
 * Return all attachments for a ticket (for embedding in ticket detail responses).
 * Result is cached under ticket:{ticketId}:attachments.
 */
export async function getAttachmentsByTicket(ticketId: string): Promise<AttachmentRow[]> {
  const cacheKey = `ticket:${ticketId}:attachments`;

  try {
    const cached = await getCache<AttachmentRow[]>(cacheKey);
    if (cached !== null) return cached;
  } catch (cacheErr) {
    console.error('[Cache] Failed to read attachments cache:', (cacheErr as Error).message);
  }

  const result = await query<AttachmentDbRow>(
    `SELECT
       id,
       ticket_id   AS "ticketId",
       comment_id  AS "commentId",
       filename,
       storage_key AS "storageKey",
       mime_type   AS "mimeType",
       size_bytes  AS "sizeBytes",
       uploaded_by AS "uploadedBy",
       created_at  AS "createdAt"
     FROM attachments
     WHERE ticket_id = $1
     ORDER BY created_at ASC`,
    [ticketId],
  );

  const rows = result.rows.map(toAttachmentRow);

  try {
    await setCache(cacheKey, rows, config.redis.ttlSeconds);
  } catch (cacheErr) {
    console.error('[Cache] Failed to write attachments cache:', (cacheErr as Error).message);
  }

  return rows;
}

export interface DownloadResult {
  stream: Readable;
  mimeType: string;
  filename: string;
}

/**
 * Return a readable stream for an attachment file, after verifying ticket access.
 * Throws 404 if the attachment is not found.
 * Throws 403/404 if the caller cannot access the parent ticket.
 */
export async function downloadAttachment(
  id: string,
  callerId: string,
  callerRole: string,
): Promise<DownloadResult> {
  const result = await query<
    Pick<AttachmentDbRow, 'id' | 'ticketId' | 'storageKey' | 'mimeType' | 'filename'>
  >(
    `SELECT
       id,
       ticket_id   AS "ticketId",
       storage_key AS "storageKey",
       mime_type   AS "mimeType",
       filename
     FROM attachments
     WHERE id = $1`,
    [id],
  );

  const row = result.rows[0];
  if (!row) throw createHttpError('Attachment not found', 404, 'NOT_FOUND');

  // Verify the caller can access the parent ticket — propagates 403/404 on failure
  await getTicketById(row.ticketId, callerId, callerRole);

  const backend = await getStorageBackend();
  const stream = await backend.getStream(row.storageKey);
  return { stream, mimeType: row.mimeType, filename: row.filename };
}

/**
 * Delete an attachment from storage and the DB, after verifying ownership.
 * ADMIN can delete any attachment; AGENT can only delete their own uploads.
 * Throws 404 if the attachment is not found.
 * Throws 403 if the agent is not the uploader.
 * Throws 403/404 if the caller cannot access the parent ticket.
 */
export async function deleteAttachment(
  id: string,
  callerId: string,
  callerRole: string,
): Promise<void> {
  const result = await query<
    Pick<AttachmentDbRow, 'id' | 'ticketId' | 'storageKey'> & { uploadedBy: string }
  >(
    `SELECT
       id,
       ticket_id   AS "ticketId",
       storage_key AS "storageKey",
       uploaded_by AS "uploadedBy"
     FROM attachments
     WHERE id = $1`,
    [id],
  );

  const row = result.rows[0];
  if (!row) throw createHttpError('Attachment not found', 404, 'NOT_FOUND');

  // Verify the caller can access the parent ticket
  await getTicketById(row.ticketId, callerId, callerRole);

  // Authorization: AGENT can only delete their own uploads
  if (callerRole !== 'ADMIN' && row.uploadedBy !== callerId) {
    throw createHttpError('Forbidden', 403, 'FORBIDDEN');
  }

  // Delete the DB row first (source of truth) so a storage failure never leaves
  // a dangling metadata row that still resolves via download.
  const deleteResult = await query('DELETE FROM attachments WHERE id = $1', [id]);
  if (!deleteResult.rowCount || deleteResult.rowCount === 0) {
    throw createHttpError('Attachment not found', 404, 'NOT_FOUND');
  }

  // Delete from storage (best-effort: log failure but continue — an orphaned
  // storage blob is preferable to a DB row pointing at a deleted file)
  const backend = await getStorageBackend();
  try {
    await backend.delete(row.storageKey);
  } catch (storageErr) {
    console.error('[Storage] Failed to delete file on attachment delete:', (storageErr as Error).message);
  }

  // Invalidate cache
  try {
    await deleteCache(`ticket:${row.ticketId}:attachments`);
  } catch (cacheErr) {
    console.error('[Cache] Failed to invalidate attachments cache on delete:', (cacheErr as Error).message);
  }
}

/**
 * Return all attachments for a specific comment.
 * Not individually cached — called inline during listComments / getCommentById.
 */
export async function getAttachmentsByComment(commentId: string): Promise<AttachmentRow[]> {
  const result = await query<AttachmentDbRow>(
    `SELECT
       id,
       ticket_id   AS "ticketId",
       comment_id  AS "commentId",
       filename,
       storage_key AS "storageKey",
       mime_type   AS "mimeType",
       size_bytes  AS "sizeBytes",
       uploaded_by AS "uploadedBy",
       created_at  AS "createdAt"
     FROM attachments
     WHERE comment_id = $1
     ORDER BY created_at ASC`,
    [commentId],
  );

  return result.rows.map(toAttachmentRow);
}
