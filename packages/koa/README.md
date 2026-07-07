# @maroonedsoftware/koa

Koa utilities and middleware for ServerKit: typed context, router, CORS, error handling, rate limiting, authentication, body parsing, and request-scoped DI via [injectkit](https://www.npmjs.com/package/injectkit).

## Installation

```bash
pnpm add @maroonedsoftware/koa koa @koa/router @koa/cors
```

Peer dependencies: `koa`, `@koa/router`, `@koa/cors`.

## Features

- **ServerKitServerBuilder** — Fluent builder that wires an injectkit container, body parsers, middleware, and routes, then runs the module lifecycle (`setup`/`start`/`shutdown`) around a Koa server
- **serverKitDefaultMiddleware** — Builds the canonical middleware stack (error → context → optional rate limiter → CORS → authentication) from the built container
- **RateLimiter** — DI token for an injected `rate-limiter-flexible` limiter; when registered, the default stack inserts `rateLimiterMiddleware` automatically
- **ServerKitContext** — Koa context extended with `container`, `logger`, `requestId`, `correlationId`, `authenticationSession`, and related request metadata
- **ServerKitRouter** — Router typed for `ServerKitContext`
- **ServerKitRouterType** — The router instance type returned by `ServerKitRouter`, for typing routers without referencing `@koa/router` directly
- **ServerKitMiddleware** — Middleware type bound to `ServerKitContext`
- **serverKitContextMiddleware** — Populates context with scoped container, logger, and request/correlation IDs; registers the live context against the `ServerKitContext` injection token so request-scoped services can inject it
- **corsMiddleware** — CORS headers with `'*'`, string, or RegExp origin matching
- **errorMiddleware** — Central error handler; maps HTTP errors to status/body, 404 for unmatched routes, 500 for unknown errors
- **rateLimiterMiddleware** — Per-IP rate limiting via `rate-limiter-flexible` (429 when exceeded)
- **authenticationMiddleware** — Resolves the `Authorization` header via `AuthenticationSchemeHandler` and populates `ctx.authenticationSession`
- **bodyParserMiddleware** — Parses JSON, form, text, multipart, or raw body by allowed content types
- **defaultParserMappings** — Pre-built MIME-subtype-to-parser map (JSON with a bigint reviver, form, text, multipart, and binary types) for use with `bodyParserMiddleware` and `ServerKitServerBuilder`
- **requireSignature** — Router middleware that verifies a request HMAC signature against `ctx.rawBody`
- **requirePolicy** — Router middleware that enforces a valid authentication session and a named policy (defaults to `auth.session.mfa.satisfied`); pluggable via `PolicyService`

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
  ctx.body = { echoed: ctx.parsedBody, requestId: ctx.requestId };
});

app.use(router.routes()).use(router.allowedMethods());

app.listen(3000);
```

### Server builder

`ServerKitServerBuilder` wires the container, body parsers, middleware, and routes, then runs each module's lifecycle hooks around a Koa server. It sets Luxon's default zone to UTC on construction and throws until `setup` has built the container.

```typescript
import { ServerKitServerBuilder } from '@maroonedsoftware/koa';

const builder = new ServerKitServerBuilder();
await builder.setup(config, logger, modules); // returns the built container

builder
  .setupMiddleware() // defaults to serverKitDefaultMiddleware(container)
  .setupRoutes([router]); // mounts router.routes() + router.allowedMethods()

await builder.start(3000);
```

`setup` registers the `Logger` and `AppConfig`, wires the parser mappings (defaulting to `defaultParserMappings`), and runs each module's `setup` hook before building the container. `start` runs every module's `start` hook once listening and installs `SIGINT`/`SIGTERM` handlers that trigger a graceful `shutdown` (each module's `shutdown` hook, then `process.exit()`).

`setupMiddleware` accepts a factory `(container) => ServerKitMiddleware[]`; the default `serverKitDefaultMiddleware` returns error → context → optional rate limiter → CORS → authentication. Register a `RateLimiter` in a module's `setup` to have the rate limiter inserted automatically:

```typescript
import { RateLimiter } from '@maroonedsoftware/koa';
import { RateLimiterMemory } from 'rate-limiter-flexible';

registry.register(RateLimiter).useInstance(new RateLimiterMemory({ points: 10, duration: 1 }));
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

### Injecting the context

`ServerKitContext` is also exported as an injectkit token. After `serverKitContextMiddleware` runs, the live `ctx` is registered against this token in the request-scoped container, so services resolved from `ctx.container` can declare it as a dependency:

```typescript
import { Injectable } from 'injectkit';
import { ServerKitContext } from '@maroonedsoftware/koa';

@Injectable()
class CurrentUserService {
  constructor(private readonly ctx: ServerKitContext) {}

  get subject() {
    return this.ctx.authenticationSession?.subject;
  }
}
```

### Authentication

