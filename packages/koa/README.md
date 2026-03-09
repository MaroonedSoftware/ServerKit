# @maroonedsoftware/koa

Koa utilities and middleware for ServerKit: typed context, router, CORS, error handling, rate limiting, authentication, body parsing, and request-scoped DI via [injectkit](https://www.npmjs.com/package/injectkit).

## Installation

```bash
pnpm add @maroonedsoftware/koa koa @koa/router @koa/cors
```

Peer dependencies: `koa`, `@koa/router`, `@koa/cors`.

## Features

- **ServerKitContext** — Koa context extended with `container`, `logger`, `requestId`, `correlationId`, `authenticationContext`, and related request metadata
- **ServerKitRouter** — Router typed for `ServerKitContext`
- **ServerKitMiddleware** — Middleware type bound to `ServerKitContext`
- **serverKitContextMiddleware** — Populates context with scoped container, logger, and request/correlation IDs
- **corsMiddleware** — CORS headers with `'*'`, string, or RegExp origin matching
- **errorMiddleware** — Central error handler; maps HTTP errors to status/body, 404 for unmatched routes, 500 for unknown errors
- **rateLimiterMiddleware** — Per-IP rate limiting via `rate-limiter-flexible` (429 when exceeded)
- **authenticationMiddleware** — Resolves the `Authorization` header via `AuthenticationSchemeHandler` and populates `ctx.authenticationContext`
- **bodyParserMiddleware** — Parses JSON, form, text, multipart, or raw body by allowed content types
- **defaultParserMappings** — Pre-built MIME-type-to-parser map for use with `bodyParserMiddleware`

## Usage

### Basic setup

```typescript
import Koa from 'koa';
import { InjectKitRegistry } from 'injectkit';
import { Logger, ConsoleLogger } from '@maroonedsoftware/logger';
import {
  ServerKitRouter,
  serverKitContextMiddleware,
  corsMiddleware,
  errorMiddleware,
  bodyParserMiddleware,
} from '@maroonedsoftware/koa';

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

### Authentication

`authenticationMiddleware` reads the `Authorization` header, delegates resolution to the `AuthenticationSchemeHandler` registered in the DI container, and populates `ctx.authenticationContext`. The header is deleted from `ctx.req.headers` immediately after reading so it cannot be captured by downstream logging.

```typescript
import {
  AuthenticationSchemeHandler,
  AuthenticationHandlerMap,
} from '@maroonedsoftware/authentication';
import { authenticationMiddleware } from '@maroonedsoftware/koa';

// Register your scheme handlers in DI
diRegistry
  .register(AuthenticationHandlerMap)
  .useMap()
  .add('Bearer', BearerAuthHandler);

diRegistry.register(AuthenticationSchemeHandler).asSingleton();

// Add to the middleware stack after serverKitContextMiddleware
app.use(serverKitContextMiddleware(container));
app.use(authenticationMiddleware());

// Access the resolved context in route handlers
router.get('/api/me', async ctx => {
  const { subject, isAuthenticated } = ctx.authenticationContext;
  if (!isAuthenticated) throw httpError(401);
  ctx.body = { subject };
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

### Custom parser mappings

`defaultParserMappings` is the built-in MIME-type-to-parser map used by `bodyParserMiddleware`. You can extend or replace it to register additional parsers:

```typescript
import { defaultParserMappings, BinaryParser } from '@maroonedsoftware/koa';
import { ServerKitBodyParser } from '@maroonedsoftware/koa';

const customMappings = {
  ...defaultParserMappings,
  pdf: BinaryParser,
};

// Pass to bodyParserMiddleware via a custom ServerKitBodyParser instance
```

The default mappings are:

| MIME subtype         | Parser          |
| -------------------- | --------------- |
| `json`               | `JsonParser`    |
| `application/*+json` | `JsonParser`    |
| `urlencoded`         | `FormParser`    |
| `text`               | `TextParser`    |
| `multipart`          | `MultipartParser` |

## API

### ServerKitContext

| Property                | Type                    | Description                                            |
| ----------------------- | ----------------------- | ------------------------------------------------------ |
| `container`             | `Container`             | Request-scoped injectkit container                     |
| `logger`                | `Logger`                | Request-scoped logger                                  |
| `loggerName`            | `string`                | Logger name (e.g. request path)                        |
| `userAgent`             | `string`                | `User-Agent` header value                              |
| `correlationId`         | `string`                | From `X-Correlation-Id` header or generated            |
| `requestId`             | `string`                | From `X-Request-Id` header or generated                |
| `rawBody`               | `unknown`               | Raw (unparsed) request body                            |
| `authenticationContext` | `AuthenticationContext` | Resolved authentication context; set by `authenticationMiddleware` |

### Middleware

| Middleware                              | Description                                                                                        |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `serverKitContextMiddleware(container)` | Sets `ctx.container`, `ctx.logger`, IDs; sets `X-Correlation-Id`, `X-Request-Id` response headers  |
| `corsMiddleware(options?)`              | CORS via `@koa/cors`; `origin`: `'*'`, string, or `(string \| RegExp)[]`                           |
| `errorMiddleware()`                     | Catches errors, maps HTTP errors to status/body, 404/500, emits app events                         |
| `rateLimiterMiddleware(rateLimiter)`    | Consumes one token per request by IP; throws 429 when exceeded                                     |
| `authenticationMiddleware()`           | Resolves `Authorization` header via `AuthenticationSchemeHandler`; populates `ctx.authenticationContext` |
| `bodyParserMiddleware(contentTypes)`    | Parses body by allowed MIME types; throws 400/411/415/422 on invalid input                         |

### Parser options

Parser options classes are registered with InjectKit and can be configured in the DI container:

| Class                | Key options                                    |
| -------------------- | ---------------------------------------------- |
| `JsonParserOptions`  | `strict`, `protoAction`, `reviver`, `encoding`, `limit` |
| `FormParserOptions`  | `allowDots`, `depth`, `parameterLimit`, `encoding`, `limit` |
| `TextParserOptions`  | `encoding`, `limit`                            |

## License

MIT
