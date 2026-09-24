---
'@maroonedsoftware/discord': minor
---

The Gateway over a socket the caller supplies, at `@maroonedsoftware/discord/gateway`.

- `GatewayClient` receives real-time events over the Discord Gateway. It never opens a connection itself: `gatewayUrl` (normally from `DiscordClient.getGatewayBot`) names the endpoint, and `connect` opens whatever satisfies the exported `SocketLike` contract. That contract has the same shape as `@maroonedsoftware/slack/socketmode`'s.
- It heartbeats (with the first beat jittered), identifies, and resumes on `resume_gateway_url` after a zombie connection, a Reconnect (op 7), a resumable Invalid Session (op 9), or a non-fatal close. A non-resumable Invalid Session identifies afresh after 1–5 seconds.
- Close codes 4004 and 4010–4014 are fatal: the client stops and reports through `onError`, and 4014 names the disallowed-intents cause.
- Every dispatch goes to `onDispatch(event, data)`. `READY` fills in `isReady` and `user`.
- `Intents` exports the `GUILDS`, `GUILD_MESSAGES`, `DIRECT_MESSAGES`, and `MESSAGE_CONTENT` bits.
- One shard, JSON only, no compression. The README no longer calls the Gateway out of scope.
