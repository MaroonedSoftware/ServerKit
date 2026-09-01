# AGENTS.md — @maroonedsoftware/discord

Machine-oriented guide for AI agents. Human prose and long-form examples live in [README.md](./README.md).
Repo-wide conventions live in the [root AGENTS.md](../../AGENTS.md).

## Purpose

A Discord interaction dispatcher for ServerKit: Ed25519 request-signature verification as a policy,
a DI-registered interaction handler map, a built-in REST client, and an optional adapter binding it
to the channel-agnostic `@maroonedsoftware/comms` router.

Discord's HTTP interaction model is request/response — you have roughly **3 seconds** to return an
interaction callback. Reach for the native handler map for Discord-specific richness (modals,
autocomplete, deferred callbacks); reach for `./comms` when the same bot should also run on Slack,
Telegram, and WhatsApp.

## Install

```bash
pnpm add @maroonedsoftware/discord
pnpm add @maroonedsoftware/comms   # only for the ./comms adapter
pnpm add @maroonedsoftware/cache   # only for idempotency
```

Runtime dependencies: `@maroonedsoftware/errors`, `@maroonedsoftware/logger`,
`@maroonedsoftware/policies`, `injectkit`, `luxon`. Optional peers: `@maroonedsoftware/comms`,
`@maroonedsoftware/cache`. **No Discord SDK** — the REST client is built in.

## Position in the graph

- **Depends on:** `errors`, `logger`, `policies`. `comms` and `cache` are **optional** peers.
- **Depended on by:** nothing internal.
- **Subpath exports:**
  - `.` — config, errors, signature verification, handler map, dispatcher, client.
  - `./comms` — the adapter. Pulls in `@maroonedsoftware/comms`. It lives here, not in `comms`,
    because `comms` must stay channel-free; see the root AGENTS.md.

**Not a dependency: `koa`.** Your route parses the request and calls the dispatcher.

## API surface

### `.` — config and errors

| Export           | Kind                       | Shape                                                                                | Notes                                                  |
| ---------------- | -------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `DiscordConfig`  | interface + abstract class | `{ botToken, publicKey, applicationId, signatureMaxAgeSeconds?, requestTimeoutMs? }` | Declaration-merged so one symbol is type and DI token. |
| `DiscordError`   | class                      | `extends ServerkitError`                                                             | —                                                      |
| `IsDiscordError` | type guard                 | `(error: unknown) => error is DiscordError`                                          | —                                                      |

`publicKey` is the Ed25519 verification key; `botToken` authenticates REST calls. They are different
credentials.

### `.` — signature verification

| Export                               | Kind      | Shape                                                       | Notes                                                     |
| ------------------------------------ | --------- | ----------------------------------------------------------- | --------------------------------------------------------- |
| `verifyDiscordSignature`             | function  | `(input: VerifyDiscordSignatureInput) => void`              | Pure Ed25519 check. **Throws** `DiscordError` on failure. |
| `VerifyDiscordSignatureInput`        | type      | Raw body, headers, and `DiscordSignatureOptions`            | —                                                         |
| `DiscordSignatureOptions`            | type      | Public key plus max age                                     | —                                                         |
| `DiscordSignatureFailureReason`      | type      | Reason codes landing in `internalDetails.reason`            | —                                                         |
| `DiscordSignaturePolicy`             | class     | `extends Policy<DiscordSignaturePolicyContext>`             | Policy form — denies rather than throwing.                |
| `DiscordSignaturePolicyContext`      | interface | Structurally compatible with koa's `SignaturePolicyContext` | What lets `requireSignature` drive it.                    |
| `DISCORD_SIGNATURE_POLICY`           | constant  | The `PolicyRegistryMap` key                                 | —                                                         |
| `DISCORD_SIGNATURE_HEADER`           | constant  | `'X-Signature-Ed25519'`                                     | —                                                         |
| `DISCORD_SIGNATURE_TIMESTAMP_HEADER` | constant  | `'X-Signature-Timestamp'`                                   | —                                                         |

### `.` — interactions and dispatch

