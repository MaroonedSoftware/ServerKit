---
"@maroonedsoftware/slack": minor
"@maroonedsoftware/discord": minor
"@maroonedsoftware/whatsapp": minor
"@maroonedsoftware/telegram": minor
---

Add a `./comms` adapter subpath to each chat package, binding it to the channel-agnostic `@maroonedsoftware/comms` router (declared as an optional peer dependency). Each exposes `dispatch<Channel>…` functions that normalize the channel's inbound payloads into comms events and a `create<Channel>Notifier` for proactive sends, so a single handler runs across every wired channel. The channel cores are unchanged.
