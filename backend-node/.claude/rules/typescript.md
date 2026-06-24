# TypeScript Rules

## Compiler (tsconfig.json)
- `strict: true` — never disable or cast around it
- `target: ES2020`, `module: commonjs`, `esModuleInterop: true`
- `sourceMap: true` — never remove
- Compiled output always in `dist/`

## Types
- Annotate function return types when not trivially inferred; controllers always `Promise<void>`
- Use `interface` for object shapes; `type` for unions/intersections only
- Name interfaces after what they describe: `RegisterPayload`, `UserRow` — not `IRegister`
- No `any` — ESLint warns; treat as error. Use `unknown` + type guards instead
- Guard `rowCount` from pg: `if (result.rowCount && result.rowCount > 0)`
- Prefer optional chaining over non-null assertion: `addr?.port` not `addr!.port`

## Exports
| Layer | Style |
|-------|-------|
| Router, App, Middleware, Config | `export default` |
| Controllers, Services, Utils, DB helpers | Named exports |

Never mix named and default in the same file.

## Async
- All I/O is `async/await` — no callbacks, no `.then()` chains
- Never fire-and-forget; always `await` Promises
- Controllers return `Promise<void>`; response is sent as a side effect

## Imports
- ES `import` syntax only — never `require()` in `.ts` files
- Group: Node built-ins → third-party → internal (blank line between groups)
- Use `* as` for service/controller imports: `import * as authService from './auth.service'`
- Use named destructuring for types and utilities: `import { Request, Response } from 'express'`

## Generics
Use on DB queries to carry row types: `query<UserRow>('SELECT ...', [id])`

## Unused Parameters
Prefix with `_`: `_req`, `_next`, `_filters`
