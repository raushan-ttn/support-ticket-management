import { z } from 'zod';

// Screenshot is a multer file field (req.file), not a Zod field.
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
  screenshot: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
}
