---
'@maroonedsoftware/whatsapp': minor
---

`normalizeWhatsAppMessage` (and so `dispatchWhatsApp`) now sets the comms event's `messageId` to the WhatsApp message id, so an app can dedupe redelivered webhooks without reaching into `raw`, and sets `conversation.group: true` for messages sent in a group. `conversation.id` is still the sender, which remains the reply address. `WhatsAppMessage` gains a typed optional `group_id`.
