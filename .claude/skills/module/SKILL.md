---
user-invocable: true
allowed-tools: Read, Write, Edit, Grep, Glob
description: Generate a ServerKitModule, the unit a ServerKit app is composed from, with DI registrations in setup and the right start, ready, and shutdown hooks. Works on both @maroonedsoftware/koa and @maroonedsoftware/fastify.
argument-hint: <name> [file]
---

# /module - Generate ServerKit Module

Generate a `ServerKitModule`: a named object that registers services and takes part in the server's
lifecycle. An app is the array of modules passed to `builder.setup`. The contract lives in
`@maroonedsoftware/servercore` and behaves the same on both adapters.

## Arguments

1. `name` (required): Module name in camelCase (e.g., `mailer`, `billing`)
2. `file` (optional): Output file path (defaults to `src/modules/<name>/<name>.module.ts`, with the name in dot notation)

## What This Skill Does

1. Creates a module file with:
   - A `ServerKitModule` export with a `name`
   - A `setup` hook registering the services
   - Only the other hooks the module needs
   - A typed config binding, if the services need configuration
2. Shows the line to add to the array passed to `builder.setup`

## Examples

Generate a module with the default path:
```
/module mailer
```

Generate at a specific path:
```
/module billing src/billing/billing.module.ts
```

## Implementation Pattern

```typescript
import type { ServerKitModule } from '@maroonedsoftware/koa'; // Or @maroonedsoftware/fastify.

export const {name}Module: ServerKitModule = {
  name: '{name}',

  async setup(registry, config) {
    // TODO: Register services. The container does not exist yet, so resolve nothing here.
    registry.register(SomeService).useClass(SomeService).asScoped();
  },

  async start(container, signal) {
    // TODO: Fast wiring that must exist before traffic: subscribers, listeners. Delete if unused.
  },

  async ready(container, signal) {
    // TODO: Slow background work: pollers, schedulers, cache warms. Delete if unused.
  },

  async shutdown(container) {
    // TODO: Close connections, flush buffers. Delete if unused.
  },
};
```

Add it to the composition root:

```typescript
await builder.setup(config, logger, [dataModule, {name}Module]);
```

## Instructions for Claude

When this skill is invoked:

1. **Parse arguments:**
   - Extract name and file (optional)
   - If no file specified, derive from the name in dot notation, with no hyphens
   - Import `ServerKitModule` from the adapter the app installed. Both re-export it

2. **Write `setup` first:**
   - Register with `registry.register(Token)` then `.useClass(Class).asScoped()`, `.asSingleton()`, or `.asTransient()`, or `.useInstance(value)`, or `.useFactory(...)`
   - Do not register `Logger` or `AppConfig`. `builder.setup` has already done so
   - Give a service its typed config section, not `AppConfig`: `registry.register(MailerConfig).useInstance(config.getAs<MailerConfig>('mailer'))`
   - A singleton may not depend on a scoped registration: `registry.build()` rejects that
   - Every hook is `async`, because each one must return a promise

3. **Choose the hooks by what the work needs:**
   - `start(container, signal)` runs once the socket is listening, in array order, and each one is awaited. Use it for fast wiring. A rejection fails `builder.start`
   - `ready(container, signal)` runs after every `start`, and is not awaited by `builder.start`. Use it for anything slow. Honour `signal` by passing it to `fetch`, timers, and long loops
   - `shutdown(container)` runs in reverse array order, so a module tears down before whatever it depends on
   - Omit a hook the module does not need

4. **Decide whether `ready` is required:**
   - By default a `ready` hook that throws is logged and the remaining modules still run, which suits a cache warm
   - Set `readyRequired: true` when the server is not whole without the hook. A failure then closes the server and it exits with code 1
   - Such a hook should retry what is merely not up yet, and reject only on what a restart should surface

5. **Resolve from the right container:**
   - Hooks receive the root container. Resolve singletons from it
   - Do not resolve a scoped service at the root: it gets cached there and is inherited by every later request scope. Use `container.createScopedContainer()`, and call `disposeAsync()` on the scope when done
   - Do not resolve `ServerKitContext` in a hook. It exists only inside a request

6. **Order the array:** a module goes after the modules whose services it uses in `start` and `ready`. Say so in a comment if it matters

7. **App entry point:** InjectKit reads constructor types through decorator metadata, so the entry point must `import 'reflect-metadata'` first and the tsconfig must set `experimentalDecorators` and `emitDecoratorMetadata`

8. **Confirm to user:**
   - Show the file path, and which hooks were generated
   - Show the line to add to the `builder.setup` array, and where it should go relative to the others
