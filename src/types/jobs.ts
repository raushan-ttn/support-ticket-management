export interface NewTicketJobData {
  ticketId: string;
  ticketTitle: string;
  creatorId: string;
  adminId: string;
}

export interface CommentNotificationJobData {
  ticketId: string;
  ticketTitle: string;
  commentMessage: string;
  commentAuthorId: string;
  creatorId: string;
  assigneeId: string;
  adminId: string;
  attachmentCount?: number;
  attachmentFilenames?: string[];
}

export interface AutoCloseJobData {
  ticketId: string;
  triggeringCommentId: string;
  assigneeId: string;
  creatorId: string;
  adminId: string;
}
