# API Contract — RBAC Reference

This file is **not** the endpoint reference — that's generated from code and always current:

- Interactive: `GET /api-docs` (Swagger UI)
- Raw schema: `GET /api-docs.json` (OpenAPI 3.0.3, for client SDK generation)
- Source: `@openapi` JSDoc blocks in `src/app.ts` and `src/modules/**/*.routes.ts`, defined in `src/config/swagger.ts`

What Swagger doesn't express well is *who* can call each endpoint and *how the response is scoped* — that's business logic living in each service, not route middleware. This file is that missing cross-reference. See `.claude/rules/security.md` for the role-by-action summary; this is the same rule set mapped to concrete routes and enforcement points.

Two roles only: `ADMIN` > `AGENT` (see `security.md` RBAC-1 — no `user`/`customer` role).

## Endpoint → enforcement map

| Endpoint | Route guard | Service-layer scoping | Enforced in |
|---|---|---|---|
| `POST /api/v1/auth/login` | none (public) | — | `auth.controller.ts` |
| `GET /api/v1/auth/me` | `authenticate` | — | `auth.controller.ts` |
| `POST /api/v1/tickets` | `authenticate` | Both roles may create | `ticket.service.ts` |
| `GET /api/v1/tickets` | `authenticate` | AGENT: `WHERE assigned_to = caller OR created_by = caller` in SQL (never filtered in-memory). ADMIN: unfiltered | `ticket.service.ts:202` |
| `GET /api/v1/tickets/:id` | `authenticate` | AGENT gets `403 FORBIDDEN` unless `assignedTo === caller \|\| createdBy === caller` | `ticket.service.ts:288` |
| `PATCH /api/v1/tickets/:id` | `authenticate` | AGENT gets `403` outside the same assigned/created scope | `ticket.service.ts:320` |
| `PATCH /api/v1/tickets/:id/status` | `authenticate` | AGENT gets `403` unless the ticket is assigned to them (ADMIN: any ticket). Transition itself validated against the state machine → `409 INVALID_STATUS_TRANSITION` | `ticket.service.ts:270` |
| `POST /api/v1/tickets/:id/assign` | `authenticate` + `requireRole('ADMIN')` | Route-level only — AGENT never reaches the controller | `ticket.routes.ts:301` |
| `POST /api/v1/tickets/:ticketId/comments` | `authenticate` | Scope gate on parent ticket: `404` if ticket missing, `403` if caller (AGENT) out of scope | `comment.service.ts:165` |
| `GET /api/v1/tickets/:ticketId/comments` | `authenticate` | Same scope gate as above | `comment.service.ts:165` |
| `GET /api/v1/tickets/:ticketId/comments/:commentId` | `authenticate` | Same scope gate, plus `404` if `commentId` doesn't belong to `ticketId` (`INVALID_COMMENT_REFERENCE`) | `comment.service.ts:236` |
| `GET /api/v1/tickets/:ticketId/attachments/:attachmentId/download` | `authenticate` | Scope gate on parent ticket (`403`/`404`) — same rule as comments | `attachment.service.ts:210` |
| `DELETE /api/v1/tickets/:ticketId/attachments/:attachmentId` | `authenticate` | Scope gate on parent ticket, **then** `403` unless `callerRole === 'ADMIN' \|\| row.uploadedBy === callerId` | `attachment.service.ts:249` |

## Pattern

Every scoped endpoint follows the same shape: `authenticate` at the route only proves *who*; every *what-can-they-see-or-touch* check lives in the service, always as a SQL `WHERE` clause (list endpoints) or a post-fetch `callerRole`/`callerId` comparison (single-resource endpoints) — never as an in-memory filter over a full result set. This mirrors the Enforcement pattern in `.claude/rules/security.md`.

## Keeping this current

Update the table when a route's guard middleware changes or a service adds/removes a scope check — not when a request/response *shape* changes (that's Swagger's job, regenerated from `@openapi` blocks on every server start).
