# @maroonedsoftware/telegram

Transport-agnostic Telegram Bot API integration for ServerKit. The package gives you:

- a DI-friendly `fetch`-based wrapper around the Bot API — no SDK dependency, and
- a single `TelegramDispatcher` service that routes parsed updates (commands, callback queries, and other update types) to typed handlers.

The package owns no HTTP routes or middleware — wire `TelegramDispatcher` from your own Koa, Express, Fastify, or Lambda handler.

## Installation

```bash
pnpm add @maroonedsoftware/telegram
```

## Exports

| Symbol                                 | Purpose                                                                                                                                                                            |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TelegramConfig`                       | Abstract `@Injectable()` token; carries `botToken`, optional `secretToken`, `apiBaseUrl`, `requestTimeoutMs` and `fetch`.                                                          |
| `TelegramClient`                       | `fetch`-based Bot API wrapper. Methods: `sendMessage`, `answerCallbackQuery`, `setWebhook`, `deleteWebhook`, `getMe`, `getWebhookInfo`, `getUpdates`, plus a generic `callMethod`. |
| `TelegramDispatcher`                   | Single-method service: `dispatchUpdate`.                                                                                                                                           |
| `TelegramCommandHandlerMap`            | `Map<command, TelegramCommandHandler>` — register one handler per command (`/start`, …).                                                                                           |
| `TelegramCallbackQueryHandlerMap`      | `Map<callbackData, TelegramCallbackQueryHandler>` — register handlers for inline-keyboard button presses.                                                                          |
| `TelegramUpdateHandlerMap`             | `Map<updateType, TelegramUpdateHandler>` — register handlers per update type (`message`, `edited_message`, …).                                                                     |
| `TelegramError`                        | `ServerkitError` subclass for non-HTTP domain failures (Bot API error, secret-token mismatch, …).                                                                                  |
| `verifyTelegramSecretToken(input)`     | Pure helper that validates the `X-Telegram-Bot-Api-Secret-Token` header. No request/context coupling.                                                                              |
| `TelegramSecretTokenPolicy`            | `@maroonedsoftware/policies` form of the check (registered under `TELEGRAM_SECRET_TOKEN_POLICY`).                                                                                  |
| `parseCommand(message)`                | Helper that extracts a `/command` (and args) from a message, stripping any `@botname` suffix.                                                                                      |
| `updateType(update)`                   | Helper that returns an update's content type — the `TelegramUpdateHandlerMap` key.                                                                                                 |
| `telegramUpdateIdempotencyKey(update)` | Pure helper returning `telegram:update:{update_id}` — the de-duplication key for a redelivered update.                                                                             |

## Configuration

The package does not read `AppConfig` itself — services take `TelegramConfig` directly via DI:

```ts
import { TelegramConfig } from '@maroonedsoftware/telegram';

const telegramConfig = appConfig.getAs<TelegramConfig>('telegram');
registry.register(TelegramConfig).useValue(telegramConfig);
```

```jsonc
// config.json
{
  "telegram": {
    "botToken": "123456:ABC-DEF...", // from BotFather
    "secretToken": "a-long-random-string", // optional but recommended
    "apiBaseUrl": "https://api.telegram.org", // optional, override for a self-hosted Bot API server
  },
}
```

| Field              | Required | Used by                                                                                              |
| ------------------ | -------- | ---------------------------------------------------------------------------------------------------- |
| `botToken`         | yes      | `TelegramClient` — embedded in the Bot API URL (`/bot<token>/<method>`).                             |
| `secretToken`      | no\*     | Webhook authenticity check (`X-Telegram-Bot-Api-Secret-Token`). Set the same value via `setWebhook`. |
| `apiBaseUrl`       | no       | Bot API host. Defaults to `https://api.telegram.org`.                                                |
| `requestTimeoutMs` | no       | Per-call timeout. Defaults to 10s. `getUpdates` adds its own long-poll wait on top.                  |
| `fetch`            | no       | The `fetch` every call goes through. Defaults to the global one; see below.                          |

\* Optional but strongly recommended — it's the only authenticity signal Telegram provides for webhooks.

## Sending messages

```ts
import { TelegramClient } from '@maroonedsoftware/telegram';

const telegram = container.get(TelegramClient);

await telegram.sendMessage({ chat_id: 42, text: 'Deploy complete ✅' });
await telegram.answerCallbackQuery({ callback_query_id: query.id, text: 'Got it' });

// Anything else the Bot API supports
await telegram.callMethod('sendPhoto', { chat_id: 42, photo: 'https://…/pic.jpg' });
```

Bot API calls return `{ ok, result }`; the client returns `result` on success and throws `TelegramError` (with the API `description` on `internalDetails`) when `ok` is `false` or the HTTP status is non-2xx. A rate-limited call carries Telegram's `retry_after` as `internalDetails.retryAfter` (seconds). A call that never reached Telegram throws a `TelegramError` too, with the bot token redacted from its `reason` and no `cause` attached, because the token is part of every URL and a transport error usually quotes the URL.

