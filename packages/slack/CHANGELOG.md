# @maroonedsoftware/slack

## 1.8.0

### Minor Changes

- 8e7a209: feat: add Slack integration package. Includes `SlackClient` (wraps `@slack/web-api`, also handles incoming-webhook and `response_url` POSTs), `SlackDispatcher` with `dispatchEvent` / `dispatchCommand` / `dispatchInteraction` for routing parsed Slack payloads to typed handlers via per-concern handler maps, and `verifySlackSignature` — a pure helper that validates Slack's v0 HMAC scheme with replay protection. Transport-agnostic: no Koa or router dependency. Consumers wire it into whatever HTTP framework they're using.

### Patch Changes

- @maroonedsoftware/errors@1.6.0
- @maroonedsoftware/logger@1.1.0
