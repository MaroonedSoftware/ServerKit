# ServerKit Skills

Custom Claude Code skills for scaffolding ServerKit applications.

ServerKit ships two HTTP adapters with different models, so the route and middleware skills come
in pairs. Use the `koa-*` skills in an app built on `@maroonedsoftware/koa` and the `fastify-*`
skills in one built on `@maroonedsoftware/fastify`. Their output is not interchangeable.

`/multipart-upload` is Koa-only for the same reason; on Fastify use `/fastify-route` with
`multipart/form-data`. The remaining skills (`/config`, `/error-handler`, `/job`, `/logger-setup`,
`/module`) are adapter-neutral.

Each skill's examples are checked against package source when the skills are refreshed. Nothing
in CI compiles them, so if one disagrees with a package's `src/index.ts`, trust the source and fix
the example.

## Available Skills

### 1. `/koa-route` - Generate Koa Route Handler

Generate a properly typed Koa route handler with ServerKit patterns.

**Usage:**
```
/koa-route <method> <path> [file] [content-types]
```

**Examples:**
```
/koa-route get /api/users
/koa-route post /api/users src/routes/users.routes.ts application/json
/koa-route put /api/users/:id src/routes/users.routes.ts application/json
```

**What it generates:**
- A router from `ServerKitRouter()`, with `ctx` typed as `ServerKitContext`
- `bodyParserMiddleware` (if content types specified), with the payload on `ctx.parsedBody`
- `requirePolicy()` guard for authenticated routes
- Error handling with httpError
- Logger integration
- Request ID tracking
- DI container access

---

### 2. `/koa-middleware` - Generate Custom Middleware

Generate custom ServerKit middleware with proper typing and error handling.

**Usage:**
```
/koa-middleware <name> [file]
```

**Examples:**
```
/koa-middleware requestTiming
/koa-middleware requireTenant src/middleware/require.tenant.middleware.ts
```

**What it generates:**
- `ServerKitMiddleware` for the server stack, or `ServerKitRouterMiddleware` for one route
- ServerKitContext access
- Async/await and next() handling
- Rejection by throwing `HttpError`
- JSDoc saying where in the stack it belongs

---

### 3. `/fastify-route` - Generate Fastify Route Plugin

Generate a route on a Fastify plugin with ServerKit patterns.

**Usage:**
```
/fastify-route <method> <path> [file] [content-types]
```

**Examples:**
```
/fastify-route get /api/users
/fastify-route post /api/users src/routes/users.routes.ts application/json
```

**What it generates:**
- A `FastifyPluginAsync` for `builder.setupRoutes`
- `config.body` content-type allow-list when the route takes a body
- `requirePolicy()` guard in `preHandler`
- Error handling with httpError
- Logger integration and request ID tracking
- DI container access, and an optional Zod schema variant

---

### 4. `/fastify-plugin` - Generate Fastify Plugin or Guard

Generate a step for the Fastify plugin stack, or a guard for one route.

**Usage:**
```
/fastify-plugin <name> [file]
```

**Examples:**
```
/fastify-plugin apiVersion
/fastify-plugin requireTenant src/hooks/require.tenant.hook.ts
```

**What it generates:**
- `serverKitPlugin(name, fn)` wrapping, so hooks are not encapsulated
- The right hook phase for the job, `onRequest` or `preHandler`
- Request context access and `HttpError` rejection
- JSDoc saying where in the stack it belongs

---

### 5. `/job` - Generate Background Job

Generate a background job class with typed payload and JobBroker integration.

**Usage:**
```
/job <name> [file]
```

**Examples:**
```
/job SendEmail
/job ProcessPayment src/jobs/payments/process.payment.job.ts
```

**What it generates:**
- Job class extending Job<Payload>
- Typed payload interface
- @Injectable decorator
- run() method scaffold
- `PgBossJobRegistryMap` entry and DI registration
- On-demand (`JobBroker.send`) and scheduled (`cron`) patterns

---

### 6. `/config` - Generate AppConfig Setup

Generate AppConfig setup with sources and resolvers for configuration management.

**Usage:**
```
/config [sources...] [--file <path>]
```

