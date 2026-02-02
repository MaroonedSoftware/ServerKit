---
user-invocable: true
allowed-tools: Read, Write, Edit, Grep, Glob
description: Add error handling decorators (@OnError or @OnPostgresError) to a class
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
4. For @OnError: includes default error handler that converts to HttpError
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

Automatically maps PostgreSQL errors to appropriate HTTP errors:

```typescript
import { OnPostgresError } from '@maroonedsoftware/errors';

@OnPostgresError()
export class UserRepository {
  // Unique constraint violation → 409 Conflict
  async create(data: UserData) { }

  // Foreign key violation → 400 Bad Request
  async update(id: string, data: UserData) { }

  // Not null violation → 400 Bad Request
  async save(data: UserData) { }
}
```

### @OnError Decorator

Wraps all methods with custom error handling:

```typescript
import { OnError, httpError } from '@maroonedsoftware/errors';

@OnError(error => {
  // Convert any error to HTTP error
  if (error.name === 'ValidationError') {
    throw httpError(400).withDetails({ message: error.message });
  }
  throw httpError(500).withCause(error);
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
   - Create a handler that checks error types
   - Convert known errors to appropriate HTTP status codes
   - Default to 500 for unknown errors
   - Use .withCause(error) to preserve original error

7. **Use Edit tool:**
   - Find the class declaration line
   - Add the decorator on the line before the class
   - Ensure proper formatting and indentation

8. **Confirm to user:**
   - Show which file was modified
   - Show which decorator was added
   - Show the class that was decorated
   - Explain what error handling is now enabled
