# AGENTS.md — @maroonedsoftware/whatsapp

Machine-oriented guide for AI agents. Human prose and long-form examples live in [README.md](./README.md).
Repo-wide conventions live in the [root AGENTS.md](../../AGENTS.md).

## Purpose

A WhatsApp Cloud API dispatcher for ServerKit: HMAC signature verification and the `hub.*` webhook
verification handshake as policies, DI-registered handler maps for messages, interactive replies,
and delivery statuses, a `WhatsAppClient` over the Graph API, and an optional adapter binding it to
the channel-agnostic `@maroonedsoftware/comms` router.

Reach for the native handler maps for media, templates, and delivery-status tracking; reach for
`./comms` when the same bot should also run on Slack, Discord, and Telegram.

## Install

```bash
pnpm add @maroonedsoftware/whatsapp
pnpm add @maroonedsoftware/comms   # only for the ./comms adapter
pnpm add @maroonedsoftware/cache   # only for idempotency
```

Runtime dependencies: `@maroonedsoftware/errors`, `@maroonedsoftware/logger`,
`@maroonedsoftware/policies`, `injectkit`. Optional peers: `@maroonedsoftware/comms`,
`@maroonedsoftware/cache`. **No Meta SDK** — the Graph API client is built in.

## Position in the graph

- **Depends on:** `errors`, `logger`, `policies`. `comms` and `cache` are **optional** peers.
- **Depended on by:** nothing internal.
- **Subpath exports:**
  - `.` — config, errors, signature and webhook verification, handler maps, dispatcher, client.
  - `./comms` — the adapter. Pulls in `@maroonedsoftware/comms`. It lives here, not in `comms`,
    because `comms` must stay channel-free; see the root AGENTS.md.

**Not a dependency: `koa`.** Your route parses the request and calls the dispatcher.

## API surface

### `.` — config and errors

| Export            | Kind                       | Shape                                                                                         | Notes                                                  |
| ----------------- | -------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `WhatsAppConfig`  | interface + abstract class | `{ accessToken, phoneNumberId, appSecret, verifyToken, graphApiVersion?, requestTimeoutMs? }` | Declaration-merged so one symbol is type and DI token. |
| `WhatsAppError`   | class                      | `extends ServerkitError`                                                                      | —                                                      |
| `IsWhatsAppError` | type guard                 | `(error: unknown) => error is WhatsAppError`                                                  | —                                                      |

Four distinct credentials: `accessToken` authenticates Graph API calls, `appSecret` verifies the
HMAC on inbound webhooks, `verifyToken` answers the one-time `hub.*` handshake, and
`phoneNumberId` addresses the sending number.

### `.` — verification

| Export                                                                 | Kind      | Shape                                                       | Notes                                                      |
| ---------------------------------------------------------------------- | --------- | ----------------------------------------------------------- | ---------------------------------------------------------- |
| `verifyWhatsAppSignature`                                              | function  | `(input: VerifyWhatsAppSignatureInput) => void`             | HMAC over the raw body. **Throws** `WhatsAppError`.        |
| `VerifyWhatsAppSignatureInput`                                         | type      | Raw body, header, and `WhatsAppSignatureOptions`            | —                                                          |
| `WhatsAppSignatureOptions`                                             | type      | The app secret                                              | —                                                          |
| `WhatsAppSignatureFailureReason`                                       | type      | Reason codes landing in `internalDetails.reason`            | —                                                          |
| `WhatsAppSignaturePolicy`                                              | class     | `extends Policy<WhatsAppSignaturePolicyContext>`            | Policy form — denies rather than throwing.                 |
| `WhatsAppSignaturePolicyContext`                                       | interface | Structurally compatible with koa's `SignaturePolicyContext` | What lets `requireSignature` drive it.                     |
| `WHATSAPP_SIGNATURE_POLICY`                                            | constant  | The `PolicyRegistryMap` key                                 | —                                                          |
| `WHATSAPP_SIGNATURE_HEADER`                                            | constant  | `'X-Hub-Signature-256'`                                     | —                                                          |
| `verifyWhatsAppWebhook`                                                | function  | `(input: VerifyWhatsAppWebhookInput) => string`             | The **`GET` handshake** — returns `hub.challenge` to echo. |
| `VerifyWhatsAppWebhookInput`                                           | type      | The `hub.*` query params plus the expected verify token     | —                                                          |
| `WhatsAppVerificationFailureReason`                                    | type      | —                                                           | —                                                          |
| `WHATSAPP_HUB_MODE_PARAM` / `…CHALLENGE_PARAM` / `…VERIFY_TOKEN_PARAM` | constants | `'hub.mode'`, `'hub.challenge'`, `'hub.verify_token'`       | —                                                          |

