# Notifications & Auto-Close — BullMQ + Email + Delayed Job

## Problem

The system must send asynchronous email notifications on ticket creation (FR-10) and on new
comments (FR-11), and automatically close stale tickets 48 hours after an assignee comment if the
creator does not reply (FR-12). All of this must be non-blocking, retried on failure, and degraded
gracefully when Redis is unavailable.

---

## Approach

**BullMQ** (Redis-backed job queue) reuses the existing `ioredis` instance from `src/config/redis.ts`.
**Nodemailer** provides the SMTP transport (configurable; dev uses Mailhog / in-memory transport).
Workers run in the same Node process for simplicity; they can be extracted to a separate worker
process for production scaling.

Three job types:
1. `new-ticket` — email creator + admin on ticket creation.
2. `comment-notification` — email creator + current assignee + admin (excluding comment author) on new comment.
3. `auto-close` — delayed job (48h) to close a ticket if creator hasn't replied.

---

## Packages

| Package | Type | Purpose |
|---------|------|---------|
| `bullmq` | dep | Redis-backed job queue (delayed jobs, retries, concurrency) |
| `nodemailer` | dep | SMTP email transport |
| `@types/nodemailer` | devDep | TypeScript types |

> BullMQ v5+ requires ioredis ≥ 5. Confirm the ioredis version in `package.json` before installing.

---

## Files Created

```
src/
  config/
    queue.ts              ← BullMQ Queue + Worker connection (reuses redis instance)
  jobs/
    queues.ts             ← named Queue exports: emailQueue, autoCloseQueue
    emailWorker.ts        ← processes new-ticket + comment-notification jobs
    autoCloseWorker.ts    ← processes auto-close delayed jobs
    mailer.ts             ← nodemailer transport factory (SMTP vs. captured)
  types/
    jobs.ts               ← TypeScript interfaces for job data payloads
```

---

## Module Specifications

### `src/config/queue.ts`

```ts
import { Queue, Worker, ConnectionOptions } from 'bullmq';
import { config } from './index';

export const connection: ConnectionOptions = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password || undefined,
  db: config.redis.db,
};
```

BullMQ uses its own ioredis connection (not the shared `redis` singleton from `redis.ts`) because
BullMQ requires a dedicated connection that it controls. The connection config is sourced from the
same `config.redis.*` values.

### `src/jobs/queues.ts`

```ts
export const emailQueue     = new Queue('email',     { connection });
export const autoCloseQueue = new Queue('auto-close', { connection, defaultJobOptions: {
  removeOnComplete: 100, removeOnFail: 200,
}});
```

### `src/types/jobs.ts`

```ts
export interface NewTicketJobData {
  ticketId: string;
  ticketTitle: string;
  priority: string;
  creatorId: string;
  adminId: string;   // always the assigned admin on creation
}

export interface CommentNotificationJobData {
  ticketId: string;
  ticketTitle: string;
  commentMessage: string;
  commentAuthorId: string;   // excluded from recipients
  creatorId: string;
  assigneeId: string;        // current assignedTo at comment time (FR-11a)
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
```

### `src/jobs/mailer.ts`

```ts
export function createTransport() {
  if (config.env === 'test') return nodemailer.createTransport({ jsonTransport: true });
  if (config.env === 'development' && !config.smtp.host) {
    return nodemailer.createTransport({ host: 'localhost', port: 1025 }); // Mailhog
  }
  return nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
}
```

The transport is created once and reused by the worker. In tests, `jsonTransport: true` captures
sent mail without sending; assert on `transporter.sentMail`.

### `src/jobs/emailWorker.ts`

```ts
const worker = new Worker('email', async (job) => {
  if (job.name === 'new-ticket')           await handleNewTicket(job.data);
  if (job.name === 'comment-notification') await handleCommentNotification(job.data);
}, { connection, concurrency: config.queue.concurrency, attempts: config.queue.attempts,
     backoff: { type: 'exponential', delay: config.queue.backoffMs } });
```

**`handleNewTicket`**:
1. Resolve email addresses for `creatorId` and `adminId` from DB (or cache under `user:{id}`).
2. De-duplicate the recipient list.
3. Send one email with ticket id, title, priority.

**`handleCommentNotification`**:
1. Resolve emails for `creatorId`, `assigneeId`, `adminId`.
2. Remove `commentAuthorId` from the recipient set (FR-11, no self-notify).
3. De-duplicate.
4. Send email with ticket title + comment message. If attachments, note count + filenames (FR-11b).

### `src/jobs/autoCloseWorker.ts`

Processes delayed `auto-close` jobs (job `delay` set to 48h from schedule time).

```ts
const worker = new Worker('auto-close', async (job) => {
  const { ticketId, triggeringCommentId, assigneeId, creatorId } = job.data;

  // FR-12c: Re-validate at execution time
  const ticket = await getTicketRaw(ticketId);          // direct DB read, no cache
  if (!ticket) return;                                   // deleted — no-op
  if (['CLOSED','CANCELLED','RESOLVED'].includes(ticket.status)) return; // terminal — no-op

  // Check most recent comment is still from assignee with no creator reply after it
  const lastComment = await getLastComment(ticketId);
  if (!lastComment || lastComment.created_by !== assigneeId) return;   // creator replied — no-op
  if (lastComment.id !== triggeringCommentId) return;                  // comment replaced — no-op

  // Execute system-only transition (SM-6)
  await systemTransitionStatus(ticketId, 'CLOSED');                    // imported from ticket.service

  // Enqueue auto-close notification (FR-12e)
  await emailQueue.add('auto-close-notification', {
    ticketId, creatorId, assigneeId, adminId: ticket.assigned_to,
  });
}, { connection });
```

