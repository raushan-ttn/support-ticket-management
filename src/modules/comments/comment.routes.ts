import { Router } from 'express';

import authenticate from '../../middlewares/authenticate';
import { uploadCommentFiles } from '../../middlewares/uploadCommentFiles';
import { validateBody } from '../../middlewares/validateBody';
import * as controller from './comment.controller';
import { createCommentSchema } from './comment.schemas';

const router = Router();

// uploadCommentFiles must run before validateBody so req.files and multipart req.body
// fields are available. It parses both the 'screenshot' and 'files' fields in one pass.
router.post(
  '/:ticketId/comments',
  authenticate,
  uploadCommentFiles,
  validateBody(createCommentSchema),
  controller.add,
);

router.get('/:ticketId/comments', authenticate, controller.list);

router.get('/:ticketId/comments/:commentId', authenticate, controller.getById);

export default router;
