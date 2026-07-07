# @maroonedsoftware/comms

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
