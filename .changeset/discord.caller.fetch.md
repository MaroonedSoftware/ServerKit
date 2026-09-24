---
'@maroonedsoftware/discord': minor
---

A `fetch` of the caller's own, a configurable base URL, token redaction on transport errors, and `retry_after`.

- `DiscordConfig.fetch` routes every REST call through the caller's own transport: an allowlisting host, a proxy, or a test. It defaults to the global `fetch`.
- `DiscordConfig.apiBaseUrl` replaces the hardcoded REST base. It defaults to `DISCORD_API_BASE`.
- `DiscordConfig.publicKey` is optional, since a Gateway-only bot never verifies a request. Verification without one fails closed with the new reason `missing_public_key`.
- `request` takes a per-call `timeoutMs`.
- A rate-limited call carries Discord's wait as `internalDetails.retryAfter` (seconds), from the body's `retry_after` or the `Retry-After` header.
- A call that never reached Discord now throws a `DiscordError` rather than the transport's own error. The bot token and any interaction token are redacted from its `reason`, and no `cause` is attached. An error body is redacted the same way.
- New helpers: `getGatewayBot()`, `getCurrentUser()`, `getChannelMessages(channelId, { after, limit })`, and `deferInteraction(interaction, 'message' | 'update')`.
