# ServerKit Skills

Custom Claude Code skills for scaffolding ServerKit applications.

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

### 3. `/job` - Generate Background Job

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

### 4. `/config` - Generate AppConfig Setup

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

### 5. `/error-handler` - Add Error Handling Decorator

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

### 6. `/logger-setup` - Generate Logger DI Setup

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

### 7. `/multipart-upload` - Generate Multipart Upload Route

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

2. **Create routes:**
   ```
   /koa-route post /api/users src/routes/users.routes.ts application/json
   /koa-route get /api/users/:id src/routes/users.routes.ts
   ```

3. **Add middleware:**
   ```
   /koa-middleware auth src/middleware/auth.middleware.ts
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