| Export                             | Kind         | Shape                                                                           | Notes                                                                                  |
| ---------------------------------- | ------------ | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `InteractionType`                  | const + type | `PING`, `APPLICATION_COMMAND`, `MESSAGE_COMPONENT`, …                           | A const object, not a TS `enum`.                                                       |
| `InteractionCallbackType`          | const + type | `PONG`, `CHANNEL_MESSAGE_WITH_SOURCE`, `DEFERRED_*`, …                          | Same.                                                                                  |
| `DiscordInteractionHandler`        | interface    | `handle(interaction, context): Promise<DiscordInteractionResponse \| void>`     | Must respond within ~3 s.                                                              |
| `DiscordInteractionHandlerMap`     | class        | `extends Map<string, DiscordInteractionHandler>`                                | Keyed by `interactionRouteKey(interaction)`.                                           |
| `interactionRouteKey`              | function     | `(interaction) => string \| undefined`                                          | `command:<name>`, `component:<custom_id>`, `autocomplete:<name>`, `modal:<custom_id>`. |
| `DiscordDispatcher`                | class        | `dispatchInteraction(interaction, options?)`                                    | Returns the callback the route serialises.                                             |
| `DiscordDispatchOptions`           | interface    | `{ idempotency?: IdempotencyStore }`                                            | Never wraps the `PING` handshake.                                                      |
| `discordInteractionIdempotencyKey` | function     | `(interaction) => string`                                                       | Keyed by `interaction.id`.                                                             |
| Payload types                      | —            | `DiscordInteraction`, `DiscordInteractionContext`, `DiscordInteractionResponse` | —                                                                                      |

### `.` — client

| Export                               | Kind     | Shape                                                                    | Notes                               |
| ------------------------------------ | -------- | ------------------------------------------------------------------------ | ----------------------------------- |
| `DiscordClient`                      | class    | `createMessage`, `createInteractionResponse`, `createFollowupMessage`, … | Built-in REST client, no SDK.       |
| `DISCORD_API_BASE`                   | constant | —                                                                        | —                                   |
| `DISCORD_DEFAULT_REQUEST_TIMEOUT_MS` | constant | —                                                                        | —                                   |
| `DiscordRequestOptions`              | type     | —                                                                        | —                                   |
| `redactDiscordWebhookToken`          | function | Strips the token from a webhook URL before logging                       | Use before logging any webhook URL. |

### `./comms`

| Export                  | Kind     | Shape                                                                               | Notes                                                             |
| ----------------------- | -------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `createDiscordNotifier` | function | `(client: DiscordClient, templates: TemplateRegistry) => Notifier`                  | For **proactive** sends outside an interaction (`createMessage`). |
| `dispatchDiscord`       | function | `(router, client, interaction) => Promise<DiscordInteractionResponse \| undefined>` | `PING` → `PONG`; command → `command`; component → `action`.       |

## Canonical usage

```typescript
import {
  DiscordConfig,
  DiscordDispatcher,
  DiscordInteractionHandlerMap,
  DiscordSignaturePolicy,
  DISCORD_SIGNATURE_POLICY,
  InteractionCallbackType,
  type DiscordSignatureOptions,
} from '@maroonedsoftware/discord';

registry.register(DeployCommand).useClass(DeployCommand).asSingleton();
registry.register(DeployConfirm).useClass(DeployConfirm).asSingleton();

registry.register(DiscordConfig).useValue(appConfig.getAs<DiscordConfig>('discord'));
registry
  .register(DiscordInteractionHandlerMap)
  .useMap(DiscordInteractionHandlerMap)
  .set('command:deploy', DeployCommand)
  .set('component:deploy.confirm', DeployConfirm);
policies.set(DISCORD_SIGNATURE_POLICY, DiscordSignaturePolicy);

router.post('/discord/interactions', requireSignature<DiscordSignatureOptions>('discord', { policy: DISCORD_SIGNATURE_POLICY }), async ctx => {
  const interaction = JSON.parse(ctx.rawBody as string);
  const response = await ctx.container.get(DiscordDispatcher).dispatchInteraction(interaction);
  if (response) ctx.body = response;
  else ctx.status = 204; // already acked out of band, or nothing matched
});
```

Slow work — defer, then follow up with the interaction `token`:

```typescript
async handle(interaction, context) {
  await jobs.send('deploy.run', { token: interaction.token, ...args });
  return { type: InteractionCallbackType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE };
}
```

## Rules for generated code

- Verify the Ed25519 signature **before** parsing or dispatching, using `requireSignature` with
  `DISCORD_SIGNATURE_POLICY`. Verification needs `ctx.rawBody`.
