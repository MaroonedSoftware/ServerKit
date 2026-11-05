---
user-invocable: true
allowed-tools: Read, Write, Edit, Grep, Glob
description: Add an error-mapping class decorator from @maroonedsoftware/errors to a service or repository, @OnError for domain errors or @OnPostgresError for SQLSTATE codes
argument-hint: <file> <decorator-type>
---

# /error-handler - Add Error Handling Decorator

Add error handling decorators to a class for automatic error conversion.

## Arguments

1. `file` (required): File containing the class to decorate
2. `decorator-type` (required): Either `http` or `postgres`
   - `http`: Adds @OnError decorator for general error handling
   - `postgres`: Adds @OnPostgresError decorator for PostgreSQL error mapping

## What This Skill Does

1. Reads the target file
2. Adds appropriate imports
3. Adds decorator to the class
4. For @OnError: includes a handler that converts known errors to HttpError
5. For @OnPostgresError: adds decorator with automatic mapping
6. Preserves existing class code

## Examples

Add PostgreSQL error handling:
```
/error-handler src/services/user.service.ts postgres
```

Add HTTP error handling:
```
/error-handler src/services/auth.service.ts http
```

## Implementation Patterns

### @OnPostgresError Decorator

Automatically maps errors with a SQLSTATE code to HTTP errors:

```typescript
import { OnPostgresError } from '@maroonedsoftware/errors';

@OnPostgresError()
export class UserRepository {
  // Unique constraint violation (23505) → 409 Conflict
  async create(data: UserData) { }

  // Foreign key violation (23503) → 409 Conflict
  async update(id: string, data: UserData) { }

  // Not null violation (23502) → 400 Bad Request
  async save(data: UserData) { }
}
```

The full mapping is in `packages/errors/src/postgres/postgres.error.handler.ts`. Check violations and
bad data (23514, 22000, 22003, 22004, 22023, 22P02) are 400. Rollbacks and deadlocks (40000, 40001,
40002, 40P01) are 500 with internal details for the logs. Any other SQLSTATE is 500. An error
without a SQLSTATE code is re-thrown unchanged.

### @OnError Decorator

Wraps all methods with custom error handling:

```typescript
import { OnError, httpError } from '@maroonedsoftware/errors';

@OnError(error => {
  // Throw a replacement to change what the caller sees.
  if (error instanceof ValidationError) {
    throw httpError(400).withDetails({ message: error.message }).withCause(error);
  }
  // Returning re-throws the original error, which renders as a 500.
})
export class UserService {
  async createUser(data: UserData) { }
  async updateUser(id: string, data: UserData) { }
}
```

## Instructions for Claude

When this skill is invoked:

1. **Parse arguments:**
   - Extract file path and decorator type
   - Validate decorator type is 'http' or 'postgres'
   - Validate file exists

2. **Read the file:**
   - Use Read tool to get file contents
   - Find the class to decorate (first exported class)
   - Check if decorator already exists

3. **Determine imports needed:**
   - For 'postgres': import OnPostgresError from '@maroonedsoftware/errors'
   - For 'http': import OnError and httpError from '@maroonedsoftware/errors'
   - Check if imports already exist to avoid duplicates

4. **Add imports:**
   - If imports don't exist, add them at the top of the file
   - Group with other imports from '@maroonedsoftware/errors'

5. **Add decorator:**
   - For @OnPostgresError: Add `@OnPostgresError()` above the class
   - For @OnError: Add `@OnError(error => { ... })` with error handler above the class
   - Preserve any existing decorators (like @Injectable)

6. **Error handler for @OnError:**
   - Create a handler that checks error types, preferring `instanceof` on `ServerkitError` subclasses over comparing `error.name`
   - Convert known errors to appropriate HTTP status codes
   - Use `.withCause(error)` to preserve the original error
   - Leave unknown errors alone by returning. The decorator re-throws the original, and `errorMiddleware` or `errorPlugin` renders a plain `Error` as a generic 500 with no details
   - Put anything that must be logged but not sent to a client in `.withInternalDetails(...)`, not `.withDetails(...)`
   - The handler cannot swallow an error: a handler that returns still ends with the original being re-thrown

7. **Know what the decorator does not cover:**
   - It wraps methods and accessors declared on the class itself. It does not wrap inherited methods, static methods, or the constructor
   - A rejection is caught only if the method returns a native `Promise`, which an `async` method always does. A non-async method that returns a Kysely builder, or any other thenable, is not covered

8. **Use Edit tool:**
   - Find the class declaration line
   - Add the decorator on the line before the class
   - Ensure proper formatting and indentation

9. **Confirm to user:**
   - Show which file was modified
   - Show which decorator was added
   - Show the class that was decorated
   - Explain what error handling is now enabled
