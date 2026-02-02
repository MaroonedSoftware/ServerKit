---
user-invocable: true
allowed-tools: Read, Write, Edit, Grep, Glob
description: Generate a Koa route handler with proper ServerKitContext typing, error handling, and optional body parsing
argument-hint: <method> <path> [file] [content-types]
---

# /koa-route - Generate Koa Route Handler

Generate a properly typed Koa route handler with ServerKit patterns.

## Arguments

1. `method` (required): HTTP method - get, post, put, patch, or delete
2. `path` (required): Route path (e.g., `/api/users/:id`)
3. `file` (optional): Output file path (defaults to `src/routes/<resource>.routes.ts`)
4. `content-types` (optional): Comma-separated list of allowed content types (e.g., `application/json,multipart/form-data`)

## What This Skill Does

1. Creates or appends to a route file
2. Generates a route handler with:
   - Proper `ServerKitContext` typing
   - Body parser middleware if content types specified
   - Access to `ctx.logger`, `ctx.container`, `ctx.requestId`, `ctx.correlationId`
   - HttpError usage for error responses
   - Type-safe route handler signature
   - Proper imports

## Examples

Generate a simple GET route:
```
/koa-route get /api/users
```

Generate a POST route with JSON body parsing:
```
/koa-route post /api/users src/routes/users.routes.ts application/json
```

Generate a PUT route with multiple content types:
```
/koa-route put /api/users/:id src/routes/users.routes.ts application/json,application/x-www-form-urlencoded
```

## Implementation Pattern

The generated route will follow this pattern:

```typescript
import { ServerKitRouter, bodyParserMiddleware } from '@maroonedsoftware/koa';
import { httpError } from '@maroonedsoftware/errors';

const router = new ServerKitRouter();

router.{method}('{path}', bodyParserMiddleware([{content-types}]), async ctx => {
  ctx.logger.info('Handling {method} {path}', { requestId: ctx.requestId });

  // TODO: Implement route logic
  // Access DI container: const service = ctx.container.get(SomeService);
  // Throw errors: throw httpError(400).withDetails({ field: 'error' });

  ctx.body = { message: 'Not implemented' };
});

export default router;
```

## Instructions for Claude

When this skill is invoked:

1. **Parse arguments:**
   - Extract method, path, file (optional), and content-types (optional)
   - Validate method is one of: get, post, put, patch, delete
   - If no file specified, derive from path (e.g., `/api/users` → `src/routes/users.routes.ts`)

2. **Check if file exists:**
   - If file exists, read it and append the new route
   - If file doesn't exist, create it with full boilerplate (imports, router creation, export)

3. **Generate route code:**
   - Use ServerKitRouter type
   - Add bodyParserMiddleware only if content-types provided
   - Include proper imports at top of file
   - Add logger statement with requestId
   - Include TODO comments for implementation
   - Set appropriate response body based on method (GET returns data, POST returns created resource, DELETE returns 204, etc.)

4. **Handle imports:**
   - Always import ServerKitRouter from '@maroonedsoftware/koa'
   - Import bodyParserMiddleware if content-types specified
   - Import httpError from '@maroonedsoftware/errors'
   - Check if imports already exist in file to avoid duplicates

5. **Format content-types:**
   - Split by comma if multiple provided
   - Wrap in array syntax for bodyParserMiddleware
   - Use string literals with quotes

6. **Write or update file:**
   - If new file, write complete file with imports, router, route, and export
   - If existing file, append route handler before the export statement
   - Ensure proper spacing and formatting

7. **Confirm to user:**
   - Show the file path where route was created/updated
   - Show the method and path of the new route
   - Mention any middleware that was added
