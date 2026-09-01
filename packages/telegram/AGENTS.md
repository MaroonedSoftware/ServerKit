# AGENTS.md — @maroonedsoftware/telegram

Machine-oriented guide for AI agents. Human prose and long-form examples live in [README.md](./README.md).
Repo-wide conventions live in the [root AGENTS.md](../../AGENTS.md).

## Purpose

A Telegram Bot API dispatcher for ServerKit: secret-token webhook verification as a policy,
DI-registered handler maps for commands, callback queries, and raw updates, a `TelegramClient` over
the Bot API, and an optional adapter binding it to the channel-agnostic `@maroonedsoftware/comms`
router.

Reach for the native handler maps when you want Telegram-specific behaviour (inline queries, media,
edited messages); reach for `./comms` when the same bot should also run on Slack, Discord, and
WhatsApp.

## Install

```bash
pnpm add @maroonedsoftware/telegram
pnpm add @maroonedsoftware/comms   # only for the ./comms adapter
pnpm add @maroonedsoftware/cache   # only for idempotency
```

Runtime dependencies: `@maroonedsoftware/errors`, `@maroonedsoftware/logger`,
`@maroonedsoftware/policies`, `injectkit`. Optional peers: `@maroonedsoftware/comms`,
`@maroonedsoftware/cache`. **No Telegram SDK** — the client is built in.

## Position in the graph

- **Depends on:** `errors`, `logger`, `policies`. `comms` and `cache` are **optional** peers.
- **Depended on by:** nothing internal.
- **Subpath exports:**
  - `.` — config, errors, secret-token verification, handler maps, dispatcher, client.
  - `./comms` — the adapter. Pulls in `@maroonedsoftware/comms`. It lives here, not in `comms`,
    because `comms` must stay channel-free; see the root AGENTS.md.

**Not a dependency: `koa`.** Your route parses the request and calls the dispatcher.

## API surface

### `.` — config and errors

| Export                          | Kind                       | Shape                                                        | Notes                                                  |
| ------------------------------- | -------------------------- | ------------------------------------------------------------ | ------------------------------------------------------ |
| `TelegramConfig`                | interface + abstract class | `{ botToken, secretToken?, apiBaseUrl?, requestTimeoutMs? }` | Declaration-merged so one symbol is type and DI token. |
| `TelegramError`                 | class                      | `extends ServerkitError`                                     | —                                                      |
| `IsTelegramError`               | type guard                 | `(error: unknown) => error is TelegramError`                 | —                                                      |
| `TELEGRAM_DEFAULT_API_BASE_URL` | constant                   | —                                                            | Override for a self-hosted Bot API server.             |

### `.` — secret-token verification

| Export                             | Kind      | Shape                                                       | Notes                                        |
| ---------------------------------- | --------- | ----------------------------------------------------------- | -------------------------------------------- |
| `verifyTelegramSecretToken`        | function  | `(input: VerifyTelegramSecretTokenInput) => void`           | Pure. **Throws** `TelegramError` on failure. |
| `VerifyTelegramSecretTokenInput`   | type      | Header value plus `TelegramSecretTokenOptions`              | —                                            |
| `TelegramSecretTokenOptions`       | type      | The expected secret                                         | —                                            |
| `TelegramSecretTokenFailureReason` | type      | Reason codes landing in `internalDetails.reason`            | —                                            |
| `TelegramSecretTokenPolicy`        | class     | `extends Policy<TelegramSecretTokenPolicyContext>`          | Policy form — denies rather than throwing.   |
| `TelegramSecretTokenPolicyContext` | interface | Structurally compatible with koa's `SignaturePolicyContext` | What lets `requireSignature` drive it.       |
| `TELEGRAM_SECRET_TOKEN_POLICY`     | constant  | The `PolicyRegistryMap` key                                 | —                                            |
| `TELEGRAM_SECRET_TOKEN_HEADER`     | constant  | `'X-Telegram-Bot-Api-Secret-Token'`                         | —                                            |

