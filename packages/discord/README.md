# @maroonedsoftware/discord

Transport-agnostic Discord integration for ServerKit. The package gives you:

- a DI-friendly `fetch`-based wrapper around Discord's REST API (v10) for sending messages, interaction followups, and slash-command registration — no SDK dependency, and
- a single `DiscordDispatcher` service that routes parsed Discord interactions (slash commands, message components, modals, autocomplete) to typed handlers, and
- a `GatewayClient` at `@maroonedsoftware/discord/gateway` that receives real-time events over the Gateway WebSocket, on a socket you supply.

The package owns no HTTP routes, signature middleware, or connections. Wire `DiscordDispatcher` from your own Koa, Express, Fastify, or Lambda handler, and hand the `GatewayClient` your own socket.

## Installation

```bash
pnpm add @maroonedsoftware/discord
```

## Exports

| Symbol                                          | Purpose                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DiscordConfig`                                 | Abstract `@Injectable()` token; carries `botToken`, `applicationId`, optional `publicKey`, `signatureMaxAgeSeconds`, `requestTimeoutMs`, `apiBaseUrl`, `fetch`. Consumer registers a concrete value.                                                                                                                       |
| `DiscordClient`                                 | `fetch`-based REST wrapper. Methods: `createMessage`, `createFollowupMessage`, `editOriginalInteractionResponse`, `deleteOriginalInteractionResponse`, `bulkOverwriteGlobalCommands`, `bulkOverwriteGuildCommands`, `deferInteraction`, `getGatewayBot`, `getCurrentUser`, `getChannelMessages`, plus a generic `request`. |
| `DiscordDispatcher`                             | Single-method service: `dispatchInteraction`.                                                                                                                                                                                                                                                                              |
| `DiscordInteractionHandlerMap`                  | `Map<routingKey, DiscordInteractionHandler>` — keys are `${kind}:${identifier}`; see [interaction routing](#interaction-routing).                                                                                                                                                                                          |
| `DiscordError`                                  | `ServerkitError` subclass for non-HTTP domain failures (signature mismatch, REST call failed, …).                                                                                                                                                                                                                          |
| `verifyDiscordSignature(input)`                 | Pure helper that validates Discord's Ed25519 signature (with optional replay window). No request/context coupling.                                                                                                                                                                                                         |
| `DiscordSignaturePolicy`                        | `@maroonedsoftware/policies` form of `verifyDiscordSignature` (registered under `DISCORD_SIGNATURE_POLICY`). Delegates to the helper but answers as a `PolicyResult`, so it slots into ServerKit's policy pipeline.                                                                                                        |
| `interactionRouteKey(interaction)`              | Helper that produces the `DiscordInteractionHandlerMap` key for a given interaction.                                                                                                                                                                                                                                       |
| `discordInteractionIdempotencyKey(interaction)` | Pure helper → `discord:interaction:{interaction.id}`. Stable key for optional [side-effect de-duplication](#de-duplicating-side-effects).                                                                                                                                                                                  |
| `InteractionType` / `InteractionCallbackType`   | Numeric enums for Discord's interaction and callback `type` values.                                                                                                                                                                                                                                                        |

## Configuration

The package does not read `AppConfig` itself — services take `DiscordConfig` directly via DI. Resolve it at bootstrap and register it:

```ts
import { AppConfigBuilder, AppConfigSourceJson } from '@maroonedsoftware/appconfig';
import { DiscordConfig } from '@maroonedsoftware/discord';

const appConfig = await new AppConfigBuilder().addSource(new AppConfigSourceJson('./config.json')).build();

