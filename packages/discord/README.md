# @maroonedsoftware/discord

Transport-agnostic Discord integration for ServerKit. The package gives you:

- a DI-friendly `fetch`-based wrapper around Discord's REST API (v10) for sending messages, interaction followups, and slash-command registration — no SDK dependency, and
- a single `DiscordDispatcher` service that routes parsed Discord interactions (slash commands, message components, modals, autocomplete) to typed handlers.

The package owns no HTTP routes or signature middleware — wire `DiscordDispatcher` from your own Koa, Express, Fastify, or Lambda handler. Real-time Gateway (WebSocket) events are out of scope; this package targets the HTTP **interactions** endpoint.

## Installation

```bash
pnpm add @maroonedsoftware/discord
```

## Exports

| Symbol                            | Purpose                                                                                                       |
|-----------------------------------|---------------------------------------------------------------------------------------------------------------|
| `DiscordConfig`                   | Abstract `@Injectable()` token; carries `botToken`, `publicKey`, `applicationId`, optional `signatureMaxAgeSeconds`. Consumer registers a concrete value. |
| `DiscordClient`                   | `fetch`-based REST wrapper. Methods: `createMessage`, `createFollowupMessage`, `editOriginalInteractionResponse`, `deleteOriginalInteractionResponse`, `bulkOverwriteGlobalCommands`, `bulkOverwriteGuildCommands`, plus a generic `request`. |
| `DiscordDispatcher`               | Single-method service: `dispatchInteraction`.                                                                  |
| `DiscordInteractionHandlerMap`    | `Map<routingKey, DiscordInteractionHandler>` — keys are `${kind}:${identifier}`; see [interaction routing](#interaction-routing). |
| `DiscordError`                    | `ServerkitError` subclass for non-HTTP domain failures (signature mismatch, REST call failed, …).             |
| `verifyDiscordSignature(input)`   | Pure helper that validates Discord's Ed25519 signature (with optional replay window). No request/context coupling. |
| `DiscordSignaturePolicy`          | `@maroonedsoftware/policies` form of `verifyDiscordSignature` (registered under `DISCORD_SIGNATURE_POLICY`). Delegates to the helper but answers as a `PolicyResult`, so it slots into ServerKit's policy pipeline. |
| `interactionRouteKey(interaction)`| Helper that produces the `DiscordInteractionHandlerMap` key for a given interaction.                          |
| `InteractionType` / `InteractionCallbackType` | Numeric enums for Discord's interaction and callback `type` values.                              |

## Configuration

The package does not read `AppConfig` itself — services take `DiscordConfig` directly via DI. Resolve it at bootstrap and register it:

```ts
import { AppConfigBuilder, AppConfigSourceJson } from '@maroonedsoftware/appconfig';
import { DiscordConfig } from '@maroonedsoftware/discord';

const appConfig = await new AppConfigBuilder()
  .addSource(new AppConfigSourceJson('./config.json'))
  .build();

const discordConfig = appConfig.getAs<DiscordConfig>('discord');
container.register(DiscordConfig, { useValue: discordConfig });
```

```jsonc
// config.json
{
  "discord": {
    "botToken": "...",         // bot token for REST calls
    "publicKey": "abc123...",  // application Ed25519 public key (hex)
    "applicationId": "...",    // application (client) id
    "signatureMaxAgeSeconds": 300 // optional; off by default
  }
}
```

| Field                     | Required | Used by                                                                          |
|---------------------------|----------|----------------------------------------------------------------------------------|
| `botToken`                | yes      | `DiscordClient` — sent as `Authorization: Bot <token>` on bot-scoped routes.      |
| `publicKey`               | yes      | Signature verification (Discord signs requests with the matching private key).    |
| `applicationId`           | yes      | `DiscordClient` interaction-followup and command-registration routes.             |
| `signatureMaxAgeSeconds`  | no       | Optional replay-protection window. **Off by default** (Discord mandates no window). |

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

Every method throws `DiscordError` (with `{ status, body, url }` on `internalDetails`) on a non-2xx response.

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
const interactions = new DiscordInteractionHandlerMap();
interactions.set('command:deploy', container.get(DeployCommand));
interactions.set('component:approve', container.get(ApproveButton));
interactions.set('modal:create_ticket', container.get(CreateTicketModal));
container.register(DiscordInteractionHandlerMap, { useValue: interactions });

// Route
router.post('/discord/interactions', async (ctx) => {
  const raw = await rawBody(ctx.req, { encoding: 'utf8' });
  verifyDiscordSignature({
    publicKey: ctx.container.get(DiscordConfig).publicKey,
    rawBody: raw,
    timestamp: ctx.get('x-signature-timestamp'),
    signature: ctx.get('x-signature-ed25519'),
  });
  const result = await ctx.container.get(DiscordDispatcher).dispatchInteraction(JSON.parse(raw));
  if (result) ctx.body = result;   // PONG, message callback, etc.
  else ctx.status = 404;           // no handler matched
});
```

`dispatchInteraction` returns `{ type: PONG }` for the handshake. For slow work, return a `DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE` callback and follow up via `discordClient.createFollowupMessage(interaction.token, …)` (the interaction token is valid for 15 minutes).

### Interaction routing

`DiscordInteractionHandlerMap` is keyed by `${kind}:${identifier}`:

| Interaction type                       | Key                              |
|----------------------------------------|----------------------------------|
| `APPLICATION_COMMAND` (2)              | `command:<data.name>`            |
| `MESSAGE_COMPONENT` (3)                | `component:<data.custom_id>`     |
| `APPLICATION_COMMAND_AUTOCOMPLETE` (4) | `autocomplete:<data.name>`       |
| `MODAL_SUBMIT` (5)                     | `modal:<data.custom_id>`         |

`PING` (1) is answered by the dispatcher and never routed. `interactionRouteKey(interaction)` is exported in case you want to compute the key yourself (e.g. to register handlers dynamically). Each handler receives a `DiscordInteractionContext` with the resolved invoking `user`, `guildId`, `channelId`, interaction `token`, and the raw `interaction`.

## Registering slash commands

```ts
await container.get(DiscordClient).bulkOverwriteGlobalCommands([
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
    rawBody,                                       // exactly what Discord sent
    timestamp: req.headers['x-signature-timestamp'] as string,
    signature: req.headers['x-signature-ed25519'] as string,
    maxAgeSeconds: discordConfig.signatureMaxAgeSeconds, // optional; off by default
  });
} catch (err) {
  if (err instanceof DiscordError) {
    // err.internalDetails.reason is one of:
    //   'missing_timestamp' | 'invalid_timestamp' | 'stale_timestamp'
    //   'missing_signature' | 'invalid_signature' | 'invalid_public_key'
    throw httpError(401).withCause(err);
  }
  throw err;
}
```

What the helper enforces:

1. `X-Signature-Timestamp` is present.
2. The Ed25519 signature in `X-Signature-Ed25519` verifies over `timestamp + rawBody` using the application public key (via Node's native `crypto` — no third-party dependency).
3. If `maxAgeSeconds` is provided, `|now - timestamp| <= maxAgeSeconds` (replay protection). Discord does not require this, so it is **off by default**.

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

## Limitations

- HTTP interactions only. Real-time Gateway (WebSocket) events are out of scope.
- v1 targets a single application via the bot token in `DiscordConfig`.

## Use with `@maroonedsoftware/comms`

The `@maroonedsoftware/discord/comms` subpath adapts this package to the channel-agnostic
[`@maroonedsoftware/comms`](../comms) router (declared as an **optional peer**), so one handler runs
on Discord and every other wired channel.

```ts
import { DiscordClient, DiscordConfig, verifyDiscordSignature } from '@maroonedsoftware/discord';
import { dispatchDiscord, createDiscordNotifier } from '@maroonedsoftware/discord/comms';
import { router } from './router.js'; // a shared ChannelRouter

