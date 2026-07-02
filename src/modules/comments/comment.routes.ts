import { Router } from 'express';

import authenticate from '../../middlewares/authenticate';
import { upload } from '../../middlewares/upload';
import { validateBody } from '../../middlewares/validateBody';
import * as controller from './comment.controller';
import { createCommentSchema } from './comment.schemas';

const router = Router();

// multer runs before validateBody so req.file is set and req.body.message is populated
router.post(
  '/:ticketId/comments',
  authenticate,
  upload.single('screenshot'),
  validateBody(createCommentSchema),
  controller.add,
);

router.get('/:ticketId/comments', authenticate, controller.list);

router.get('/:ticketId/comments/:commentId', authenticate, controller.getById);

export default router;
