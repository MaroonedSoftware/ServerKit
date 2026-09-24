---
'@maroonedsoftware/slack': minor
---

A `fetch` of the caller's own, a configurable base URL, an optional signing secret, and an app token for Socket Mode.

- `SlackConfig.fetch` routes every outbound call through the caller's own transport: the Web API client, `postWebhook`, and `openSocketModeUrl`. It defaults to the global `fetch`. Its type, `SlackFetch`, is `@slack/web-api`'s `FetchFunction`.
- `SlackConfig.apiBaseUrl` is forwarded to the Web API client as `slackApiUrl`.
- `SlackConfig.signingSecret` is optional, since a Socket Mode app never verifies a request. Verification without one fails closed with the new reason `missing_signing_secret`.
- `SlackConfig.appToken` and `SlackClient.openSocketModeUrl()` open a Socket Mode connection through `apps.connections.open` and return its WebSocket URL.
- A `postWebhook` that never reached Slack now throws a `SlackError` rather than the transport's own error. The URL's secret segment is redacted from its `reason`, and no `cause` is attached.
