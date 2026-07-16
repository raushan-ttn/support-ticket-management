# Email Notifications

> **Status:** Implemented
> **Branch:** chore/remove-bullmq-modular-middleware (PR #17, merge commit `8d6a5ca`, 2026-07-08)
> **Date:** 2026-07-16
> **Requirements:** FR-10, FR-11, FR-11a, FR-11b, NFR-8, NFR-11, TS-7, TEST-7

---

## Overview

The email notification feature sends outbound emails on two events: ticket creation and new comments. On ticket creation (FR-10), the ticket's creator and the designated admin each receive a notification. On a new comment (FR-11), the ticket's creator, current assignee, and admin all receive a notification — with the comment's author always excluded to prevent self-notification. Recipients are de-duplicated before each send so that a user who fills more than one role (e.g. a creator who is also the admin) receives exactly one email.

The implementation is deliberately minimal: no job queue, no worker process, no retry logic. Each notification is dispatched as a direct `await` call from the service layer immediately after the triggering DB write commits. The entire call is wrapped in `try/catch` so that any failure — whether an SMTP outage or a DB error during recipient resolution — is logged and dropped without propagating to the HTTP response (NFR-8, NFR-11). This guarantees that a notification failure can never cause the originating `POST /api/v1/tickets` or `POST /api/v1/tickets/:id/comments` request to fail or slow down.

This feature was initially written with BullMQ queue infrastructure in place alongside the auto-close background job (formerly FR-12). On 2026-07-08, the auto-close feature was removed from scope (it required a Redis-backed delayed-job queue), and all BullMQ code was removed with it. Email notifications were re-implemented as a direct, synchronous-looking call at that point (PR #17). The queue cleanup is complete — no BullMQ code remains in the codebase. The "no queue" design decision and its trade-offs are detailed in the Background Jobs section below.

---

## Architecture

| File | Role |
|------|------|
| `src/jobs/mailer.ts` | Nodemailer transport singleton factory — returns `jsonTransport` under `NODE_ENV=test`, SMTP otherwise |
| `src/jobs/notifications.ts` | Two exported functions: `sendNewTicketEmail()` and `sendCommentNotificationEmail()`; private `resolveEmails()` helper |
| `src/types/jobs.ts` | Payload interfaces: `NewTicketJobData`, `CommentNotificationJobData` |
| `src/modules/tickets/ticket.service.ts` | Calls `sendNewTicketEmail()` inside `createTicket()` after the ticket INSERT |
| `src/modules/comments/comment.service.ts` | Calls `sendCommentNotificationEmail()` inside `addComment()` after the comment INSERT and cache invalidation |

There are no routes, controllers, or schemas specific to this feature — it is entirely service-layer logic with no HTTP surface of its own.

---

## Notification Functions

This feature exposes no API endpoints. The following describes the two exported functions, their signatures, trigger points, recipient logic, and error-handling contract.

---

### `sendNewTicketEmail(data: NewTicketJobData): Promise<void>`

**Defined in:** `src/jobs/notifications.ts`
**Triggered by:** `ticket.service.createTicket()` — after the ticket INSERT and attachment upload succeed, before the function returns.

**Payload type (`src/types/jobs.ts`):**

```ts
interface NewTicketJobData {
  ticketId: string;
  ticketTitle: string;
  creatorId: string;
  adminId: string;
}
```

**Recipient resolution:**

1. Combine `[creatorId, adminId]` into an array.
2. De-duplicate using `Array.from(new Set(...))` — handles the case where the ticket creator is also the admin.
3. Query `SELECT id, email FROM users WHERE id = ANY($1)` for the unique IDs.
4. If the resolved email list is empty, return immediately without calling `sendMail`.
5. Call `getTransport().sendMail({ from, to: emails.join(', '), subject, text })`.

**Email shape:**
- Subject: `New ticket: {ticketTitle}`
- Body: `A new ticket "{ticketTitle}" ({ticketId}) has been created.`
- From: `config.smtp.from` (default `no-reply@support.local`)

**Error handling:** The entire function body is enclosed in `try/catch`. Any error from the DB query or SMTP transport is caught, logged as `[Notify] Failed to send new-ticket email: {message}`, and swallowed. The function always resolves to `undefined` and never rejects. At the callsite in `ticket.service.ts`, the call is additionally wrapped in its own `try/catch` as a belt-and-suspenders measure making the fire-and-forget intent explicit.

**Callsite in `ticket.service.createTicket()`:**

```ts
try {
  await sendNewTicketEmail({
    ticketId,
    ticketTitle: dbRow.title,
    creatorId,
    adminId,
  });
} catch (emailErr) {
  console.error('[Notify] Failed to send new-ticket email:', (emailErr as Error).message);
}
```

---

### `sendCommentNotificationEmail(data: CommentNotificationJobData): Promise<void>`

**Defined in:** `src/jobs/notifications.ts`
**Triggered by:** `comment.service.addComment()` — after the comment INSERT, attachment upload, and `ticket:{ticketId}:comments` cache invalidation; after admin ID resolution.

**Payload type (`src/types/jobs.ts`):**

```ts
interface CommentNotificationJobData {
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
```

**Recipient resolution (FR-11, FR-11a):**

1. Build candidate list: `[creatorId, assigneeId, adminId]`.
2. Filter the list: keep only IDs that are non-empty **and** not equal to `commentAuthorId`. This single filter handles every role combination — a creator who comments is excluded, an admin who comments is excluded, an assignee who comments is excluded.
3. Pass the filtered IDs to `resolveEmails()`, which deduplicates via `Set` and queries `SELECT id, email FROM users WHERE id = ANY($1)`.
4. If the resolved email list is empty (e.g. all three IDs matched `commentAuthorId`), return immediately without calling `sendMail`.
5. Call `getTransport().sendMail(...)`.

**Email shape:**
- Subject: `New comment on ticket: {ticketTitle}`
- Body: the raw `commentMessage`. If `attachmentCount` is present and greater than zero, appends `\n\nAttachments ({attachmentCount}): {filename1}, {filename2}, ...` (FR-11b).
- From: `config.smtp.from`

**Admin ID resolution in caller:** `comment.service.addComment()` resolves the designated admin's UUID via a Redis-backed lookup. It first checks `admin:default` in Redis; on a cache miss it queries `SELECT id FROM users WHERE role = 'ADMIN' ORDER BY created_at ASC LIMIT 1` and caches the result with `config.redis.ttlSeconds`. The resolution block is wrapped in `try/catch` and logs failures with the prefix `[Queue]` (a legacy artifact from the BullMQ era — functional but cosmetically stale). If admin resolution fails, `adminId` remains an empty string, and the filter in step 2 above silently removes it from the candidate list.

**Assignee currency (FR-11a):** `addComment()` calls `getTicketById()` at the top of the function to authorize the caller. The returned `ticket` object carries the ticket's current `assignedTo` value, which is used directly in the email payload — no stale cache value is possible here because `getTicketById` always returns the current DB row.

**Error handling:** Same pattern as `sendNewTicketEmail` — full body in `try/catch`, failures logged as `[Notify] Failed to send comment-notification email: {message}`, never re-thrown (NFR-8).

---

### Transport Factory — `getTransport()` (`src/jobs/mailer.ts`)

`getTransport()` returns a Nodemailer `Transporter` singleton, creating it on first call:

```ts
transporter =
  config.env === 'test'
    ? nodemailer.createTransport({ jsonTransport: true })
    : nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        auth: config.smtp.user
          ? { user: config.smtp.user, pass: config.smtp.password }
          : undefined,
      });
```

Under `NODE_ENV=test`, `jsonTransport: true` causes Nodemailer to serialize each sent message to JSON without making any network connection, which allows test assertions on the `sendMail` arguments without an SMTP server. For all other environments, the transport uses the SMTP config from `src/config/index.ts`. The `auth` block is omitted entirely when `SMTP_USER` is not set, supporting anonymous SMTP relays (e.g. Mailhog for local development, which by default requires no credentials).

---

## Data Model Changes

No new tables, columns, indexes, or ENUM values are introduced by this feature. Both notification functions read email addresses from the existing `users` table using a standard parameterized query:

```sql
SELECT id, email FROM users WHERE id = ANY($1)
```

The `admin:default` cache entry written by `comment.service.addComment()` is a Redis string (not Postgres) and is not a schema change.

---

## RBAC

Not applicable at the notification-function level. Both functions are called from within service functions that have already enforced RBAC before reaching the notification callsite:

| Trigger | Upstream RBAC enforced by |
|---------|--------------------------|
| `sendNewTicketEmail` | `createTicket()` — any authenticated user (ADMIN or AGENT) may create a ticket |
| `sendCommentNotificationEmail` | `addComment()` → `getTicketById()` — caller must be within ticket scope; AGENT callers outside `assignedTo`/`createdBy` are rejected with `403` before the comment INSERT is attempted |

The notification functions themselves have no role-awareness and apply no access control. They are internal service helpers, not HTTP handlers.

---

## Caching

The notification functions themselves do not read from or write to Redis. The one cache interaction introduced by this feature is in `comment.service.addComment()`, which caches the resolved admin UUID to avoid a repeated DB lookup on every comment:

| Cache key | Content | TTL | Invalidated by |
|-----------|---------|-----|----------------|
| `admin:default` | Admin user UUID (`string`) | `config.redis.ttlSeconds` (default 3600s) | Nothing at runtime — admin identity is seeded, not changed via API |

If Redis is unavailable when resolving the admin ID, the `try/catch` in `addComment()` logs the error and leaves `adminId` as an empty string, which causes the admin to be silently omitted from the comment notification recipient list for that request. Core comment creation is unaffected.

---

## Background Jobs — No Queue

**There is deliberately no job queue in this codebase.** This section explains the decision and confirms the cleanup state.

### Decision history

The initial implementation (PR #16, branch `attachments_setup`) dispatched email notifications using BullMQ: `emailQueue.add('comment-notification', payload)`. This was coupled to an auto-close background job (`autoCloseQueue`) that would have closed stale tickets after 48 hours (FR-12, SM-6).

On **2026-07-08**, FR-12 and the auto-close job were removed from scope (see `requirements.md` §1.2 and §5.5). The auto-close feature required a Redis-backed BullMQ delayed-job queue and a separate worker process — adding operational complexity that was not justified. Because the BullMQ queue infrastructure was installed solely for auto-close and email, removing the auto-close feature made the entire queue layer unnecessary. Email notifications were simplified to direct synchronous calls at the same time (PR #17, branch `chore/remove-bullmq-modular-middleware`, merge commit `8d6a5ca`).

### Dead code confirmed removed (Phase 7/8 cleanup)

All of the following were removed as part of PR #17 and Phase 8 cleanup. None exist in the current codebase:

| Artifact | Status |
|----------|--------|
| `src/config/queue.ts` — BullMQ `ConnectionOptions` singleton | Deleted |
| `src/jobs/queues.ts` — `emailQueue` and `autoCloseQueue` exports | Deleted |
| `systemCloseTicket()` in `ticket.service.ts` — SM-6 system-only `{OPEN,IN_PROGRESS} → CLOSED` transition | Removed |
| `autoCloseQueue.add('auto-close', ...)` / `autoCloseQueue.getJob(...).remove()` in `comment.service.addComment()` | Removed |
| `AutoCloseJobData` in `src/types/jobs.ts` | Removed |
| `bullmq` package in `package.json` | Removed |
| `AUTO_CLOSE_DELAY_MS` config key in `src/config/index.ts` | Removed |

### Trade-offs

| Property | Direct-call (current) | Queue-based (removed) |
|----------|-----------------------|----------------------|
| Retry on SMTP failure | None — failed sends are permanently lost | Configurable exponential backoff |
| Operational complexity | None — no worker process | Requires a persistent worker process alongside the API |
| Observability | `console.error` log only | Queue dashboard, job state, retry count |
| Request latency impact | Minimal — awaited but SMTP errors are caught internally | None — send is fully decoupled |
| Correctness under crash | Email lost if the process crashes during `sendMail` | Email survives crashes (job persisted in Redis) |

The current implementation accepts best-effort delivery. Per NFR-11, this is acceptable — the requirements only mandate that SMTP failures never affect core ticket/comment API behavior.

For cross-reference: `documents/phase-9-tests.md §Background Jobs` confirms this architecture from the testing perspective.

---

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `SMTP_HOST` | `localhost` | SMTP relay hostname |
| `SMTP_PORT` | `1025` | SMTP port — 1025 is the Mailhog default for local development |
| `SMTP_SECURE` | `false` | Set to `true` to enable TLS (port 465) in production |
| `SMTP_USER` | _(empty)_ | SMTP auth username — omit for anonymous relay |
| `SMTP_PASSWORD` | _(empty)_ | SMTP auth password |
| `SMTP_FROM` | `no-reply@support.local` | Sender address in the `From:` header of all outbound emails |

No new environment variables were introduced beyond this SMTP block. The `NODE_ENV=test` path that activates `jsonTransport` is controlled by the existing `NODE_ENV` variable (see CLAUDE.md Environment Variables table).

---

## Testing

### How to run

```bash
# Run only the notification unit tests
npm test -- --testPathPattern="notifications"

# Run with coverage
npm run test:coverage
```

No test database or SMTP server is required. Both the Postgres `query` function and the `getTransport()` factory are mocked at the module level.

### Test coverage

| Test file | What it covers |
|-----------|----------------|
| `src/jobs/notifications.test.ts` | 100% unit coverage — mocks `query` from `src/config/postgres` and `getTransport` from `src/jobs/mailer`; asserts on `sendMail` call count and arguments |

### Key test scenarios

- **TEST-7 (`sendNewTicketEmail` — 5 cases):**
  - Sends to both creator and admin when they are distinct users; `to` field contains both addresses (FR-10)
  - De-duplicates when creator and admin are the same person — `to` contains exactly one address (FR-10)
  - Does not call `sendMail` when the DB query returns no rows (empty `users` result)
  - Resolves without throwing when `sendMail` rejects with an SMTP error — fire-and-forget (NFR-8)
  - Resolves without throwing when the DB `query` rejects — fire-and-forget (NFR-8)

- **TEST-7 (`sendCommentNotificationEmail` — 9 cases):**
  - Excludes the comment author when the author is the ticket creator (FR-11)
  - Excludes the comment author when the author is the assignee (FR-11)
  - Excludes the comment author when the author is the admin (FR-11)
  - Sends to all three (creator + assignee + admin) when the author is a fourth distinct user (FR-11)
  - Does not call `sendMail` or even query the DB when all three parties equal the comment author
  - Includes attachment count and filenames in the email body when `attachmentCount > 0` (FR-11b)
  - Omits the attachment section when `attachmentCount` is undefined
  - Resolves without throwing when `sendMail` rejects — fire-and-forget (NFR-8)
  - Resolves without throwing when the DB `query` rejects — fire-and-forget (NFR-8)

### Test infrastructure

Both mocks are declared at module scope before any imports, which is required by Jest's module-mock hoisting:

```ts
jest.mock('../config/postgres', () => ({ query: jest.fn() }));

const mockSendMail = jest.fn();
jest.mock('./mailer', () => ({
  getTransport: jest.fn(() => ({ sendMail: mockSendMail })),
}));
```

This approach validates the full recipient-set logic and error-swallowing behavior without a running Postgres instance or SMTP server. All mocks are cleared in `beforeEach` so test cases are independent.

---

## Known Limitations / Future Work

- **No retry mechanism.** A failed SMTP send at `sendMail` time is logged once and the email is permanently lost. There is no backoff, no dead-letter queue, and no re-send API. If reliable delivery is required in the future, a durable queue (BullMQ or similar) would need to be reintroduced, along with a worker process.

- **Attachment metadata not currently forwarded by `comment.service.addComment()`.** The `CommentNotificationJobData` interface supports `attachmentCount` and `attachmentFilenames` (optional), and `sendCommentNotificationEmail` renders them in the email body when present (FR-11b). However, `addComment()` does not currently populate those fields in the payload it passes. The unit tests (TEST-7) verify the function's handling of those fields correctly, but the fields are always `undefined` in practice. Wiring them up would require returning the uploaded attachment filenames from `uploadAttachments()` and passing them into the email payload in `addComment()`.

- **Admin recipient is always the first seeded ADMIN by `created_at`.** Both `createTicket()` and `addComment()` resolve the designated admin with `ORDER BY created_at ASC LIMIT 1`. If multiple admins are seeded, only the first receives notifications. The requirements note this as an open assumption (§12: "confirm whether all admins or only the designated one are notified").

- **`admin:default` cache is never explicitly invalidated.** If the first admin's user row is deleted or their email changes, the cached UUID will remain valid for up to one TTL period (default 3600s). Since user management is seed-only (DM-1) and there is no delete-user endpoint, this is low risk in the current implementation.

- **Stale `[Queue]` log prefix in `comment.service.addComment()`.** The admin-resolution failure log message reads `[Queue] Failed to resolve admin user:`. This is a legacy artifact from the BullMQ era and is cosmetically incorrect but functionally harmless. It can be renamed to `[Notify]` in a future cleanup.

- **No end-to-end integration test for the full email rendering path.** The `notifications.test.ts` suite mocks both the DB and the transport, validating recipient logic in isolation. An additional integration-level test that calls the notification functions against the real `ttn_stm_test` database with `jsonTransport` active would validate that the user email lookup returns correct rows and that the assembled `sendMail` arguments are correct end-to-end. This was deferred because the unit tests cover the logic that matters most.

- **Plain text only.** All notification emails use the Nodemailer `text` field. Rich HTML templating is out of scope per requirements §12.
