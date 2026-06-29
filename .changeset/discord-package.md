---
"@maroonedsoftware/discord": minor
---

Add `@maroonedsoftware/discord`: a transport-agnostic Discord integration modeled on `@maroonedsoftware/slack`. Includes `DiscordDispatcher` for routing interactions (slash commands, message components, modals, autocomplete) to typed handlers, Ed25519 signature verification (`verifyDiscordSignature` + `DiscordSignaturePolicy`) implemented with Node's native `crypto` (no third-party dependency), a `fetch`-based `DiscordClient` REST wrapper, and DI-friendly `DiscordConfig`/`DiscordError`. Targets the HTTP interactions endpoint; real-time Gateway events are out of scope.
