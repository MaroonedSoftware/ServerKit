# AGENTS.md — ServerKit

Machine-oriented guide for AI agents. Human prose and long-form examples live in [README.md](./README.md)
and in each package's `README.md`.

This file covers what is true across the whole repo. Each package has its own `AGENTS.md` with its
API surface, canonical wiring, and gotchas — read that one too before generating code against a
package, and prefer it over the package README when the two disagree (`AGENTS.md` is written against
`src/` and the built type declarations, the README is prose that can drift).

## What ServerKit is

A modular TypeScript monorepo of independent server-side packages, published individually to npm
under `@maroonedsoftware/*`. Every package is meant to be usable on its own, so anything one package
assumes about another is a real API contract, not an internal detail.

The centre of gravity is a Koa HTTP API assembled from injectkit DI modules: `koa` gives you the
server, router, context, and middleware stack; `appconfig` supplies typed config; `errors` defines
how failures render; `logger`, `policies`, `authentication`, `permissions`, and `jobbroker` fill in
the cross-cutting concerns. Nothing forces you to take the whole stack — a downstream app can depend
on `errors` alone.

Two audiences use these files:

- **Consumers** — an agent writing an app that imports `@maroonedsoftware/*`. Read the root
  "Building an app on ServerKit" section, then the `AGENTS.md` of each package you import.
- **Contributors** — an agent editing ServerKit itself. Read "Conventions" and "Working in this
  repo" below, then the target package's "Working inside this package" section.

## Package index