### Scheduling & Cancellation (FR-12f)

**BullMQ job IDs** are used to replace/cancel delayed jobs:

```ts
const autoCloseJobId = (ticketId: string) => `auto-close:${ticketId}`;

// When assignee comments — schedule or replace
await autoCloseQueue.add('auto-close', jobData, {
  delay: 48 * 60 * 60 * 1000,    // 48 hours in ms
  jobId: autoCloseJobId(ticketId), // replaces existing job with same ID (FR-12b)
  removeOnComplete: true,
  removeOnFail: false,
});

// When creator comments on non-terminal ticket — cancel (FR-12a)
await autoCloseQueue.remove(autoCloseJobId(ticketId));

// When ticket transitions to terminal state — cancel
await autoCloseQueue.remove(autoCloseJobId(ticketId));
```

BullMQ's `jobId` uniqueness replaces an existing delayed job with the same key automatically
(the old job is removed and a new one with a fresh 48h delay is added). This handles FR-12b
(assignee re-comments) without needing to explicitly remove the old job first.

---

## Integration Points in `comment.service.ts`

After a comment is successfully persisted:

```ts
// FR-12: Auto-close scheduling
if (author.id === ticket.assignedTo && !isTerminal(ticket.status)) {
  await autoCloseQueue.add('auto-close', payload, {
    delay: 48 * 60 * 60 * 1000,
    jobId: `auto-close:${ticketId}`,
  });
}

// FR-12a: Cancel on creator reply
if (author.id === ticket.createdBy && !isTerminal(ticket.status)) {
  await autoCloseQueue.remove(`auto-close:${ticketId}`);
}

// FR-11: Comment notification
await emailQueue.add('comment-notification', notificationPayload);
```

Queue add failures are caught and logged; they never throw to the caller (NFR-8, NFR-11).

---

## Worker Startup (`bin/www.ts`)

```ts
import './jobs/emailWorker';
import './jobs/autoCloseWorker';
```

Import-side-effect pattern starts workers when the process boots. Workers connect lazily and
degrade if Redis is unreachable — core APIs continue (NFR-11).

---

## Graceful Shutdown

```ts
SIGTERM → worker.close() for each worker before server.close()
```

---

## Environment Variables

| Variable | Default | Notes |
|----------|---------|-------|
| `SMTP_HOST` | `localhost` | SMTP relay |
| `SMTP_PORT` | `1025` | 1025 = Mailhog dev |
| `SMTP_SECURE` | `false` | `true` for TLS |
| `SMTP_USER` | _(empty)_ | |
| `SMTP_PASS` | _(empty)_ | |
| `SMTP_FROM` | `noreply@ttn.com` | Sender address |
| `QUEUE_CONCURRENCY` | `5` | Worker concurrency |
| `QUEUE_ATTEMPTS` | `3` | Retries per job |
| `QUEUE_BACKOFF_MS` | `5000` | Base backoff ms |
| `AUTO_CLOSE_DELAY_MS` | `172800000` | 48h in ms (injectable in tests) |

---

## Testing (TEST-7, TEST-8)

### Email (TEST-7)

Use `jsonTransport: true` nodemailer transport in `NODE_ENV=test`. Assert on the captured
`sentMail` array that:
- `new-ticket` enqueues exactly one job; processed mail goes to de-duplicated creator + admin set.
- `comment-notification` excludes the comment author; correct recipient set for all role combinations.

### Auto-close (TEST-8)

Inject `AUTO_CLOSE_DELAY_MS=0` (or use BullMQ's `advanceTimersByTime` with fake timers) to
simulate the 48h window instantly:

- **(a)** Assignee comment → delayed job scheduled with correct `jobId`.
- **(b)** Creator replies within window → `autoCloseQueue.remove` called; job cancelled.
- **(c)** Deadline fires with no creator reply → ticket status becomes `CLOSED` via system transition.
- **(d)** Creator replies at the last moment (race) → FR-12c re-validation prevents close.

---

## Risks

- **BullMQ ioredis version** — BullMQ v5 requires ioredis ≥ 5; verify `package.json` before `npm install`.
- **Job ID collision** — using `ticketId` as job key means only one pending auto-close per ticket; this is intentional (FR-12f) but must be documented clearly.
- **Worker process crash** — BullMQ jobs are persisted in Redis; jobs survive worker restart. On
  restart, any in-progress job that wasn't acknowledged is re-queued automatically.
- **Redis unavailable at schedule time** — queue add is wrapped in try/catch; unavailability logs
  a warning but does not fail the comment endpoint (NFR-11).

---

## Next Steps

- [ ] `npm install bullmq nodemailer @types/nodemailer`
- [ ] Add smtp + queue + storage config to `src/config/index.ts` and `.sample.env`
- [ ] Create `src/config/queue.ts` (BullMQ connection)
- [ ] Create `src/types/jobs.ts`
- [ ] Create `src/jobs/queues.ts`, `mailer.ts`, `emailWorker.ts`, `autoCloseWorker.ts`
- [ ] Export `systemTransitionStatus` from `ticket.service.ts` (not exposed via controller)
- [ ] Import workers in `bin/www.ts`
- [ ] Add worker graceful-shutdown hooks to `bin/www.ts`
- [ ] Integration tests: email capture (TEST-7), auto-close with fake timer (TEST-8)
