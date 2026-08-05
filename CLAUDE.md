# CLAUDE.md

ServerKit is a modular TypeScript monorepo of independent server-side packages (`packages/*`), built around Koa HTTP APIs, DI, config, errors, auth, and background jobs. Packages are published individually under `@maroonedsoftware/*` and are meant to be usable on their own, so anything one package assumes about another is a real API contract.

Read a package's `README.md` and `package.json` for what it does and what it depends on. This file covers only the things you cannot learn from the tree.

## Conventions

**No hyphens — anywhere.** This is the convention most likely to be violated by default:

- File names use dot separators, composed from the exported symbol plus a kind suffix: `scim.user.service.ts`, `require.security.middleware.ts`, `enterprise.user.schema.ts`. Tests mirror their source: `scim.user.service.test.ts`. Barrels are `index.ts`.
- Catalog keys (job names, document kinds, rule keys, anything used as a string identifier in a `Record<string, …>`) use dot notation: `agreement.terms.of.service`.
- Code identifiers are camelCase / PascalCase.

Exception: the directories `permissions-dsl`, `config-eslint`, and `config-typescript` predate this rule. Their *contents* still follow it. Do not add new hyphenated names.

**Luxon, not `Date`.** Use `DateTime` / `Duration` / `Interval` for all time logic. Never `Date.now()`, `new Date()`, or `Date.parse()`, and no millisecond arithmetic. Unix seconds are `Math.floor(DateTime.now().toSeconds())`. Native `Date` is allowed only at interop boundaries: external library type signatures, `instanceof Date` checks, and reconstituting a stored timestamp. Convert at the boundary and keep everything in between as Luxon types.

**Tests live in `tests/` at the package root**, mirroring `src/`, not colocated. `tests/` stays out of the build tsconfig so `tsc --noEmit` only checks shippable code.

TypeScript is strict with `noUncheckedIndexedAccess` and decorators enabled. Prefer `undefined` over `null` for "not set".

## Gotchas

**Koa middleware order is load-bearing.** `errorMiddleware()` must be first (it catches everything downstream), then `serverKitContextMiddleware(container)` (which creates the request-scoped DI container and attaches `logger` / `requestId` / `correlationId`), then everything else, with `router.routes()` last. Middleware registered before the context middleware will not have `ctx.container` or `ctx.logger`.

**Errors that aren't HTTP-shaped.** `httpError(n)` is for HTTP responses; domain rule violations and job failures should throw or subclass `ServerkitError` (which `HttpError` extends, so the same `withDetails` / `withCause` / `withInternalDetails` setters apply). `errorMiddleware` renders a bare `ServerkitError` as a 500 *with* its `details`; a plain `Error` gets a generic 500 with none. Use `withInternalDetails` for anything that must be logged but never sent to a client.

**Cross-package dependency arrows are deliberate.** Optional integrations are wired as optional peer deps plus a subpath export, so the dependency points the way that keeps the lower-level package standalone. `serverfeed` is the sharpest case: it owns the event contract and bus only and depends on nothing internal. Framing and connection handling belong to a transport (koa's SSE module), and the `serverfeed/logger` bridge lives in `serverfeed` with `logger` as an optional peer specifically so `logger` stays dependency-free. When adding an integration, put the adapter in the higher-level package and take the other side as an optional peer — do not add a hard dependency to keep an import tidy.

**Services take typed config, not `AppConfig`.** `appconfig` builds and merges config at bootstrap; a service constructor should receive the already-typed section it needs. The consumer wires `AppConfig` → typed config at composition time.

**Do not run `changeset version` in a feature branch.** It consumes every pending changeset in the repo, not just yours. Add the changeset file and let the release automation do the bump.

## Commands

`pnpm build`, `pnpm test`, `pnpm lint`, `pnpm format` at the root (Turbo, dependency-aware). Per package, `cd packages/<name> && pnpm test`. Vitest with `unplugin-swc`; tsup for ESM builds.

If pnpm's `verifyDepsBeforeRun` check misfires in a sandboxed session, run the underlying binary (`vitest`, `eslint`) directly. Never set `CI=true` to get past it — that auto-confirms a destructive purge and reinstall of the whole workspace.
