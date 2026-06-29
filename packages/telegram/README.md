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

| Symbol                              | Purpose                                                                                                       |
|-------------------------------------|---------------------------------------------------------------------------------------------------------------|
| `TelegramConfig`                    | Abstract `@Injectable()` token; carries `botToken`, optional `secretToken`, optional `apiBaseUrl`.             |
| `TelegramClient`                    | `fetch`-based Bot API wrapper. Methods: `sendMessage`, `answerCallbackQuery`, `setWebhook`, `deleteWebhook`, plus a generic `callMethod`. |
| `TelegramDispatcher`                | Single-method service: `dispatchUpdate`.                                                                       |
| `TelegramCommandHandlerMap`         | `Map<command, TelegramCommandHandler>` — register one handler per command (`/start`, …).                       |
| `TelegramCallbackQueryHandlerMap`   | `Map<callbackData, TelegramCallbackQueryHandler>` — register handlers for inline-keyboard button presses.      |
| `TelegramUpdateHandlerMap`          | `Map<updateType, TelegramUpdateHandler>` — register handlers per update type (`message`, `edited_message`, …). |
| `TelegramError`                     | `ServerkitError` subclass for non-HTTP domain failures (Bot API error, secret-token mismatch, …).             |
| `verifyTelegramSecretToken(input)`  | Pure helper that validates the `X-Telegram-Bot-Api-Secret-Token` header. No request/context coupling.         |
| `TelegramSecretTokenPolicy`         | `@maroonedsoftware/policies` form of the check (registered under `TELEGRAM_SECRET_TOKEN_POLICY`).              |
| `parseCommand(message)`             | Helper that extracts a `/command` (and args) from a message, stripping any `@botname` suffix.                  |
| `updateType(update)`                | Helper that returns an update's content type — the `TelegramUpdateHandlerMap` key.                             |

## Configuration

The package does not read `AppConfig` itself — services take `TelegramConfig` directly via DI:

```ts
import { TelegramConfig } from '@maroonedsoftware/telegram';

const telegramConfig = appConfig.getAs<TelegramConfig>('telegram');
container.register(TelegramConfig, { useValue: telegramConfig });
```

```jsonc
// config.json
{
  "telegram": {
    "botToken": "123456:ABC-DEF...",       // from BotFather
    "secretToken": "a-long-random-string", // optional but recommended
    "apiBaseUrl": "https://api.telegram.org" // optional, override for a self-hosted Bot API server
  }
}
```

| Field         | Required | Used by                                                                              |
|---------------|----------|--------------------------------------------------------------------------------------|
| `botToken`    | yes      | `TelegramClient` — embedded in the Bot API URL (`/bot<token>/<method>`).             |
| `secretToken` | no\*     | Webhook authenticity check (`X-Telegram-Bot-Api-Secret-Token`). Set the same value via `setWebhook`. |
| `apiBaseUrl`  | no       | Bot API host. Defaults to `https://api.telegram.org`.                                 |

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

Bot API calls return `{ ok, result }`; the client returns `result` on success and throws `TelegramError` (with the API `description` on `internalDetails`) when `ok` is `false` or the HTTP status is non-2xx.

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

const commands = new TelegramCommandHandlerMap();
commands.set('/start', container.get(StartCommand));
container.register(TelegramCommandHandlerMap, { useValue: commands });

router.post('/telegram/webhook', async (ctx) => {
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

| Update                                   | Map                                 | Key                                    |
|------------------------------------------|-------------------------------------|----------------------------------------|
| `message` whose text/caption is `/…`     | `TelegramCommandHandlerMap`         | command name, e.g. `/start`            |
| `callback_query`                         | `TelegramCallbackQueryHandlerMap`   | `callback_query.data`                  |
| anything else                            | `TelegramUpdateHandlerMap`          | update type (`updateType(update)`)     |

If a command or callback query has no matching handler, the dispatcher falls back to the update-type map (so a generic `message`/`callback_query` handler can still run). Each handler receives a context with the resolved `chatId`, `from`, `updateId`, and the raw `update`.

Telegram only invokes a command if the user's text begins with `/`; `parseCommand` lowercases the name and strips an `@botname` suffix (so `/Start@MyBot` routes as `/start`).

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

- Webhook delivery only; long-polling (`getUpdates`) is out of scope.
- v1 targets a single bot via `TelegramConfig`.

## Use with `@maroonedsoftware/comms`

The `@maroonedsoftware/telegram/comms` subpath adapts this package to the channel-agnostic
[`@maroonedsoftware/comms`](../comms) router (declared as an **optional peer**), so one handler runs
on Telegram and every other wired channel.

```ts
import { TelegramClient, TelegramConfig, verifyTelegramSecretToken } from '@maroonedsoftware/telegram';
import { dispatchTelegram, createTelegramNotifier } from '@maroonedsoftware/telegram/comms';
import { router } from './router.js'; // a shared ChannelRouter

http.post('/telegram/webhook', async (ctx) => {
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

MIT
