// Hardcoded per VAL-6 / FR-13b — only PNG and JPEG are accepted for attachments,
// independent of the broader config.attachment.allowedMimeTypes default.
export const ALLOWED_ATTACHMENT_MIMES = new Set(['image/jpeg', 'image/png']);

/**
 * AttachmentRow — the public response shape for a single attachment.
 * storage_key is never included (DM-8).
 * url is a derived field computed at query time — not stored in DB.
 */
export interface AttachmentRow {
  id: string;
  ticketId: string;
  commentId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: string;
  url: string;
}

/**
 * AttachmentDbRow — internal DB row shape used only inside the service.
 * Includes storageKey so the service can compute url and then discard it.
 */
export interface AttachmentDbRow {
  id: string;
  ticketId: string;
  commentId: string | null;
  filename: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: string;
}
