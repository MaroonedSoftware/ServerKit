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

## Requirements

- Node.js 20+
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
