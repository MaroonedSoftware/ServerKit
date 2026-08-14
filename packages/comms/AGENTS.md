# AGENTS.md — @maroonedsoftware/comms

Machine-oriented guide for AI agents. Human prose and long-form examples live in [README.md](./README.md).
Repo-wide conventions live in the [root AGENTS.md](../../AGENTS.md).

## Purpose

The channel-agnostic messaging core: one normalized `IncomingEvent` shape, one `ChannelRouter` you
register command / action / message handlers against, a `Reply` seam for sending back, and a
`TemplateRegistry` that picks a channel-native renderer when one exists and a portable fallback
otherwise. Write a bot once and run it on Slack, Discord, Telegram, and WhatsApp.

This package is **channel-free**. It contains no HTTP client, no signature verification, and no
knowledge of any provider's payloads. Each chat package normalizes its own payloads into these
shapes through its `./comms` subpath. Do not reach for this when you need channel-specific richness
on a single channel — use that package's native dispatcher directly.

## Install

```bash
pnpm add @maroonedsoftware/comms
```

Runtime dependencies: `@maroonedsoftware/errors`, `@maroonedsoftware/logger`, `injectkit`.

## Position in the graph

- **Depends on:** `errors`, `logger`.
- **Depended on by:** `discord`, `slack`, `telegram`, `whatsapp` — each exposing its adapter at
  `@maroonedsoftware/<channel>/comms`.
- **Subpath exports:** none. The package has no `exports` map at all.

The arrow points from the chat packages into this one. Adapters live in the chat package, which can
afford both dependencies, so this core stays free of every provider SDK. See the root AGENTS.md.

## API surface

### Inbound (`src/comms.event.ts`)

| Export              | Kind      | Shape                                                                                                                                      | Notes                                                                        |
| ------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `ChannelId`         | type      | `'slack' \| 'discord' \| 'whatsapp' \| 'telegram' \| (string & {})`                                                                        | The open `string` keeps it extensible while preserving literal completions.  |
| `IncomingEventKind` | type      | `'command' \| 'action' \| 'message'`                                                                                                       | —                                                                            |
| `IncomingEvent`     | interface | `{ channel, kind, user: { id, username? }, conversation: { id }, text?, command?: { name, args }, action?: { id, value? }, raw: unknown }` | `command.name` is already normalized. `raw` is the untouched native payload. |

### Outbound (`src/comms.message.ts`, `src/comms.reply.ts`)

| Export            | Kind      | Shape                                                                                                        | Notes                                                                            |
| ----------------- | --------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `OutgoingButton`  | interface | `{ id: string; label: string; value?: string }`                                                              | `id` is echoed back as `IncomingEvent.action.id`.                                |
| `OutgoingMessage` | interface | `{ text: string; subject?: string; buttons?: OutgoingButton[] }`                                             | The lowest common denominator. `subject` is used by email/push; chat ignores it. |
| `Notifier`        | interface | `{ readonly channel: ChannelId; send(to, message); sendTemplate(to, name, data?); sendNative(to, payload) }` | Implemented per channel as `create<Channel>Notifier`.                            |
| `Reply`           | interface | `{ readonly channel; send(message); sendTemplate(name, data?); sendNative(payload) }`                        | A `Notifier` pre-bound to one recipient.                                         |
| `bindReply`       | function  | `(notifier: Notifier, to: string) => Reply`                                                                  | What adapters use to build the `Reply` handed to a handler.                      |

### Templates (`src/comms.template.ts`)

| Export                 | Kind  | Shape                                                                                             | Notes                                                                               |
| ---------------------- | ----- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `NativeRenderer<D>`    | type  | `(data: D) => unknown`                                                                            | Rich, channel-specific payload.                                                     |
| `PortableRenderer<D>`  | type  | `(data: D) => OutgoingMessage`                                                                    | Cross-channel fallback.                                                             |
| `TemplateRenderResult` | type  | `{ kind: 'native'; payload } \| { kind: 'portable'; message } \| undefined`                       | `undefined` when nothing is registered under the name.                              |
| `TemplateRegistry`     | class | `register(name, channel, render)`, `registerDefault(name, render)`, `render(name, channel, data)` | Chainable registration. Stores plain functions — **no template engine is bundled**. |

`render` resolves channel-native first, then the portable default, then `undefined`.

### Routing (`src/comms.router.ts`)

| Export                 | Kind     | Shape                                                           | Notes                                                           |
| ---------------------- | -------- | --------------------------------------------------------------- | --------------------------------------------------------------- |
| `CommsHandler`         | type     | `(event: IncomingEvent, reply: Reply) => Promise<void> \| void` | —                                                               |
| `normalizeCommandName` | function | `(name: string) => string`                                      | Strips one leading `/`, lowercases.                             |
| `ChannelRouter`        | class    | `@Injectable() new ChannelRouter(logger?: Logger)`              | `readonly templates: TemplateRegistry` is exposed for adapters. |
| `#command`             | method   | `(name: string, handler: CommsHandler) => this`                 | Name is normalized on both registration and dispatch.           |
| `#action`              | method   | `(id: string, handler: CommsHandler) => this`                   | Matched verbatim — **not** normalized.                          |
| `#message`             | method   | `(handler: CommsHandler) => this`                               | A **single** catch-all for free-text messages.                  |
| `#fallback`            | method   | `(handler: CommsHandler) => this`                               | Invoked when nothing else matches.                              |
| `#dispatch`            | method   | `(event: IncomingEvent, reply: Reply) => Promise<void>`         | What adapters call.                                             |

