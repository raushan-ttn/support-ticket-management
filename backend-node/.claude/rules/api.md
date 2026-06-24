# API Design Rules

## URL Structure
- Base: `/api/v1/{resource}` — plural nouns, kebab-case, no verbs
- Health check: `GET /health` (outside versioned prefix)
- Nested: `GET /api/v1/tickets/:id/comments`

## HTTP Methods
| Operation | Method | Success code |
|-----------|--------|-------------|
| List (+ query filters) | `GET /` | 200 |
| Get single | `GET /:id` | 200 / 404 |
| Create | `POST /` | 201 |
| Full replace | `PUT /:id` | 200 |
| Partial update | `PATCH /:id` | 200 |
| Delete | `DELETE /:id` | 204 (no body) |

## Response Envelope (fixed — never deviate)
```
Success: { "success": true,  "data": <payload|null|[]> }
Error:   { "success": false, "message": "<string>" }
```
Always use `success(res, data, code?)` / `error(res, message, code?)` from `src/utils/response.ts`.

## Status Codes
| Scenario | Code |
|----------|------|
| Missing/invalid token | 401 |
| Insufficient role | 403 |
| Not found | 404 |
| Validation failure | 400 |
| Server error | 500 |

## Controller Pattern
```ts
export const getOne = async (req, res, next): Promise<void> => {
  try {
    const data = await service.findById(req.params.id);
    if (!data) { error(res, 'Not found', 404); return; }  // always return after error()
    success(res, data);
  } catch (err) { next(err); }                            // never res.json() in catch
};
```

## Query Filters (list endpoints)
`?status=open&priority=high&assignedTo=<uuid>&page=1&limit=20&sortBy=createdAt&order=desc`
- Keys: `camelCase` in URL
- Pagination: `page` (1-based), `limit` (default 20, max 100)

## Route File Pattern
```ts
router.get('/', controller.getAll);
router.post('/', authenticate, validateBody(schema), controller.createOne);
```
Auth + validation middleware applied at route level, not in controllers.

## Versioning
Never modify `v1` endpoints in a breaking way — add `v2` mounted alongside.

## Middleware Order in app.ts (fixed)
morgan → express.json → express.urlencoded → cookieParser → routes → **errorHandler (last)**
