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

- Pluggable authentication factors: password, email (OTP/magic link), phone (OTP), authenticator app (TOTP/HOTP), FIDO2/WebAuthn, and single-use recovery codes
- Scheme-based handler dispatch with built-in JWT (multi-issuer Bearer) and Basic support
- Server-side session lifecycle and JWT issuance
- Password strength validation (zxcvbn + HaveIBeenPwned) and rate-limited verification
- Account recovery orchestrator covering forgot-password, MFA recovery, account unlock, and full account recovery

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

- `ServerkitError` base class with chainable `withDetails` / `withCause` / `withInternalDetails`
- `HttpError` subclass with status codes and response headers
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

### Permissions

Zanzibar-style relationship-based access control.

- Authorization model DSL with `direct`, `computed`, `tupleToUserset`, `union`, `intersection`, `exclusion`
- Validated `AuthorizationModel` — bad models fail at startup, not at Check time
- Pluggable `PermissionsTupleRepository` for any storage backend
- Recursive Check evaluator with per-request memo, cycle guard, and pluggable metrics sink

[View documentation →](./packages/permissions/README.md)

---

### Policies

Small, DI-friendly framework for encoding allow/deny rules as named, injectable `Policy` classes.

- Discriminated `PolicyResult` (`{ allowed: true } | { allowed: false, reason, details? }`) so policies surface machine-readable reasons instead of throwing
- Type-safe `PolicyService` — declare a `Policies` map and `check`/`assert` enforce the right context per name at compile time
- Per-evaluation envelope with `now: DateTime` (extend with session, request id, …)
- `denyStepUp(reason, requirement)` helper bundles a `StepUpRequirement` for re-auth-gated operations

[View documentation →](./packages/policies/README.md)

---

### SCIM

SCIM 2.0 (RFC 7643/7644) server toolkit — schemas, filter parser, PATCH applier, error envelope, and a Koa router with abstract repositories.

- Core schemas (User, Group, EnterpriseUser) and discovery endpoints (`/Schemas`, `/ResourceTypes`, `/ServiceProviderConfig`)
- Full SCIM filter grammar with a typed AST
- PATCH op applier with value-path filters
- Abstract `ScimUserRepository` / `ScimGroupRepository` for any datastore
- Bearer-scope guard that integrates with `@maroonedsoftware/authentication`

[View documentation →](./packages/scim/README.md)

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
