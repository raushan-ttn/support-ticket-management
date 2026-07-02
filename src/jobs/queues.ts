import { Queue } from 'bullmq';

import connection from '../config/queue';
import type { AutoCloseJobData, CommentNotificationJobData, NewTicketJobData } from '../types/jobs';

export const emailQueue = new Queue<CommentNotificationJobData | NewTicketJobData>('email', {
  connection,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});

export const autoCloseQueue = new Queue<AutoCloseJobData>('auto-close', {
  connection,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});
