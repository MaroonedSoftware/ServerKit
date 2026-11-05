---
user-invocable: true
allowed-tools: Read, Write, Edit, Grep, Glob
description: Set up @maroonedsoftware/logger for a ServerKit app, passing a Logger to the server builder or registering it on a standalone InjectKit registry, with ConsoleLogger or a custom implementation
argument-hint: [file]
---

# /logger-setup - Generate Logger DI Setup

Generate logger setup for a ServerKit app, so `Logger` can be injected anywhere.

## Arguments

1. `file` (optional): Output file path (defaults to `src/config/logger.config.ts`)

## What This Skill Does

1. Creates a complete logger config file with:
   - A `createLogger` function for the server builder
   - A `configureLogger` function registering `Logger` to `ConsoleLogger`, for code with no server builder
   - Export for use in application bootstrap
   - Usage example in comments

## Examples

Generate logger setup with defaults:
```
/logger-setup
```

Generate at specific path:
```
/logger-setup src/config/logger.config.ts
```

## Implementation Pattern

The generated logger setup will follow this pattern:

```typescript
import { InjectKitRegistry } from 'injectkit';
import { Logger, ConsoleLogger } from '@maroonedsoftware/logger';

/**
 * The logger for a server. builder.setup registers it against the Logger token.
 */
export const createLogger = (): Logger => new ConsoleLogger();

/**
 * Logger registration for code with no server builder, such as a worker or a script.
 */
export const configureLogger = (registry: InjectKitRegistry): void => {
  registry.register(Logger).useClass(ConsoleLogger).asSingleton();
};

// Usage in a server bootstrap:
//
// const builder = new ServerKitServerBuilder();
// await builder.setup(config, createLogger(), modules);
//
// // Now you can inject Logger in your classes:
// @Injectable()
// class MyService {
//   constructor(private readonly logger: Logger) {}
//
//   doWork() {
//     this.logger.info('Working...', { data: 'example' });
//   }
// }
```

## Instructions for Claude

When this skill is invoked:

1. **Parse arguments:**
   - Extract file path (optional)
   - Default to `src/config/logger.config.ts` if not specified

2. **Generate logger config file:**
   - Import `InjectKitRegistry` from `injectkit`
   - Import `Logger` and `ConsoleLogger` from `@maroonedsoftware/logger`
   - Create `createLogger`, and `configureLogger` if the app has code running outside the server builder
   - In `configureLogger`, register `Logger` to the `ConsoleLogger` class as a singleton

3. **Wire it correctly:**
   - On a server, pass the logger to `builder.setup(config, logger, modules)`. That call registers it against the `Logger` token, so a module must not register `Logger` again
   - On Koa it is then `ctx.logger`, and on Fastify `request.logger`, resolved from the request's scoped container by `serverKitContextMiddleware` or `serverKitContextPlugin`
   - Those context steps add `requestId` and `correlationId` to the context, not to log lines. Pass them in the data argument, or write a custom logger

4. **Add JSDoc documentation:**
   - Document both functions
   - Explain that `Logger` is an abstract class used as a DI token, and `ConsoleLogger` the implementation

5. **Include logger usage examples:**
   - Show structured logging with data objects
   - Show error logging: the first argument is `unknown`, so `logger.error(error, { requestId })` works
   - Show different log levels: `error`, `warn`, `info`, `debug`, `trace`
   - Mention that `ConsoleLogger` writes to the console and takes an alternative `Console` in its constructor

6. **Add advanced notes:**
   - A custom logger (e.g., one wrapping Pino or Winston) implements all five methods, each `(message: unknown, ...optionalParams: unknown[]): void`
   - On a server, pass an instance of it to `builder.setup`. Elsewhere, register it against the `Logger` token

7. **Write file:**
   - Create the complete logger config file
   - Ensure proper formatting

8. **Confirm to user:**
   - Show the file path where config was created
   - Explain how to use it in application bootstrap
   - Mention that Logger can now be injected in any class resolved from the container
