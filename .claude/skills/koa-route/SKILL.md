---
user-invocable: true
allowed-tools: Read, Write, Edit, Grep, Glob
description: Generate a route handler for an app on @maroonedsoftware/koa, with ServerKitRouter, typed ctx, optional body parsing and policy guards. On @maroonedsoftware/fastify use /fastify-route instead.
argument-hint: <method> <path> [file] [content-types]
---

# /koa-route - Generate Koa Route Handler

Generate a properly typed Koa route handler with ServerKit patterns. For the Fastify adapter use
`/fastify-route` instead: the two adapters have different models and the code is not interchangeable.

## Arguments

1. `method` (required): HTTP method - get, post, put, patch, or delete
2. `path` (required): Route path (e.g., `/api/users/:id`)
3. `file` (optional): Output file path (defaults to `src/routes/<resource>.routes.ts`)
4. `content-types` (optional): Comma-separated list of allowed content types (e.g., `application/json,multipart/form-data`)

## What This Skill Does

1. Creates or appends to a route file
2. Generates a route handler with:
   - A router from `ServerKitRouter()`, which types `ctx` as `ServerKitContext`
   - `bodyParserMiddleware` if content types are specified, with the payload read from `ctx.parsedBody`
   - `requirePolicy()` for authenticated routes
   - Access to `ctx.logger`, `ctx.container`, `ctx.requestId`, `ctx.correlationId`
   - `httpError` for error responses
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
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { httpError } from '@maroonedsoftware/errors';

const router = ServerKitRouter();

router.{method}('{path}', requirePolicy(), bodyParserMiddleware([{content-types}]), async ctx => {
  ctx.logger.info('Handling {method} {path}', { requestId: ctx.requestId });

  // TODO: Implement route logic
  // Access DI container: const service = ctx.container.get(SomeService);
  // Read the parsed body: ctx.parsedBody, typed unknown. Validate it with parseAndValidate from @maroonedsoftware/zod.
  // Throw errors: throw httpError(400).withDetails({ field: 'error' });

  ctx.body = { message: 'Not implemented' };
});

export default router;
```

Mount it with the builder:

```typescript
builder.setupMiddleware().setupRoutes([router]);
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
   - Create the router by calling `ServerKitRouter()`. It is a factory, so `new ServerKitRouter()` throws at runtime
   - Add `bodyParserMiddleware` only if content-types were provided. With it, a request whose content type is
     not listed gets 415 and one with no body gets 411. Without it the body is never read and
     `ctx.parsedBody` stays undefined. `bodyParserMiddleware([])` rejects any body with 400
   - Add `requirePolicy()` first on authenticated routes. It reads the session set by `authenticationMiddleware`
     (in the default stack) and resolves `PolicyService` from the request container, so the app must register one
   - Read the request payload from `ctx.parsedBody`. `ctx.body` is the response body in Koa
   - Add a logger statement with `requestId`
   - Include TODO comments for implementation
   - Set an appropriate response based on method (GET returns data, POST sets 201 and returns the created resource,
     DELETE sets 204, etc.)
   - A route that verifies a webhook uses `requireSignature(optionsKey)` after `bodyParserMiddleware`, since it checks `ctx.rawBody`

4. **Handle imports:**
   - Always import `ServerKitRouter` from `@maroonedsoftware/koa`
   - Import `bodyParserMiddleware` and `requirePolicy` from `@maroonedsoftware/koa` when used
   - Import `httpError` from `@maroonedsoftware/errors`
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
   - Remind them to pass the router to `builder.setupRoutes` if the file is new

For `multipart/form-data`, use `/multipart-upload`: `ctx.parsedBody` is then a lazy `MultipartBody`, not parsed data.