`authenticationMiddleware` reads the `Authorization` header, delegates resolution to the `AuthenticationSchemeHandler` registered in the DI container, and populates `ctx.authenticationSession`. The header is deleted from `ctx.req.headers` immediately after reading so it cannot be captured by downstream logging.

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

// Access the resolved session in route handlers
router.get('/api/me', async ctx => {
  const { subject } = ctx.authenticationSession;
  ctx.body = { subject };
});
```

### Authorization

`requirePolicy` is router middleware that runs after `authenticationMiddleware`. It throws **401** with `WWW-Authenticate: Bearer error="invalid_token"` when the request is unauthenticated, and **403** when the named policy denies. The policy's own deny shape carries the response details and any `WWW-Authenticate` value (e.g. `Bearer error="mfa_required"`).

By default, `requirePolicy()` enforces the `'auth.session.mfa.satisfied'` policy — bundled with `@maroonedsoftware/authentication` as `DefaultMfaSatisfiedPolicy`. It allows when the session carries at least two factors and at least one is not of `kind: 'knowledge'`. Override by registering your own class against the same name in `PolicyRegistryMap` (e.g. to grant MFA credit to `oidc` sessions when your IdP enforces 2FA upstream).

```typescript
import { requirePolicy } from '@maroonedsoftware/koa';

// Default MFA gate
router.get('/api/profile', requirePolicy(), handler);

// AAL2 step-up gate (uses 'auth.session.assurance.level')
router.post('/api/admin/dangerous', requirePolicy({ policy: 'auth.session.assurance.level' }), handler);

// Recent-factor step-up gate (uses 'auth.session.recent.factor')
router.post('/api/billing/update', requirePolicy({ policy: 'auth.session.recent.factor' }), handler);

// Authenticated-only — useful for step-up routes such as MFA enrollment
router.post('/api/mfa/enroll', requirePolicy({ policy: false }), handler);
```

The middleware resolves `PolicyService` from `ctx.container` per request and calls `policyService.assert(name, { session })`. Headers, details, and internal log context come from the policy's deny payload — see `@maroonedsoftware/policies` and `@maroonedsoftware/authentication` for the policy authoring API.

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

The parsed body is placed on `ctx.parsedBody` (the raw bytes on `ctx.rawBody`). It is deliberately not written to `ctx.body`, which in Koa is the *response* body.

```typescript
router.post('/api/upload', bodyParserMiddleware(['multipart/form-data']), async ctx => {
  const body = ctx.parsedBody as MultipartBody;
  // ...
});

router.post('/api/json', bodyParserMiddleware(['application/json']), async ctx => {
  const data = ctx.parsedBody as Record<string, unknown>;
  // ...
});
```

### Signature verification

`requireSignature` validates that an incoming request was signed with a shared secret. It computes an HMAC over `ctx.rawBody` and compares it to a header value. Use it for webhook endpoints from GitHub, Stripe, and similar services.

The verification rule lives in the `request.signature.valid` policy (`DefaultSignaturePolicy`), which `requireSignature` resolves through `PolicyService` — mirroring how `requirePolicy` is backed by `DefaultMfaSatisfiedPolicy`. Register it in your `PolicyRegistryMap` so the middleware can resolve it:

```typescript
import { REQUIRE_SIGNATURE_POLICY, DefaultSignaturePolicy } from '@maroonedsoftware/koa';

// when building your PolicyRegistryMap
registry.set(REQUIRE_SIGNATURE_POLICY, DefaultSignaturePolicy);
```

To change the rule (e.g. accept a rotated secret during a key rollover), subclass `DefaultSignaturePolicy` and register your subclass under the same name — no middleware changes needed.

Store the options under a key in `AppConfig` and reference that key when adding the middleware:

**config.json:**

```json
{
  "webhook": {
    "header": "X-Hub-Signature-256",
    "secret": "${env:WEBHOOK_SECRET}",
    "algorithm": "sha256",
    "digest": "hex"
  }
}
```

```typescript
import { requireSignature, bodyParserMiddleware } from '@maroonedsoftware/koa';

// bodyParserMiddleware must run first so that ctx.rawBody is populated
router.post(
  '/webhooks/github',
  bodyParserMiddleware(['application/json']),
  requireSignature('webhook'),
  async ctx => {
    ctx.status = 204;
  },
);
```

#### Driving a different scheme

`requireSignature` is generic over the resolved options type and takes an optional second argument — an options object whose `policy` names a different registered policy to evaluate, so any scheme expressed as a `SignaturePolicyContext` policy runs through the same middleware. For example, Slack's v0 scheme via `SlackSignaturePolicy` from `@maroonedsoftware/slack`:

```typescript
import { requireSignature } from '@maroonedsoftware/koa';
import { SLACK_SIGNATURE_POLICY, SlackSignaturePolicy, type SlackSignatureOptions, SlackConfig } from '@maroonedsoftware/slack';

