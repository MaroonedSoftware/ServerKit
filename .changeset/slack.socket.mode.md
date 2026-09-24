---
'@maroonedsoftware/slack': minor
---

Socket Mode over a socket the caller supplies, at `@maroonedsoftware/slack/socketmode`.

- `SocketModeClient` receives Events API deliveries, slash commands, and interactive payloads over a Slack Socket Mode WebSocket. It never opens a connection itself: `openUrl` (normally `SlackClient.openSocketModeUrl`) fetches the URL, and `connect` opens whatever satisfies the exported `SocketLike` contract.
- Every envelope is acked the moment it arrives, before its handler runs, so a slow handler never misses Slack's 3-second window. A handler that throws is logged and does not stop the client.
- `refresh_requested` and `warning` disconnects move to a fresh URL. `link_disabled` stops the client and reports through `onError`. Any other close reconnects with exponential backoff. `stop()` never reconnects.
