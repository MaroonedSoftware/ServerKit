# AGENTS.md — @maroonedsoftware/servercore

Machine-oriented guide for AI agents. Human prose and long-form examples live in [README.md](./README.md).
Repo-wide conventions live in the [root AGENTS.md](../../AGENTS.md).

## Purpose

The framework-neutral half of ServerKit's HTTP layer: the module lifecycle contract, body
parsers and their dispatch, the error-rendering rules, request identity, rate limiting, CORS
origin matching, the HMAC signature policy, and the SSE transport. `koa` and `fastify` are thin
adapters over it and re-export what applications use. Import this package directly only when
writing another framework adapter or a library that must run under either adapter; an
application should import from its adapter package instead.

## Install

```bash
pnpm add @maroonedsoftware/servercore
```

Required peers: none. Optional peers: none yet (`./serverfeed` arrives in a later phase).

Runtime dependencies: `appconfig`, `errors`, `logger`, `multipart`, `policies`, `utilities`,
plus `@hapi/bourne`, `inflation`, `injectkit`, `luxon`, `qs`, `rate-limiter-flexible`,
`raw-body`, `type-is`.

## Position in the graph

- **Depends on:** `appconfig`, `errors`, `logger`, `multipart`, `policies`, `utilities`.
  Deliberately **not** `authentication` (L2): the session-aware pieces stay in each adapter.
- **Depended on by:** `koa`, `fastify`.
- **Subpath exports:** none yet.

## API surface

### Lifecycle

| Export                     | Kind      | Shape                                          | Notes                                          |
| -------------------------- | --------- | ---------------------------------------------- | ---------------------------------------------- |
| `ServerKitModule<ConfigT>` | interface | `{ name?, setup?, start?, ready?, shutdown? }` | See the lifecycle table in the root AGENTS.md. |

### Body parsing

| Export                                 | Kind           | Shape                                                                                          | Notes                                                                                       |
| -------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `ServerKitParser`                      | abstract class | `parse(req: IncomingMessage): Promise<ServerKitParserResult>`                                  | Reads the raw Node request.                                                                 |
| `ServerKitParserResult`                | type           | `{ parsed: unknown; raw: BinaryLike }`                                                         | —                                                                                           |
| `ServerKitParserMapping`               | type           | `{ parser: Constructor<ServerKitParser>; options?: { id, instance } }`                         | —                                                                                           |
| `defaultParserMappings`                | constant       | `Record<string, ServerKitParserMapping>`                                                       | `json`, `application/*+json`, `urlencoded`, `text`, `multipart`, octet-stream/pdf/zip/gzip. |
| `ServerKitParserMappings`              | class          | `extends Map<string, ServerKitParser>`                                                         | DI token (`useMap`).                                                                        |
| `ServerKitBodyParser`                  | class          | `readonly mimeTypes: string[]`, `parse(source: ServerKitBodySource)`                           | Matches with `type-is`; wildcard keys resolve to their parser. 415 when nothing matches.    |
| `ServerKitBodySource`                  | type           | `IncomingMessage \| { req: IncomingMessage }`                                                  | A Koa ctx satisfies the second shape.                                                       |
| `BodyGateRequest`                      | interface      | `{ length: number; type: string; is(types: string[]) }`                                        | Structural input for the gate.                                                              |
| `assertBodyExpectation`                | function       | `(request: BodyGateRequest, contentTypes: string[]) => boolean`                                | 400 unexpected body / 411 missing / 415 not allowed. `true` means "parse now".              |
| `parseRouteBody`                       | function       | `(parser: ServerKitBodyParser, source: ServerKitBodySource) => Promise<ServerKitParserResult>` | Rethrows `HttpError`; anything else becomes 422.                                            |
| `JsonParser` / `JsonParserOptions`     | class          | —                                                                                              | `@hapi/bourne`, strict by default, options carry the reviver.                               |
| `TextParser` / `TextParserOptions`     | class          | —                                                                                              | —                                                                                           |
| `FormParser` / `FormParserOptions`     | class          | —                                                                                              | Uses `qs`.                                                                                  |
| `MultipartParser`                      | class          | —                                                                                              | Wraps `@maroonedsoftware/multipart`; lazy.                                                  |
| `BinaryParser` / `BinaryParserOptions` | class          | —                                                                                              | 20 MB default limit.                                                                        |

### Errors and identity

