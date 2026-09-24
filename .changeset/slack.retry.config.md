---
'@maroonedsoftware/slack': minor
---

`SlackConfig` gains `retries` and `rejectRateLimitedCalls`, forwarded to `@slack/web-api`'s `WebClient`

- `retries` becomes `retryConfig: { retries }`. The SDK's default retries a failed call ten times over about thirty minutes in the background, which outlives a caller that owns its own retries or deadline and can deliver a message long after it stopped being true; `0` turns that off.
- `rejectRateLimitedCalls` rejects a rate-limited call instead of pausing every call until `Retry-After` has passed.
- Both apply to the bot-token client and to the app-token client `openSocketModeUrl` builds. Unset, nothing changes.
