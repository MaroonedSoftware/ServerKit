---
"@maroonedsoftware/telegram": minor
---

Add `@maroonedsoftware/telegram`: a transport-agnostic Telegram Bot API integration modeled on `@maroonedsoftware/slack`. Includes `TelegramDispatcher` for routing updates (commands by name, callback queries by data, other updates by type) to typed handlers, secret-token webhook verification (`verifyTelegramSecretToken` + `TelegramSecretTokenPolicy`), command parsing helpers (`parseCommand`, `updateType`), a `fetch`-based `TelegramClient` Bot API wrapper, and DI-friendly `TelegramConfig`/`TelegramError`.