### Errors (`src/comms.error.ts`)

| Export         | Kind       | Shape                                     | Notes                                         |
| -------------- | ---------- | ----------------------------------------- | --------------------------------------------- |
| `CommsError`   | class      | `extends ServerkitError`                  | E.g. `sendTemplate` for an unregistered name. |
| `IsCommsError` | type guard | `(error: unknown) => error is CommsError` | True for subclasses.                          |

## Canonical usage

```typescript
import { ChannelRouter } from '@maroonedsoftware/comms';
import { createSlackCommsAdapter } from '@maroonedsoftware/slack/comms';

const router = new ChannelRouter(logger);

router.templates
  .register('order.card', 'slack', (d: Order) => ({ blocks: [/* Slack blocks */] }))
  .registerDefault('order.card', (d: Order) => ({ text: `Order ${d.id} confirmed` }));

router
  .command('deploy', async (event, reply) => {
    await reply.send({
      text: `Deploy ${event.command!.args}?`,
      buttons: [{ id: 'deploy:confirm', label: 'Confirm', value: event.command!.args }],
    });
  })
  .action('deploy:confirm', async (event, reply) => {
    await deploy(event.action!.value!);
    await reply.sendTemplate('order.card', order);
  })
  .message(async (event, reply) => reply.send({ text: `You said: ${event.text}` }))
  .fallback(async (_event, reply) => reply.send({ text: "I didn't understand that." }));
```

The channel package's `./comms` adapter normalizes its webhook payload and calls
`router.dispatch(event, bindReply(notifier, conversationId))`.

## Rules for generated code

- Register commands without worrying about the slash — `normalizeCommandName` strips one leading
  `/` and lowercases on both sides.
- **Action ids are matched verbatim.** Use dot-notation catalog keys (`deploy.confirm`), keep them
  stable, and remember that an id is a wire contract: it round-trips through the channel on a
  button and must still match when it comes back.
- Register a `registerDefault` portable renderer for **every** template name. Without one, a channel
  with no native renderer gets `undefined` and the send fails.
- Prefer `reply.send` with a portable `OutgoingMessage`. Reach for `sendTemplate` when a channel
  deserves richer rendering, and for `sendNative` only as a last resort — it hard-codes the
  message to one channel.
- Read `event.raw` only inside channel-specific code. A handler that touches `raw` is no longer
  channel-agnostic, which is the whole point of this package.
- Narrow `event.command` and `event.action` before using them. They are optional even when `kind`
  implies they are present.
- Throw `CommsError` for comms-domain failures rather than a bare `Error`, so `errorMiddleware`
  renders the details.
- Register a `fallback`. Without one, an unmatched event logs at debug and silently returns.

## Gotchas

- **An unmatched event is silent.** With no `fallback`, `dispatch` logs `No comms handler for event`
  at **debug** level and returns normally. In production, where debug is usually filtered out, a
  typo'd command name produces no output anywhere and no error.
- **The logger is optional and injected positionally.** `new ChannelRouter()` with no argument
  loses even that debug line.
- **There is only one message handler.** `message()` replaces the previous one rather than adding
  to a list. Same for `fallback()`.
- **Command names are normalized, action ids are not.** `router.command('/Deploy')` and
  `router.command('deploy')` collide; `router.action('Deploy')` and `router.action('deploy')` do
  not. Easy to get backwards.
- **No template engine is bundled.** `TemplateRegistry` stores plain functions. Handlebars or
  anything else is the consumer's choice — and their dependency.
- **`sendTemplate` for an unregistered name is the adapter's problem, not the registry's.**
  `render()` returns `undefined`; each adapter decides whether that becomes a `CommsError` or a
  silent no-op. Do not assume uniform behaviour across channels.
- **`ChannelId` is `(string & {})`-widened**, so a typo'd channel string compiles. It buys
  extensibility at the cost of catching `'slak'`.
- **Handler exceptions propagate out of `dispatch`.** The router does not catch. Whatever calls
  `dispatch` — usually a webhook route — owns the error handling, and an unhandled throw there can
  make the provider retry the delivery.

## Working inside this package

```
src/
  comms.event.ts     ChannelId, IncomingEventKind, IncomingEvent
  comms.message.ts   OutgoingButton, OutgoingMessage
  comms.reply.ts     Notifier, Reply, bindReply
  comms.template.ts  NativeRenderer, PortableRenderer, TemplateRenderResult, TemplateRegistry
  comms.router.ts    CommsHandler, normalizeCommandName, ChannelRouter
  comms.error.ts     CommsError, IsCommsError
  index.ts           Barrel
```

Tests are in `tests/`, mirroring `src/`.

Invariants a change must not break:

- **No channel-specific code here, ever.** No provider SDK, no HTTP client, no signature
  verification, no payload shapes. A new channel gets a `./comms` adapter in its own package.
- `IncomingEvent` and `OutgoingMessage` are the contract four packages normalize into. Adding a
  required field breaks all four adapters at once.
- `errors` and `logger` are the only internal dependencies, and adding a third would start pulling
  this core toward being a framework.
- `bindReply` must stay a pure delegation — adapters rely on it not adding behaviour.

User-visible changes need a changeset in `.changeset/`.
