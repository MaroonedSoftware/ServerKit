---
user-invocable: true
allowed-tools: Read, Write, Edit, Grep, Glob
description: Generate a Fastify route plugin with ServerKit typing, route config body parsing, guards, and error handling
argument-hint: <method> <path> [file] [content-types]
---

# /fastify-route - Generate Fastify Route Plugin

Generate a route on a Fastify plugin using ServerKit patterns. For the Koa adapter use
`/koa-route` instead: the two adapters have different models and the code is not interchangeable.

## Arguments

1. `method` (required): HTTP method - get, post, put, patch, or delete
2. `path` (required): Route path (e.g., `/api/users/:id`)
3. `file` (optional): Output file path (defaults to `src/routes/<resource>.routes.ts`)
4. `content-types` (optional): Comma-separated content types the route accepts a body for
   (e.g., `application/json,multipart/form-data`)

## What This Skill Does

1. Creates or appends to a route plugin file
2. Generates a route with:
   - A `FastifyPluginAsync` wrapper, registered through `builder.setupRoutes`
   - `config.body` listing the accepted content types, when any were given
   - `requirePolicy()` in `preHandler` for authenticated routes
   - Access to `request.logger`, `request.container`, `request.requestId`, `request.correlationId`
   - `httpError` for error responses
   - Proper imports

## Examples

Generate a simple GET route:
```
/fastify-route get /api/users
```

Generate a POST route that accepts JSON:
```
/fastify-route post /api/users src/routes/users.routes.ts application/json
```

## Implementation Pattern

```typescript
import type { FastifyPluginAsync } from 'fastify';
import { requirePolicy } from '@maroonedsoftware/fastify';
import { httpError } from '@maroonedsoftware/errors';

export const {resource}Routes: FastifyPluginAsync = async app => {
  app.{method}(
    '{path}',
    { config: { body: [{content-types}] }, preHandler: [requirePolicy()] },
    async request => {
      request.logger.info('Handling {method} {path}', { requestId: request.requestId });

      // TODO: Implement route logic
      // Access DI container: const service = request.container.get(SomeService);
      // Read the parsed body: request.body
      // Throw errors: throw httpError(400).withDetails({ field: 'error' });

      return { message: 'Not implemented' };
    },
  );
};
```

Register it with the builder:

```typescript
builder.setupPlugins().setupRoutes([{ plugin: usersRoutes, prefix: '/api' }]);
```

## Instructions for Claude

When this skill is invoked:

1. **Parse arguments:**
   - Extract method, path, file (optional), and content-types (optional)
   - Validate method is one of: get, post, put, patch, delete
   - If no file specified, derive from path (e.g., `/api/users` -> `src/routes/users.routes.ts`)

2. **Check if file exists:**
   - If it exists, read it and add the new route inside the existing plugin function
   - If not, create it with the full plugin boilerplate

3. **Generate route code:**
   - Register through `app.<method>(path, options, handler)`
   - Include `config: { body: [...] }` only when content types were given. A route without it
     rejects any body with 400, which is correct for GET and DELETE
   - Omit the `config`/`preHandler` options object entirely if neither applies
   - Add a logger statement with `requestId`
   - Include TODO comments for the implementation
   - Return the response body from the handler; Fastify serializes an object as JSON

4. **Handle imports:**
   - `FastifyPluginAsync` as a type import from `fastify`
   - `requirePolicy` from `@maroonedsoftware/fastify` when the route is authenticated
   - `httpError` from `@maroonedsoftware/errors`
   - Check for existing imports to avoid duplicates

5. **Never use these:** `ServerKitRouter`, `bodyParserMiddleware`, `sendJson`, and
   `request.parsedBody` do not exist in this adapter. Body content types belong in route `config`
   and the parsed body is `request.body`.

6. **Confirm to user:**
   - Show the file path, the method and path, the accepted content types, and any guard added
   - Remind them to pass the plugin to `builder.setupRoutes` if the file is new
