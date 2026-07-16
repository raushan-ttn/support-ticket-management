# AI Prompts — Testing

> Same caveat as `planning.md` — no verbatim transcript exists. Templates below are the real
> ones documented in `tool-workflow.md` §7, which produced the actual 187-test suite verified
> in `test-results.md`.

## Unit test prompt

```
Write Jest unit tests for src/modules/tickets/ticket.service.ts.
Mock query from src/config/postgres.ts with jest.mock.
Cover: createTicket (auto-assigns to admin, ignores client-supplied assignedTo),
transitionStatus (valid transition succeeds, invalid returns 409 with INVALID_STATUS_TRANSITION).
Follow .claude/rules/api-conventions.md (Testing section). Assert status code first, then envelope shape.
```

## Integration test prompt

```
Write Supertest integration tests for PATCH /api/v1/tickets/:id/status.
Use test DB ttn_stm_test (NODE_ENV=test).
Assert: 200 on valid transition (OPEN → IN_PROGRESS);
409 + { code: 'INVALID_STATUS_TRANSITION' } on invalid transition (OPEN → CLOSED);
401 on missing token; 403 when AGENT tries to transition a ticket they don't own.
```

## Notification test prompt (TEST-7)

```
Write tests for sendNewTicketEmail()/sendCommentNotificationEmail() using jsonTransport
(NODE_ENV=test captures sent mail) — direct function calls, no queue/worker.
Assert new-ticket send: sends to creator + admin, de-duplicated if same person.
Assert comment-notification send: excludes comment author from recipient set.
```

## Attachment test prompt (TEST-9)

```
Write Supertest tests for POST /api/v1/tickets/:id/attachments using local storage.
Assert: allowed MIME type accepted (201); disallowed type rejected (415);
oversize file rejected (400); caller without ticket access gets 403;
download streams correct bytes; delete restricted to uploader or admin.
```

## Related Files
- `tool-workflow.md` §7 — full testing section
- `test-strategy.md` / `.claude/plans/phase-9-tests.md` — the strategy these prompts implemented
- `test-results.md` — actual, current run output
