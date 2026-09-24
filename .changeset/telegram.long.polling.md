---
'@maroonedsoftware/telegram': minor
---

Long polling, and a `fetch` of the caller's own.

- `TelegramClient.getUpdates(params, options)` long-polls for a bot with no public address to receive a webhook on. The call is allowed Telegram's `timeout` wait on top of `requestTimeoutMs`, so a quiet poll is never cut off as a timeout. `getMe` and `getWebhookInfo` join the typed helpers.
- `TelegramConfig.fetch` routes every call through the caller's own transport (an allowlisting host, a proxy, a test). It defaults to the global `fetch`.
- `callMethod` takes a per-call `timeoutMs`.
- A rate-limited call carries Telegram's `retry_after` as `internalDetails.retryAfter`.
- A call that never reached Telegram now throws a `TelegramError` rather than the transport's own error, with the bot token redacted from its `reason` and no `cause` attached, since the token is part of every URL. A non-JSON error body is redacted the same way.
