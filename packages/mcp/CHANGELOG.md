# @maroonedsoftware/mcp

## 0.1.2

### Patch Changes

- Ship `AGENTS.md` in the published tarball.

  Each package now carries an `AGENTS.md` alongside its `README.md`: a machine-oriented guide for AI
  coding agents covering the full export surface, canonical wiring, package-specific rules, and the
  non-obvious failure modes. Adding it to the `files` array means a downstream agent finds it in
  `node_modules` without a network round-trip.

  No runtime code changed.

- Updated dependencies [2a2bcf4]
- Updated dependencies
  - @maroonedsoftware/cache@0.4.1
  - @maroonedsoftware/errors@1.8.1
  - @maroonedsoftware/logger@1.1.4
  - @maroonedsoftware/policies@0.6.1

## 0.1.1

### Patch Changes

- Updated dependencies [b7e1163]
  - @maroonedsoftware/policies@0.6.0

## 0.1.0

### Minor Changes

- b27b697: Add `@maroonedsoftware/mcp`: Model Context Protocol server support that wraps the official SDK behind ServerKit's DI/Koa patterns. Register tools and resources as `@Injectable()` handler maps and serve them through `McpDispatcher` over Streamable HTTP, with stateless (default) and stateful session modes, `AsyncLocalStorage`-backed request context, and bearer auth as a `@maroonedsoftware/policies` policy.