- Store `DiscordConfig` in `AppConfig`. Never inline `botToken` or `publicKey`.
- Handle `PING` → `PONG`. `dispatchDiscord` does it; the native path expects the dispatcher's
  return value to be serialised.
- **Respond within ~3 seconds.** For anything slower, return a `DEFERRED_*` callback and follow up
  with `DiscordClient` using `interaction.token`.
- Register handlers under the exact `interactionRouteKey` shape (`command:<name>`,
  `component:<custom_id>`, `autocomplete:<name>`, `modal:<custom_id>`).
- `custom_id` values are wire contracts that round-trip through Discord on a component. Use dot
  notation and keep them stable.
- Do not treat `undefined` from `dispatchDiscord` as "no handler" — see Gotchas. Ack with an empty
  2xx.
- Never log a webhook URL without `redactDiscordWebhookToken`.
- Import `./comms` functions from `@maroonedsoftware/discord/comms`, never from the root.

## Gotchas

- **`undefined` from `dispatchDiscord` is ambiguous.** It means nothing matched, _or_ the handler
  did not reply, _or_ the handler replied more than once. In the multi-reply case the adapter has
  **already acknowledged** the interaction out of band and delivered every reply as a followup, so
  responding with an error would be wrong. Ack with an empty 2xx.
- **The multi-reply path is subtle and deliberate.** The HTTP callback is only sent after `dispatch`
  returns, so a followup issued before that would race ahead of the ack and Discord would 404. On a
  _second_ reply the adapter sends the captured first reply via
  `POST /interactions/{id}/{token}/callback` immediately, marks the interaction acknowledged, and
  routes that and every later reply as followups. `getCallback()` then returns `undefined` so the
  route does not double-acknowledge. Do not "simplify" this.
- **The comms adapter always sets `allowed_mentions: { parse: [] }`**, so user-supplied text can
  never trigger `@everyone`, `@here`, or role pings. The **native** `DiscordClient` path does not —
  set it yourself there.
- **Buttons are chunked into rows of 5.** Discord's action-row limit is 5 components; the adapter
  splits automatically. Discord's own limit of 5 rows still applies, so more than 25 buttons will be
  rejected by the API.
- **Discord does not redeliver HTTP interactions** the way Slack, WhatsApp, and Telegram redeliver
  events. `DiscordDispatchOptions.idempotency` is a conservative guard against duplicate _side
  effects_ from a proxy retry or a client double-submit, not a redelivery net.
- **`InteractionType` and `InteractionCallbackType` are const objects, not TS enums** (each exports
  both a value and a type of the same name). `isolatedModules`-friendly, but they do not behave like
  enums for reverse lookup.
- **`publicKey` verifies, `botToken` authenticates.** Swapping them produces a signature failure on
  every request and a 401 on every REST call, with no hint that the two are transposed.

## Working inside this package

```
src/
  index.ts                      Root barrel
  discord.config.ts             DiscordConfig (interface + token)
  discord.error.ts              DiscordError, IsDiscordError
  discord.signature.ts          verifyDiscordSignature + header/constant exports
  discord.signature.policy.ts   DiscordSignaturePolicy, DISCORD_SIGNATURE_POLICY
  discord.interaction.handler.ts Handler + map, interactionRouteKey, InteractionType(+Callback)
  discord.dispatcher.ts         DiscordDispatcher, DiscordDispatchOptions,
                                discordInteractionIdempotencyKey
  client/discord.client.ts      DiscordClient, redactDiscordWebhookToken
  comms.ts                      Subpath entry — notifier, render, interactionReply, dispatchDiscord
```

Tests are in `tests/`, mirroring `src/`.

Invariants a change must not break:

- **Nothing reachable from `src/index.ts` may import `@maroonedsoftware/comms` or
  `@maroonedsoftware/cache`.** Both are optional peers (`cache` is imported `type`-only).
- No dependency on `@maroonedsoftware/koa`; the structural signature-policy context keeps the arrow
  out.
- Ed25519 verification stays before any body parsing and keeps its replay window.
- `allowed_mentions: { parse: [] }` in the comms renderer is a security control.
- The out-of-band ack sequence in `interactionReply` is what makes multi-reply handlers work at all.
- The four chat packages share a deliberate shape: config token, error + guard, verification
  function + policy, handler maps, dispatcher, client, `./comms` adapter. Keep changes consistent
  across all four.

User-visible changes need a changeset in `.changeset/`.