| Package             | Layer   | Purpose                                                                                   | Guide                                                       |
| ------------------- | ------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `errors`            | L0      | `ServerkitError` / `HttpError` with chainable details, causes, and internal-only details  | [errors](./packages/errors/AGENTS.md)                       |
| `logger`            | L0      | DI-friendly `Logger` abstraction with a console implementation                            | [logger](./packages/logger/AGENTS.md)                       |
| `utilities`         | L0      | Validation, base32, deterministic avatars, and misc dependency-free helpers               | [utilities](./packages/utilities/AGENTS.md)                 |
| `permissions`       | L0      | Zanzibar-style relationship-based access control with a validated authorization model     | [permissions](./packages/permissions/AGENTS.md)             |
| `eventbus`          | L0      | Synchronous in-process fan-out event dispatch                                             | [eventbus](./packages/eventbus/AGENTS.md)                   |
| `appconfig`         | L1      | Typed config loading, merging, transformation, and runtime reload                         | [appconfig](./packages/appconfig/AGENTS.md)                 |
| `policies`          | L1      | Named, injectable allow/deny rules returning a discriminated `PolicyResult`               | [policies](./packages/policies/AGENTS.md)                   |
| `encryption`        | L1      | Envelope encryption with a pluggable KMS provider interface                               | [encryption](./packages/encryption/AGENTS.md)               |
| `multipart`         | L1      | Streaming `multipart/form-data` parsing with size limits                                  | [multipart](./packages/multipart/AGENTS.md)                 |
| `zod`               | L1      | Zod-to-`HttpError` translation and shared schema helpers                                  | [zod](./packages/zod/AGENTS.md)                             |
| `storage`           | L1      | Object storage abstraction over filesystem, S3, and GCS                                   | [storage](./packages/storage/AGENTS.md)                     |
| `jobbroker`         | L1      | Background jobs on PostgreSQL-backed queues with scoped `JobContext`                      | [jobbroker](./packages/jobbroker/AGENTS.md)                 |
| `serverfeed`        | L1      | Transport-free realtime activity feed: event contract, bus, replay buffer, snapshot       | [serverfeed](./packages/serverfeed/AGENTS.md)               |
| `comms`             | L1      | Channel-agnostic messaging core: router, reply/notifier, template registry                | [comms](./packages/comms/AGENTS.md)                         |
| `cache`             | L1      | Cache interface with a Redis backend, plus an idempotency store for at-least-once sources | [cache](./packages/cache/AGENTS.md)                         |
| `kysely`            | L1      | Kysely/PostgreSQL client wiring plus `pg` and Luxon type helpers                          | [kysely](./packages/kysely/AGENTS.md)                       |
| `permissions-dsl`   | L1      | `.perm` surface syntax, compiler, fixtures, and the `pdsl` CLI                            | [permissions-dsl](./packages/permissions-dsl/AGENTS.md)     |
| `servercore`        | L1      | Framework-agnostic HTTP core: module lifecycle, body parsers, error rendering, SSE        | [servercore](./packages/servercore/AGENTS.md)               |
| `authentication`    | L2      | Auth factors, scheme handlers, sessions, JWT issuance, and account recovery               | [authentication](./packages/authentication/AGENTS.md)       |
| `koa`               | L2      | Server builder, typed context, middleware stack, body parsing, SSE                        | [koa](./packages/koa/AGENTS.md)                             |
| `mcp`               | L2      | Model Context Protocol server over Streamable HTTP, wrapping the official SDK             | [mcp](./packages/mcp/AGENTS.md)                             |
| `discord`           | L3      | Discord interaction dispatcher with Ed25519 signature verification                        | [discord](./packages/discord/AGENTS.md)                     |
| `slack`             | L3      | Slack command/event/interaction dispatcher with signature verification                    | [slack](./packages/slack/AGENTS.md)                         |
| `telegram`          | L3      | Telegram Bot API dispatcher with secret-token webhook verification                        | [telegram](./packages/telegram/AGENTS.md)                   |
| `whatsapp`          | L3      | WhatsApp Cloud API dispatcher with HMAC signature verification                            | [whatsapp](./packages/whatsapp/AGENTS.md)                   |
| `scim`              | L3      | SCIM 2.0 server toolkit: schemas, filter parser, PATCH applier, Koa router                | [scim](./packages/scim/AGENTS.md)                           |
| `johnny5`           | L3      | CLI framework for ServerKit apps, with a doctor runner and plugin discovery               | [johnny5](./packages/johnny5/AGENTS.md)                     |
| `config-eslint`     | tooling | Shared ESLint flat configs (private, workspace-only)                                      | [config-eslint](./packages/config-eslint/AGENTS.md)         |
| `config-typescript` | tooling | Shared `tsconfig` bases (private, workspace-only)                                         | [config-typescript](./packages/config-typescript/AGENTS.md) |
| `vscode-extension`  | app     | VS Code language support for `.perm` files                                                | [vscode-extension](./apps/vscode-extension/AGENTS.md)       |

## Dependency layers

Arrows point downward. A package may depend on any lower layer and never on a higher one.

```
L3  discord  slack  telegram  whatsapp  scim  johnny5
L2  authentication  koa  mcp
L1  appconfig  policies  encryption  multipart  zod  storage
    jobbroker  serverfeed  comms  cache  kysely  permissions-dsl  servercore
L0  errors  logger  utilities  permissions  eventbus
```

L0 packages have zero internal dependencies. `errors`, `logger`, `utilities`, `permissions`, and
`eventbus` must stay that way — they are the packages a downstream app is most likely to adopt
alone, and adding an internal dependency to one of them silently widens every install below it.

### The optional-peer + subpath pattern

Cross-package integrations are wired so the dependency arrow points the way that keeps the
lower-level package standalone. The adapter lives in the package that can afford the dependency,
exposed as a subpath export, with the other side declared an **optional** peer dependency.

`serverfeed` is the sharpest case. It owns the event contract and bus and depends on nothing
internal. Framing and connection handling are a transport concern, so they live in `koa` behind
`@maroonedsoftware/koa/serverfeed`, with `serverfeed` as an optional peer of `koa`. The
logger bridge goes the other way — `@maroonedsoftware/serverfeed/logger`, with `logger` as an
optional peer of `serverfeed` — specifically so `logger` stays dependency-free.

