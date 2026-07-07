---
'@maroonedsoftware/cache': minor
'@maroonedsoftware/slack': minor
'@maroonedsoftware/discord': minor
'@maroonedsoftware/telegram': minor
'@maroonedsoftware/whatsapp': minor
---

Add opt-in webhook de-duplication for at-least-once delivery.

- **cache**: new `IdempotencyStore` abstraction and default `CacheIdempotencyStore` (backed by the atomic `CacheProvider.add` claim primitive). `deduplicate(key, work, options?)` runs `work` at most once per key across processes, returning `processed` / `duplicate` / `dropped`. It uses an in-flight claim (`inFlightTtl`), a configurable retention window (`retentionTtl`), and a poison-event attempt cap (`maxAttempts`) so a permanently-failing event is dead-lettered rather than reprocessed forever.
- **slack / discord / telegram / whatsapp**: each dispatch method now accepts an optional trailing `{ idempotency }` argument and exports a per-platform key helper — `slackEventIdempotencyKey`, `discordInteractionIdempotencyKey`, `telegramUpdateIdempotencyKey`, and `whatsappMessageIdempotencyKey` / `whatsappStatusIdempotencyKey`. De-duplication is fully opt-in: when no store is passed, behavior is byte-for-byte unchanged. `@maroonedsoftware/cache` is declared as an optional peer dependency (type-only import, no runtime dependency when unused). See each package README for the recommended durable enqueue-and-ack pattern and the edge de-dup one-liner.
