# @maroonedsoftware/eventbus

## 0.1.6

### Patch Changes

- Ship `AGENTS.md` in the published tarball.

  Each package now carries an `AGENTS.md` alongside its `README.md`: a machine-oriented guide for AI
  coding agents covering the full export surface, canonical wiring, package-specific rules, and the
  non-obvious failure modes. Adding it to the `files` array means a downstream agent finds it in
  `node_modules` without a network round-trip.

  No runtime code changed.

## 0.1.5

### Patch Changes

- Ship `AGENTS.md` in the published tarball.

  Each package now carries an `AGENTS.md` alongside its `README.md`: a machine-oriented guide for AI
  coding agents covering the full export surface, canonical wiring, package-specific rules, and the
  non-obvious failure modes. Adding it to the `files` array means a downstream agent finds it in
  `node_modules` without a network round-trip.

  No runtime code changed.

## 0.1.4

### Patch Changes

- Ship `AGENTS.md` in the published tarball.

  Each package now carries an `AGENTS.md` alongside its `README.md`: a machine-oriented guide for AI
  coding agents covering the full export surface, canonical wiring, package-specific rules, and the
  non-obvious failure modes. Adding it to the `files` array means a downstream agent finds it in
  `node_modules` without a network round-trip.

  No runtime code changed.

## 0.1.3

### Patch Changes

- Ship `AGENTS.md` in the published tarball.

  Each package now carries an `AGENTS.md` alongside its `README.md`: a machine-oriented guide for AI
  coding agents covering the full export surface, canonical wiring, package-specific rules, and the
  non-obvious failure modes. Adding it to the `files` array means a downstream agent finds it in
  `node_modules` without a network round-trip.

  No runtime code changed.

## 0.1.2

### Patch Changes

- dfe5304: Declare `engines.node >= 22` in the package manifest to match the supported runtime.

## 0.1.1

### Patch Changes

- b759188: Bump shared runtime dependencies: `injectkit` to `^1.6.0` across packages, plus package-specific bumps to `zxcvbn-ts` (authentication), `@slack/web-api` (slack), `mime-types` (storage), and `prettier` (permissions-dsl).

## 0.1.0

### Minor Changes

- fb39b40: Add `@maroonedsoftware/eventbus`: synchronous, in-process fan-out event dispatch. Wraps Node's `EventEmitter` and resolves subscribers from a DI container on every publish, so request-scoped subscribers inherit the publisher's transaction and authorization context. Sequential, fail-fast — the first subscriber to throw aborts the rest and the error propagates so the caller's transaction can roll back. Sibling to `@maroonedsoftware/jobbroker`: use jobbroker when you want fire-and-forget queueing in a separate process/transaction; use eventbus when you want multiple handlers to run in the same request before the response.
