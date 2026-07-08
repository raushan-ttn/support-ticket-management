# Notifications — Direct Email (Phase 7)

> **Decision (2026-07-08):** Email notifications are implemented as a **direct,
> non-queued call** (fire-and-forget) — no BullMQ, no job queue at all.
>
> **Auto-close (formerly Phase 8 / FR-12) is removed from scope**, not deferred — it
> required a Redis-backed BullMQ delayed-job queue, which is not part of this
> implementation. See `requirements.md` §1.2 Out of Scope for the full rationale.
>
> This plan previously bundled email + auto-close together and included working
> BullMQ code samples for both. Those auto-close samples have been removed; the
> corresponding **already-written code is dead and needs cleanup** — see "Cleanup"
> below and `task.md` Phase 7/8.

## Problem

The system must send email notifications on ticket creation (FR-10) and on new
comments (FR-11), without blocking or failing the originating API request (NFR-8).

---

## Approach

**Nodemailer** provides the SMTP transport (configurable; dev uses Mailhog / in-memory
transport, test uses `jsonTransport`). Notification functions are called **directly**
from the service layer immediately after the triggering DB write succeeds — no queue,
no worker process. Each call is wrapped in its own `try/catch`; a failure is logged and
dropped (no retry/backoff, since there's no queue to retry from).

Two notification functions:
1. `sendNewTicketEmail()` — email creator + admin on ticket creation.
2. `sendCommentNotificationEmail()` — email creator + current assignee + admin (excluding comment author) on new comment.

### Packages

| Package | Type | Purpose |
|---------|------|---------|
| `nodemailer` | dep | SMTP email transport |
| `@types/nodemailer` | devDep | TypeScript types |

`bullmq` is currently installed but is being removed as part of this decision (see
Cleanup below) — it is not used by anything once Phase 8 cleanup lands.

### Files

```
src/
  jobs/
    mailer.ts             ← nodemailer transport factory (SMTP vs. captured)
    notifications.ts      ← sendNewTicketEmail(), sendCommentNotificationEmail() — direct calls, no queue
  types/
    jobs.ts               ← TypeScript interfaces for notification payloads (NewTicketJobData, CommentNotificationJobData only — AutoCloseJobData removed)
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

The transport is created once and reused. In tests, `jsonTransport: true` captures sent
mail without sending; assert on the captured message.

### `src/jobs/notifications.ts`

```ts
export async function sendNewTicketEmail(data: NewTicketJobData): Promise<void> {
  try {
    // Resolve creator + admin emails, de-duplicate, send via transporter
  } catch (err) {
    console.error('[Notify] Failed to send new-ticket email:', (err as Error).message);
    // never re-throw — NFR-8
  }
}

export async function sendCommentNotificationEmail(data: CommentNotificationJobData): Promise<void> {
  try {
    // Resolve creator/assignee/admin emails, exclude commentAuthorId, de-duplicate, send
  } catch (err) {
    console.error('[Notify] Failed to send comment-notification email:', (err as Error).message);
    // never re-throw — NFR-8
  }
}
```

Both functions are called with `await` immediately after the triggering write, but the
`try/catch` inside each function means a failure is swallowed there — it never
propagates back to the controller/response path.

### Integration Points

**`ticket.service.createTicket()`** — after the ticket insert succeeds:
```ts
await sendNewTicketEmail({ ticketId, ticketTitle, priority, creatorId, adminId });
```

**`comment.service.addComment()`** — after the comment insert succeeds:
```ts
await sendCommentNotificationEmail(notificationPayload);
```

> These replace the previous `emailQueue.add('new-ticket', …)` /
> `emailQueue.add('comment-notification', …)` calls. `comment.service.ts` currently
> still calls `emailQueue.add()` (pre-dating this decision) — replacing it is part of
> "Next Steps" below.

### Environment Variables

| Variable | Default | Notes |
|----------|---------|-------|
| `SMTP_HOST` | `localhost` | SMTP relay |
| `SMTP_PORT` | `1025` | 1025 = Mailhog dev |
| `SMTP_SECURE` | `false` | `true` for TLS |
| `SMTP_USER` | _(empty)_ | |
| `SMTP_PASS` | _(empty)_ | |
| `SMTP_FROM` | `noreply@ttn.com` | Sender address |

### Testing (TEST-7)

Use `jsonTransport: true` nodemailer transport in `NODE_ENV=test`. Call
`sendNewTicketEmail()` / `sendCommentNotificationEmail()` directly and assert on the
captured message:
- `sendNewTicketEmail`: recipients are the de-duplicated creator + admin set.
- `sendCommentNotificationEmail`: excludes the comment author; correct recipient set for all role combinations.

---

## Cleanup — Dead Code From the Removed BullMQ/Auto-Close Design

The following already exists in the codebase from before this decision and needs to be
removed (tracked in `task.md` Phase 7/Phase 8):

- `src/config/queue.ts` — BullMQ `ConnectionOptions` singleton. No longer needed once nothing uses BullMQ.
- `src/jobs/queues.ts` — exports `emailQueue` and `autoCloseQueue`. Delete entirely.
- `comment.service.ts`'s `addComment()`:
  - `emailQueue.add('comment-notification', …)` call → replace with direct `sendCommentNotificationEmail()`.
  - `autoCloseQueue.add('auto-close', …)` (assignee-comment scheduling) and `autoCloseQueue.getJob(...)`/`.remove()` (creator-reply cancellation) → remove entirely, no replacement (auto-close is out of scope, not just re-implemented differently).
- `src/modules/tickets/ticket.service.ts`'s `systemCloseTicket()` — implemented the removed SM-6 system-only transition; no longer reachable by anything once the auto-close scheduling calls above are removed. Delete.
- `src/types/jobs.ts` — remove `AutoCloseJobData`; keep `NewTicketJobData` and `CommentNotificationJobData` (retarget them as plain function-argument types, not queue job payloads).
- `bullmq` dependency in `package.json` — remove once all of the above lands and nothing else references it.
- Config: `AUTO_CLOSE_DELAY_MS` / `QUEUE_AUTO_CLOSE_DELAY_MS` / queue concurrency-attempts-backoff env vars — remove from `src/config/index.ts` and `.sample.env` if unused elsewhere.

## Risks

- **Partial cleanup risk:** if the `comment.service.ts` queue calls are removed before
  `sendCommentNotificationEmail()` is wired in, comment notifications would silently
  stop firing. Land the direct-call integration and the cleanup removal together (or
  cleanup immediately after) rather than leaving a gap.
- **SMTP unavailable:** direct email send fails, is logged, and is dropped — no retry.
  Core ticket/comment APIs are unaffected (NFR-11).

## Next Steps

- [ ] `npm install nodemailer @types/nodemailer`
- [ ] Add SMTP config to `src/config/index.ts` and `.sample.env`
- [ ] Create `src/jobs/mailer.ts`
- [ ] Create `src/jobs/notifications.ts` (`sendNewTicketEmail`, `sendCommentNotificationEmail`)
- [ ] Call `sendNewTicketEmail()` directly in `ticket.service.createTicket()`
- [ ] Replace the existing `emailQueue.add('comment-notification', …)` call in `comment.service.addComment()` with a direct `sendCommentNotificationEmail()` call
- [ ] Perform the Cleanup items above (remove auto-close/BullMQ dead code)
- [ ] Unit tests: email capture (TEST-7)
