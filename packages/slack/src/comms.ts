/**
 * `@maroonedsoftware/slack/comms` — adapter binding the Slack package to the
 * channel-agnostic `@maroonedsoftware/comms` router. Importing this subpath
 * pulls in `@maroonedsoftware/comms` (an optional peer); the slack core does not.
 */
import { bindReply, CommsError, type ChannelRouter, type IncomingEvent, type Notifier, type OutgoingMessage, type TemplateRegistry } from '@maroonedsoftware/comms';
import { SlackClient } from './client/slack.client.js';
import type { SlackCommandPayload } from './slack.command.handler.js';
import type { SlackInteractionPayload } from './slack.interaction.handler.js';
import type { SlackEventCallback } from './slack.event.handler.js';
import type { SlackEventsRequest } from './slack.dispatcher.js';

type SlackPayload = Record<string, unknown>;

/**
 * Neutralizes Slack broadcast control sequences in user-supplied text so it
 * cannot ping a whole channel/workspace. `<!everyone>`, `<!channel>`, `<!here>`
 * (and their `<!channel|label>` forms) are rewritten to harmless literal
 * `@everyone`/`@channel`/`@here` text.
 */
const sanitizeText = (text: string | undefined): string | undefined => (text === undefined ? undefined : text.replace(/<!(everyone|channel|here)(\|[^>]*)?>/gi, '@$1'));

/** Renders a portable message to a Slack chat payload (`text`, or `text` + Block Kit `actions`). */
const render = (message: OutgoingMessage): SlackPayload => {
  const text = sanitizeText(message.text);
  if (!message.buttons?.length) return { text };
  return {
    text,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text } },
      {
        type: 'actions',
        elements: message.buttons.map(b => ({ type: 'button', action_id: b.id, text: { type: 'plain_text', text: b.label }, value: b.value ?? b.id })),
      },
    ],
  };
};

/** Delivers a Slack payload: to a `response_url` (http) via webhook, otherwise to a channel id. */
const deliver = (client: SlackClient, to: string, payload: SlackPayload): Promise<unknown> =>
  to.startsWith('http')
    ? client.postWebhook(payload as Parameters<SlackClient['postWebhook']>[0], to)
    : client.postMessage({ channel: to, ...payload } as Parameters<SlackClient['postMessage']>[0]);

/**
 * Builds a {@link Notifier} that sends portable messages and registered templates
 * through {@link SlackClient}. The recipient string is either a `response_url`
 * (used as an incoming webhook) or a channel id (`chat.postMessage`).
 */
export const createSlackNotifier = (client: SlackClient, templates: TemplateRegistry): Notifier => ({
  channel: 'slack',
  send: async (to, message) => void (await deliver(client, to, render(message))),
  sendTemplate: async (to, name, data) => {
    const resolved = templates.render(name, 'slack', data);
    if (!resolved) throw new CommsError(`No comms template registered for "${name}"`).withInternalDetails({ channel: 'slack', name });
    await deliver(client, to, resolved.kind === 'native' ? (resolved.payload as SlackPayload) : render(resolved.message));
  },
  sendNative: async (to, payload) => void (await deliver(client, to, payload as SlackPayload)),
});

/**
 * Dispatches a parsed Slack Events API body. Returns the `url_verification`
 * challenge for the handshake; for `message` / `app_mention` events it routes a
 * normalized `message` event to the {@link ChannelRouter} (replying via
 * `chat.postMessage` to the event's channel). Returns `undefined` otherwise.
 */
export const dispatchSlackEvent = async (router: ChannelRouter, client: SlackClient, body: SlackEventsRequest): Promise<{ challenge: string } | undefined> => {
  if (body.type === 'url_verification') return { challenge: (body as { challenge: string }).challenge };
  if (body.type !== 'event_callback') return undefined;

  const envelope = body as SlackEventCallback;
  const ev = envelope.event as { type: string; channel?: string; user?: string; text?: string; bot_id?: string; subtype?: string };
  if ((ev.type === 'message' || ev.type === 'app_mention') && ev.user && !ev.bot_id && ev.subtype !== 'bot_message') {
    const channel = ev.channel ?? '';
    const event: IncomingEvent = { channel: 'slack', kind: 'message', user: { id: ev.user }, conversation: { id: channel }, text: ev.text, raw: envelope };
    await router.dispatch(event, bindReply(createSlackNotifier(client, router.templates), channel));
  }
  return undefined;
};

/** Dispatches a parsed slash-command payload as a normalized `command` event (reply via `response_url`). */
export const dispatchSlackCommand = async (router: ChannelRouter, client: SlackClient, payload: SlackCommandPayload): Promise<void> => {
  const event: IncomingEvent = {
    channel: 'slack',
    kind: 'command',
    user: { id: payload.user_id, username: payload.user_name },
    conversation: { id: payload.channel_id },
    text: `${payload.command} ${payload.text}`.trim(),
    command: { name: payload.command, args: payload.text },
    raw: payload,
  };
  const to = payload.response_url || payload.channel_id;
  await router.dispatch(event, bindReply(createSlackNotifier(client, router.templates), to));
};

/**
 * Dispatches a parsed interactive payload. Only `block_actions` is normalized
 * (to an `action` event keyed by the first action's `action_id`); other types
 * (e.g. `view_submission`) stay on the slack package's native handlers.
 */
export const dispatchSlackInteraction = async (router: ChannelRouter, client: SlackClient, payload: SlackInteractionPayload): Promise<void> => {
  if (payload.type !== 'block_actions') return;
  const first = payload.actions?.[0];
  if (!first) return;

  const channel = (payload as { channel?: { id?: string } }).channel?.id ?? '';
  const event: IncomingEvent = {
    channel: 'slack',
    kind: 'action',
    user: { id: payload.user?.id ?? '', username: payload.user?.name },
    conversation: { id: channel },
    action: { id: first.action_id, value: first.value },
    raw: payload,
  };
  const to = payload.response_url || channel;
  await router.dispatch(event, bindReply(createSlackNotifier(client, router.templates), to));
};
