# @maroonedsoftware/discord

## 1.0.2

### Patch Changes

- Updated dependencies [b00d9b4]
  - @maroonedsoftware/errors@1.7.1
  - @maroonedsoftware/comms@0.2.2
  - @maroonedsoftware/policies@0.5.2

## 1.0.1

### Patch Changes

- b759188: Bump shared runtime dependencies: `injectkit` to `^1.6.0` across packages, plus package-specific bumps to `zxcvbn-ts` (authentication), `@slack/web-api` (slack), `mime-types` (storage), and `prettier` (permissions-dsl).
- Updated dependencies [b759188]
  - @maroonedsoftware/comms@0.2.1
  - @maroonedsoftware/logger@1.1.2
  - @maroonedsoftware/policies@0.5.1

## 1.0.0

### Minor Changes

- fe8ec2c: Add a `./comms` adapter subpath to each chat package, binding it to the channel-agnostic `@maroonedsoftware/comms` router (declared as an optional peer dependency). Each exposes `dispatch<Channel>…` functions that normalize the channel's inbound payloads into comms events and a `create<Channel>Notifier` for proactive sends, so a single handler runs across every wired channel. The channel cores are unchanged.
- ab4acc2: Add `@maroonedsoftware/discord`: a transport-agnostic Discord integration modeled on `@maroonedsoftware/slack`. Includes `DiscordDispatcher` for routing interactions (slash commands, message components, modals, autocomplete) to typed handlers, Ed25519 signature verification (`verifyDiscordSignature` + `DiscordSignaturePolicy`) implemented with Node's native `crypto` (no third-party dependency), a `fetch`-based `DiscordClient` REST wrapper, and DI-friendly `DiscordConfig`/`DiscordError`. Targets the HTTP interactions endpoint; real-time Gateway events are out of scope.

### Patch Changes

- Updated dependencies [fe8ec2c]
  - @maroonedsoftware/comms@0.2.0