Two separate mechanisms: the `GET` handshake registers the webhook once, and the HMAC verifies every
`POST` afterwards. You need both routes.

### `.` — handlers and dispatch

| Export                                                           | Kind      | Shape                                                                                                                                                                                | Notes                                                       |
| ---------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `WhatsAppMessageHandler`                                         | interface | `handle(message, context: WhatsAppMessageContext)`                                                                                                                                   | —                                                           |
| `WhatsAppMessageHandlerMap`                                      | class     | `extends Map<string, WhatsAppMessageHandler>`                                                                                                                                        | Keyed by message type (`text`, `image`, `document`, …).     |
| `WhatsAppInteractiveHandler`                                     | interface | `handle(message, context)`                                                                                                                                                           | —                                                           |
| `WhatsAppInteractiveHandlerMap`                                  | class     | `extends Map<string, WhatsAppInteractiveHandler>`                                                                                                                                    | Keyed by the interactive reply id.                          |
| `WhatsAppStatusHandler`                                          | interface | `handle(status, context: WhatsAppStatusContext)`                                                                                                                                     | Delivery receipts.                                          |
| `WhatsAppStatusHandlerMap`                                       | class     | `extends Map<string, WhatsAppStatusHandler>`                                                                                                                                         | Keyed by status (`sent`, `delivered`, `read`, `failed`).    |
| `interactiveReplyId`                                             | function  | `(message) => string \| undefined`                                                                                                                                                   | Reads `interactive.button_reply` / `list_reply` / `button`. |
| `WhatsAppDispatcher`                                             | class     | `dispatchWebhook(body, options?)`                                                                                                                                                    | Walks entries → changes → messages.                         |
| `WhatsAppDispatchOptions`                                        | interface | `{ idempotency?: IdempotencyStore }`                                                                                                                                                 | —                                                           |
| `whatsappMessageIdempotencyKey` / `whatsappStatusIdempotencyKey` | function  | —                                                                                                                                                                                    | Two separate keying functions.                              |
| Payload types                                                    | —         | `WhatsAppWebhookBody`, `WhatsAppEntry`, `WhatsAppChange`, `WhatsAppValue`, `WhatsAppMessage`, `WhatsAppContact`, `WhatsAppStatus`, `WhatsAppMessageContext`, `WhatsAppStatusContext` | —                                                           |

### `.` — client

| Export                                | Kind     | Shape                                           | Notes                              |
| ------------------------------------- | -------- | ----------------------------------------------- | ---------------------------------- |
| `WhatsAppClient`                      | class    | `sendText`, `sendInteractive`, `sendMessage`, … | Built-in Graph API client, no SDK. |
| `WHATSAPP_GRAPH_API_HOST`             | constant | —                                               | —                                  |
| `WHATSAPP_DEFAULT_GRAPH_API_VERSION`  | constant | —                                               | Overridable via `graphApiVersion`. |
| `WHATSAPP_DEFAULT_REQUEST_TIMEOUT_MS` | constant | —                                               | —                                  |

### `./comms`

| Export                   | Kind     | Shape                                                               | Notes                                                                            |
| ------------------------ | -------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `createWhatsAppNotifier` | function | `(client: WhatsAppClient, templates: TemplateRegistry) => Notifier` | Recipient is a `wa_id` (phone). Native payloads omit `messaging_product` / `to`. |
| `dispatchWhatsApp`       | function | `(router, client, body) => Promise<void>`                           | `/`-prefixed text → `command`; other text → `message`; interactive → `action`.   |

## Canonical usage

```typescript
import {
  WhatsAppConfig,
  WhatsAppDispatcher,
  WhatsAppMessageHandlerMap,
  WhatsAppSignaturePolicy,
  WHATSAPP_SIGNATURE_POLICY,
  verifyWhatsAppWebhook,
  type WhatsAppSignatureOptions,
} from '@maroonedsoftware/whatsapp';

registry.register(WhatsAppConfig).useValue(appConfig.getAs<WhatsAppConfig>('whatsapp'));
policies.set(WHATSAPP_SIGNATURE_POLICY, WhatsAppSignaturePolicy);

// 1. The one-time GET handshake — no signature to verify yet
router.get('/whatsapp/webhook', async ctx => {
  ctx.body = verifyWhatsAppWebhook({ query: ctx.query, expectedToken: config.verifyToken });
});

// 2. Every inbound POST — HMAC-verified
router.post('/whatsapp/webhook', requireSignature<WhatsAppSignatureOptions>('whatsapp', { policy: WHATSAPP_SIGNATURE_POLICY }), async ctx => {
  await ctx.container.get(WhatsAppDispatcher).dispatchWebhook(JSON.parse(ctx.rawBody as string), {
    idempotency: ctx.container.get(IdempotencyStore),
  });
  ctx.status = 200;
});
```

