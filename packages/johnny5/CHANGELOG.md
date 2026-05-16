# @maroonedsoftware/johnny5

## 0.1.0

### Minor Changes

- 45f0294: Add @maroonedsoftware/johnny5 — a CLI framework for ServerKit-based applications. Provides `createCliApp` for assembling a commander-backed program from declarative `CommandModule` definitions, a built-in doctor runner with auto-remediation hooks, workspace-package plugin discovery (via a top-level `"johnny5"` field in each plugin's `package.json`), and opt-in integrations (Postgres, Redis, Docker, version checks, filesystem checks, ServerKit DI bootstrap) exposed as subpath exports.
