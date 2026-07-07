# @maroonedsoftware/whatsapp

Transport-agnostic WhatsApp Cloud API integration for ServerKit. The package gives you:

- a DI-friendly `fetch`-based wrapper around Meta's Graph API for sending messages — no SDK dependency, and
- a single `WhatsAppDispatcher` service that walks a batched webhook body and routes each message and status to typed handlers.

The package owns no HTTP routes or middleware — wire `WhatsAppDispatcher` from your own Koa, Express, Fastify, or Lambda handler.

## Installation

```bash
pnpm add @maroonedsoftware/whatsapp
```

## Exports

| Symbol                            | Purpose                                                                                                       |
|-----------------------------------|---------------------------------------------------------------------------------------------------------------|
| `WhatsAppConfig`                  | Abstract `@Injectable()` token; carries `accessToken`, `phoneNumberId`, `appSecret`, `verifyToken`, optional `graphApiVersion`. |
| `WhatsAppClient`                  | `fetch`-based Graph API wrapper. Methods: `sendMessage`, `sendText`, `sendInteractive`, `markAsRead`, plus a generic `request`. |
| `WhatsAppDispatcher`              | Single-method service: `dispatchWebhook` (walks the batched body).                                             |
| `WhatsAppMessageHandlerMap`       | `Map<messageType, WhatsAppMessageHandler>` — register one handler per message `type` (`text`, `image`, …).     |
| `WhatsAppInteractiveHandlerMap`   | `Map<replyId, WhatsAppInteractiveHandler>` — register handlers for interactive button/list replies by id.      |
| `WhatsAppStatusHandlerMap`        | `Map<status, WhatsAppStatusHandler>` — register handlers per delivery status (`sent`/`delivered`/`read`/`failed`). |
| `WhatsAppError`                   | `ServerkitError` subclass for non-HTTP domain failures (signature mismatch, Graph API call failed, …).         |
| `verifyWhatsAppSignature(input)`  | Pure helper that validates Meta's `X-Hub-Signature-256` HMAC. No request/context coupling.                     |
| `verifyWhatsAppWebhook(input)`    | Pure helper for the subscription verification (`GET`) handshake; returns the challenge to echo.                |
| `WhatsAppSignaturePolicy`         | `@maroonedsoftware/policies` form of `verifyWhatsAppSignature` (registered under `WHATSAPP_SIGNATURE_POLICY`). |
| `interactiveReplyId(message)`     | Helper that produces the `WhatsAppInteractiveHandlerMap` key for an interactive/quick-reply message.           |
| `whatsappMessageIdempotencyKey(message)` | Pure helper: `whatsapp:message:{message.id}` — the de-duplication key for an inbound message.            |
| `whatsappStatusIdempotencyKey(status)`   | Pure helper: `whatsapp:status:{status.id}:{status.status}` — keyed by status VALUE so `sent`/`delivered`/`read` don't collide. |

## Configuration

The package does not read `AppConfig` itself — services take `WhatsAppConfig` directly via DI:

```ts
import { WhatsAppConfig } from '@maroonedsoftware/whatsapp';

const whatsappConfig = appConfig.getAs<WhatsAppConfig>('whatsapp');
container.register(WhatsAppConfig, { useValue: whatsappConfig });
```

```jsonc
// config.json
{
  "whatsapp": {
    "accessToken": "EAAG...",     // Graph API token (Bearer)
    "phoneNumberId": "123456789", // sends from this number
    "appSecret": "...",           // verifies X-Hub-Signature-256
    "verifyToken": "...",         // echoed during the GET handshake
    "graphApiVersion": "v21.0"    // optional, defaults to v21.0
  }
}
```

| Field             | Required | Used by                                                              |
|-------------------|----------|----------------------------------------------------------------------|
| `accessToken`     | yes      | `WhatsAppClient` — sent as `Authorization: Bearer`.                  |
| `phoneNumberId`   | yes      | `WhatsAppClient` send endpoint (`/{phoneNumberId}/messages`).         |
| `appSecret`       | yes      | Webhook signature verification (`X-Hub-Signature-256`).               |
| `verifyToken`     | yes      | Subscription verification (`GET`) handshake.                         |
| `graphApiVersion` | no       | Graph API version segment. Defaults to `v21.0`.                       |

## Sending messages

```ts
import { WhatsAppClient } from '@maroonedsoftware/whatsapp';

const whatsapp = container.get(WhatsAppClient);

await whatsapp.sendText('15551234567', 'Your order has shipped :package:');
await whatsapp.markAsRead(message.id);

// Interactive (buttons / list), templates, media — pass the raw payload
await whatsapp.sendInteractive('15551234567', { type: 'button', body: { text: 'Confirm?' }, action: { buttons: [/* … */] } });
await whatsapp.sendMessage({ messaging_product: 'whatsapp', to: '15551234567', type: 'template', template: { /* … */ } });
```