This is a **shared-secret header check**, not an HMAC over the body. It only proves the caller knows
the secret you registered with `setWebhook`.

### `.` — handlers and dispatch

| Export                            | Kind      | Shape                                                                                                                    | Notes                                                            |
| --------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `TelegramCommandHandler`          | interface | `handle(command, context)`                                                                                               | —                                                                |
| `TelegramCommandHandlerMap`       | class     | `extends Map<string, TelegramCommandHandler>`                                                                            | Keyed by the normalised command name (**with** leading `/`).     |
| `TelegramCallbackQueryHandler`    | interface | `handle(query, context)`                                                                                                 | —                                                                |
| `TelegramCallbackQueryHandlerMap` | class     | `extends Map<string, TelegramCallbackQueryHandler>`                                                                      | Keyed by `callback_query.data`.                                  |
| `TelegramUpdateHandler`           | interface | `handle(update, context)`                                                                                                | Raw updates the other maps do not cover.                         |
| `TelegramUpdateHandlerMap`        | class     | `extends Map<string, TelegramUpdateHandler>`                                                                             | Keyed by `updateType(update)`.                                   |
| `updateType`                      | function  | `(update) => string \| undefined`                                                                                        | The first present update field (`message`, `callback_query`, …). |
| `parseCommand`                    | function  | `(message) => TelegramCommand \| undefined`                                                                              | Strips `@botname`, lowercases, **keeps the leading `/`**.        |
| `TelegramDispatcher`              | class     | `dispatchUpdate(update, options?)`                                                                                       | The entry point.                                                 |
| `TelegramDispatchOptions`         | interface | `{ idempotency?: IdempotencyStore }`                                                                                     | —                                                                |
| `telegramUpdateIdempotencyKey`    | function  | `(update) => string`                                                                                                     | —                                                                |
| Payload types                     | —         | `TelegramUpdate`, `TelegramMessage`, `TelegramCallbackQuery`, `TelegramUser`, `TelegramCommand`, `TelegramUpdateContext` | —                                                                |

### `.` — client

| Export                                | Kind     | Shape                                   | Notes                            |
| ------------------------------------- | -------- | --------------------------------------- | -------------------------------- |
| `TelegramClient`                      | class    | `sendMessage`, `answerCallbackQuery`, … | Built-in Bot API client, no SDK. |
| `TELEGRAM_DEFAULT_REQUEST_TIMEOUT_MS` | constant | —                                       | —                                |

### `./comms`

| Export                   | Kind     | Shape                                                               | Notes                                                                             |
| ------------------------ | -------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `createTelegramNotifier` | function | `(client: TelegramClient, templates: TemplateRegistry) => Notifier` | Recipient is a chat id. Native payloads are `sendMessage` params minus `chat_id`. |
| `dispatchTelegram`       | function | `(router, client, update) => Promise<void>`                         | `/`-command → `command`; `callback_query` → `action`; other messages → `message`. |

## Canonical usage

```typescript
import {
  TelegramConfig,
  TelegramDispatcher,
  TelegramCommandHandlerMap,
  TelegramSecretTokenPolicy,
  TELEGRAM_SECRET_TOKEN_POLICY,
  type TelegramSecretTokenOptions,
} from '@maroonedsoftware/telegram';

registry.register(StartCommand).useClass(StartCommand).asSingleton();

registry.register(TelegramConfig).useValue(appConfig.getAs<TelegramConfig>('telegram'));
// note the leading slash on the key
registry.register(TelegramCommandHandlerMap).useMap(TelegramCommandHandlerMap).set('/start', StartCommand);
policies.set(TELEGRAM_SECRET_TOKEN_POLICY, TelegramSecretTokenPolicy);

router.post('/telegram/webhook', requireSignature<TelegramSecretTokenOptions>('telegram', { policy: TELEGRAM_SECRET_TOKEN_POLICY }), async ctx => {
  await ctx.container.get(TelegramDispatcher).dispatchUpdate(ctx.parsedBody as TelegramUpdate, {
    idempotency: ctx.container.get(IdempotencyStore),
  });
  ctx.status = 200;
});
```

