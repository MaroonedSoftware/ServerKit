# @maroonedsoftware/comms

## 0.2.11

### Patch Changes

- Updated dependencies [97a75be]
  - @maroonedsoftware/errors@1.9.1

## 0.2.10

### Patch Changes

- 7587006: Update runtime dependency ranges across the workspace (injectkit ^1.7.1, zod ^4.5.4, deepmerge-ts ^8, raw-body ^4, qs ^6.16, kysely ^0.29.5, pg ^8.23, @modelcontextprotocol/sdk ^1.30, @fastify/busboy ^3.2.2, and related minors).
- Updated dependencies [7587006]
  - @maroonedsoftware/logger@1.1.9

## 0.2.9

### Patch Changes

- Updated dependencies [e2e968d]
  - @maroonedsoftware/errors@1.9.0

## 0.2.8

### Patch Changes

- be035ce: Ship the MIT LICENSE file in the published package tarball, and link to it from the README.
- Updated dependencies [be035ce]
  - @maroonedsoftware/errors@1.8.5
  - @maroonedsoftware/logger@1.1.8

## 0.2.7

### Patch Changes

- Ship `AGENTS.md` in the published tarball.

  Each package now carries an `AGENTS.md` alongside its `README.md`: a machine-oriented guide for AI
  coding agents covering the full export surface, canonical wiring, package-specific rules, and the
  non-obvious failure modes. Adding it to the `files` array means a downstream agent finds it in
  `node_modules` without a network round-trip.

  No runtime code changed.

- Updated dependencies
  - @maroonedsoftware/errors@1.8.4
  - @maroonedsoftware/logger@1.1.7

## 0.2.6

### Patch Changes

- Ship `AGENTS.md` in the published tarball.

  Each package now carries an `AGENTS.md` alongside its `README.md`: a machine-oriented guide for AI
  coding agents covering the full export surface, canonical wiring, package-specific rules, and the
  non-obvious failure modes. Adding it to the `files` array means a downstream agent finds it in
  `node_modules` without a network round-trip.

  No runtime code changed.

- Updated dependencies
  - @maroonedsoftware/errors@1.8.3
  - @maroonedsoftware/logger@1.1.6

## 0.2.5

### Patch Changes

- Ship `AGENTS.md` in the published tarball.

  Each package now carries an `AGENTS.md` alongside its `README.md`: a machine-oriented guide for AI
  coding agents covering the full export surface, canonical wiring, package-specific rules, and the
  non-obvious failure modes. Adding it to the `files` array means a downstream agent finds it in
  `node_modules` without a network round-trip.

  No runtime code changed.

- Updated dependencies
  - @maroonedsoftware/errors@1.8.2
  - @maroonedsoftware/logger@1.1.5

## 0.2.4

### Patch Changes

- Ship `AGENTS.md` in the published tarball.

  Each package now carries an `AGENTS.md` alongside its `README.md`: a machine-oriented guide for AI
  coding agents covering the full export surface, canonical wiring, package-specific rules, and the
  non-obvious failure modes. Adding it to the `files` array means a downstream agent finds it in
  `node_modules` without a network round-trip.

  No runtime code changed.

- Updated dependencies
  - @maroonedsoftware/errors@1.8.1
  - @maroonedsoftware/logger@1.1.4

## 0.2.3

### Patch Changes

- dfe5304: Declare `engines.node >= 22` in the package manifest to match the supported runtime.
- Updated dependencies [dfe5304]
- Updated dependencies [dfe5304]
  - @maroonedsoftware/logger@1.1.3
  - @maroonedsoftware/errors@1.8.0

## 0.2.2

### Patch Changes

- Updated dependencies [b00d9b4]
  - @maroonedsoftware/errors@1.7.1

## 0.2.1

### Patch Changes

- b759188: Bump shared runtime dependencies: `injectkit` to `^1.6.0` across packages, plus package-specific bumps to `zxcvbn-ts` (authentication), `@slack/web-api` (slack), `mime-types` (storage), and `prettier` (permissions-dsl).
- Updated dependencies [b759188]
  - @maroonedsoftware/logger@1.1.2

## 0.2.0

### Minor Changes

- fe8ec2c: Add `@maroonedsoftware/comms`: a channel-agnostic messaging core. Define a `command` / `action` / `message` handler once on a `ChannelRouter` and run it on every wired channel, replying through a uniform `Reply`. Includes a `TemplateRegistry` for rich, per-channel outbound (with a portable default and a `sendNative` escape hatch), a `Notifier` seam for proactive sends, and `CommsError`. The core is channel-free — each chat package exposes a `./comms` adapter that binds to it via an optional peer dependency.
