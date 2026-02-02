---
user-invocable: true
allowed-tools: Read, Write, Edit, Grep, Glob
description: Generate custom ServerKit middleware with proper typing and error handling
argument-hint: <name> [file]
---

# /koa-middleware - Generate Custom Middleware

Generate a custom middleware function with proper ServerKitContext typing.

## Arguments

1. `name` (required): Middleware name in camelCase (e.g., `authMiddleware`, `rateLimitMiddleware`)
2. `file` (optional): Output file path (defaults to `src/middleware/<name>.middleware.ts`)

## What This Skill Does

1. Creates a complete middleware file with:
   - Proper imports from '@maroonedsoftware/koa'
   - ServerKitMiddleware type signature
   - Access to ServerKitContext
   - Proper async/await and next() handling
   - Error handling pattern
   - JSDoc documentation
   - Export ready to use

## Examples

Generate auth middleware:
```
/koa-middleware auth
```

Generate custom middleware at specific path:
```
/koa-middleware rateLimit src/middleware/rate-limit.middleware.ts
```

## Implementation Pattern

The generated middleware will follow this pattern:

```typescript
import { ServerKitMiddleware } from '@maroonedsoftware/koa';
import { httpError } from '@maroonedsoftware/errors';

/**
 * {Name} middleware
 *
 * @description TODO: Describe what this middleware does
 */
export const {name}Middleware = (): ServerKitMiddleware => {
  return async (ctx, next) => {
    ctx.logger.info('Running {name} middleware', { requestId: ctx.requestId });

    try {
      // TODO: Implement middleware logic before next()
      // Access context: ctx.requestId, ctx.logger, ctx.container, etc.

      await next();

      // TODO: Implement middleware logic after next() (response modification)
    } catch (error) {
      // TODO: Handle errors if needed
      throw error;
    }
  };
};
```

## Instructions for Claude

When this skill is invoked:

1. **Parse arguments:**
   - Extract name and file (optional)
   - Ensure name is in camelCase
   - If no file specified, derive from name: `src/middleware/{name}.middleware.ts`

2. **Generate middleware file:**
   - Import ServerKitMiddleware from '@maroonedsoftware/koa'
   - Import httpError from '@maroonedsoftware/errors'
   - Create middleware function with proper typing
   - Include JSDoc documentation
   - Add logger statement with requestId
   - Include try/catch for error handling
   - Add TODO comments for implementation
   - Include comments explaining before/after next() pattern

3. **Middleware structure:**
   - Export const function that returns ServerKitMiddleware
   - Async arrow function with (ctx, next) parameters
   - Call await next() in the middle
   - Show pattern for pre-processing (before next) and post-processing (after next)

4. **Add helpful comments:**
   - Explain that code before next() runs before route handler
   - Explain that code after next() runs after route handler
   - Show how to access ctx properties (requestId, logger, container, etc.)
   - Show how to throw errors with httpError

5. **Write file:**
   - Create the complete middleware file
   - Ensure proper formatting and spacing

6. **Confirm to user:**
   - Show the file path where middleware was created
   - Show the middleware function name
   - Provide usage example in a Koa app
