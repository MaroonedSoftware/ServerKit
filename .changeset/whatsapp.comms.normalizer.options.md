---
'@maroonedsoftware/whatsapp': minor
---

Export the `./comms` per-message normalizer as `normalizeWhatsAppMessage(message, value)`, and give `dispatchWhatsApp` an optional fourth `options` argument. `options.reply(to, event)` builds the `Reply` handed to the router, so an app can queue outbound messages (for example as a job inside its DB transaction) instead of sending inline; the default is unchanged. `options.onUnsupported(message, value, reply)` receives the media and other messages the router skips, with an inline reply to the sender.
