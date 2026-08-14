# AGENTS.md — @maroonedsoftware/logger

Machine-oriented guide for AI agents. Human prose and long-form examples live in [README.md](./README.md).
Repo-wide conventions live in the [root AGENTS.md](../../AGENTS.md).

## Purpose

A five-level logging abstraction (`error`, `warn`, `info`, `debug`, `trace`) that exists so every
other ServerKit package can log without picking a logging library for its consumer. `Logger` is an
injectable abstract class used as a DI token; `ConsoleLogger` is the trivial implementation.

Reach for this whenever a service needs to log. Do **not** reach for it expecting features — there
is no level filtering, no formatting, no transports, no child loggers, and no async context. If you
need those, implement `Logger` over pino/winston and register that instead.

## Install

```bash
pnpm add @maroonedsoftware/logger
```

Runtime dependency: `injectkit` (for the `@Injectable()` decorator on the token). No internal
dependencies, and it must stay that way.

## Position in the graph

- **Depends on:** nothing internal.
- **Depended on by:** `appconfig`, `authentication`, `comms`, `discord`, `jobbroker`, `johnny5`,
  `koa`, `mcp`, `scim`, `slack`, `telegram`, `whatsapp`, and — as an **optional** peer —
  `serverfeed`.
- **Subpath exports:** none. The package has no `exports` map at all.

The `serverfeed` relationship is the one to understand: the bridge that turns log calls into feed
events lives at `@maroonedsoftware/serverfeed/logger`, with `logger` declared an optional peer
there. That direction is deliberate, and it is why this package has no dependency on `serverfeed`.

## API surface

| Export          | Kind           | Shape                                                                               | Notes                                                                                                     |
| --------------- | -------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `Logger`        | interface      | `error/warn/info/debug/trace(message: unknown, ...optionalParams: unknown[]): void` | All five methods are synchronous and return `void`.                                                       |
| `Logger`        | abstract class | `@Injectable() abstract class Logger implements Logger {}`                          | Declaration-merged with the interface. This is the DI token you register against and inject.              |
| `ConsoleLogger` | class          | `new ConsoleLogger(_console: Console = console)`                                    | Implements `Logger` by forwarding to the matching `console` method. The constructor arg exists for tests. |

That is the entire public surface.

## Canonical usage

```typescript
import 'reflect-metadata';
import { InjectKitRegistry, Injectable } from 'injectkit';
import { Logger, ConsoleLogger } from '@maroonedsoftware/logger';

const registry = new InjectKitRegistry();
registry.register(Logger).useClass(ConsoleLogger).asSingleton();
const container = registry.build();

@Injectable()
class InvoiceService {
  constructor(private readonly logger: Logger) {}

  async issue(id: string) {
    this.logger.info('issuing invoice', { id });
  }
}
```

Inside a Koa request, do not resolve the logger from the root container — use `ctx.logger`, which
`serverKitContextMiddleware` attaches along with `requestId` and `correlationId`. See
[.claude/skills/logger-setup](../../.claude/skills/logger-setup).

## Rules for generated code

- Register and inject the abstract class `Logger`, never `ConsoleLogger`. The concrete class is a
  composition-root choice.
- Register as a singleton. A per-request logger instance buys nothing here.
- Log structured context as an extra parameter (`logger.info('message', { id })`), not by string
  interpolation. Downstream `Logger` implementations forward the rest args to their own structured
  field, and interpolated data cannot be recovered.
- Inside a Koa handler or a request-scoped service, prefer `ctx.logger` over an injected `Logger`
  so the request and correlation IDs travel with the line.
- Never log `internalDetails` from a `ServerkitError` to a client-facing path, and never log
  secrets, tokens, or raw request bodies.
- Implementing `Logger` over another library is expected. Implement the interface; do not fork
  `ConsoleLogger`.

## Gotchas

- **There is no level filtering.** `ConsoleLogger.trace()` calls `console.trace()`, which prints a
  stack trace to stderr on every call. In production, register an implementation that filters, or
  do not call `trace`.
- **`console.debug` goes to stdout, `console.trace` and `console.error` and `console.warn` go to
  stderr.** That is Node's behaviour, inherited unchanged. Log-shipping configs that only follow
  stdout will silently drop warnings.
- **`Logger` is both an interface and a class with the same name.** That is deliberate
  declaration merging (see the `no-unsafe-declaration-merging` disable in `src/logger.ts`) so the
  single symbol works as a type, an implementable interface, and a runtime DI token. Do not
  "clean it up" by splitting them — every registration in the monorepo depends on the class
  identity being the same symbol as the type.
- **Nothing is async.** A `Logger` implementation that needs to flush must do so on its own; the
  interface gives callers no way to await a write.

## Working inside this package

```
src/
  logger.ts          The Logger interface + injectable abstract class token
  console.logger.ts  ConsoleLogger
  index.ts           Barrel
```

Tests are in `tests/`, mirroring `src/`.

Invariants a change must not break:

- **No internal dependencies.** `injectkit` is the only runtime dependency, and adding a second one
  needs a strong reason: every ServerKit package that logs pulls this in.
- The declaration merge of interface and abstract class is load-bearing (see Gotchas).
- The five levels are the contract. Adding a level is a breaking change for every implementation
  outside this repo.

User-visible changes need a changeset in `.changeset/`.
