# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ServerKit is a modular TypeScript monorepo for building Node.js server applications. It consists of independent packages that can be used together or separately, with a focus on Koa-based HTTP APIs, configuration management, error handling, and background jobs.

**Tech Stack:**

- Node.js 22+
- TypeScript 5.9.3
- pnpm 10.24.0+ (workspace monorepo)
- Turbo (build orchestration)
- Vitest (testing)
- ESLint (linting)
- tsup (bundling)

## Development Commands

```bash
# Install dependencies
pnpm install

# Build all packages (respects dependency order)
pnpm build

# Run all tests
pnpm test

# Run tests for a single package
cd packages/<package-name>
pnpm test

# Run tests in watch mode
cd packages/<package-name>
pnpm test -- --watch

# Lint all packages
pnpm lint

# Format all packages
pnpm format

# Create a changeset for versioning
pnpm changeset
```

## Repository Structure

```
packages/
├── appconfig/       # Configuration management with multiple sources
├── authentication/  # Scheme dispatch, sessions, JWT, OTP, password/email/phone/authenticator/FIDO factors
├── cache/           # CacheProvider abstraction with an ioredis implementation
├── encryption/      # AES-GCM envelope encryption and per-id KMS provider
├── errors/          # HTTP error handling and PostgreSQL error mapping
├── jobbroker/       # Background job processing (pg-boss wrapper)
├── koa/             # Koa middleware and utilities
├── kysely/          # Kysely repository base, transaction helpers, PG type overrides
├── logger/          # Logger interface and console implementation
├── multipart/       # Multipart form-data parsing
├── utilities/       # Common utilities (UUID, email, base32)
├── zod/             # Zod-to-httpError validation helper
├── config-eslint/   # Shared ESLint configuration
└── config-typescript/ # Shared TypeScript configuration
```

## Architecture

### Package Dependencies

The monorepo uses workspace references (`workspace:*`). Key dependency relationships:

- **koa** depends on: `appconfig`, `authentication`, `errors`, `logger`, `multipart`, `utilities`
- **authentication** depends on: `cache`, `encryption`, `errors`, `logger`, `utilities`
- **cache** depends on: `errors`, `logger`, `utilities`
- **encryption** depends on: `errors`
- **jobbroker** depends on: `logger`
- **kysely** depends on: `errors`, `utilities`
- **multipart** depends on: `errors`
- **zod** depends on: `errors`
- **errors**, **appconfig**, **logger**, **utilities** are standalone (no internal deps)
- All packages use `config-eslint` and `config-typescript`

### Error Handling Pattern

ServerKit uses a fluent HTTP error pattern throughout:

```typescript
import { httpError } from '@maroonedsoftware/errors';

// Basic error
throw httpError(404);

// With details (for validation errors)
throw httpError(400).withDetails({ email: 'Invalid format' });

// With headers
throw httpError(401).withHeaders({ 'WWW-Authenticate': 'Bearer' });

// With cause (for error chaining)
throw httpError(500).withCause(originalError);

// With internal details (for logging, not exposed)
throw httpError(500).withInternalDetails({ userId: 123 });
```

The `errorMiddleware` in the koa package catches these errors and serializes them to appropriate HTTP responses.

For errors that aren't HTTP-shaped (domain rule violations, background-job failures, etc.), throw or subclass `ServerkitError` — `HttpError` extends it, so the same `withDetails` / `withCause` / `withInternalDetails` setters apply. `errorMiddleware` recognises a bare `ServerkitError` and renders it as a 500 with the attached `details` (a plain `Error` gets a generic 500 with no details).

### Koa Integration

The **koa** package provides a typed context pattern:

1. **ServerKitContext** extends Koa's context with:
   - `container`: Request-scoped InjectKit DI container
   - `logger`: Request-scoped logger instance
   - `requestId`: From `X-Request-Id` header or generated
   - `correlationId`: From `X-Correlation-Id` header or generated
   - `userAgent`: From `User-Agent` header

2. **ServerKitRouter** and **ServerKitMiddleware** are type-safe wrappers that ensure proper context typing

3. **Middleware order** is critical:
   ```typescript
   app.use(errorMiddleware()); // First: catch all errors
   app.use(serverKitContextMiddleware(container)); // Set up context
   app.use(corsMiddleware({ origin: ['*'] })); // CORS
   // ... other middleware
   app.use(router.routes()); // Last: route handlers
   ```

### Configuration Pattern

The **appconfig** package uses a builder pattern with sources and providers:

- **Sources** load config from files (JSON, YAML, .env)
- **Providers** transform values (resolve env vars, GCP secrets)
- Configs are deep-merged in order (last wins)

```typescript
const config = await new AppConfigBuilder()
  .addSource(new AppConfigSourceJson('./config.json'))
  .addSource(new AppConfigSourceDotenv())
  .addProvider(new AppConfigProviderDotenv()) // Resolves ${env:VAR}
  .build<MyConfigType>();
```

### Decorator Pattern

The **errors** package provides decorators for class-level error handling:

- `@OnError(handler)`: Wraps all methods with error handling
- `@OnPostgresError()`: Maps PostgreSQL errors to HTTP errors automatically

These are used on service classes to handle database errors consistently.

## Testing

- Tests use **Vitest** with `unplugin-swc` for fast TypeScript compilation
- Test files: `packages/*/tests/**/*.test.ts`
- Each package has its own `vitest.config.ts`
- Tests run in Node environment with globals enabled
- Coverage via `@vitest/coverage-v8`

## Build System

- **Turbo** orchestrates builds with dependency awareness
- Each package builds with **tsup** (ESM format, sourcemaps, declaration files)
- Output: `packages/*/dist/`
- Build inputs include `.env*` files (some packages use env vars at build time)

## Important Patterns

### Fluent API Design

Many packages use method chaining for configuration:

```typescript
throw httpError(400).withDetails({}).withCause(err);
config.addSource(s1).addSource(s2).addProvider(p1).build();
```

### Dependency Injection

The koa package integrates with **InjectKit** for request-scoped services. The `serverKitContextMiddleware` creates a scoped container per request, allowing services to access request-specific data (logger, request IDs, etc.).

### Type Safety

All packages are fully typed. The koa package uses generic types (`ServerKitContext`, `ServerKitMiddleware<ResponseBody>`) to ensure type safety in route handlers.