| Export                   | Kind      | Shape                                               | Notes                                                                                                                          |
| ------------------------ | --------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `renderError`            | function  | `(error: unknown) => RenderedError`                 | `HttpError` → own status/message/details/headers; `ServerkitError` → 500 **with** details; else generic 500, no `details` key. |
| `notFoundBody`           | function  | `(url: string) => RenderedErrorBody`                | `{ statusCode: 404, message: 'Not Found', details: { url } }`.                                                                 |
| `RenderedError`          | interface | `{ status; body: RenderedErrorBody; headers? }`     | —                                                                                                                              |
| `RenderedErrorBody`      | interface | `{ statusCode; message; details? }`                 | —                                                                                                                              |
| `resolveRequestIdentity` | function  | `(headers: IncomingHttpHeaders) => RequestIdentity` | First header value or `crypto.randomUUID()`.                                                                                   |
| `RequestIdentity`        | interface | `{ correlationId; requestId }`                      | —                                                                                                                              |
| `CORRELATION_ID_HEADER`  | constant  | `'x-correlation-id'`                                | —                                                                                                                              |
| `REQUEST_ID_HEADER`      | constant  | `'x-request-id'`                                    | —                                                                                                                              |

### Guards

| Export                       | Kind                       | Shape                                                                                          | Notes                                                                        |
| ---------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `RateLimiter`                | interface + abstract class | `extends RateLimiterAbstract`                                                                  | DI token for a `rate-limiter-flexible` limiter.                              |
| `consumeRateLimit`           | function                   | `(rateLimiter: RateLimiter, key: string) => Promise<void>`                                     | Throws 429 with `retry-after` / `x-ratelimit-*` headers.                     |
| `CorsOrigin`                 | type                       | `string \| (string \| RegExp)[]`                                                               | —                                                                            |
| `normalizeCorsOrigins`       | function                   | `(origin?: CorsOrigin) => (string \| RegExp)[]`                                                | `undefined` → `['*']`; a string is one origin.                               |
| `createOriginMatcher`        | function                   | `(matchers) => (requestOrigin: string) => string`                                              | Reflects the origin on match, `''` otherwise.                                |
| `createAnonymousPathMatcher` | function                   | `(paths?: (string \| RegExp)[]) => (path: string) => boolean`                                  | Strings exact, RegExps tested.                                               |
| `REQUIRE_SIGNATURE_POLICY`   | constant                   | `'request.signature.valid'`                                                                    | —                                                                            |
| `SignatureOptions`           | type                       | `{ header, secret, algorithm, digest }`                                                        | Stored in `AppConfig`, resolved by key.                                      |
| `SignaturePolicyContext<T>`  | interface                  | `{ rawBody: BinaryLike; getHeader: (name) => string; options: T }`                             | The policy context for a signature scheme.                                   |
| `DefaultSignaturePolicy`     | class                      | `extends Policy<SignaturePolicyContext>`                                                       | HMAC over `rawBody`, `timingSafeEqual`. Denies `'invalid_signature'`.        |
| `SignatureRequest`           | interface                  | `{ rawBody; getHeader }`                                                                       | —                                                                            |
| `assertRequestSignature<T>`  | function                   | `(container, request: SignatureRequest, optionsKey: string, policy?: string) => Promise<void>` | Resolves `AppConfig` and `PolicyService` from `container`; asserts with 401. |

### SSE

| Export                                     | Kind                  | Shape                                                              | Notes                                                                         |
| ------------------------------------------ | --------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `openSseStream`                            | function              | `(ctx: SseContext, options?: SseStreamOptions) => SseStream`       | Sets `status`/`respond` for Koa, calls `hijack` for Fastify, then owns `res`. |
| `SseStream`                                | interface             | `write`, `event`, `comment`, `onClose`, `close`, `readonly closed` | Writes after close are no-ops.                                                |
| `SseStreamOptions`                         | interface             | `{ heartbeatMs?, maxBufferedBytes?, headers?, signal? }`           | Pass the server's lifecycle signal as `signal`.                               |
| `SseContext`                               | interface             | `{ status?, respond?, res: SseResponse, hijack?() }`               | Structural; a Koa ctx or `{ res: reply.raw, hijack }` both fit.               |
| `SseResponse`                              | interface             | Raw response sink, including `writableLength`                      | —                                                                             |
| `SseFrame` / `frameEvent` / `frameComment` | interface / functions | Frame shape and serialisers                                        | —                                                                             |
| `resolveLastEventId`                       | function              | `(header: string, queryLastEventId: unknown) => number`            | —                                                                             |
| `firstQueryValue`                          | function              | `(value: unknown) => string \| undefined`                          | —                                                                             |
| `DEFAULT_SSE_HEARTBEAT_MS`                 | constant              | `15_000`                                                           | `0` disables.                                                                 |
| `DEFAULT_SSE_MAX_BUFFERED_BYTES`           | constant              | `1_000_000`                                                        | Past this, the client is dropped and reconnects with `Last-Event-ID`.         |

