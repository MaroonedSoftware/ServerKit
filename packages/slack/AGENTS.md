# AGENTS.md — @maroonedsoftware/slack

Machine-oriented guide for AI agents. Human prose and long-form examples live in [README.md](./README.md).
Repo-wide conventions live in the [root AGENTS.md](../../AGENTS.md).

## Purpose

A Slack dispatcher for ServerKit: signature verification as a policy, DI-registered handler maps for
events, slash commands, and interactive payloads, a `SlackClient` over `@slack/web-api`, and an
optional adapter that binds it all to the channel-agnostic `@maroonedsoftware/comms` router.

Reach for the native handler maps when you want Slack-specific richness (Block Kit modals,
`view_submission`). Reach for `./comms` when you want one bot that also runs on Discord, Telegram,
and WhatsApp. The two coexist: `./comms` normalises the common cases and leaves the rest on the
native maps.

## Install

```bash
pnpm add @maroonedsoftware/slack
pnpm add @maroonedsoftware/comms   # only for the ./comms adapter
pnpm add @maroonedsoftware/cache   # only for idempotency
```

Runtime dependencies: `@maroonedsoftware/errors`, `@maroonedsoftware/logger`,
`@maroonedsoftware/policies`, `@slack/web-api`, `injectkit`, `luxon`. Optional peers:
`@maroonedsoftware/comms`, `@maroonedsoftware/cache`.

## Position in the graph

- **Depends on:** `errors`, `logger`, `policies`. `comms` and `cache` are **optional** peers.
- **Depended on by:** nothing internal.
- **Subpath exports:**
  - `.` — config, errors, signature verification, handler maps, dispatcher, client.
  - `./comms` — the adapter. Pulls in `@maroonedsoftware/comms`. It lives here, not in `comms`,
    because `comms` must stay channel-free; see the root AGENTS.md.

**Not a dependency: `koa`.** Your route parses the request and calls the dispatcher.

## API surface

### `.` — config and errors

| Export         | Kind                       | Shape                                                                                          | Notes                                                  |
| -------------- | -------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `SlackConfig`  | interface + abstract class | `{ botToken, signingSecret, incomingWebhookUrl?, signatureMaxAgeSeconds?, requestTimeoutMs? }` | Declaration-merged so one symbol is type and DI token. |
| `SlackError`   | class                      | `extends ServerkitError`                                                                       | —                                                      |
| `IsSlackError` | type guard                 | `(error: unknown) => error is SlackError`                                                      | —                                                      |

### `.` — signature verification

| Export                                    | Kind      | Shape                                                       | Notes                                      |
| ----------------------------------------- | --------- | ----------------------------------------------------------- | ------------------------------------------ |
| `verifySlackSignature`                    | function  | `(input: VerifySlackSignatureInput) => void`                | Pure. **Throws** `SlackError` on failure.  |
| `VerifySlackSignatureInput`               | type      | Raw body, headers, and `SlackSignatureOptions`              | —                                          |
| `SlackSignatureOptions`                   | type      | Signing secret plus max age                                 | —                                          |
| `SlackSignatureFailureReason`             | type      | Reason codes landing in `internalDetails.reason`            | —                                          |
| `SlackSignaturePolicy`                    | class     | `extends Policy<SlackSignaturePolicyContext>`               | Policy form — denies rather than throwing. |
| `SlackSignaturePolicyContext`             | interface | Structurally compatible with koa's `SignaturePolicyContext` | What lets `requireSignature` drive it.     |
| `SLACK_SIGNATURE_POLICY`                  | constant  | The `PolicyRegistryMap` key                                 | —                                          |
| `SLACK_SIGNATURE_HEADER`                  | constant  | `'X-Slack-Signature'`                                       | —                                          |
| `SLACK_REQUEST_TIMESTAMP_HEADER`          | constant  | `'X-Slack-Request-Timestamp'`                               | —                                          |
| `SLACK_SIGNATURE_DEFAULT_MAX_AGE_SECONDS` | constant  | Replay window                                               | —                                          |

### `.` — handlers and dispatch

