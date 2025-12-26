# @maroonedsoftware/errors

A comprehensive error handling library for HTTP APIs with built-in support for PostgreSQL error mapping and class-level error decorators.

## Installation

```bash
pnpm add @maroonedsoftware/errors
```

## Features

- **HttpError** — Fluent HTTP error class with support for status codes, headers, details, and error chaining
- **OnError** — Class decorator for automatic error handling on all methods
- **PostgresErrorHandler** — Maps PostgreSQL error codes to appropriate HTTP errors
- **Type-safe** — Full TypeScript support with inferred status messages

## Usage

### HttpError

Create HTTP errors with fluent method chaining:

```ts
import { HttpError, httpError, unauthorizedError } from '@maroonedsoftware/errors';

// Using the factory function
throw httpError(404);

// With custom message
throw httpError(400, 'Validation failed');

// With error details (great for form validation)
throw httpError(400).withErrors({
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
throw httpError(409).withErrors({ username: 'Already taken' }).withCause(dbError).withInternalDetails({ attemptedUsername: 'john_doe' });
```

### Type Guard

Check if an error is an HttpError:

```ts
import { IsHttpError } from '@maroonedsoftware/errors';

try {
  await someOperation();
} catch (error) {
  if (IsHttpError(error)) {
    console.log(error.statusCode); // Typed access
    console.log(error.details);
  }
}
```

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
  // 23502, 22P02, 22003, 23514 (validation) → 400 Bad Request
  // 40000, 40001, 40002 (transaction rollback) → 500 Internal Server Error
  // 40P01 (deadlock) → 500 Internal Server Error
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

### HttpError

| Property          | Type                      | Description                               |
| ----------------- | ------------------------- | ----------------------------------------- |
| `statusCode`      | `HttpStatusCodes`         | The HTTP status code                      |
| `message`         | `string`                  | Error message                             |
| `details`         | `Record<string, unknown>` | Validation/error details for response     |
| `headers`         | `Record<string, string>`  | HTTP headers to include in response       |
| `cause`           | `Error`                   | Underlying error (for error chaining)     |
| `internalDetails` | `Record<string, unknown>` | Internal debugging info (not for clients) |

### Methods

| Method                         | Returns     | Description                 |
| ------------------------------ | ----------- | --------------------------- |
| `withErrors(errors)`           | `HttpError` | Add error details           |
| `withHeaders(headers)`         | `HttpError` | Add response headers        |
| `addHeader(key, value)`        | `HttpError` | Add a single header         |
| `withCause(error)`             | `HttpError` | Set the underlying cause    |
| `withInternalDetails(details)` | `HttpError` | Add internal debugging info |

## License

MIT
