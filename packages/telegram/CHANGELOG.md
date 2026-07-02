# @maroonedsoftware/telegram

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
- fe8ec2c: Add `@maroonedsoftware/telegram`: a transport-agnostic Telegram Bot API integration modeled on `@maroonedsoftware/slack`. Includes `TelegramDispatcher` for routing updates (commands by name, callback queries by data, other updates by type) to typed handlers, secret-token webhook verification (`verifyTelegramSecretToken` + `TelegramSecretTokenPolicy`), command parsing helpers (`parseCommand`, `updateType`), a `fetch`-based `TelegramClient` Bot API wrapper, and DI-friendly `TelegramConfig`/`TelegramError`.

### Patch Changes

- Updated dependencies [fe8ec2c]
  - @maroonedsoftware/comms@0.2.0