The same pattern covers `discord/comms`, `slack/comms`, `telegram/comms`, `whatsapp/comms`
(adapter in the chat package, `comms` is the core), and every cloud SDK: `appconfig/{aws,gcp}`,
`storage/{s3,gcs}`, `cache/ioredis`, `jobbroker/pgboss`.

**When adding an integration:** put the adapter in the higher-level package, export it as a
subpath, and take the other side as an optional peer. Do not add a hard dependency to keep an
import tidy, and do not add a subpath export whose code is unconditionally reachable from the
root barrel — that defeats the point, since the optional peer then loads on every import.

## Conventions

These are checkable rules. An agent should verify its own output against them before finishing.

### No hyphens — anywhere

The convention most likely to be violated by default.

- **File names** use dot separators, composed from the exported symbol plus a kind suffix:
  `scim.user.service.ts`, `require.security.middleware.ts`, `enterprise.user.schema.ts`.
  Tests mirror their source: `scim.user.service.test.ts`. Barrels are `index.ts`.
- **Catalog keys** — job names, document kinds, rule keys, anything used as a string identifier in
  a `Record<string, …>` — use dot notation: `agreement.terms.of.service`.
- **Code identifiers** are camelCase or PascalCase.

Exception: the directories `permissions-dsl`, `config-eslint`, and `config-typescript` predate the
rule. Their _contents_ still follow it. Do not add new hyphenated names.

### Luxon, not `Date`

Use `DateTime` / `Duration` / `Interval` for all time logic. Never `Date.now()`, `new Date()`, or
`Date.parse()`, and no millisecond arithmetic. Unix seconds are `Math.floor(DateTime.now().toSeconds())`.

Native `Date` is allowed only at interop boundaries: external library type signatures,
`instanceof Date` checks, and reconstituting a stored timestamp. Convert at the boundary and keep
everything in between as Luxon types.

### TypeScript

Strict, with `noUncheckedIndexedAccess`, `experimentalDecorators`, and `emitDecoratorMetadata`
enabled (`packages/config-typescript/base.json`). Modules are `NodeNext`, target `esnext`, ESM only.

Prefer `undefined` over `null` for "not set". Use an optional field with no initializer
(`handledGapForTrackId?: string`) rather than `handledGapForTrackId: string | null = null`.
Reserve `null` for the rare case where "explicitly set to empty" must be distinguished from
"never set", or where an external API forces it.

`noUncheckedIndexedAccess` means every index access is `T | undefined`. Narrow it; do not reach
for `!`.

### Tests

Tests live in `tests/` at the package root, mirroring `src/`, never colocated. Import into
`../src/...` with relative paths. `tests/` stays out of the build tsconfig so `tsc --noEmit`
type-checks only shippable code.

Vitest runs through `unplugin-swc` so decorators and `emitDecoratorMetadata` work. The root
`vitest.config.ts` runs the whole workspace; per package, `cd packages/<name> && pnpm test`.

### Errors

`httpError(n)` is for HTTP responses. Domain rule violations and job failures should throw or
subclass `ServerkitError` (which `HttpError` extends, so the same `withDetails` / `withCause` /
`withInternalDetails` setters apply).

`errorMiddleware` renders a bare `ServerkitError` as a 500 **with** its `details`; a plain `Error`
gets a generic 500 with none. Use `withInternalDetails` for anything that must be logged but never
sent to a client. See [errors](./packages/errors/AGENTS.md).

### Config injection

`appconfig` builds and merges config at bootstrap. A service constructor receives the
already-typed section it needs, not `AppConfig`:

```typescript
// Yes
constructor(private config: MailerConfig, private logger: Logger) {}

// No — leaks the whole config surface and couples the service to bootstrap
constructor(private config: AppConfig) {}
```

The consumer wires `AppConfig` → typed config at composition time, in the module's `setup` hook.
See [appconfig](./packages/appconfig/AGENTS.md) for the `AppConfigSection<T>` token model when a
service needs to observe reloads.

## Building an app on ServerKit

