import { Router } from 'express';

import authenticate from '../../middlewares/authenticate';
import { validateBody } from '../../middlewares/validateBody';
import { uploadCommentFiles } from './comment.middleware';
import * as controller from './comment.controller';
import { createCommentSchema } from './comment.schemas';

const router = Router();

/**
 * @openapi
 * /tickets/{ticketId}/comments:
 *   post:
 *     tags: [Comments]
 *     summary: Add a comment to a ticket
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message: { type: string, example: Looking into this now. }
 *               screenshot: { type: string, format: binary }
 *               files:
 *                 type: array
 *                 items: { type: string, format: binary }
 *                 description: 'Up to 5 files, image/jpeg or image/png only'
 *     responses:
 *       201:
 *         description: Comment created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/CommentRow' }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       415:
 *         description: Unsupported file MIME type
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
// uploadCommentFiles must run before validateBody so req.files and multipart req.body
// fields are available. It parses both the 'screenshot' and 'files' fields in one pass.
router.post(
  '/:ticketId/comments',
  authenticate,
  uploadCommentFiles,
  validateBody(createCommentSchema),
  controller.add,
);

/**
 * @openapi
 * /tickets/{ticketId}/comments:
 *   get:
 *     tags: [Comments]
 *     summary: List comments for a ticket
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Comment list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/CommentRow' }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get('/:ticketId/comments', authenticate, controller.list);

/**
 * @openapi
 * /tickets/{ticketId}/comments/{commentId}:
 *   get:
 *     tags: [Comments]
 *     summary: Get a single comment
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: commentId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Comment detail
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/CommentRow' }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         description: Ticket not found, or comment does not belong to ticket
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/:ticketId/comments/:commentId', authenticate, controller.getById);

export default router;