| Export                       | Kind      | Shape                                                                                                                                                                                                                                          | Notes                                                           |
| ---------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `SlackEventHandler<TEvent>`  | interface | `handle(event, context: SlackEventContext)`                                                                                                                                                                                                    | —                                                               |
| `SlackEventHandlerMap`       | class     | `extends Map<string, SlackEventHandler>`                                                                                                                                                                                                       | Keyed by event type (`app_mention`, `message`).                 |
| `SlackCommandHandler`        | interface | `handle(payload: SlackCommandPayload)`                                                                                                                                                                                                         | —                                                               |
| `SlackCommandHandlerMap`     | class     | `extends Map<string, SlackCommandHandler>`                                                                                                                                                                                                     | Keyed by command name.                                          |
| `SlackInteractionHandler`    | interface | `handle(payload: SlackInteractionPayload)`                                                                                                                                                                                                     | —                                                               |
| `SlackInteractionHandlerMap` | class     | `extends Map<string, SlackInteractionHandler>`                                                                                                                                                                                                 | Keyed by `interactionRouteKey(payload)`.                        |
| `interactionRouteKey`        | function  | `(payload) => string \| undefined`                                                                                                                                                                                                             | `block_actions:<action_id>`, `view_submission:<callback_id>`, … |
| `SlackDispatcher`            | class     | `dispatchEvent(body, options?)`, `dispatchCommand(payload)`, `dispatchInteraction(payload)`                                                                                                                                                    | The entry point.                                                |
| `slackEventIdempotencyKey`   | function  | `(envelope: Pick<SlackEventCallback, 'event_id' \| 'team_id'>) => string`                                                                                                                                                                      | Team-scoped, so ids are unique across workspaces.               |
| Payload types                | —         | `SlackEventsRequest`, `SlackEventsResponse`, `SlackEventCallback`, `SlackEventContext`, `SlackCommandPayload`, `SlackCommandResponse`, `SlackInteractionPayload`, `SlackInteractionResponse`, `SlackInteractionType`, `IncomingWebhookPayload` | —                                                               |

`dispatchEvent(body, { idempotency })` wraps the handler in `IdempotencyStore.deduplicate` keyed by
`slackEventIdempotencyKey`. Slack redelivers events, so this is a real redelivery net, not just a
guard.

### `.` — client

| Export                             | Kind     | Shape                                                           | Notes                                  |
| ---------------------------------- | -------- | --------------------------------------------------------------- | -------------------------------------- |
| `SlackClient`                      | class    | `postMessage`, `postWebhook`, …                                 | Over `@slack/web-api`.                 |
| `adaptLogger`                      | function | Bridges `@maroonedsoftware/logger` to `@slack/web-api`'s logger | —                                      |
| `redactSlackUrl`                   | function | Strips the token from a webhook URL before logging              | Use it before logging any webhook URL. |
| `SLACK_DEFAULT_REQUEST_TIMEOUT_MS` | constant | —                                                               | —                                      |

### `./comms`

| Export                     | Kind     | Shape                                                                   | Notes                                                                     |
| -------------------------- | -------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `createSlackNotifier`      | function | `(client: SlackClient, templates: TemplateRegistry) => Notifier`        | Recipient is a `response_url` (webhook) **or** a channel id.              |
| `dispatchSlackEvent`       | function | `(router, client, body) => Promise<{ challenge: string } \| undefined>` | Returns the `url_verification` challenge; routes `message`/`app_mention`. |
| `dispatchSlackCommand`     | function | `(router, client, payload) => Promise<void>`                            | Replies via `response_url` when present.                                  |
| `dispatchSlackInteraction` | function | `(router, client, payload) => Promise<void>`                            | **Only `block_actions`** is normalised.                                   |

## Canonical usage

```typescript
import {
  SlackConfig,
  SlackDispatcher,
  SlackEventHandlerMap,
  SlackSignaturePolicy,
  SLACK_SIGNATURE_POLICY,
  type SlackSignatureOptions,
} from '@maroonedsoftware/slack';

// Composition root
registry.register(SlackConfig).useValue(appConfig.getAs<SlackConfig>('slack'));
const events = new SlackEventHandlerMap();
events.set('app_mention', container.get(MentionHandler));
registry.register(SlackEventHandlerMap).useValue(events);
policies.set(SLACK_SIGNATURE_POLICY, SlackSignaturePolicy);

// Route — signature first, then dispatch
router.post('/slack/events', requireSignature<SlackSignatureOptions>('slack', { policy: SLACK_SIGNATURE_POLICY }), async ctx => {
  const body = JSON.parse(ctx.rawBody as string);
  ctx.body = await ctx.container.get(SlackDispatcher).dispatchEvent(body, { idempotency: ctx.container.get(IdempotencyStore) });
});
```