Channel-agnostic instead:

```typescript
import { dispatchTelegram } from '@maroonedsoftware/telegram/comms';

await dispatchTelegram(router, client, update);
```

## Rules for generated code

- Set a `secretToken` in config **and** register it with `setWebhook`. It is optional in the type,
  which means an unverified webhook is one omitted field away.
- Register command handlers under the name `parseCommand` produces: lowercased, `@botname` stripped,
  **with** the leading `/`. `'start'` will not match; `'/start'` will.
- Ack with a 200 quickly. Telegram redelivers an update until you do, and a slow handler produces a
  backlog.
- Pass an `IdempotencyStore` to `dispatchUpdate`. Telegram redelivers.
- Answer every `callback_query`, or the client's inline-button spinner hangs. `dispatchTelegram`
  does it for you; on the native path it is yours.
- Store `TelegramConfig` in `AppConfig`. Never inline `botToken` — it is in the API URL path, so it
  must never be logged either.
- Import `./comms` functions from `@maroonedsoftware/telegram/comms`, never from the root.

## Gotchas

- **`secretToken` is optional, and an absent one is not a failure.** Leave it unset and the webhook
  accepts anything that reaches the URL. Nothing warns you.
- **This is a header equality check, not a signature.** It does not authenticate the body. Anyone
  who learns the secret can post arbitrary updates.
- **Command keys keep the leading slash.** `parseCommand('/Start@MyBot foo')` yields
  `{ name: '/start', args: 'foo' }`. This differs from `@maroonedsoftware/comms`'s
  `normalizeCommandName`, which **strips** the slash — so the same command is keyed `/start` on the
  native map and `start` on the comms router.
- **`dispatchTelegram` answers the callback query in a `finally`**, so the spinner is dismissed even
  when the query carried no `data` (nothing to route) or the handler threw. Removing that `finally`
  leaves users staring at a spinner and triggers a Telegram redelivery.
- **Buttons are chunked into inline-keyboard rows of 5**, with `callback_data` set to the button id.
  Telegram caps `callback_data` at 64 bytes — a long id is silently rejected by the API.
- **Media and non-text updates are skipped by the comms adapter.** They stay on
  `TelegramUpdateHandlerMap`. Mixing the two paths is expected.
- **The bot token is in the URL path** of every Bot API call. Any logging of the request URL leaks
  it.
- **`apiBaseUrl` is overridable** for a self-hosted Bot API server; the default is Telegram's.

## Working inside this package

```
src/
  index.ts                        Root barrel
  telegram.config.ts              TelegramConfig (interface + token)
  telegram.error.ts               TelegramError, IsTelegramError
  telegram.secret.token.ts        verifyTelegramSecretToken + header/constant exports
  telegram.secret.token.policy.ts TelegramSecretTokenPolicy, TELEGRAM_SECRET_TOKEN_POLICY
  telegram.update.handler.ts      Handler maps, updateType, parseCommand, update types
  telegram.dispatcher.ts          TelegramDispatcher, telegramUpdateIdempotencyKey
  client/telegram.client.ts       TelegramClient
  comms.ts                        Subpath entry — notifier, inline keyboard, dispatchTelegram
```

Tests are in `tests/`, mirroring `src/`.

Invariants a change must not break:

- **Nothing reachable from `src/index.ts` may import `@maroonedsoftware/comms` or
  `@maroonedsoftware/cache`.** Both are optional peers.
- No dependency on `@maroonedsoftware/koa`; the structural policy context keeps the arrow out.
- Secret-token comparison stays constant-time.
- The `finally` that answers a `callback_query` is a UX and redelivery control, not cleanup.
- The four chat packages share a deliberate shape: config token, error + guard, verification
  function + policy, handler maps, dispatcher, client, `./comms` adapter. Keep changes consistent
  across all four.

User-visible changes need a changeset in `.changeset/`.
