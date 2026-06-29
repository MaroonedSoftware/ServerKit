---
"@maroonedsoftware/whatsapp": minor
---

Add `@maroonedsoftware/whatsapp`: a transport-agnostic WhatsApp Cloud API integration modeled on `@maroonedsoftware/slack`. Includes `WhatsAppDispatcher` for routing batched webhook bodies (messages by type, interactive replies by id, statuses by value) to typed handlers, HMAC-SHA256 signature verification (`verifyWhatsAppSignature` + `WhatsAppSignaturePolicy`), the subscription verification handshake helper (`verifyWhatsAppWebhook`), a `fetch`-based `WhatsAppClient` Graph API wrapper, and DI-friendly `WhatsAppConfig`/`WhatsAppError`.