// register once: registry.set(SLACK_SIGNATURE_POLICY, SlackSignaturePolicy);
// store the Slack config (signingSecret, optional signatureMaxAgeSeconds) under the 'slack' AppConfig key

router.post(
  '/slack/events',
  bodyParserMiddleware(['application/json']),
  requireSignature<SlackSignatureOptions>('slack', { policy: SLACK_SIGNATURE_POLICY }),
  handler,
);
```

### Custom parser mappings

`defaultParserMappings` is the built-in MIME-subtype-to-parser map used by `bodyParserMiddleware` and `ServerKitServerBuilder`. Each value is a `ServerKitParserMapping` — a `parser` class plus an optional `options` object (an injectkit `id` and the pre-built `instance`) registered alongside it. Extend or replace it by spreading into a new object:

```typescript
import {
  defaultParserMappings,
  BinaryParser,
  ServerKitParserMapping,
} from '@maroonedsoftware/koa';

const customMappings: Record<string, ServerKitParserMapping> = {
  ...defaultParserMappings,
  'text/csv': { parser: BinaryParser },
};

// Pass the map to the builder, which registers each parser and its options in the container:
await builder.setup(config, logger, modules, customMappings);
```

The default mappings are:

| MIME subtype               | Parser            | Options                                     |
| -------------------------- | ----------------- | ------------------------------------------- |
| `json`                     | `JsonParser`      | `JsonParserOptions` (with the bigint reviver) |
| `application/*+json`       | `JsonParser`      | `JsonParserOptions` (with the bigint reviver) |
| `urlencoded`               | `FormParser`      | `FormParserOptions`                         |
| `text`                     | `TextParser`      | `TextParserOptions`                         |
| `multipart`                | `MultipartParser` | —                                           |
| `application/octet-stream` | `BinaryParser`    | —                                           |
| `application/pdf`          | `BinaryParser`    | —                                           |
| `application/zip`          | `BinaryParser`    | —                                           |
| `application/gzip`         | `BinaryParser`    | —                                           |

The `json` mappings bind a `JsonParserOptions` instance whose `reviver` is `bigIntReviver`, so numeric-string bigints round-trip through JSON bodies out of the box.

## API

### ServerKitContext

| Property                | Type                    | Description                                            |
| ----------------------- | ----------------------- | ------------------------------------------------------ |
| `container`             | `Container`             | Request-scoped injectkit container                     |
| `logger`                | `Logger`                | Request-scoped logger                                  |
| `loggerName`            | `string`                | Logger name (e.g. request path)                        |
| `userAgent`             | `string`                | `User-Agent` header value                              |
| `ipAddress`             | `string`                | IP address of the client                               |
| `correlationId`         | `string`                | From `X-Correlation-Id` header or generated            |
| `requestId`             | `string`                | From `X-Request-Id` header or generated                |
| `rawBody`               | `BinaryLike`            | Raw request body bytes; set by `bodyParserMiddleware`  |
| `authenticationSession` | `AuthenticationSession` | Resolved authentication session; set by `authenticationMiddleware` |

### Middleware

| Middleware                              | Description                                                                                        |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `serverKitContextMiddleware(container)` | Sets `ctx.container`, `ctx.logger`, IDs; sets `X-Correlation-Id`, `X-Request-Id` response headers  |
| `corsMiddleware(options?)`              | CORS via `@koa/cors`; `origin`: `'*'`, string, or `(string \| RegExp)[]`                           |
| `errorMiddleware()`                     | Catches errors, maps HTTP errors to status/body, 404/500, emits app events                         |
| `rateLimiterMiddleware(rateLimiter)`    | Consumes one token per request by IP; throws 429 when exceeded                                     |
| `authenticationMiddleware()`           | Resolves `Authorization` header via `AuthenticationSchemeHandler`; populates `ctx.authenticationSession` |
| `bodyParserMiddleware(contentTypes)`    | Parses body by allowed MIME types; throws 400/411/415/422 on invalid input                         |
| `requireSignature(optionsKey)`          | Verifies HMAC of `ctx.rawBody` against a request header; throws 401 on mismatch                   |
| `requirePolicy(options?)`               | Throws 401 when the session is invalid; otherwise asserts `options.policy` (default `'auth.session.mfa.satisfied'`) via `PolicyService`, which throws 403 with policy-supplied details/headers on deny. Pass `{ policy: false }` to skip the policy check. |

### Parser options

Parser options classes are registered with InjectKit and can be configured in the DI container:

| Class                | Key options                                    |
| -------------------- | ---------------------------------------------- |
| `JsonParserOptions`  | `strict`, `protoAction`, `reviver`, `encoding`, `limit` |
| `FormParserOptions`  | `allowDots`, `depth`, `parameterLimit`, `encoding`, `limit` |
| `TextParserOptions`  | `encoding`, `limit`                            |

## License

MIT