const discordConfig = appConfig.getAs<DiscordConfig>('discord');
registry.register(DiscordConfig).useValue(discordConfig);
```

```jsonc
// config.json
{
  "discord": {
    "botToken": "...", // bot token for REST calls
    "publicKey": "abc123...", // application Ed25519 public key (hex)
    "applicationId": "...", // application (client) id
    "signatureMaxAgeSeconds": 300, // optional; off by default
    "apiBaseUrl": "https://discord.com/api/v10", // optional
  },
}
```

| Field                    | Required | Used by                                                                                                                                                            |
| ------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `botToken`               | yes      | `DiscordClient` — sent as `Authorization: Bot <token>` on bot-scoped routes.                                                                                       |
| `publicKey`              | no       | Signature verification (Discord signs requests with the matching private key). Needed only when Discord calls you over HTTP; verification fails closed without it. |
| `applicationId`          | yes      | `DiscordClient` interaction-followup and command-registration routes.                                                                                              |
| `signatureMaxAgeSeconds` | no       | Optional replay-protection window. **Off by default** (Discord mandates no window).                                                                                |
| `requestTimeoutMs`       | no       | Per-request REST timeout (default 10s). `request` also takes a per-call `timeoutMs`.                                                                               |
| `apiBaseUrl`             | no       | REST base URL (default `DISCORD_API_BASE`, `https://discord.com/api/v10`).                                                                                         |
| `fetch`                  | no       | The transport for every REST call. See [bringing your own fetch](#bringing-your-own-fetch).                                                                        |

## Sending messages

```ts
import { DiscordClient } from '@maroonedsoftware/discord';

const discord = container.get(DiscordClient);

// Post to a channel (bot token)
await discord.createMessage('123456789', { content: 'deploy complete :ship:' });

// Follow up on an interaction (uses the interaction token, no bot auth)
await discord.createFollowupMessage(interaction.token, { content: 'still working on it…' });

// Anything not exposed as a typed helper — reach for the generic request
await discord.request('GET', '/users/@me');
```

Every method throws `DiscordError` (with `{ status, body, url }` on `internalDetails`) on a non-2xx response. On a 429, `internalDetails.retryAfter` carries Discord's wait in seconds, from the body's `retry_after` or else the `Retry-After` header. A call that never reached Discord throws `DiscordError` too, with the transport's reason on `internalDetails.reason`. The bot token and any interaction token are redacted from it, and no `cause` is attached, because the cause would quote them.

Other helpers: `deferInteraction(interaction, 'message' | 'update')` acknowledges now and answers later (callback type 5 or 6). `getGatewayBot()` returns the Gateway URL and identify budget. `getCurrentUser()` proves the token works. `getChannelMessages(channelId, { after, limit })` reads a page of messages.

### Bringing your own fetch

`DiscordConfig.fetch` routes every REST call through a transport the caller owns: an allowlisting host, a proxy, or a test. It defaults to the global `fetch`. The client passes an `AbortSignal` carrying its timeout.

```ts
registry.register(DiscordConfig).useValue({ ...appConfig.getAs<DiscordConfig>('discord'), fetch: host.fetch });
```

## Receiving Discord interactions

You own the route. Discord delivers **all** slash commands, components, modals, and autocomplete to one interactions endpoint:

1. Read the raw body (signature verification needs unparsed bytes).
2. Verify the Ed25519 signature with `verifyDiscordSignature` (see [signature verification](#signature-verification)).
3. Parse the JSON body.
4. Call `dispatcher.dispatchInteraction(interaction)`.
5. Serialize the returned `DiscordInteractionResponse` as the response body.

Unlike Slack, Discord requires a JSON interaction callback (not an empty 200), and the `PING` (type 1) handshake must answer with a `PONG`.

```ts
import {
  DiscordConfig,
  DiscordDispatcher,
  DiscordInteractionHandlerMap,
  InteractionCallbackType,
  verifyDiscordSignature,
  type DiscordInteractionHandler,
} from '@maroonedsoftware/discord';
import rawBody from 'raw-body';

class DeployCommand implements DiscordInteractionHandler {
  async handle() {
    return { type: InteractionCallbackType.CHANNEL_MESSAGE_WITH_SOURCE, data: { content: 'Deploying…' } };
  }
}

// Bootstrap
registry.register(DeployCommand).useClass(DeployCommand).asSingleton();
registry.register(ApproveButton).useClass(ApproveButton).asSingleton();
registry.register(CreateTicketModal).useClass(CreateTicketModal).asSingleton();

registry
  .register(DiscordInteractionHandlerMap)
  .useMap(DiscordInteractionHandlerMap)
  .set('command:deploy', DeployCommand)
  .set('component:approve', ApproveButton)
  .set('modal:create_ticket', CreateTicketModal);

// Route
router.post('/discord/interactions', async ctx => {
  const raw = await rawBody(ctx.req, { encoding: 'utf8' });
  verifyDiscordSignature({
    publicKey: ctx.container.get(DiscordConfig).publicKey,
    rawBody: raw,
    timestamp: ctx.get('x-signature-timestamp'),
    signature: ctx.get('x-signature-ed25519'),
  });
  const result = await ctx.container.get(DiscordDispatcher).dispatchInteraction(JSON.parse(raw));
  if (result)
    ctx.body = result; // PONG, message callback, etc.
  else ctx.status = 404; // no handler matched
});
```

`dispatchInteraction` returns `{ type: PONG }` for the handshake. For slow work, return a `DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE` callback and follow up via `discordClient.createFollowupMessage(interaction.token, …)` (the interaction token is valid for 15 minutes).

### De-duplicating side effects

**Discord does not redeliver HTTP interactions.** They are request/response, and the response body matters (a `PING` must `PONG`, a command must return its callback). So unlike Slack/WhatsApp/Telegram — which redeliver events on a slow/failed ack — Discord dedup is **not** a redelivery-safety net. It is a conservative guard against a duplicate **side effect** from an out-of-band resend: a proxy/gateway retry, or a client double-submit of the same interaction.

Pass an optional `@maroonedsoftware/cache` [`IdempotencyStore`](../cache) (an **optional peer** — no runtime dependency if you don't use it) as `options.idempotency`. The dispatcher wraps only the handler invocation, keyed by `discordInteractionIdempotencyKey(interaction)` = `discord:interaction:{interaction.id}`. The `PING` handshake is answered directly and **never** de-duplicated. A first delivery is `processed` and its response body is returned unchanged; only a genuine duplicate of the same `interaction.id` skips the handler and returns `undefined` (ack `200`):

```ts
import { IdempotencyStore } from '@maroonedsoftware/cache';

const result = await ctx.container.get(DiscordDispatcher).dispatchInteraction(JSON.parse(raw), {
  idempotency: ctx.container.get(IdempotencyStore),
});
if (result) ctx.body = result;
else ctx.status = 200; // PONG/callback already sent, or a duplicate was skipped
```

Because the ~3s ack window is tight, dedup here protects fast, in-request side effects. For handlers that do **real** work, prefer the durable pattern: return a `DEFERRED_*` callback immediately and enqueue a background job keyed by `interaction.id` (e.g. via `@maroonedsoftware/jobbroker`), so the de-duplication and retries live around the slow work rather than the interaction response.

### Interaction routing

`DiscordInteractionHandlerMap` is keyed by `${kind}:${identifier}`:

| Interaction type                       | Key                          |
| -------------------------------------- | ---------------------------- |
| `APPLICATION_COMMAND` (2)              | `command:<data.name>`        |
| `MESSAGE_COMPONENT` (3)                | `component:<data.custom_id>` |
| `APPLICATION_COMMAND_AUTOCOMPLETE` (4) | `autocomplete:<data.name>`   |
| `MODAL_SUBMIT` (5)                     | `modal:<data.custom_id>`     |

`PING` (1) is answered by the dispatcher and never routed. `interactionRouteKey(interaction)` is exported in case you want to compute the key yourself (e.g. to register handlers dynamically). Each handler receives a `DiscordInteractionContext` with the resolved invoking `user`, `guildId`, `channelId`, interaction `token`, and the raw `interaction`.

## Registering slash commands

```ts
await container
  .get(DiscordClient)
  .bulkOverwriteGlobalCommands([
    { name: 'deploy', description: 'Deploy a service', options: [{ type: 3, name: 'target', description: 'Environment', required: true }] },
  ]);

// Or scoped to a single guild (updates instantly — handy in development):
await container.get(DiscordClient).bulkOverwriteGuildCommands('123', [/* … */]);
```

## Signature verification

`verifyDiscordSignature` is a pure function — no request, context, or framework awareness. The caller pulls headers and the raw body from whatever transport it's using and passes them in:

```ts
import { verifyDiscordSignature, DiscordError } from '@maroonedsoftware/discord';

try {
  verifyDiscordSignature({
    publicKey: discordConfig.publicKey,
    rawBody, // exactly what Discord sent
    timestamp: req.headers['x-signature-timestamp'] as string,
    signature: req.headers['x-signature-ed25519'] as string,
    maxAgeSeconds: discordConfig.signatureMaxAgeSeconds, // optional; off by default
  });
} catch (err) {
  if (err instanceof DiscordError) {
    // err.internalDetails.reason is one of:
    //   'missing_public_key' | 'missing_timestamp' | 'invalid_timestamp' | 'stale_timestamp'
    //   'missing_signature' | 'invalid_signature' | 'invalid_public_key'
    throw httpError(401).withCause(err);
  }
  throw err;
}
```

What the helper enforces:

1. A public key is configured. Without one the helper throws with reason `missing_public_key`, so an HTTP route on a Gateway-only config fails closed.
1. `X-Signature-Timestamp` is present.
1. The Ed25519 signature in `X-Signature-Ed25519` verifies over `timestamp + rawBody` using the application public key (via Node's native `crypto` — no third-party dependency).
1. If `maxAgeSeconds` is provided, `|now - timestamp| <= maxAgeSeconds` (replay protection). Discord does not require this, so it is **off by default**.

On any failure the helper throws `DiscordError` with `internalDetails.reason` set to a `DiscordSignatureFailureReason` code. Map to HTTP 401 at the route boundary. For deterministic tests, pass `now` (Unix seconds) to override the clock.

### As a policy

`DiscordSignaturePolicy` is the same rule wrapped as a `@maroonedsoftware/policies` policy, so signature verification slots into ServerKit's policy pipeline. It delegates to `verifyDiscordSignature` (one source of truth) but returns a `PolicyResult` instead of throwing — denying with the same `DiscordSignatureFailureReason` as the denial `reason`, and anchoring the optional replay window to the evaluation's `envelope.now`.

```ts
import { DiscordSignaturePolicy, DISCORD_SIGNATURE_POLICY, DiscordConfig } from '@maroonedsoftware/discord';

// wiring
registry.set(DISCORD_SIGNATURE_POLICY, DiscordSignaturePolicy);

// in a route handler (ctx is a ServerKit Koa context)
const result = await ctx.container.get(PolicyService).check(DISCORD_SIGNATURE_POLICY, {
  rawBody: ctx.rawBody,
  getHeader: name => ctx.get(name),
  options: ctx.container.get(DiscordConfig),
});
if (isPolicyResultDenied(result)) throw httpError(401).withInternalDetails(result.internalDetails ?? {});
```

The context (`rawBody` + a case-insensitive `getHeader` + `options`) is structurally compatible with `@maroonedsoftware/koa`'s `SignaturePolicyContext<DiscordSignatureOptions>`, so the koa `requireSignature` middleware can drive this policy when it's registered under the signature policy name — no koa dependency in this package.

## Gateway

`@maroonedsoftware/discord/gateway` receives real-time events (messages, interactions, guild changes) over the Discord Gateway, for a bot with no public HTTP endpoint. The caller supplies the socket, so the package never opens a connection of its own.

```ts
import { DiscordClient, DiscordConfig } from '@maroonedsoftware/discord';
import { GatewayClient, Intents } from '@maroonedsoftware/discord/gateway';

const discord = container.get(DiscordClient);

const gateway = new GatewayClient({
  token: container.get(DiscordConfig).botToken,
  intents: Intents.GUILDS | Intents.GUILD_MESSAGES | Intents.MESSAGE_CONTENT,
  gatewayUrl: async () => (await discord.getGatewayBot()).url,
  connect: url => host.socket(url), // anything satisfying SocketLike
  onDispatch: (event, data) => {
    if (event === 'INTERACTION_CREATE') return handleInteraction(data);
    if (event === 'MESSAGE_CREATE') return handleMessage(data);
  },
  logger,
  onError: error => logger.error('Gateway stopped', error),
});

await gateway.start();
// on shutdown
gateway.stop();
```

`SocketLike` is the whole transport contract: `send(text)`, `close(code?, reason?)`, `onMessage(listener)`, and `onClose(listener)`. It has the same shape as `@maroonedsoftware/slack/socketmode`'s, so one implementation serves both. `connect` may answer with the socket or a promise of one.

How it behaves:

- **Hello** starts the heartbeat, with the first beat jittered, then sends **Identify**, or **Resume** when a session, a sequence, and a `resume_gateway_url` are held.
- **Dispatch** records the sequence and hands every event to `onDispatch(event, data)`, `READY` and `RESUMED` included. `READY` sets `isReady` and `user`. A handler that throws or rejects is logged, and the client carries on.
- A heartbeat that is never acknowledged means a **zombie** connection. The client closes it with 4000, which keeps the session, and resumes.
- **Reconnect** (op 7) resumes. **Invalid Session** (op 9) resumes when Discord says it can, and otherwise identifies afresh after 1–5 seconds.
- **Close codes** 4004 and 4010–4014 are fatal: the client stops and calls `onError`. 4014 means the app requested a privileged intent (such as `MESSAGE_CONTENT`) that the Developer Portal has not enabled. 4007 and 4009 end the session, so the next connection identifies. Any other close resumes, with backoff from 1s doubling to 30s, reset by the next `READY` or `RESUMED`.
- `start()` rejects if the first connection cannot be opened. Later reconnects retry instead.
- `stop()` closes with 1000, which ends the session, cancels timers, and never reconnects.

Interactions arriving over the Gateway are acknowledged over REST, not in a response body: use `createInteractionResponse` or `deferInteraction`.

### Gateway limits

- **One shard.** It fits a single bot on a modest number of guilds. Discord requires sharding past 2,500 guilds (close code 4011).
- **JSON only**, with no zlib or zstd compression and no ETF.
- The client does not track the identify budget (`session_start_limit`). `getGatewayBot()` reports it if you want to check it.

## Limitations

- v1 targets a single application via the bot token in `DiscordConfig`.
- The Gateway client runs one shard, JSON only (see [Gateway limits](#gateway-limits)).

## Use with `@maroonedsoftware/comms`

The `@maroonedsoftware/discord/comms` subpath adapts this package to the channel-agnostic
[`@maroonedsoftware/comms`](../comms) router (declared as an **optional peer**), so one handler runs
on Discord and every other wired channel.

```ts
import { DiscordClient, DiscordConfig, verifyDiscordSignature } from '@maroonedsoftware/discord';
import { dispatchDiscord, createDiscordNotifier } from '@maroonedsoftware/discord/comms';
import { router } from './router.js'; // a shared ChannelRouter

http.post('/discord/interactions', async ctx => {
  const raw = await rawBody(ctx.req, { encoding: 'utf8' });
  verifyDiscordSignature({
    publicKey: ctx.container.get(DiscordConfig).publicKey,
    rawBody: raw,
    timestamp: ctx.get('x-signature-timestamp'),
    signature: ctx.get('x-signature-ed25519'),
  });
  const result = await dispatchDiscord(router, ctx.container.get(DiscordClient), JSON.parse(raw));
  if (result) ctx.body = result;
  else ctx.status = 200; // 200: matched-and-acked or nothing to reply
});
```

- `dispatchDiscord` handles `PING`→PONG, `APPLICATION_COMMAND`→`command` (string options joined into
  `command.args`), `MESSAGE_COMPONENT`→`action`. **Reply model:** a single `reply.send` is returned as
  the interaction callback. If the handler replies **more than once**, the adapter acknowledges the
  interaction out of band (via `createInteractionResponse`) so every reply is delivered as a valid
  followup; `dispatchDiscord` then returns `undefined` and the route responds with an empty 2xx.
  Discord's ~3s ack window applies, so reply promptly.
- There is **no inbound `message`** from `dispatchDiscord` (HTTP interactions only; Gateway `MESSAGE_CREATE` events are yours to route). Buttons render as component action rows.
  `createDiscordNotifier(client, router.templates)` posts proactively via `createMessage`;
  `reply.sendTemplate` / `reply.sendNative` cover rich payloads (embeds, etc.).

## License

MIT — see [LICENSE](./LICENSE).