## Canonical usage

An adapter's error handler and body gate, the two places the shared rules matter most:

```typescript
import { renderError, notFoundBody, assertBodyExpectation, parseRouteBody, ServerKitBodyParser } from '@maroonedsoftware/servercore';
import typeis from 'type-is';

// Error boundary
const { status, body, headers } = renderError(error);

// Per-route body gate, then parse from the raw Node request
if (assertBodyExpectation({ length, type, is: types => typeis(req, types) }, ['application/json'])) {
  const { parsed, raw } = await parseRouteBody(container.get(ServerKitBodyParser), req);
}
```

## Rules for generated code

- Call `renderError` for every error response. Never re-derive which details reach the client.
- Enforce a route's body contract with `assertBodyExpectation` before `parseRouteBody`, so the
  400/411/415/422 statuses stay identical across adapters.
- Pass a raw `IncomingMessage` (or an object carrying it as `req`) to `ServerKitBodyParser.parse`.
- Keep `SseContext` structural: supply `hijack` from a framework that needs one and let the
  stream own `res` afterwards.
- Do not import `@maroonedsoftware/authentication` here. Session-aware guards belong to the
  adapters.

## Gotchas

- **`renderError` is a data-exposure boundary.** A bare `ServerkitError` sends its `details`; a
  plain `Error` sends nothing. Throwing `new Error('...')` silently drops everything the client
  could have been told.
- **`ServerKitBodyParser` matches with `type-is`**, which returns the concrete media type, not
  the registered pattern. Wildcard keys (`application/*+json`) are resolved by a second pass;
  do not rely on `Map.get` with the matched type.
- **`assertBodyExpectation` returns `false` for "no body allowed and none sent".** Only a `true`
  result should reach `parseRouteBody`.
- **`RateLimiter` is a declaration-merged token**, because `rate-limiter-flexible` exports
  `RateLimiterAbstract` as a type only. Do not split it.
- **`openSseStream` sets `ctx.status`/`ctx.respond` unconditionally** (they are harmless extra
  properties on a non-Koa context) and calls `hijack` exactly once before any write.

## Working inside this package

```
src/
  index.ts                         Root barrel
  serverkit.module.ts              ServerKitModule
  serverkit.bodyparser.ts          ServerKitBodyParser, ServerKitParserMappings, ServerKitBodySource
  body.gate.ts                     assertBodyExpectation, parseRouteBody
  parsers/                         serverkit.parser, json, text, form, multipart, binary, serverkit.default.parsers
  policies/request.signature.valid.policy.ts   SignatureOptions, DefaultSignaturePolicy, assertRequestSignature
  errors/error.renderer.ts         renderError, notFoundBody
  request/request.identity.ts      resolveRequestIdentity
  ratelimit/rate.limiter.ts        RateLimiter, consumeRateLimit
  cors/cors.origin.ts              normalizeCorsOrigins, createOriginMatcher
  authentication/anonymous.paths.ts  createAnonymousPathMatcher
  sse/                             sse.frame, sse.request, sse.stream
```

Tests are in `tests/`, mirroring `src/`.

Invariants a change must not break:

- `renderError`'s three-way split (`HttpError` / `ServerkitError` / `Error`) is a security
  boundary shared with `@maroonedsoftware/policies`' `assert`. Changing which payload reaches
  the client is a security change.
- The body gate's status contract (400 / 411 / 415 / 422) is what both adapters promise.
- Signature comparison must stay constant-time (`timingSafeEqual`), and the secret must never
  reach `details` or the response.
- The SSE stream must keep owning the socket and swallowing disconnect teardown.
- No import of `@maroonedsoftware/authentication`; this package is L1.

User-visible changes need a changeset in `.changeset/`. A new export must also land in the
`README.md` feature list and the API surface table above; the root `README.md` and root
`AGENTS.md` package index list this package.
