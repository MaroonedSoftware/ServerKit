---
'@maroonedsoftware/comms': minor
---

Add two optional fields to `IncomingEvent`: `messageId`, the channel-native id of the inbound message (stable across webhook redeliveries, so it is the key to dedupe on), and `conversation.group`, `true` when the event came from a group chat. Both are optional, so existing adapters and handlers keep compiling; an adapter sets them only when its channel reports them.
