# @maroonedsoftware/errors

A comprehensive error handling library for HTTP APIs with built-in support for PostgreSQL error mapping and class-level error decorators.

## Installation

```bash
pnpm add @maroonedsoftware/errors
```

## Features

- **ServerkitError** — Base error class with `details`, `cause`, `internalDetails`, and chainable setters
- **HttpError** — `ServerkitError` subclass that adds an HTTP status code and response headers
- **OnError** — Class decorator for automatic error handling on all methods
- **PostgresErrorHandler** — Maps PostgreSQL error codes to appropriate HTTP errors
- **Type-safe** — Full TypeScript support with inferred status messages

## Usage

### ServerkitError

The base class for all ServerKit-aware errors. Use it directly when an error isn't HTTP-shaped (e.g. a domain rule violation in a worker), or extend it to build your own typed error hierarchy. The `errorMiddleware` in `@maroonedsoftware/koa` recognises `ServerkitError` and renders its `details` in the 500 response body — bare `Error` instances get a generic "Internal Server Error" with no details.

```ts
import { ServerkitError } from '@maroonedsoftware/errors';

throw new ServerkitError('Quota exceeded')
  .withDetails({ resource: 'invoices', limit: 100 })
  .withInternalDetails({ accountId: 'acct_42' });
```

To build your own:

```ts
class DomainError extends ServerkitError {}

throw new DomainError('Pricing rule violated').withDetails({ rule: 'min-margin' });
```

### HttpError

Create HTTP errors with fluent method chaining:

```ts
import { HttpError, httpError, unauthorizedError } from '@maroonedsoftware/errors';

// Using the factory function
throw httpError(404);

// With the default status message (must match the status code's mapped message)
throw httpError(400, 'Bad Request');

// With error details
throw httpError(400).withDetails({
  email: 'Invalid email format',
  password: 'Must be at least 8 characters',
});

// With response headers
throw httpError(401).withHeaders({
  'WWW-Authenticate': 'Bearer realm="api"',
});

// Shorthand for unauthorized with WWW-Authenticate header
throw unauthorizedError('Bearer realm="api"');

// With error chaining
throw httpError(500).withCause(originalError);

// With internal details (for logging, not exposed to clients)
throw httpError(500).withInternalDetails({
  userId: 123,
  requestId: 'abc-123',
});

// Combine multiple options
throw httpError(409).withDetails({ username: 'Already taken' }).withCause(dbError).withInternalDetails({ attemptedUsername: 'john_doe' });
```

### Type Guards

Check if an error is an `HttpError` (subclass) or any `ServerkitError`:

```ts
import { IsHttpError, IsServerkitError } from '@maroonedsoftware/errors';

try {
  await someOperation();
} catch (error) {
  if (IsHttpError(error)) {
    console.log(error.statusCode); // typed
    console.log(error.details);
  } else if (IsServerkitError(error)) {
    // Any non-HTTP ServerkitError — still has details/cause/internalDetails.
    console.log(error.details);
  }
}
```

`IsServerkitError` is true for `HttpError`, `KmsError` (from `@maroonedsoftware/encryption`), and any subclass you define.

### OnError Decorator

Automatically wrap all class methods with error handling:

```ts
import { OnError, httpError } from '@maroonedsoftware/errors';

@OnError(error => {
  console.error('Error caught:', error);
  throw httpError(500).withCause(error);
})
class MyService {
  async doSomething() {
    // If this throws, it will be caught and handled
    throw new Error('Something went wrong');
  }

  get computedValue() {
    // Getters are also wrapped
    throw new Error('Getter failed');
  }
}
```

### PostgreSQL Error Handling

Convert PostgreSQL errors to appropriate HTTP errors:

```ts
import { PostgresErrorHandler, OnPostgresError } from '@maroonedsoftware/errors';

// Manual usage
try {
  await db.insert(users).values({ email: 'duplicate@example.com' });
} catch (error) {
  PostgresErrorHandler(error);
  // 23505 (unique violation) → 409 Conflict
  // 23503 (foreign key violation) → 404 Not Found
  // 22000, 22003, 22004, 22023, 23502, 22P02, 23514 (validation) → 400 Bad Request
  // 40000, 40001, 40002 (transaction rollback) → 500 Internal Server Error
  // 40P01 (deadlock) → 500 Internal Server Error
  // Unknown PostgreSQL codes → 500 Internal Server Error
  // Non-PostgreSQL errors are re-thrown as-is
}

// Using the decorator (recommended)
@OnPostgresError()
class UserRepository {
  async create(data: UserData) {
    return await db.insert(users).values(data);
  }

  async findById(id: number) {
    return await db.select().from(users).where(eq(users.id, id));
  }
}
```

## Supported HTTP Status Codes

All standard 4xx and 5xx status codes are supported with their default messages:

| Code | Message                                   |
| ---- | ----------------------------------------- |
| 400  | Bad Request                               |
| 401  | Unauthorized                              |
| 403  | Forbidden                                 |
| 404  | Not Found                                 |
| 409  | Conflict                                  |
| 422  | Unprocessable Entity                      |
| 429  | Too Many Requests                         |
| 500  | Internal Server Error                     |
| 502  | Bad Gateway                               |
| 503  | Service Unavailable                       |
| ...  | [and more](./src/http/http.status.map.ts) |

## API Reference

### ServerkitError

Base class for all ServerKit errors.

| Property          | Type                      | Description                                              |
| ----------------- | ------------------------- | -------------------------------------------------------- |
| `message`         | `string`                  | Error message                                            |
| `details`         | `Record<string, unknown>` | Response-shaped details (rendered by `errorMiddleware`)  |
| `cause`           | `Error`                   | Underlying error for chaining                            |
| `internalDetails` | `Record<string, unknown>` | Internal debugging info (never rendered to the response) |

Methods (all return the instance for chaining):

| Method                         | Description                                  |
| ------------------------------ | -------------------------------------------- |
| `withDetails(details)`         | Set response-shaped details                  |
| `withCause(error)`             | Set the underlying cause                     |
| `withInternalDetails(details)` | Set internal debug info (not exposed to API) |

`IsServerkitError(value)` — type guard. Returns `true` for `ServerkitError` and any subclass (including `HttpError` and `KmsError`).

### HttpError

Extends `ServerkitError`. Inherits all of the above and adds:

| Property      | Type                     | Description                         |
| ------------- | ------------------------ | ----------------------------------- |
| `statusCode`  | `HttpStatusCodes`        | The HTTP status code                |
| `headers`     | `Record<string, string>` | HTTP headers to include in response |

| Method                          | Description                                 |
| ------------------------------- | ------------------------------------------- |
| `withHeaders(headers)`          | Replace the headers map                     |
| `addHeader(key, value)`         | Set or overwrite a single header (chainable)|

`IsHttpError(value)` — type guard for `HttpError` instances specifically.

## License

MIT
