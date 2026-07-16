# AI Prompts — Debugging

> Same caveat as `planning.md` — no verbatim transcript exists. Template below is from
> `tool-workflow.md` §8, the real pattern behind the entries in `debugging-notes.md`.

## Debugging prompt

```
Debug this error in the tickets module.

Error:
[paste stack trace — redact emails and IDs]

File: src/modules/tickets/ticket.controller.ts

Context: CLAUDE.md Non-Negotiables apply.
What is the root cause and the minimal fix?
```

## Fix-loop follow-up (used after every failed validation)

```
Fix these errors. Minimal change only. Follow CLAUDE.md Non-Negotiables.
[paste errors]
```

## Common issues this pattern actually caught (`tool-workflow.md` §8)

| Symptom | Typical root cause |
|---|---|
| `Cannot set headers after they are sent` | Missing `return` after `error()` |
| `500` with raw JSON in response | `res.status(500).json()` in catch instead of `next(err)` |
| SQL syntax error at runtime | String interpolation instead of `$N` params |
| `undefined` in query result | `SELECT *` column name mismatch |
| Auth failure on protected route | Missing `authenticate` middleware or wrong JWT strategy |
| `409` never returned on bad transition | State machine check missing `FOR UPDATE` lock |
| `storage_key` visible in API response | Attachment service returning full row instead of safe columns |

Real, specific instances of these (with dates and root cause) are logged in `debugging-notes.md`
— this file documents the *prompting pattern*, that file documents the *actual findings*.

## Related Files
- `tool-workflow.md` §8 — full debugging section
- `debugging-notes.md` — dated log of real bugs found and fixed this way