The composition root is a `ServerKitServerBuilder` plus a list of `ServerKitModule`s.

```typescript
import { ServerKitServerBuilder, ServerKitRouter } from '@maroonedsoftware/koa';

const builder = new ServerKitServerBuilder();
const container = await builder.setup(config, logger, modules);

builder
  .setupMiddleware() // defaults to serverKitDefaultMiddleware(container)
  .setupRoutes([router]);

await builder.start(3000);
```

`setup` registers `Logger` and `AppConfig`, wires the body-parser mappings, runs every module's
`setup` hook, and builds the container. It sets Luxon's default zone to UTC on construction and
throws if you call anything else before `setup`.

### Module lifecycle

Hooks run in module registration order at every phase except `shutdown`, which runs in reverse
registration order so a module tears down before whatever it depends on.

| Hook                       | When                             | Use for                                                                    |
| -------------------------- | -------------------------------- | -------------------------------------------------------------------------- |
| `setup(registry, config)`  | Before the container is built    | Registering services and bindings                                          |
| `start(container, signal)` | Socket listening, before "ready" | Wiring that must exist before the first request: subscribers, listeners    |
| `ready(container, signal)` | After every module's `start`     | Background work that must not delay boot: pollers, schedulers, cache warms |
| `shutdown(container)`      | On SIGINT/SIGTERM, reverse order | Closing connections, flushing buffers                                      |

`start` hooks are all awaited, so anything slow belongs in `ready` — work done in `start` delays
boot for every module after it. A `ready` hook that throws is logged and does not block the rest.
Both receive an `AbortSignal` that fires when shutdown begins; honour it cooperatively (pass it to
`fetch`, timers, and long loops) so a shutdown received mid-boot can unwind instead of tearing
down a half-wired server.

### Middleware order is load-bearing

If you build the stack by hand instead of using `serverKitDefaultMiddleware`, this order is not
stylistic:

1. `errorMiddleware()` — **first**; it catches everything downstream.
2. `serverKitContextMiddleware(container)` — creates the request-scoped DI container and attaches
   `logger`, `requestId`, `correlationId`.
3. Rate limiting, CORS, authentication, everything else.
4. `router.routes()` and `router.allowedMethods()` — **last**.

Middleware registered before the context middleware has no `ctx.container` and no `ctx.logger`,
and it will fail at runtime rather than at compile time.

## Working in this repo

### Commands

```bash
pnpm build      # turbo, dependency-aware
pnpm test
pnpm lint
pnpm format
```

Per package: `cd packages/<name> && pnpm test`. Builds are tsup (ESM) plus
`tsc --emitDeclarationOnly` for types.

If pnpm's `verifyDepsBeforeRun` check misfires in a sandboxed session, run the underlying binary
(`vitest`, `eslint`) directly. **Never set `CI=true` to get past it** — that does not skip the
check, it auto-confirms a destructive purge and reinstall of the whole workspace.

### Adding an export

A new public export has to land in four places or it is invisible to consumers:

1. The implementation file, named per the dot convention.
2. The package's `src/index.ts` barrel (or the subpath entry, e.g. `src/serverfeed.ts`).
3. The package `README.md` feature list.
4. The package `AGENTS.md` "API surface" table.

A new _subpath_ export also needs an `exports` entry in `package.json`, a matching tsup entry in
the `build` script, and the peer declared under `peerDependenciesMeta` as optional if it pulls in
an external SDK.

### Changesets

Every user-visible change needs a changeset file in `.changeset/`.

**Do not run `changeset version` in a feature branch.** It consumes every pending changeset in the
repo, not just yours. Add the changeset file and let the release automation do the bump.

### Skills

`.claude/skills/` holds vetted, working examples for the most commonly generated code:
`config`, `error-handler`, `job`, `koa-middleware`, `koa-route`, `logger-setup`, `multipart-upload`.
When generating code of one of those shapes, use the skill's example as the starting point rather
than writing a fresh one — the examples are kept in sync with the packages.
