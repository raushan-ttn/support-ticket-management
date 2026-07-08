import { query } from '../config/postgres';
import config from '../config';
import { getTransport } from './mailer';
import type { CommentNotificationJobData, NewTicketJobData } from '../types/jobs';

async function resolveEmails(ids: string[]): Promise<string[]> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) return [];
  const result = await query<{ id: string; email: string }>(
    'SELECT id, email FROM users WHERE id = ANY($1)',
    [uniqueIds],
  );
  return result.rows.map((r) => r.email);
}

export async function sendNewTicketEmail(data: NewTicketJobData): Promise<void> {
  try {
    const recipients = await resolveEmails([data.creatorId, data.adminId]);
    if (recipients.length === 0) return;

    await getTransport().sendMail({
      from: config.smtp.from,
      to: recipients.join(', '),
      subject: `New ticket: ${data.ticketTitle}`,
      text: `A new ticket "${data.ticketTitle}" (${data.ticketId}) has been created.`,
    });
  } catch (err) {
    console.error('[Notify] Failed to send new-ticket email:', (err as Error).message);
  }
}

export async function sendCommentNotificationEmail(
  data: CommentNotificationJobData,
): Promise<void> {
  try {
    const recipientIds = [data.creatorId, data.assigneeId, data.adminId].filter(
      (id) => id && id !== data.commentAuthorId,
    );
    const recipients = await resolveEmails(recipientIds);
    if (recipients.length === 0) return;

    const attachmentNote =
      data.attachmentCount && data.attachmentCount > 0
        ? `\n\nAttachments (${data.attachmentCount}): ${(data.attachmentFilenames ?? []).join(', ')}`
        : '';

    await getTransport().sendMail({
      from: config.smtp.from,
      to: recipients.join(', '),
      subject: `New comment on ticket: ${data.ticketTitle}`,
      text: `${data.commentMessage}${attachmentNote}`,
    });
  } catch (err) {
    console.error('[Notify] Failed to send comment-notification email:', (err as Error).message);
  }
}