http.post('/discord/interactions', async (ctx) => {
  const raw = await rawBody(ctx.req, { encoding: 'utf8' });
  verifyDiscordSignature({ publicKey: ctx.container.get(DiscordConfig).publicKey, rawBody: raw,
    timestamp: ctx.get('x-signature-timestamp'), signature: ctx.get('x-signature-ed25519') });
  const result = await dispatchDiscord(router, ctx.container.get(DiscordClient), JSON.parse(raw));
  if (result) ctx.body = result; else ctx.status = 200; // 200: matched-and-acked or nothing to reply
});
```

- `dispatchDiscord` handles `PING`→PONG, `APPLICATION_COMMAND`→`command` (string options joined into
  `command.args`), `MESSAGE_COMPONENT`→`action`. **Reply model:** a single `reply.send` is returned as
  the interaction callback. If the handler replies **more than once**, the adapter acknowledges the
  interaction out of band (via `createInteractionResponse`) so every reply is delivered as a valid
  followup; `dispatchDiscord` then returns `undefined` and the route responds with an empty 2xx.
  Discord's ~3s ack window applies, so reply promptly.
- There is **no inbound `message`** (HTTP interactions only). Buttons render as component action rows.
  `createDiscordNotifier(client, router.templates)` posts proactively via `createMessage`;
  `reply.sendTemplate` / `reply.sendNative` cover rich payloads (embeds, etc.).

## License

MIT
