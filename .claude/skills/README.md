# ServerKit Skills

Custom Claude Code skills for scaffolding ServerKit applications.

ServerKit ships two HTTP adapters with different models, so the route and middleware skills come
in pairs. Use the `koa-*` skills in an app built on `@maroonedsoftware/koa` and the `fastify-*`
skills in one built on `@maroonedsoftware/fastify`. Their output is not interchangeable.

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
- ServerKitRouter with proper typing
- Body parser middleware (if content types specified)
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
/koa-middleware auth
/koa-middleware rateLimit src/middleware/rate-limit.middleware.ts
```

**What it generates:**
- ServerKitMiddleware type signature
- ServerKitContext access
- Async/await and next() handling
- Error handling pattern
- JSDoc documentation

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
/job ProcessPayment src/jobs/payments/process-payment.job.ts
```

**What it generates:**
- Job class extending Job<Payload>
- Typed payload interface
- @Injectable decorator
- run() method scaffold
- Registration examples
- On-demand and scheduled patterns

---

### 6. `/config` - Generate AppConfig Setup

Generate AppConfig setup with sources and providers for configuration management.

**Usage:**
```
/config [sources...] [--file <path>]
```

**Examples:**
```
/config
/config json yaml dotenv gcp
/config json dotenv --file src/config/app.config.ts
```

**What it generates:**
- AppConfigBuilder with sources
- Providers (env vars, GCP secrets)
- Type-safe config interface
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

Generate logger registration and configuration for dependency injection.

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
- InjectKit registry setup
- Logger interface registration
- Singleton configuration
- Usage examples

---

### 9. `/multipart-upload` - Generate Multipart Upload Route

Generate a route handler for multipart/form-data file uploads.

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
- MultipartBody typing
- File validation (size, mime type)
- Stream handling
- Error handling

---

## Skill Features

All skills:
- Generate production-ready code
- Follow ServerKit best practices
- Include proper TypeScript types
- Add comprehensive error handling
- Include usage examples and comments
- Create or append to existing files intelligently

## Examples Directory

Each skill includes example files in the `examples/` directory showing:
- Common use cases
- Best practices
- Complete working code
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
   /koa-middleware auth src/middleware/auth.middleware.ts
   ```
   ```
   /fastify-plugin requireTenant src/hooks/require.tenant.hook.ts
   ```

4. **Create background jobs:**
   ```
   /job SendEmail src/jobs/send-email.job.ts
   ```

5. **Add error handling:**
   ```
   /error-handler src/services/user.service.ts postgres
   ```

6. **Add file uploads:**
   ```
   /multipart-upload /api/users/:id/avatar src/routes/users.routes.ts
   ```

This scaffolds a complete ServerKit application with routes, middleware, jobs, config, logging, error handling, and file uploads!
