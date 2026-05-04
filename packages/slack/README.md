# @maroonedsoftware/slack

Transport-agnostic Slack integration for ServerKit. The package gives you:

- a DI-friendly wrapper around `@slack/web-api` for sending messages and posting to incoming-webhook URLs, and
- a single `SlackDispatcher` service that routes parsed Slack payloads (Events API, slash commands, interactive components) to typed handlers.

The package owns no HTTP routes or signature middleware — wire `SlackDispatcher` from your own Koa, Express, Fastify, or Lambda handler.

## Installation

```bash
pnpm add @maroonedsoftware/slack
```

## Exports

| Symbol                          | Purpose                                                                                                       |
|---------------------------------|---------------------------------------------------------------------------------------------------------------|
| `SlackConfig`                   | Abstract `@Injectable()` token; carries `botToken`, `signingSecret`, optional `incomingWebhookUrl`, optional `signatureMaxAgeSeconds`. Consumer registers a concrete value. |
| `SlackClient`                   | Wraps `@slack/web-api`'s `WebClient`; routes its diagnostics through ServerKit's `Logger`. Methods: `postMessage`, `updateMessage`, `deleteMessage`, `openView`, `postWebhook`. Underlying SDK reachable at `.web`. |
| `SlackDispatcher`               | Three-method service: `dispatchEvent`, `dispatchCommand`, `dispatchInteraction`.                              |
| `SlackEventHandlerMap`          | `Map<eventType, SlackEventHandler>` — register one handler per Slack event type (`app_mention`, `message`, …). |
| `SlackCommandHandlerMap`        | `Map<commandKeyword, SlackCommandHandler>` — register one handler per slash command (`/deploy`, …).            |
| `SlackInteractionHandlerMap`    | `Map<routingKey, SlackInteractionHandler>` — keys are `${type}:${identifier}`; see [interaction routing](#interaction-routing). |
| `SlackError`                    | `ServerkitError` subclass for non-HTTP domain failures (signature mismatch, webhook POST failed, …).          |
| `verifySlackSignature(input)`   | Pure helper that validates Slack's v0 HMAC scheme + replay window. No request/context coupling.               |
| `interactionRouteKey(payload)`  | Helper that produces the `SlackInteractionHandlerMap` key for a given payload.                                |

## Configuration

The package does not read `AppConfig` itself — services take `SlackConfig` directly via DI. Resolve it at bootstrap and register it:

```ts
import { AppConfigBuilder, AppConfigSourceJson } from '@maroonedsoftware/appconfig';
import { SlackConfig } from '@maroonedsoftware/slack';

const appConfig = await new AppConfigBuilder()
  .addSource(new AppConfigSourceJson('./config.json'))
  .build();

const slackConfig = appConfig.getAs<SlackConfig>('slack');
container.register(SlackConfig, { useValue: slackConfig });
```

```jsonc
// config.json
{
  "slack": {
    "botToken": "xoxb-...",
    "signingSecret": "...",
    "incomingWebhookUrl": "https://hooks.slack.com/services/...", // optional
    "signatureMaxAgeSeconds": 300                                  // optional
  }
}
```

| Field                     | Required | Used by                                                                 |
|---------------------------|----------|-------------------------------------------------------------------------|
| `botToken`                | yes      | `SlackClient` constructor — passed to `WebClient`.                       |
| `signingSecret`           | yes      | Your signature verifier (Slack signs requests with this secret).         |
| `incomingWebhookUrl`      | no       | `SlackClient.postWebhook` default URL when no per-call URL is supplied.  |
| `signatureMaxAgeSeconds`  | no       | Replay-protection window for your signature verifier (default `300`).    |

## Sending messages

```ts
import { SlackClient } from '@maroonedsoftware/slack';

const slack = container.get(SlackClient);

// Bot-token Web API call
await slack.postMessage({ channel: '#ops', text: 'deploy complete :ship:' });

// Incoming webhook URL or a per-payload response_url follow-up
await slack.postWebhook({ text: 'still working on it…' }, payload.response_url);

// Anything not exposed as a typed passthrough — reach for the underlying client
await slack.web.users.info({ user: 'U123' });
```

`postWebhook` throws `SlackError` if neither `config.incomingWebhookUrl` nor an explicit URL is provided, or if the HTTP response is non-2xx.

## Receiving Slack requests

You own the route. The pattern is the same for all three Slack endpoint types:

1. Read the raw body (signature verification needs unparsed bytes).
2. Verify the Slack signature with `verifySlackSignature` (see [signature verification](#signature-verification)).
3. Parse the body for the endpoint type.
4. Call the matching `dispatcher.dispatch*` method.
5. If the dispatcher returns a value, send it as the response body; otherwise ack `200 ''`.

Examples below use Koa, but any HTTP framework works.

### Events API

```ts
import {
  SlackConfig,
  SlackDispatcher,
  SlackEventHandlerMap,
  verifySlackSignature,
  type SlackEventHandler,
} from '@maroonedsoftware/slack';
import rawBody from 'raw-body';

class AppMentionHandler implements SlackEventHandler {
  async handle(event: { type: 'app_mention'; channel: string; text: string }) {
    // Ack quickly — Slack retries any non-2xx within ~3s.
    // Offload slow work via @maroonedsoftware/jobbroker.
  }
}

// Bootstrap
const events = new SlackEventHandlerMap();
events.set('app_mention', container.get(AppMentionHandler));
container.register(SlackEventHandlerMap, { useValue: events });

// Route
router.post('/slack/events', async (ctx) => {
  const raw = await rawBody(ctx.req, { encoding: 'utf8' });
  verifySlackSignature({
    signingSecret: ctx.container.get(SlackConfig).signingSecret,
    rawBody: raw,
    timestamp: ctx.get('x-slack-request-timestamp'),
    signature: ctx.get('x-slack-signature'),
  });
  const result = await ctx.container.get(SlackDispatcher).dispatchEvent(JSON.parse(raw));
  if (result) ctx.body = result;          // url_verification challenge
  else { ctx.status = 200; ctx.body = ''; }
});
```

`dispatchEvent` returns `{ challenge }` for the `url_verification` handshake and `undefined` for everything else (event handlers run for their side effects). Unregistered event types are logged at debug and acked — Slack retries any non-2xx, so dropping unknown events on the floor is intentional.

### Slash commands

```ts
import {
  SlackCommandHandlerMap,
  SlackConfig,
  SlackDispatcher,
  verifySlackSignature,
  type SlackCommandHandler,
  type SlackCommandPayload,
} from '@maroonedsoftware/slack';
import rawBody from 'raw-body';

class DeployCommand implements SlackCommandHandler {
  async handle(payload: SlackCommandPayload) {
    return { response_type: 'in_channel' as const, text: `Deploying ${payload.text}…` };
  }
}

const commands = new SlackCommandHandlerMap();
commands.set('/deploy', container.get(DeployCommand));
container.register(SlackCommandHandlerMap, { useValue: commands });

router.post('/slack/commands', async (ctx) => {
  const raw = await rawBody(ctx.req, { encoding: 'utf8' });
  verifySlackSignature({
    signingSecret: ctx.container.get(SlackConfig).signingSecret,
    rawBody: raw,
    timestamp: ctx.get('x-slack-request-timestamp'),
    signature: ctx.get('x-slack-signature'),
  });
  const form = new URLSearchParams(raw);
  const payload = {
    token: form.get('token') ?? '',
    team_id: form.get('team_id') ?? '',
    team_domain: form.get('team_domain') ?? '',
    channel_id: form.get('channel_id') ?? '',
    channel_name: form.get('channel_name') ?? '',
    user_id: form.get('user_id') ?? '',
    user_name: form.get('user_name') ?? '',
    command: form.get('command') ?? '',
    text: form.get('text') ?? '',
    response_url: form.get('response_url') ?? '',
    trigger_id: form.get('trigger_id') ?? '',
  } satisfies SlackCommandPayload;
  const result = await ctx.container.get(SlackDispatcher).dispatchCommand(payload);
  if (result) ctx.body = result;
  else { ctx.status = 200; ctx.body = ''; }
});
```

If your handler returns a `SlackCommandResponse`, Slack renders it inline. Return `void` to ack with an empty 200 and follow up later via `slackClient.postWebhook(payload, payload.response_url)` (Slack accepts up to 30 minutes / 5 follow-ups per command).

### Interactive components

```ts
import {
  SlackConfig,
  SlackDispatcher,
  SlackInteractionHandlerMap,
  verifySlackSignature,
  type SlackInteractionHandler,
} from '@maroonedsoftware/slack';
import rawBody from 'raw-body';

const interactions = new SlackInteractionHandlerMap();
interactions.set('block_actions:approve', container.get(ApproveButton));
interactions.set('view_submission:create_ticket_modal', container.get(CreateTicketModal));
container.register(SlackInteractionHandlerMap, { useValue: interactions });

router.post('/slack/interactions', async (ctx) => {
  const raw = await rawBody(ctx.req, { encoding: 'utf8' });
  verifySlackSignature({
    signingSecret: ctx.container.get(SlackConfig).signingSecret,
    rawBody: raw,
    timestamp: ctx.get('x-slack-request-timestamp'),
    signature: ctx.get('x-slack-signature'),
  });
  const payload = JSON.parse(new URLSearchParams(raw).get('payload') ?? '{}');
  const result = await ctx.container.get(SlackDispatcher).dispatchInteraction(payload);
  if (result) ctx.body = result;
  else { ctx.status = 200; ctx.body = ''; }
});
```

Slack POSTs interactive payloads as `application/x-www-form-urlencoded` with a single `payload` field whose value is JSON — that's why the snippet above unwraps `payload` after URL-decoding the form.

#### Interaction routing

`SlackInteractionHandlerMap` is keyed by `${type}:${identifier}`:

| Payload type      | Key                                    |
|-------------------|----------------------------------------|
| `block_actions`   | `block_actions:<actions[0].action_id>` |
| `view_submission` | `view_submission:<view.callback_id>`   |
| `view_closed`     | `view_closed:<view.callback_id>`       |
| `shortcut`        | `shortcut:<callback_id>`               |
| `message_action`  | `message_action:<callback_id>`         |

`interactionRouteKey(payload)` is exported in case you want to compute the key yourself (e.g. to register handlers dynamically). View-submission handlers may return a `SlackInteractionResponse` with `response_action: 'errors' | 'update' | 'push' | 'clear'` to drive Slack's modal flow.

## Signature verification

`verifySlackSignature` is a pure function — no request, context, or framework awareness. The caller pulls headers and the raw body from whatever transport it's using and passes them in:

```ts
import { verifySlackSignature, SlackError } from '@maroonedsoftware/slack';

try {
  verifySlackSignature({
    signingSecret: slackConfig.signingSecret,
    rawBody,                                  // exactly what Slack sent
    timestamp: req.headers['x-slack-request-timestamp'] as string,
    signature: req.headers['x-slack-signature'] as string,
    maxAgeSeconds: slackConfig.signatureMaxAgeSeconds, // optional, default 300
  });
} catch (err) {
  if (err instanceof SlackError) {
    // err.internalDetails.reason is one of:
    //   'missing_timestamp' | 'invalid_timestamp' | 'stale_timestamp'
    //   'missing_signature' | 'invalid_signature'
    throw httpError(401).withCause(err);
  }
  throw err;
}
```

What the helper enforces:

1. `X-Slack-Request-Timestamp` is present and an integer.
2. `|now - timestamp| <= maxAgeSeconds` (default 300) — replay protection.
3. `X-Slack-Signature` matches `v0=` + `HMAC-SHA256(signingSecret, "v0:{timestamp}:{rawBody}")` as hex, compared with `crypto.timingSafeEqual`.

On any failure the helper throws `SlackError` with `internalDetails.reason` set to a `SlackSignatureFailureReason` code. Map to HTTP 401 at the route boundary.

For deterministic tests, pass `now` (Unix seconds) to override the clock.

## Limitations

- v1 supports a single workspace via the bot token in `SlackConfig`. Multi-workspace OAuth install is out of scope.

## License

MIT
