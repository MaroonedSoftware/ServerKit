# @maroonedsoftware/koa

Koa utilities and middleware for ServerKit: typed context, router, CORS, error handling, rate limiting, body parsing, and request-scoped DI via [injectkit](https://www.npmjs.com/package/injectkit).

## Installation

```bash
pnpm add @maroonedsoftware/koa koa @koa/router @koa/cors
```

Peer dependencies: `koa`, `@koa/router`, `@koa/cors`.

## Features

- **ServerKitContext** — Koa context extended with `container`, `logger`, `requestId`, `correlationId`, and related request metadata
- **ServerKitRouter** — Router typed for `ServerKitContext`
- **ServerKitMiddleware** — Middleware type bound to `ServerKitContext`
- **serverKitContextMiddleware** — Populates context with scoped container, logger, and request/correlation IDs
- **corsMiddleware** — CORS headers with `'*'`, string, or RegExp origin matching
- **errorMiddleware** — Central error handler; maps HTTP errors to status/body, 404 for unmatched routes, 500 for unknown errors
- **rateLimiterMiddleware** — Per-IP rate limiting via `rate-limiter-flexible` (429 when exceeded)
- **bodyParserMiddleware** — Parses JSON, form, text, multipart, or raw body by allowed content types

## Usage

### Basic setup

```typescript
import Koa from 'koa';
import { InjectKitRegistry } from 'injectkit';
import { Logger, ConsoleLogger } from '@maroonedsoftware/logger';
import { ServerKitRouter, serverKitContextMiddleware, corsMiddleware, errorMiddleware, bodyParserMiddleware } from '@maroonedsoftware/koa';

const diRegistry = new InjectKitRegistry();
diRegistry.register(Logger).useClass(ConsoleLogger).asSingleton();
const container = diRegistry.build();

const app = new Koa();
const router = new ServerKitRouter();

app.use(errorMiddleware());
app.use(serverKitContextMiddleware(container));
app.use(corsMiddleware({ origin: ['*'] }));

router.post('/api/echo', bodyParserMiddleware(['application/json']), async ctx => {
  ctx.body = { echoed: ctx.body, requestId: ctx.requestId };
});

app.use(router.routes()).use(router.allowedMethods());

app.listen(3000);
```

### Route handlers with ServerKitContext

Handlers receive `ctx` as `ServerKitContext` with `ctx.container`, `ctx.logger`, `ctx.requestId`, `ctx.correlationId`, and `ctx.userAgent`:

```typescript
router.get('/api/users/:id', async ctx => {
  ctx.logger.info('Fetching user', { id: ctx.params.id });
  const user = await ctx.container.get(UserService).findById(ctx.params.id);
  if (!user) throw httpError(404);
  ctx.body = user;
});
```

### CORS

```typescript
// Allow all origins
app.use(corsMiddleware({ origin: ['*'] }));

// Single origin
app.use(corsMiddleware({ origin: ['https://app.example.com'] }));

// Multiple origins or RegExps
app.use(
  corsMiddleware({
    origin: ['https://app.example.com', /^https:\/\/.*\.example\.com$/],
  }),
);
```

### Rate limiting

```typescript
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { rateLimiterMiddleware } from '@maroonedsoftware/koa';

const rateLimiter = new RateLimiterMemory({
  points: 100,
  duration: 60,
});
app.use(rateLimiterMiddleware(rateLimiter));
```

### Body parser

Allow specific content types; empty array disallows any body. Supports JSON, urlencoded, text, multipart, and raw (e.g. PDF).

```typescript
router.post('/api/upload', bodyParserMiddleware(['multipart/form-data']), async ctx => {
  const body = ctx.body as MultipartBody;
  // ...
});

router.post('/api/json', bodyParserMiddleware(['application/json']), async ctx => {
  const data = ctx.body as Record<string, unknown>;
  // ...
});
```

## API

### ServerKitContext

| Property        | Type        | Description                          |
| --------------- | ----------- | ------------------------------------ |
| `container`     | `Container` | Request-scoped injectkit container   |
| `logger`        | `Logger`    | Request-scoped logger                |
| `loggerName`    | `string`    | Logger name (e.g. request path)      |
| `userAgent`     | `string`    | `User-Agent` header value            |
| `correlationId` | `string`    | From `X-Correlation-Id` or generated |
| `requestId`     | `string`    | From `X-Request-Id` or generated     |

### Middleware

| Middleware                              | Description                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `serverKitContextMiddleware(container)` | Sets `ctx.container`, `ctx.logger`, IDs; sets `X-Correlation-Id`, `X-Request-Id` response headers |
| `corsMiddleware(options?)`              | CORS via `@koa/cors`; `origin`: `'*'`, string, or `(string \| RegExp)[]`                          |
| `errorMiddleware()`                     | Catches errors, maps HTTP errors to status/body, 404/500, emits app events                        |
| `rateLimiterMiddleware(rateLimiter)`    | Consumes one token per request by IP; throws 429 when exceeded                                    |
| `bodyParserMiddleware(contentTypes)`    | Parses body by allowed MIME types; throws 400/411/415/422 on invalid input                        |

## License

MIT
