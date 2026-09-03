---
user-invocable: true
allowed-tools: Read, Write, Edit, Grep, Glob
description: Generate a ServerKit Fastify plugin or route guard with proper typing and error handling
argument-hint: <name> [file]
---

# /fastify-plugin - Generate Fastify Plugin or Guard

Generate a step for the ServerKit Fastify stack, or a guard for one route. For the Koa adapter use
`/koa-middleware` instead: Fastify has no `(ctx, next)` chain, so the two are not interchangeable.

## Arguments

1. `name` (required): Plugin or guard name (e.g., `requestTiming`, `requireTenant`)
2. `file` (optional): Output file path (defaults to `src/plugins/<name>.plugin.ts`)

## Which shape to generate

Ask which of these the user wants, or infer it from the name:

- **A server plugin** applies to every request: rate limits, tracing, response headers. It is a
  `serverKitPlugin(name, fn)` that adds a hook, and goes in the list passed to
  `builder.setupPlugins`.
- **A route guard** applies to the routes that opt in: authorization, tenant checks. It is a
  function returning a `preHandlerAsyncHookHandler`, listed in a route's `preHandler`.

## Implementation Pattern

A server plugin:

```typescript
import { serverKitPlugin, type ServerKitPlugin } from '@maroonedsoftware/fastify';

export const {name}Plugin = (): ServerKitPlugin =>
  serverKitPlugin('{name}', async app => {
    app.addHook('onRequest', async request => {
      request.logger.info('Running {name}', { requestId: request.requestId });
      // Throw an HttpError to reject the request here.
    });
  });
```

A route guard:

```typescript
import type { preHandlerAsyncHookHandler } from 'fastify';
import { httpError } from '@maroonedsoftware/errors';

export const {name} = (): preHandlerAsyncHookHandler => {
  return async request => {
    const service = request.container.get(SomeService);
    if (!(await service.allows(request.authenticationSession))) {
      throw httpError(403).withDetails({ reason: 'not allowed' });
    }
  };
};
```

## Instructions for Claude

When this skill is invoked:

1. **Decide the shape** (server plugin or route guard) from the name or by asking, then pick the
   matching pattern above. Default the file to `src/plugins/<name>.plugin.ts` for a plugin and
   `src/hooks/<name>.hook.ts` for a guard, following the repo's dot naming.

2. **Wrap a server plugin with `serverKitPlugin`.** A bare Fastify plugin passed to
   `setupPlugins` is encapsulated and its hooks never run. This is the single most common mistake.

3. **Pick the hook phase deliberately:**
   - `onRequest` runs before the body is read. Use it to reject early.
   - `preHandler` runs after parsing and validation. Use it when the guard needs the body.
   - `onSend` for response mutation, `onResponse` for after-the-fact work.

4. **Do not try to run code after the handler in the same hook.** There is no `next()` to await;
   split before-and-after work into two hooks.

5. **Use the request context:** `request.logger`, `request.container`, `request.requestId`,
   `request.correlationId`, `request.authenticationSession`. These exist only after
   `serverKitContextPlugin`, so a custom plugin must be registered after it.

6. **Signal failures by throwing** an `HttpError` from `@maroonedsoftware/errors`. `errorPlugin`
   renders it. Do not call `reply.send` in a guard.

7. **Add JSDoc** on the exported factory saying what it does and where in the stack it belongs.

8. **Confirm to user:** show the file path, the shape generated, and the line to add to
   `setupPlugins` or to the route's `preHandler`.