Every method throws `WhatsAppError` (with `{ status, body, url }` on `internalDetails`) on a non-2xx response.

## Receiving webhooks

WhatsApp uses two HTTP exchanges on the same path: a one-off `GET` to verify the subscription, and ongoing `POST`s carrying message/status batches.

### Verification handshake (GET)

```ts
import { WhatsAppConfig, verifyWhatsAppWebhook, WhatsAppError } from '@maroonedsoftware/whatsapp';

router.get('/whatsapp/webhook', (ctx) => {
  try {
    ctx.body = verifyWhatsAppWebhook({
      verifyToken: ctx.container.get(WhatsAppConfig).verifyToken,
      mode: ctx.query['hub.mode'],
      token: ctx.query['hub.verify_token'],
      challenge: ctx.query['hub.challenge'],
    });
  } catch (err) {
    if (err instanceof WhatsAppError) { ctx.status = 403; return; }
    throw err;
  }
});
```

### Message delivery (POST)

```ts
import {
  WhatsAppConfig,
  WhatsAppDispatcher,
  WhatsAppMessageHandlerMap,
  verifyWhatsAppSignature,
  type WhatsAppMessageHandler,
} from '@maroonedsoftware/whatsapp';
import rawBody from 'raw-body';

class TextHandler implements WhatsAppMessageHandler {
  async handle(message, context) {
    // Ack quickly — WhatsApp retries any non-2xx. Offload slow work via @maroonedsoftware/jobbroker.
  }
}

const messages = new WhatsAppMessageHandlerMap();
messages.set('text', container.get(TextHandler));
container.register(WhatsAppMessageHandlerMap, { useValue: messages });

router.post('/whatsapp/webhook', async (ctx) => {
  const raw = await rawBody(ctx.req, { encoding: 'utf8' });
  verifyWhatsAppSignature({
    appSecret: ctx.container.get(WhatsAppConfig).appSecret,
    rawBody: raw,
    signature: ctx.get('x-hub-signature-256'),
  });
  await ctx.container.get(WhatsAppDispatcher).dispatchWebhook(JSON.parse(raw));
  ctx.status = 200;
});
```

### De-duplicating redeliveries

WhatsApp is at-least-once: any non-2xx ack (or a slow one) makes Meta resend the **whole** webhook, so the same `message.id` / `status` can arrive more than once. There are two ways to make processing exactly-once, and they compose.

**(a) Durable — enqueue then ack (recommended for real work).** Handlers should ack in milliseconds, so offload the actual work to a job and let the queue own idempotency. Key the job by the message id (or `status.id:status.status`) so a redelivery enqueues the *same* job identity and the broker collapses it. With `@maroonedsoftware/jobbroker` (pg-boss) that is the job's `singletonKey` — a second insert with the same key is a no-op:

```ts
class TextHandler implements WhatsAppMessageHandler {
  async handle(message, context) {
    // Conceptually: broker.send('whatsapp.inbound', { message, context }, { singletonKey: message.id })
    // Redelivery re-enqueues the same singletonKey → deduped by the queue, not by us.
    await this.jobs.enqueue('whatsapp.inbound', { message, context }, { singletonKey: message.id });
  }
}
// Ack 200 immediately after dispatchWebhook returns — the work runs off the request path.
```

**(b) Edge dedup — one line at the front door.** For lighter handlers (or as a guard in front of the enqueue) pass an `IdempotencyStore` into `dispatchWebhook`. Each message and status is wrapped per item (`whatsappMessageIdempotencyKey` / `whatsappStatusIdempotencyKey`), so a redelivered batch replays only the items it hasn't already processed:

```ts
import { IdempotencyStore } from '@maroonedsoftware/cache';

await ctx.container.get(WhatsAppDispatcher).dispatchWebhook(JSON.parse(raw), {
  idempotency: ctx.container.get(IdempotencyStore),
});
ctx.status = 200;
```

De-dup is per item (not per batch) because WhatsApp resends the entire webhook on failure. Statuses are keyed by their VALUE too, so the legitimate `sent → delivered → read` sequence for one message is each processed rather than collapsed. Omit `options` for the default at-least-once behaviour.

### Routing

A webhook body is a **batch** — `dispatchWebhook` walks every `entry → change → value` and dispatches each message and status:

