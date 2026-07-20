# ServerKit

A modular collection of TypeScript packages for building Node.js server applications.

---

## Packages

### AppConfig

Flexible, type-safe configuration management with support for multiple sources and value transformation.

- Load from JSON, YAML, and `.env` files
- Transform values using environment variables and GCP/AWS secrets
- Merge configurations from multiple sources
- Reload config at runtime and inject the latest values via an `IOptions`-style accessor trio

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

### Comms

Channel-agnostic messaging core for ServerKit.

- `ChannelRouter` dispatch with `Reply` / `Notifier` helpers and a `TemplateRegistry`
- Standalone, channel-free core — chat packages bind to it via an optional `./comms` adapter
- Depends only on the errors and logger packages

[View documentation →](./packages/comms/README.md)

---

### Discord

Discord interaction dispatcher for ServerKit.

- Interaction handlers with Ed25519 request-signature verification
- Built-in REST client
- Optional `./comms` adapter for the messaging core

[View documentation →](./packages/discord/README.md)

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

### EventBus

Synchronous, in-process fan-out event dispatch.

- Register subscribers and publish events in-process
- No external broker or transport
- DI-friendly and dependency-free

[View documentation →](./packages/eventbus/README.md)

---

### JobBroker

Background job processing powered by PostgreSQL-backed queues.

- Scheduled and on-demand job execution
- Built on pg-boss for reliable delivery
- Simple runner abstraction

[View documentation →](./packages/jobbroker/README.md)

---

### Johnny5

A CLI framework for ServerKit-based applications.

- `createCliApp` assembles a `commander` program from declarative `CommandModule` definitions
- Built-in `doctor` runner with auto-remediation hooks and a rich `Check` API
- Workspace-package plugin discovery via a top-level `"johnny5"` field in each plugin's `package.json`
- Opt-in integrations exposed as subpath exports: ServerKit DI bootstrap, Postgres / Redis / Docker / filesystem / version checks

[View documentation →](./packages/johnny5/README.md)

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

### MCP

Model Context Protocol (MCP) server support wrapping the official SDK.

- DI-registered tool/resource handler maps behind an `McpDispatcher`
- Stateless (default) and stateful (`Mcp-Session-Id`) transport over Streamable HTTP
- `AsyncLocalStorage`-backed request context for concurrency-safe handlers
- Bearer auth as a `@maroonedsoftware/policies` policy

[View documentation →](./packages/mcp/README.md)

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
- Pluggable `PermissionsTupleRepository` for any storage backend, plus a built-in `InMemoryTupleRepository` for tests and tooling
- Recursive Check evaluator with per-request memo, cycle guard, and pluggable metrics sink
- `explain()` returns a hierarchical `CheckTrace` for debugging why a check passed or failed

[View documentation →](./packages/permissions/README.md)

---

### Permissions DSL

A surface-syntax DSL and compiler (`pdsl` CLI) for authoring permissions declaratively, plus a test/checker for them.

- Human-readable `.perm` files with `|` union, `&` intersection, `-` exclusion, `->` tupleToUserset operators
- Ohm-based grammar with caret-annotated diagnostics
- Generates TypeScript that calls the `@maroonedsoftware/permissions` builders
- SpiceDB-style `.perm.yaml` fixtures with `assertTrue` / `assertFalse` / `validation` blocks
- `pdsl` CLI subcommands: `compile`, `validate <fixture>`, `check`, and `explain` (with trace output)

[View documentation →](./packages/permissions-dsl/README.md)

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

### Slack

Slack dispatcher for ServerKit.

- Command, event, and interaction handlers
- Request-signature verification
- Optional `./comms` adapter for the messaging core

[View documentation →](./packages/slack/README.md)

---

### Storage

Object storage abstraction with pluggable backends.

- DI-friendly `StorageProvider` interface (write/read/stat/exists/delete/copy/move/list, byte-range reads, signed URLs)
- Local filesystem, AWS S3, and Google Cloud Storage backends
- Cloud SDKs are optional peer dependencies — install only what you use
- Typed errors for not-found, access-denied, and unsupported operations

[View documentation →](./packages/storage/README.md)

---

### Telegram

Telegram Bot API dispatcher for ServerKit.

- Command, callback, and update handlers
- Secret-token webhook verification
- Bot API client, plus an optional `./comms` adapter

[View documentation →](./packages/telegram/README.md)

---

### Utilities

Common utility functions for everyday server development.

- UUID and email validation
- Base32 encoding/decoding
- Deterministic SVG avatar and identicon generation
- Lightweight and dependency-free

[View documentation →](./packages/utilities/README.md)

---

### WhatsApp

WhatsApp Cloud API dispatcher for ServerKit.

- Message, interactive, and status handlers
- HMAC signature and webhook verification
- REST client, plus an optional `./comms` adapter

[View documentation →](./packages/whatsapp/README.md)

---

### Zod

Zod utilities for ServerKit, integrated with the errors package.

- Helpers for translating Zod issues into HTTP errors
- Shared schema utilities

[View documentation →](./packages/zod/README.md)

---

## Requirements

- Node.js 22+
- pnpm 11.1.1+

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