### Bringing your own `fetch`

Set `TelegramConfig.fetch` when the caller owns the transport: a host that sends outbound HTTP through its own allowlist, rate limiter or proxy, or a test. The client calls it with the URL and a `POST` init carrying a JSON body and an `AbortSignal` for its timeout:

```ts
const client = new TelegramClient({ botToken, fetch: (url, init) => myHost.fetch(url, init) }, logger);
```

## Long polling

A bot with no public address to receive a webhook on can poll instead. `getUpdates` takes Telegram's own parameters, where `timeout` is the long-poll wait in seconds, and allows the call that wait on top of `requestTimeoutMs`, so a quiet poll that comes back empty is never cut off as a timeout:

```ts
let offset: number | undefined;
for (;;) {
  const updates = (await client.getUpdates({ offset, timeout: 25, allowed_updates: ['message'] })) as { update_id: number }[];
  for (const update of updates) await dispatcher.dispatchUpdate(update);
  if (updates.length > 0) offset = updates[updates.length - 1]!.update_id + 1;
}
```

Passing `offset` confirms every earlier update to Telegram, so persist it if a restart must not replay them. Telegram refuses `getUpdates` while a webhook is set: `getWebhookInfo` tells you whether one is, and `deleteWebhook` removes it.

### Registering the webhook

```ts
await container.get(TelegramClient).setWebhook({
  url: 'https://example.com/telegram/webhook',
  secret_token: telegramConfig.secretToken, // echoed back on every delivery
});
```

## Receiving updates

You own the route. Telegram POSTs one `Update` per request:

1. Verify the secret token (`verifyTelegramSecretToken`).
2. Parse the JSON body.
3. Call `dispatcher.dispatchUpdate(update)`.
4. Ack `200`.

```ts
import {
  TelegramConfig,
  TelegramDispatcher,
  TelegramCommandHandlerMap,
  verifyTelegramSecretToken,
  type TelegramCommandHandler,
} from '@maroonedsoftware/telegram';
import rawBody from 'raw-body';

class StartCommand implements TelegramCommandHandler {
  async handle(command, context) {
    // command.name === '/start', command.args === '…'; ack quickly and reply via TelegramClient.
  }
}

registry.register(StartCommand).useClass(StartCommand).asSingleton();

registry.register(TelegramCommandHandlerMap).useMap(TelegramCommandHandlerMap).set('/start', StartCommand);

router.post('/telegram/webhook', async ctx => {
  const raw = await rawBody(ctx.req, { encoding: 'utf8' });
  verifyTelegramSecretToken({
    secretToken: ctx.container.get(TelegramConfig).secretToken!,
    headerValue: ctx.get('x-telegram-bot-api-secret-token'),
  });
  await ctx.container.get(TelegramDispatcher).dispatchUpdate(JSON.parse(raw));
  ctx.status = 200;
});
```

### Routing

`dispatchUpdate` applies this precedence per update:

| Update                               | Map                               | Key                                |
| ------------------------------------ | --------------------------------- | ---------------------------------- |
| `message` whose text/caption is `/…` | `TelegramCommandHandlerMap`       | command name, e.g. `/start`        |
| `callback_query`                     | `TelegramCallbackQueryHandlerMap` | `callback_query.data`              |
| anything else                        | `TelegramUpdateHandlerMap`        | update type (`updateType(update)`) |

If a command or callback query has no matching handler, the dispatcher falls back to the update-type map (so a generic `message`/`callback_query` handler can still run). Each handler receives a context with the resolved `chatId`, `from`, `updateId`, and the raw `update`.

Telegram only invokes a command if the user's text begins with `/`; `parseCommand` lowercases the name and strips an `@botname` suffix (so `/Start@MyBot` routes as `/start`).

### Handling redeliveries (de-duplication)

Telegram redelivers the same update (same `update_id`) whenever your webhook answers with a non-2xx
status. If your handlers have side effects, a slow or flaky ack can cause them to run twice. There are
two ways to make delivery effectively at-most-once.

**(a) Durable — validate, enqueue, ack.** The most robust pattern for webhooks: do only cheap work
in the request (verify the secret token, parse the body), enqueue a background job keyed by
`update_id`, then ack `200` immediately. The queue's own de-duplication then guarantees the update is
processed once. With `@maroonedsoftware/jobbroker` (pg-boss), pass the `update_id` as the job's
`singletonKey` so an identical redelivery is collapsed to a single queued job:

