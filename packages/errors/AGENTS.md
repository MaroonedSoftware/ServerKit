# AGENTS.md — @maroonedsoftware/errors

Machine-oriented guide for AI agents. Human prose and long-form examples live in [README.md](./README.md).
Repo-wide conventions live in the [root AGENTS.md](../../AGENTS.md).

## Purpose

The error vocabulary the rest of ServerKit throws and renders. `ServerkitError` is a native `Error`
with three optional, response-shaping fields (`details`, `cause`, `internalDetails`) and fluent
setters for each; `HttpError` extends it with a status code and response headers. Two class
decorators (`OnError`, `OnPostgresError`) wrap every method on a class so failures are mapped at
one place instead of at every call site.

Reach for this whenever you throw. Do **not** reach for `HttpError` in code with no HTTP request
behind it — job runners, event subscribers, and domain services should throw a `ServerkitError`
subclass, so the failure carries structured detail without pretending to be a status code.

## Install

```bash
pnpm add @maroonedsoftware/errors
```

No required peers, no runtime dependencies. This package is L0 and must stay that way.

## Position in the graph

- **Depends on:** nothing internal, and nothing external.
- **Depended on by:** nearly everything — `appconfig`, `authentication`, `cache`, `comms`,
  `discord`, `encryption`, `jobbroker`, `koa`, `kysely`, `mcp`, `multipart`, `policies`, `scim`,
  `slack`, `storage`, `telegram`, `whatsapp`, `zod`.
- **Subpath exports:** none. Everything ships from the root barrel.

## API surface

| Export                               | Kind            | Shape                                                                        | Notes                                                                                                        |
| ------------------------------------ | --------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `ServerkitError`                     | class           | `new ServerkitError(message: string, options?: { cause?: unknown })`         | Extends `Error`. Fields: `details?`, `cause?`, `internalDetails?`. Restores the prototype via `new.target`.  |
| `ServerkitError#withDetails`         | method          | `(details: Record<string, unknown>) => this`                                 | Chainable. Rendered in the response body.                                                                    |
| `ServerkitError#withCause`           | method          | `(cause: Error) => this`                                                     | Chainable. Never rendered to the client.                                                                     |
| `ServerkitError#withInternalDetails` | method          | `(internalDetails: Record<string, unknown>) => this`                         | Chainable. Logged, never rendered to the client.                                                             |
| `IsServerkitError`                   | type guard      | `(error: unknown) => error is ServerkitError`                                | True for every subclass, including `HttpError`.                                                              |
| `HttpError`                          | class           | `new HttpError(statusCode: HttpStatusCodes, message?: HttpStatusMessage<…>)` | Extends `ServerkitError`. Adds `statusCode` (readonly) and `headers?`. Defaults the message from the status. |
| `HttpError#withHeaders`              | method          | `(headers: Record<string, string>) => HttpError`                             | Chainable. **Replaces** the whole header map.                                                                |
| `HttpError#addHeader`                | method          | `(key: string, value: string) => HttpError`                                  | Chainable. Merges one header.                                                                                |
| `IsHttpError`                        | type guard      | `(error: unknown) => error is HttpError`                                     | What `errorMiddleware` uses to decide the status code.                                                       |
| `httpError`                          | factory         | `(statusCode, message?) => HttpError`                                        | Preferred over `new HttpError(...)`; infers the message type from the status.                                |
| `unauthorizedError`                  | factory         | `(error: string) => HttpError`                                               | `httpError(401)` with `WWW-Authenticate` set to `error`.                                                     |
| `HttpStatusCodes`                    | type            | `keyof typeof HttpStatusMap` — the 4xx/5xx codes                             | Type only. 2xx and 3xx are deliberately absent.                                                              |
| `HttpStatusMessage<T>`               | type            | `(typeof HttpStatusMap)[T]`                                                  | The default message literal for a status.                                                                    |
| `OnError`                            | class decorator | `(handler: (error: Error) => void) => ClassDecorator`                        | Wraps every method, getter, and setter. Not the constructor, not plain properties.                           |
| `PostgresErrorHandler`               | function        | `(error: Error) => never`                                                    | Maps SQLSTATE to `HttpError`; rethrows non-Postgres errors unchanged.                                        |
| `OnPostgresError`                    | class decorator | `() => ClassDecorator`                                                       | Sugar for `OnError(PostgresErrorHandler)`.                                                                   |

**Not exported, despite appearing in the source:** `HttpStatusMap`, `isPostgresError`, and the
`PostgresError` interface are internal. Do not import them from a deep path — use
`HttpStatusCodes` for the type and let `PostgresErrorHandler` do the narrowing.

### SQLSTATE mapping used by `PostgresErrorHandler`

| SQLSTATE                                                | Status             | Internal details                  |
| ------------------------------------------------------- | ------------------ | --------------------------------- |
| `23505` unique violation, `23503` FK violation          | 409                | —                                 |
| `22000` `22003` `22004` `22023` `23502` `22P02` `23514` | 400                | —                                 |
| `40000` `40001` `40002`                                 | 500                | `{ msg: 'Transaction rollback' }` |
| `40P01` deadlock                                        | 500                | `{ msg: 'Deadlock' }`             |
| anything else with a 5-char SQLSTATE                    | 500                | —                                 |
| anything without one                                    | rethrown unchanged | —                                 |

