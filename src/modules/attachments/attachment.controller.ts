import { NextFunction, Request, Response } from 'express';

import { error } from '../../utils/response';
import { uuidParam } from '../../utils/zodHelpers';
import { deleteAttachment, downloadAttachment } from './attachment.service';

function getUser(req: Request, res: Response): Express.User | null {
  if (!req.user) {
    error(res, 'Unauthorized', 401);
    return null;
  }
  return req.user;
}

/**
 * GET /api/v1/tickets/:ticketId/attachments/:attachmentId/download
 *
 * Streams the attachment file to the client.
 * Requires: authenticate (set in routes).
 * RBAC: any authenticated user with access to the parent ticket.
 */
export async function download(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = getUser(req, res);
    if (!user) return;

    uuidParam.parse(req.params.ticketId);
    const attachmentId = uuidParam.parse(req.params.attachmentId);

    const { stream, mimeType, filename } = await downloadAttachment(
      attachmentId,
      user.id,
      user.role,
    );

    const safeFilename = filename.replace(/[\r\n"\\]/g, '_');

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);

    res.on('close', () => {
      if (!stream.destroyed) stream.destroy();
    });

    stream.on('error', (streamErr: Error) => {
      if (res.headersSent) {
        res.destroy(streamErr);
        return;
      }
      next(streamErr);
    });

    stream.pipe(res);
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/v1/tickets/:ticketId/attachments/:attachmentId
 *
 * Deletes an attachment from storage and the DB.
 * Requires: authenticate (set in routes).
 * RBAC: ADMIN can delete any; AGENT can only delete their own uploads.
 */
export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = getUser(req, res);
    if (!user) return;

    uuidParam.parse(req.params.ticketId);
    const attachmentId = uuidParam.parse(req.params.attachmentId);

    await deleteAttachment(attachmentId, user.id, user.role);

    res.status(204).end();
  } catch (err) {
    next(err);
  }
}