```ts
router.post('/telegram/webhook', async ctx => {
  const raw = await rawBody(ctx.req, { encoding: 'utf8' });
  verifyTelegramSecretToken({
    secretToken: ctx.container.get(TelegramConfig).secretToken!,
    headerValue: ctx.get('x-telegram-bot-api-secret-token'),
  });
  const update = JSON.parse(raw);
  // Enqueue keyed by update_id — pg-boss's singletonKey dedupes a redelivered update.
  await ctx.container.get(JobBroker).send('telegram.update', update, { singletonKey: String(update.update_id) });
  ctx.status = 200; // ack fast; the worker calls dispatchUpdate(update) later
});
```

**(b) Edge dedup — one liner.** If you dispatch inline and just want to guard against redeliveries,
pass an `IdempotencyStore` (from `@maroonedsoftware/cache`). `dispatchUpdate` wraps the routing in
`store.deduplicate(telegramUpdateIdempotencyKey(update), …)`, so a redelivered `update_id` is routed
at most once; a `duplicate`/`dropped` outcome is skipped. Omit the option and behaviour is unchanged.

```ts
import { IdempotencyStore } from '@maroonedsoftware/cache';

await ctx.container.get(TelegramDispatcher).dispatchUpdate(JSON.parse(raw), {
  idempotency: ctx.container.get(IdempotencyStore),
});
```

`telegramUpdateIdempotencyKey` keys on `update_id` alone, which is unique _per bot_. For a multi-bot
deployment sharing one store, prefix a bot id yourself.

## Secret-token verification

`verifyTelegramSecretToken` is a pure function — Telegram does not sign payloads; it echoes the `secret_token` you set on the webhook in a header on every delivery:

```ts
import { verifyTelegramSecretToken, TelegramError } from '@maroonedsoftware/telegram';

try {
  verifyTelegramSecretToken({
    secretToken: telegramConfig.secretToken!,
    headerValue: req.headers['x-telegram-bot-api-secret-token'] as string,
  });
} catch (err) {
  if (err instanceof TelegramError) {
    // err.internalDetails.reason is 'missing_secret_token' | 'invalid_secret_token'
    throw httpError(401).withCause(err);
  }
  throw err;
}
```

The header is compared with `crypto.timingSafeEqual`.

### As a policy

`TelegramSecretTokenPolicy` is the same rule wrapped as a `@maroonedsoftware/policies` policy. It delegates to `verifyTelegramSecretToken` (one source of truth) but returns a `PolicyResult` instead of throwing.

```ts
import { TelegramSecretTokenPolicy, TELEGRAM_SECRET_TOKEN_POLICY, TelegramConfig } from '@maroonedsoftware/telegram';

registry.set(TELEGRAM_SECRET_TOKEN_POLICY, TelegramSecretTokenPolicy);

const result = await ctx.container.get(PolicyService).check(TELEGRAM_SECRET_TOKEN_POLICY, {
  getHeader: name => ctx.get(name),
  options: ctx.container.get(TelegramConfig),
});
if (isPolicyResultDenied(result)) throw httpError(401);
```

The context (a case-insensitive `getHeader` + `options`, with an ignored optional `rawBody`) is structurally compatible with `@maroonedsoftware/koa`'s `SignaturePolicyContext<TelegramSecretTokenOptions>`, so the koa `requireSignature` middleware can drive this policy when registered under the policy name — no koa dependency in this package.

## Limitations

- v1 targets a single bot via `TelegramConfig`.

## Use with `@maroonedsoftware/comms`

The `@maroonedsoftware/telegram/comms` subpath adapts this package to the channel-agnostic
[`@maroonedsoftware/comms`](../comms) router (declared as an **optional peer**), so one handler runs
on Telegram and every other wired channel.

```ts
import { TelegramClient, TelegramConfig, verifyTelegramSecretToken } from '@maroonedsoftware/telegram';
import { dispatchTelegram, createTelegramNotifier } from '@maroonedsoftware/telegram/comms';
import { router } from './router.js'; // a shared ChannelRouter

http.post('/telegram/webhook', async ctx => {
  const raw = await rawBody(ctx.req, { encoding: 'utf8' });
  verifyTelegramSecretToken({ secretToken: ctx.container.get(TelegramConfig).secretToken!, headerValue: ctx.get('x-telegram-bot-api-secret-token') });
  await dispatchTelegram(router, ctx.container.get(TelegramClient), JSON.parse(raw));
  ctx.status = 200;
});
```

- `dispatchTelegram` routes a `/`-command message → `command`, a `callback_query` → `action` (and
  acknowledges it via `answerCallbackQuery` so handlers stay channel-agnostic), other messages →
  `message`. Other update types stay on the native handler maps.
- Replies go to the originating chat. Buttons render as an inline keyboard (`callback_data` = button
  id). `createTelegramNotifier(client, router.templates)` sends proactively; `reply.sendTemplate` /
  `reply.sendNative` pass extra `sendMessage` params (parse mode, etc.).

## License

MIT — see [LICENSE](./LICENSE).