Channel-agnostic instead:

```typescript
import { dispatchSlackCommand, createSlackNotifier } from '@maroonedsoftware/slack/comms';

await dispatchSlackCommand(router, client, payload);
```

## Rules for generated code

- Verify the signature **before** parsing or dispatching, using `requireSignature` with
  `SLACK_SIGNATURE_POLICY`. The verification needs `ctx.rawBody`, so it must run before anything
  that re-serialises the body.
- Store `SlackConfig` in `AppConfig` and register the typed section. Never inline `signingSecret` or
  `botToken`.
- Pass an `IdempotencyStore` to `dispatchEvent`. Slack retries deliveries, so without it a flaky
  handler produces duplicate side effects.
- Scope idempotency keys by team — `slackEventIdempotencyKey` already does, and a raw `event_id` is
  not unique across workspaces.
- Handle the `url_verification` challenge. `dispatchSlackEvent` returns it; the native path expects
  you to echo it.
- Ack within 3 seconds and do slow work in a job. Slack times out and retries.
- Never log a webhook URL without `redactSlackUrl` — the token is in the path.
- Import `./comms` functions from `@maroonedsoftware/slack/comms`, never from the root.

## Gotchas

- **`./comms` normalises only part of the surface.** `dispatchSlackInteraction` handles
  `block_actions` and returns silently for everything else; `view_submission` and `view_closed` stay
  on `SlackInteractionHandlerMap`. Mixing the two paths is expected, not a mistake.
- **The comms adapter sanitises broadcast sequences.** `<!everyone>`, `<!channel>`, `<!here>` (and
  their `<!channel|label>` forms) in outbound text are rewritten to literal `@everyone` / `@channel`
  / `@here` so user-supplied text cannot ping a workspace. The **native** `SlackClient` path does
  **not** do this — sanitise yourself there.
- **The recipient string is overloaded.** `createSlackNotifier` sends to a `response_url` when the
  string starts with `http`, and to a channel id otherwise. A channel id that somehow starts with
  `http` would be misrouted.
- **Bot messages are filtered out** of the comms path (`bot_id`, `subtype: 'bot_message'`) to avoid
  loops. The native event handlers see them.
- **`verifySlackSignature` throws; `SlackSignaturePolicy` denies.** Same logic, two shapes.
- **The signature has a max-age replay window.** Clock skew on your host produces spurious
  verification failures.
- **`@slack/web-api` is a hard dependency**, unlike `comms` and `cache`. Installing this package
  pulls it in even if you only use the comms path.

## Working inside this package

```
src/
  index.ts                    Root barrel
  slack.config.ts             SlackConfig (interface + token)
  slack.error.ts              SlackError, IsSlackError
  slack.signature.ts          verifySlackSignature + header/constant exports
  slack.signature.policy.ts   SlackSignaturePolicy, SLACK_SIGNATURE_POLICY
  slack.event.handler.ts      Event handler + map, slackEventIdempotencyKey
  slack.command.handler.ts    Command handler + map
  slack.interaction.handler.ts Interaction handler + map, interactionRouteKey
  slack.dispatcher.ts         SlackDispatcher
  client/slack.client.ts      SlackClient
  client/slack.logger.adapter.ts adaptLogger, redactSlackUrl
  comms.ts                    Subpath entry — notifier, render, and the three dispatch functions
```

Tests are in `tests/`, mirroring `src/`.

Invariants a change must not break:

- **Nothing reachable from `src/index.ts` may import `@maroonedsoftware/comms` or
  `@maroonedsoftware/cache`.** Both are optional peers; `cache` is imported `type`-only in the
  dispatcher for exactly this reason.
- No dependency on `@maroonedsoftware/koa`. `SlackSignaturePolicyContext` is structurally
  compatible with koa's context, which is what keeps the arrow out.
- Signature comparison stays constant-time, and the replay window stays enforced.
- The comms adapter's broadcast sanitisation is a security control, not formatting.
- The four chat packages (`slack`, `discord`, `telegram`, `whatsapp`) share a deliberate shape:
  config token, error + guard, verification function + policy, handler maps, dispatcher, client,
  `./comms` adapter. Keep a change consistent across all four.

User-visible changes need a changeset in `.changeset/`.
