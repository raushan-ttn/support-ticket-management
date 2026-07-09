import { Router } from 'express';

import authenticate from '../../middlewares/authenticate';
import { download, remove } from './attachment.controller';

const attachmentRouter = Router({ mergeParams: true });

// GET /api/v1/tickets/:ticketId/attachments/:attachmentId/download
attachmentRouter.get('/:attachmentId/download', authenticate, download);

// DELETE /api/v1/tickets/:ticketId/attachments/:attachmentId
attachmentRouter.delete('/:attachmentId', authenticate, remove);

export default attachmentRouter;
