# ServerKit

A modular collection of TypeScript packages for building Node.js server applications.

---

## Packages

### AppConfig

Flexible, type-safe configuration management with support for multiple sources and value transformation.

- Load from JSON, YAML, and `.env` files
- Transform values using environment variables and GCP secrets
- Merge configurations from multiple sources

[View documentation →](./packages/appconfig/README.md)

---

### Authentication

Authentication primitives for ServerKit applications.

- Pluggable authentication factors (email, password, TOTP)
- JWT-based session handling
- Password strength validation and rate limiting

[View documentation →](./packages/authentication/README.md)

---

### Cache

Cache utilities with pluggable backends.

- DI-friendly cache interface
- Redis (ioredis) backend support
- Rate limiting helpers

[View documentation →](./packages/cache/README.md)

---

### Encryption

Encryption primitives for ServerKit applications, including envelope encryption and a pluggable KMS provider interface.

- DI-friendly encryption services
- Per-id KMS provider with key rotation and deterministic fingerprinting
- In-memory KMS provider for tests and local development
- Integrates with the errors package for consistent failures

[View documentation →](./packages/encryption/README.md)

---

### Errors

Comprehensive error handling with fluent API design and database integration.

- HTTP error classes with chainable methods
- PostgreSQL error mapping and handling
- Class-level error decorators

[View documentation →](./packages/errors/README.md)

---

### JobBroker

Background job processing powered by PostgreSQL-backed queues.

- Scheduled and on-demand job execution
- Built on pg-boss for reliable delivery
- Simple runner abstraction

[View documentation →](./packages/jobbroker/README.md)

---

### Koa

Koa middleware, body parsing, and utilities for ServerKit.

- Typed `ServerKitContext` with request-scoped DI container
- Error, CORS, rate limiting, and context middleware
- Type-safe router and middleware wrappers

[View documentation →](./packages/koa/README.md)

---

### Kysely

Kysely utilities for ServerKit applications backed by PostgreSQL.

- DI-friendly database client setup
- Shared helpers for `pg` and Luxon types

[View documentation →](./packages/kysely/README.md)

---

### Logger

Lightweight logging abstraction designed for dependency injection.

- Multiple log levels
- DI-friendly interface
- Console logger implementation

[View documentation →](./packages/logger/README.md)

---

### Multipart

Robust multipart/form-data parsing with stream support.

- Promise-based API
- Configurable size limits
- Efficient stream-based file handling

[View documentation →](./packages/multipart/README.md)

---

### Utilities

Common utility functions for everyday server development.

- UUID and email validation
- Base32 encoding/decoding
- Lightweight and dependency-free

[View documentation →](./packages/utilities/README.md)

---

### Zod

Zod utilities for ServerKit, integrated with the errors package.

- Helpers for translating Zod issues into HTTP errors
- Shared schema utilities

[View documentation →](./packages/zod/README.md)

---

## Requirements

- Node.js 22+
- pnpm 10.24.0+

## Development

```bash
pnpm install    # Install dependencies
pnpm build      # Build all packages
pnpm test       # Run tests
pnpm lint       # Lint
pnpm format     # Format
```

## License

MIT