Channel-agnostic instead:

```typescript
import { dispatchWhatsApp } from '@maroonedsoftware/whatsapp/comms';

await dispatchWhatsApp(router, client, body);
```

## Rules for generated code

- Mount **both** routes. The `GET` handshake registers the webhook; the `POST` handles traffic. A
  missing `GET` means Meta will not accept the subscription at all.
- Verify the HMAC on every `POST` before parsing or dispatching, using `requireSignature` with
  `WHATSAPP_SIGNATURE_POLICY`. Verification needs `ctx.rawBody`.
- Store `WhatsAppConfig` in `AppConfig` and keep the four credentials straight (see the config
  table). Never inline any of them.
- Ack with a 200 quickly. Meta redelivers for hours, so a slow or failing handler produces a long
  retry tail.
- Pass an `IdempotencyStore` to `dispatchWebhook`. Meta redelivers, and the redelivery window is
  hours — size `retentionTtl` accordingly.
- Keep button ids short and stable. They round-trip through WhatsApp as reply ids.
- Handle `status` updates (`failed` especially) via `WhatsAppStatusHandlerMap` — send failures are
  reported asynchronously, not on the send call.
- Import `./comms` functions from `@maroonedsoftware/whatsapp/comms`, never from the root.

## Gotchas

- **Buttons silently change widget type at 4.** The comms adapter sends plain text with no buttons,
  an interactive **button** message for 1–3, and an interactive **list** (with a hard-coded
  `"Choose"` trigger label) for 4 or more. Adding a fourth button changes the UI the user sees, with
  no error and no way to override the list label through the portable API.
- **A webhook body is deeply nested and plural at every level.** `entry[] → changes[] → value →
messages[]`. `dispatchWhatsApp` walks all of it; a hand-rolled handler that reads
  `body.entry[0].changes[0].value.messages[0]` will drop batched messages.
- **Media and non-text messages are skipped by the comms adapter.** They stay on
  `WhatsAppMessageHandlerMap`. Mixing the two paths is expected.
- **Command detection in the comms path is a bare `/` prefix check** on text messages — WhatsApp has
  no native slash-command concept. Users do not naturally type `/`, so a WhatsApp-only bot usually
  wants `router.message(...)` rather than `router.command(...)`.
- **`conversation.id` is the sender's phone number** (`wa_id`), which is personal data. Do not log
  it unredacted.
- **The `GET` handshake route cannot be signature-verified** — there is no body and no HMAC at that
  point. `verifyWhatsAppWebhook` compares `hub.verify_token`. Do not put `requireSignature` on it.
- **`verifyWhatsAppWebhook` returns the challenge to echo**, as a bare string body. Wrapping it in
  JSON fails the handshake.
- **Message and status idempotency use different key functions.** Using the message key for a status
  update collides across the two streams.

## Working inside this package

```
src/
  index.ts                       Root barrel
  whatsapp.config.ts             WhatsAppConfig (interface + token)
  whatsapp.error.ts              WhatsAppError, IsWhatsAppError
  whatsapp.signature.ts          verifyWhatsAppSignature + header/constant exports
  whatsapp.webhook.ts            verifyWhatsAppWebhook + hub.* param constants
  whatsapp.signature.policy.ts   WhatsAppSignaturePolicy, WHATSAPP_SIGNATURE_POLICY
  whatsapp.message.handler.ts    Handler maps, interactiveReplyId, webhook body types
  whatsapp.dispatcher.ts         WhatsAppDispatcher, the two idempotency key functions
  client/whatsapp.client.ts      WhatsAppClient
  comms.ts                       Subpath entry — notifier, portable/native delivery, dispatchWhatsApp
```

Tests are in `tests/`, mirroring `src/`.

Invariants a change must not break:

- **Nothing reachable from `src/index.ts` may import `@maroonedsoftware/comms` or
  `@maroonedsoftware/cache`.** Both are optional peers.
- No dependency on `@maroonedsoftware/koa`; the structural policy context keeps the arrow out.
- HMAC comparison stays constant-time and runs over the **raw** body, before any re-serialisation.
- The dispatcher must keep walking every level of `entry → changes → messages`; batching is normal.
- The button-count degradation (text / buttons / list) is the documented portable contract.
- The four chat packages share a deliberate shape: config token, error + guard, verification
  function + policy, handler maps, dispatcher, client, `./comms` adapter. Keep changes consistent
  across all four.

User-visible changes need a changeset in `.changeset/`.