**Examples:**
```
/config
/config json yaml dotenv env gcp
/config json dotenv --file src/config/app.config.ts
```

**What it generates:**
- AppConfigBuilder with sources
- Resolvers (`${env:KEY}`, GCP and AWS secrets)
- Type-safe config shape
- Usage examples

---

### 7. `/error-handler` - Add Error Handling Decorator

Add error handling decorators to a class for automatic error conversion.

**Usage:**
```
/error-handler <file> <decorator-type>
```

**Decorator types:**
- `http` - General error handling with @OnError
- `postgres` - PostgreSQL error mapping with @OnPostgresError

**Examples:**
```
/error-handler src/services/user.service.ts postgres
/error-handler src/services/auth.service.ts http
```

**What it does:**
- Adds appropriate imports
- Adds decorator to class
- Preserves existing code
- Automatic error conversion

---

### 8. `/logger-setup` - Generate Logger DI Setup

Generate logger setup for the server builder, or for a standalone registry.

**Usage:**
```
/logger-setup [file]
```

**Examples:**
```
/logger-setup
/logger-setup src/config/logger.config.ts
```

**What it generates:**
- A logger to pass to `builder.setup`
- A `Logger` token registration for code with no server builder
- Usage examples, including a custom logger

---

### 9. `/multipart-upload` - Generate Multipart Upload Route

Generate a **Koa** route handler for multipart/form-data file uploads. On Fastify run
`/fastify-route post <path> <file> multipart/form-data` instead.

**Usage:**
```
/multipart-upload <path> [file]
```

**Examples:**
```
/multipart-upload /api/upload
/multipart-upload /api/users/:id/avatar src/routes/users.routes.ts
```

**What it generates:**
- POST route with multipart parser
- MultipartBody typing, from `@maroonedsoftware/multipart`
- A file handler passed to `body.parse`, with count and size limits and a mime type check
- Stream handling
- Error handling

---

### 10. `/module` - Generate ServerKit Module

Generate a `ServerKitModule`, the unit a ServerKit app is composed from. Works on both adapters.

**Usage:**
```
/module <name> [file]
```

**Examples:**
```
/module mailer
/module billing src/billing/billing.module.ts
```

**What it generates:**
- A named module with DI registrations in `setup`
- The `start`, `ready`, and `shutdown` hooks the module needs
- A typed config binding
- The line to add to the `builder.setup` array

---

## Skill Features

All skills:
- Generate a starting point with TODOs, not finished business logic
- Follow the conventions in the root `AGENTS.md`: dot-separated file names and catalog keys, Luxon for time
- Include proper TypeScript types
- Signal failures with `HttpError` or a `ServerkitError` subclass
- Include usage examples and comments
- Create new files, and most also append to existing ones

## Examples Directory

Each skill includes example files in the `examples/` directory showing:
- Common use cases
- The imports and wiring the package expects
- Integration patterns

## Development Workflow

Typical workflow using these skills:

1. **Setup configuration:**
   ```
   /config json dotenv
   /logger-setup
   ```

2. **Create routes** (pick the pair matching your adapter):
   ```
   /koa-route post /api/users src/routes/users.routes.ts application/json
   /koa-route get /api/users/:id src/routes/users.routes.ts
   ```
   ```
   /fastify-route post /api/users src/routes/users.routes.ts application/json
   /fastify-route get /api/users/:id src/routes/users.routes.ts
   ```

3. **Add middleware or plugins:**
   ```
   /koa-middleware requireTenant src/middleware/require.tenant.middleware.ts
   ```
   ```
   /fastify-plugin requireTenant src/hooks/require.tenant.hook.ts
   ```

4. **Create background jobs:**
   ```
   /job SendEmail src/jobs/send.email.job.ts
   ```

5. **Add error handling:**
   ```
   /error-handler src/services/user.service.ts postgres
   ```

6. **Add file uploads (Koa):**
   ```
   /multipart-upload /api/users/:id/avatar src/routes/users.routes.ts
   ```

7. **Group the services into modules:**
   ```
   /module mailer
   ```

This scaffolds the shape of a ServerKit application: routes, middleware, jobs, config, logging, error handling, and file uploads, with the TODOs left for you to fill in.
