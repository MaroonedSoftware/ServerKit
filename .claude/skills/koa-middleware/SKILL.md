---
user-invocable: true
allowed-tools: Read, Write, Edit, Grep, Glob
description: Generate custom middleware for an app on @maroonedsoftware/koa, for the server stack or a single route, with ServerKitContext typing. On @maroonedsoftware/fastify use /fastify-plugin instead.
argument-hint: <name> [file]
---

# /koa-middleware - Generate Custom Middleware

Generate a custom middleware function with proper ServerKitContext typing. For the Fastify adapter
use `/fastify-plugin` instead: Fastify has no `(ctx, next)` chain, so the two are not interchangeable.

Check first that the package does not already ship it. `@maroonedsoftware/koa` exports
`errorMiddleware`, `serverKitContextMiddleware`, `rateLimiterMiddleware`, `corsMiddleware`, and
`authenticationMiddleware` for the server stack, plus `bodyParserMiddleware`, `requirePolicy`, and
`requireSignature` for routes. Do not hand-roll rate limiting or token checks.

## Arguments

1. `name` (required): Middleware name in camelCase (e.g., `requestTiming`, `requireTenant`)
2. `file` (optional): Output file path (defaults to `src/middleware/<name>.middleware.ts`, with the name in dot notation)

## Which shape to generate

Ask which of these the user wants, or infer it from the name:

- **A server middleware** applies to every request. It is typed `ServerKitMiddleware` and goes in the
  list passed to `builder.setupMiddleware`.
- **A router middleware** applies to the routes that list it: tenant checks and other per-route
  guards. It is typed `ServerKitRouterMiddleware`, and `ctx.params` is available to it.

## What This Skill Does

1. Creates a complete middleware file with:
   - Proper imports from `@maroonedsoftware/koa`
   - The `ServerKitMiddleware` or `ServerKitRouterMiddleware` type signature
   - Access to ServerKitContext
   - Proper async/await and next() handling
   - JSDoc saying what it does and where in the stack it belongs
   - Export ready to use

## Examples

Generate middleware with the default path:
```
/koa-middleware requestTiming
```

Generate custom middleware at specific path:
```
/koa-middleware requireTenant src/middleware/require.tenant.middleware.ts
```

## Implementation Pattern

The generated middleware will follow this pattern:

```typescript
import { type ServerKitMiddleware } from '@maroonedsoftware/koa';

/**
 * {Name} middleware
 *
 * @description TODO: Describe what this middleware does and where in the stack it belongs
 */
export const {name}Middleware = (): ServerKitMiddleware => {
  return async (ctx, next) => {
    // TODO: Implement middleware logic before next()
    // Access context: ctx.requestId, ctx.logger, ctx.container, etc.
    // Reject by throwing: throw httpError(403).withDetails({ reason: 'not allowed' });

    await next();

    // TODO: Implement middleware logic after next() (response modification)
  };
};
```

Add a server middleware to the stack after the defaults:

```typescript
builder.setupMiddleware(container => [...serverKitDefaultMiddleware(container), {name}Middleware()]);
```

List a router middleware on the route:

```typescript
router.get('/reports', requirePolicy(), {name}Middleware(), handler);
```

## Instructions for Claude

When this skill is invoked:

1. **Parse arguments:**
   - Extract name and file (optional)
   - Ensure name is in camelCase
   - If no file specified, derive from name in dot notation, so `requireTenant` becomes
     `src/middleware/require.tenant.middleware.ts`. Never use a hyphen in a file name

2. **Generate middleware file:**
   - Import `ServerKitMiddleware` or `ServerKitRouterMiddleware` from `@maroonedsoftware/koa`
   - Import `httpError` from `@maroonedsoftware/errors` only if the middleware rejects requests
   - Create middleware function with proper typing
   - Include JSDoc documentation
   - Add TODO comments for implementation
   - Include comments explaining before/after next() pattern

3. **Middleware structure:**
   - Export const function that returns the middleware
   - Async arrow function with (ctx, next) parameters
   - Call await next() in the middle
   - Show pattern for pre-processing (before next) and post-processing (after next)

4. **Get the error handling right:**
   - Signal failures by throwing an `HttpError`. `errorMiddleware` is first in the stack and renders it
   - Do not wrap `next()` in a try/catch just to log and re-throw: `errorMiddleware` already reports through the server's error listener
   - Code after `next()` does not run when something downstream throws

5. **Get the position right:**
   - `ctx.logger` and `ctx.container` exist only after `serverKitContextMiddleware`, so a custom middleware must come after it
   - `authenticationMiddleware` deletes the `Authorization` header from the request and sets `ctx.authenticationSession`.
     A middleware after it cannot read the header. Credential handling belongs in an `AuthenticationSchemeHandler`
   - `ctx.parsedBody` and `ctx.rawBody` are set by `bodyParserMiddleware`, a route middleware, so a server middleware cannot read them before `next()`

6. **Use Luxon for time:** `DateTime` and `Duration`, never `Date.now()` or millisecond arithmetic

7. **Write file:**
   - Create the complete middleware file
   - Ensure proper formatting and spacing

8. **Confirm to user:**
   - Show the file path where middleware was created
   - Show the middleware function name
   - Show the line to add to `setupMiddleware` or to the route
