# @maroonedsoftware/comms

The channel-agnostic messaging core for ServerKit. Register a `command` / `action` / `message`
handler **once** and run it on every wired channel, replying through a uniform `Reply`.

This package is **channel-free** — it has no dependency on any chat platform. Each channel package
ships its own adapter as a `./comms` subpath (e.g. `@maroonedsoftware/slack/comms`) that binds to this
core via an optional peer dependency. So you install `comms` plus whichever channels you wire.

## Installation

```bash
pnpm add @maroonedsoftware/comms @maroonedsoftware/slack   # + any other channels
```

## Exports

| Symbol                         | Purpose                                                                                          |
|--------------------------------|--------------------------------------------------------------------------------------------------|
| `ChannelRouter`                | Registers `command`/`action`/`message`/`fallback` handlers and `dispatch`es normalized events. Holds `.templates`. |
| `IncomingEvent`                | Normalized inbound event (`channel`, `kind`, `user`, `conversation`, `text?`, `command?`, `action?`, `raw`). |
| `OutgoingMessage` / `OutgoingButton` | Portable outbound message (`text`, optional `subject`, optional `buttons`).                 |
| `Reply`                        | A `Notifier` bound to one recipient — what handlers use: `send` / `sendTemplate` / `sendNative`.  |
| `Notifier`                     | Send-to-recipient interface each channel adapter implements (the seam for future push/email).     |
| `bindReply(notifier, to)`      | Builds a `Reply` from a `Notifier` + recipient.                                                   |
| `TemplateRegistry`             | Named rich templates: `register(name, channel, fn)`, `registerDefault(name, fn)`, `render(...)`.  |
| `CommsError`                   | `ServerkitError` subclass (e.g. `sendTemplate` for an unknown template).                          |

## Defining handlers (channel-agnostic)

```ts
import { ChannelRouter } from '@maroonedsoftware/comms';

export const router = new ChannelRouter();

router.command('deploy', async (event, reply) => {
  await reply.send({
    text: `Deploying ${event.command!.args || 'production'}…`,
    buttons: [{ id: 'deploy:confirm', label: 'Confirm' }, { id: 'deploy:cancel', label: 'Cancel' }],
  });
});

router.action('deploy:confirm', async (event, reply) => {
  await reply.send({ text: `:rocket: Confirmed by ${event.user.username ?? event.user.id}` });
});

router.message(async (event, reply) => {
  if (/help/i.test(event.text ?? '')) await reply.send({ text: 'Try `/deploy <env>`.' });
});
```

Routing precedence per event: `command` → by normalized name (`/Deploy` and `deploy` both match
`deploy`), `action` → by id, `message` → the single message handler, else the optional `fallback`.

## Wiring a channel

Each channel package exposes a `./comms` adapter. Wire it from your own HTTP route, reusing that
package's signature verification:

```ts
import { SlackClient, SlackConfig, verifySlackSignature } from '@maroonedsoftware/slack';
import { dispatchSlackCommand } from '@maroonedsoftware/slack/comms';
import { router } from './router.js';

http.post('/slack/commands', async (ctx) => {
  const raw = await rawBody(ctx.req, { encoding: 'utf8' });
  verifySlackSignature({ signingSecret: ctx.container.get(SlackConfig).signingSecret, rawBody: raw,
    timestamp: ctx.get('x-slack-request-timestamp'), signature: ctx.get('x-slack-signature') });
  await dispatchSlackCommand(router, ctx.container.get(SlackClient), Object.fromEntries(new URLSearchParams(raw)) as any);
  ctx.status = 200; ctx.body = '';
});
```

The **same `router`** is reused by `@maroonedsoftware/discord/comms`, `/whatsapp/comms`, and
`/telegram/comms`. See each channel package's README for its adapter's exports and any caveats (e.g.
Discord has no inbound `message`; WhatsApp/Telegram commands come from `/`-prefixed text).

## Rich outbound via the template registry

For anything beyond text + buttons, register a named template — rich per channel, portable fallback
elsewhere — and call it channel-agnostically:

```ts
router.templates.register('order.card', 'slack', (d: { id: string }) => ({ blocks: [/* Block Kit */] }));
router.templates.registerDefault('order.card', (d: { id: string }) => ({ text: `Order ${d.id} ✅` }));

router.action('order:confirm', async (event, reply) => {
  await reply.sendTemplate('order.card', { id: event.action!.value });   // native on Slack, fallback elsewhere
});
```

Resolution prefers a channel-native renderer, then the portable default; an unregistered name throws
`CommsError`. The registry stores plain functions — back a renderer with Handlebars or any engine; no
template engine is bundled. For one-off native payloads, `reply.sendNative(payload)` is the raw escape
hatch.

## Outbound-only sends

Each adapter also exposes a `Notifier` (`create<Channel>Notifier(client, router.templates)`) for
proactive, non-reply sends: `notifier.send(recipientId, { text: '…' })`.

## License

MIT
