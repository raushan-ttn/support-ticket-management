# UI Flow

**Out of scope for this repository.**

`.claude/requirements.md` §1.2 (Out of Scope) is explicit: *"Frontend application, components,
and UI error rendering"* are not part of this backend's requirements — the frontend is treated
purely as a consumer of the API contracts defined in `.claude/requirements.md` §5.

## What exists instead

- A Next.js frontend was scaffolded in this monorepo early on (PR #12, `feat(fe): Next.js
  frontend setup with tickets UI`, 2026-06-30) and briefly configured for Cursor AI
  (PR #13, 2026-06-30).
- It was subsequently **removed from this repo** — commit `471adb6 remove fe in separate repo` —
  and now lives in its own repository, outside the scope of `backend-node`.

There is no UI flow documentation to derive here because there is no frontend code in this repo
to trace flows through. If a UI flow document is required for the assessment, it would need to
be written from the separate frontend repo, not this one — out of scope for the work done here.

## Related Files
- `.claude/requirements.md` §1.2 — explicit scope boundary
- `api-contract.md` — what the frontend (or any client) is actually authorized to call
- Generated Swagger (`GET /api-docs`) — the full request/response contract a UI would consume