Every mapped error carries the original as `cause`.

## Canonical usage

```typescript
import { httpError, ServerkitError, OnPostgresError, IsServerkitError } from '@maroonedsoftware/errors';

// HTTP-shaped failure inside a route
throw httpError(404).withDetails({ resource: 'invoice', id });

// Domain failure with no HTTP request behind it
class QuotaExceededError extends ServerkitError {}

throw new QuotaExceededError('Quota exceeded')
  .withDetails({ resource: 'invoices', limit: 100 }) // goes to the client
  .withInternalDetails({ accountId }); // logged only

// Repository-wide SQLSTATE mapping
@OnPostgresError()
export class InvoiceRepository {
  async create(data: NewInvoice) {
    return this.db.insertInto('invoices').values(data).returningAll().executeTakeFirstOrThrow();
  }
}

// Narrowing at a boundary
try {
  await work();
} catch (error) {
  if (IsServerkitError(error)) logger.error(error.message, { details: error.details, internal: error.internalDetails });
  throw error;
}
```

Worked examples live in [.claude/skills/error-handler/examples](../../.claude/skills/error-handler/examples).

## Rules for generated code

- Use the `httpError(n)` factory, not `new HttpError(n)`. The factory infers the message literal
  type from the status code, so a wrong custom message fails to compile.
- Only 4xx and 5xx codes exist in `HttpStatusCodes`. `httpError(200)` does not compile — that is
  intentional, not a gap to work around.
- Put client-safe context in `withDetails` and everything else in `withInternalDetails`. If you
  are unsure which a field is, it is internal.
- `withCause` takes an `Error`, not `unknown`. Narrow first rather than casting.
- Prefer `addHeader` over `withHeaders` when adding a single header to an error that may already
  have some — `withHeaders` replaces the map wholesale.
- Subclass `ServerkitError` for domain errors instead of throwing bare `Error`. The subclass needs
  no body; the prototype fix in the base constructor already gives it correct `instanceof`.
- Use `unauthorizedError(challenge)` rather than hand-assembling a 401 with a `WWW-Authenticate`
  header.
- Never import from `@maroonedsoftware/errors/dist/...`. There are no subpath exports.

## Gotchas

- **A plain `Error` loses its details.** `errorMiddleware` in `@maroonedsoftware/koa` renders a
  bare `ServerkitError` as a 500 **with** its `details`; a plain `Error` gets a generic 500 with
  none. Throwing `new Error('...')` in a service silently drops everything the client could have
  been told.
- **`OnError` re-throws by default.** The handler runs and then the _original_ error is re-thrown.
  A handler that wants to substitute a different error must `throw` it — returning is not enough.
  That is exactly how `PostgresErrorHandler` works.
- **`OnError` only wraps what is on the prototype.** Methods, getters, and setters are wrapped;
  the constructor is not, and neither are arrow functions assigned as instance properties
  (`handle = async () => {}`), because those live on the instance. Write methods, not fields.
- **Not every `error.code` is a SQLSTATE.** `PostgresErrorHandler` narrows on `/^[0-9A-Z]{5}$/`
  specifically so Node errors like `ENOENT` and `EPERM` are re-thrown instead of becoming opaque
  500s. Do not loosen that check.
- **`Symbol.toStringTag` is set to `'Object'`** in the `ServerkitError` constructor. Structured
  loggers and serialisers that branch on `Object.prototype.toString.call(err)` will see
  `[object Object]`, not `[object Error]`. Branch on `IsServerkitError` instead.
- **The `OnPostgresError` JSDoc claims `23503` maps to 404.** The mapping table maps it to **409**.
  The table is the behaviour; the comment is stale.

## Working inside this package

```
src/
  serverkit.error.ts          ServerkitError, IsServerkitError
  on.error.decorator.ts       OnError and its descriptor wrapper
  http/
    http.error.ts             HttpError, IsHttpError, httpError, unauthorizedError, status types
    http.status.map.ts        HttpStatusMap (internal — the 4xx/5xx table)
  postgres/
    postgres.error.handler.ts PostgresErrorHandler, isPostgresError (internal), the SQLSTATE map
    postgres.error.decorator.ts  OnPostgresError
```

Tests are in `tests/`, mirroring `src/` with a `.test.ts` suffix.

Invariants a change must not break:

- **Zero dependencies, internal or external.** This is the package every other one imports; a
  dependency added here lands in every downstream install.
- The prototype restoration in the `ServerkitError` constructor uses `new.target.prototype`, so
  subclasses get correct `instanceof` without repeating it. Do not replace it with a hard-coded
  `ServerkitError.prototype`.
- `HttpStatusCodes` is derived from `HttpStatusMap`. Adding a status means adding it to that map;
  do not widen the type by hand.
- Adding an export means updating `src/index.ts`, the README feature list, and the API surface
  table above.

User-visible changes need a changeset in `.changeset/`.