| Inbound                         | Map                              | Key                                        |
|---------------------------------|----------------------------------|--------------------------------------------|
| message (by type)               | `WhatsAppMessageHandlerMap`      | `message.type` (`text`, `image`, …)        |
| interactive / quick-reply       | `WhatsAppInteractiveHandlerMap`  | reply id (`interactiveReplyId(message)`)   |
| delivery status                 | `WhatsAppStatusHandlerMap`       | `status.status` (`delivered`, `read`, …)   |

For `interactive` and `button` messages the dispatcher tries the interactive map (by reply id) **first**, then falls back to the message-type map. Each handler receives a context with the resolved `phoneNumberId`, `displayPhoneNumber`, `wabaId`, the sender `contact`, and the raw `value`.

## Signature verification

`verifyWhatsAppSignature` is a pure function — the caller pulls the header and raw body from whatever transport it's using:

```ts
import { verifyWhatsAppSignature, WhatsAppError } from '@maroonedsoftware/whatsapp';

try {
  verifyWhatsAppSignature({
    appSecret: whatsappConfig.appSecret,
    rawBody,                                   // exactly what Meta sent
    signature: req.headers['x-hub-signature-256'] as string,
  });
} catch (err) {
  if (err instanceof WhatsAppError) {
    // err.internalDetails.reason is 'missing_signature' | 'invalid_signature'
    throw httpError(401).withCause(err);
  }
  throw err;
}
```

Meta signs the raw body with `HMAC-SHA256(appSecret, rawBody)` and sends the hex digest as `X-Hub-Signature-256: sha256=<hex>`, compared here with `crypto.timingSafeEqual`. There is no timestamp in the scheme, so there is no replay window.

### As a policy

`WhatsAppSignaturePolicy` is the same rule wrapped as a `@maroonedsoftware/policies` policy. It delegates to `verifyWhatsAppSignature` (one source of truth) but returns a `PolicyResult` instead of throwing.

```ts
import { WhatsAppSignaturePolicy, WHATSAPP_SIGNATURE_POLICY, WhatsAppConfig } from '@maroonedsoftware/whatsapp';

registry.set(WHATSAPP_SIGNATURE_POLICY, WhatsAppSignaturePolicy);

const result = await ctx.container.get(PolicyService).check(WHATSAPP_SIGNATURE_POLICY, {
  rawBody: ctx.rawBody,
  getHeader: name => ctx.get(name),
  options: ctx.container.get(WhatsAppConfig),
});
if (isPolicyResultDenied(result)) throw httpError(401);
```

The context (`rawBody` + a case-insensitive `getHeader` + `options`) is structurally compatible with `@maroonedsoftware/koa`'s `SignaturePolicyContext<WhatsAppSignatureOptions>`, so the koa `requireSignature` middleware can drive this policy when registered under the signature policy name — no koa dependency in this package.

## Limitations

- v1 targets a single phone number via `WhatsAppConfig`. Media upload/download helpers are out of scope (use `WhatsAppClient.request` against the media endpoints).

## Use with `@maroonedsoftware/comms`

The `@maroonedsoftware/whatsapp/comms` subpath adapts this package to the channel-agnostic
[`@maroonedsoftware/comms`](../comms) router (declared as an **optional peer**), so one handler runs
on WhatsApp and every other wired channel.

```ts
import { WhatsAppClient, WhatsAppConfig, verifyWhatsAppSignature } from '@maroonedsoftware/whatsapp';
import { dispatchWhatsApp, createWhatsAppNotifier } from '@maroonedsoftware/whatsapp/comms';
import { router } from './router.js'; // a shared ChannelRouter

http.post('/whatsapp/webhook', async (ctx) => {
  const raw = await rawBody(ctx.req, { encoding: 'utf8' });
  verifyWhatsAppSignature({ appSecret: ctx.container.get(WhatsAppConfig).appSecret, rawBody: raw, signature: ctx.get('x-hub-signature-256') });
  await dispatchWhatsApp(router, ctx.container.get(WhatsAppClient), JSON.parse(raw));
  ctx.status = 200;
});
```

- `dispatchWhatsApp` walks the batch: `/`-prefixed text → `command`, other text → `message`,
  interactive/quick-reply → `action`. Media and delivery statuses are skipped here — handle them on
  the native `WhatsAppMessageHandlerMap` / `WhatsAppStatusHandlerMap`.
- Replies go back to the sender (`message.from`). Buttons render as an interactive button message
  (≤3) or degrade to a list (>3). `createWhatsAppNotifier(client, router.templates)` sends
  proactively; `reply.sendTemplate` / `reply.sendNative` cover templates and other rich payloads.

## License

MIT
