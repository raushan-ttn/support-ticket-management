import { Router } from 'express';

import authenticate from '../../middlewares/authenticate';
import { requireRole } from '../../middlewares/requireRole';
import { uploadAttachmentFiles } from '../../middlewares/uploadAttachments';
import { validateBody } from '../../middlewares/validateBody';
import { validateQuery } from '../../middlewares/validateQuery';
import * as controller from './ticket.controller';
import {
  assignSchema,
  createTicketSchema,
  listTicketsQuerySchema,
  statusTransitionSchema,
  updateTicketSchema,
} from './ticket.schemas';

const router = Router();

// uploadAttachmentFiles must run before validateBody so req.files and multipart req.body fields are available
router.post(
  '/',
  authenticate,
  uploadAttachmentFiles,
  validateBody(createTicketSchema),
  controller.create,
);
router.get('/', authenticate, validateQuery(listTicketsQuerySchema), controller.list);
router.get('/:id', authenticate, controller.getById);
router.patch(
  '/:id',
  authenticate,
  uploadAttachmentFiles,
  validateBody(updateTicketSchema),
  controller.update,
);
router.patch(
  '/:id/status',
  authenticate,
  validateBody(statusTransitionSchema),
  controller.transitionStatus,
);
router.post(
  '/:id/assign',
  authenticate,
  requireRole('ADMIN'),
  validateBody(assignSchema),
  controller.assign,
);

export default router;
