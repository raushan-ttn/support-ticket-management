import { z } from 'zod';

import { AttachmentRow } from '../attachments/attachment.schemas';

export const createCommentSchema = z
  .object({
    message: z.string().trim().min(1, 'Message is required'),
  })
  .strip();

export type CreateCommentPayload = z.infer<typeof createCommentSchema>;

export interface CommentRow {
  id: string;
  ticketId: string;
  message: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  attachments: AttachmentRow[];
}
