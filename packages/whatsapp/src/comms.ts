/**
 * `@maroonedsoftware/whatsapp/comms` — adapter binding the WhatsApp package to
 * the channel-agnostic `@maroonedsoftware/comms` router. Importing this subpath
 * pulls in `@maroonedsoftware/comms` (an optional peer); the whatsapp core does not.
 */
import {
  bindReply,
  CommsError,
  type ChannelRouter,
  type IncomingEvent,
  type Notifier,
  type OutgoingMessage,
  type Reply,
  type TemplateRegistry,
} from '@maroonedsoftware/comms';
import { WhatsAppClient } from './client/whatsapp.client.js';
import { interactiveReplyId, type WhatsAppMessage, type WhatsAppValue, type WhatsAppWebhookBody } from './whatsapp.message.handler.js';

/** Sends a portable message: plain text, ≤3 reply buttons, or a list for >3 (degradation). */
const deliverPortable = (client: WhatsAppClient, to: string, message: OutgoingMessage): Promise<unknown> => {
  const buttons = message.buttons ?? [];
  if (buttons.length === 0) return client.sendText(to, message.text);
  if (buttons.length <= 3) {
    return client.sendInteractive(to, {
      type: 'button',
      body: { text: message.text },
      action: { buttons: buttons.map(b => ({ type: 'reply', reply: { id: b.id, title: b.label } })) },
    });
  }
  return client.sendInteractive(to, {
    type: 'list',
    body: { text: message.text },
    action: { button: 'Choose', sections: [{ rows: buttons.map(b => ({ id: b.id, title: b.label })) }] },
  });
};

/** Sends a native message body (the type-specific part); `messaging_product`/`to` are added. */
const deliverNative = (client: WhatsAppClient, to: string, payload: unknown): Promise<unknown> =>
  client.sendMessage({ messaging_product: 'whatsapp', recipient_type: 'individual', to, ...(payload as Record<string, unknown>) });

/**
 * Builds a {@link Notifier} that sends portable messages and registered templates
 * through {@link WhatsAppClient}. The recipient is a `wa_id` (phone). Native
 * template/`sendNative` payloads are the message body minus `messaging_product`/`to`.
 */
export const createWhatsAppNotifier = (client: WhatsAppClient, templates: TemplateRegistry): Notifier => ({
  channel: 'whatsapp',
  send: async (to, message) => void (await deliverPortable(client, to, message)),
  sendTemplate: async (to, name, data) => {
    const resolved = templates.render(name, 'whatsapp', data);
    if (!resolved) throw new CommsError(`No comms template registered for "${name}"`).withInternalDetails({ channel: 'whatsapp', name });
    await (resolved.kind === 'native' ? deliverNative(client, to, resolved.payload) : deliverPortable(client, to, resolved.message));
  },
  sendNative: async (to, payload) => void (await deliverNative(client, to, payload)),
});

/**
 * Normalizes one inbound WhatsApp message into a comms {@link IncomingEvent}:
 * `/`-prefixed text → `command`, other text → `message`, interactive/quick-reply
 * → `action` (keyed by the reply id). Returns `undefined` for media and every
 * other type the router does not route. `value` is the change's `value`, which
 * carries the sender's contact profile. The event carries the WhatsApp message id
 * as `messageId`, and `conversation.group: true` when the message came from a group
 * (the group id stays on `raw.message.group_id`; `conversation.id` is the sender).
 */
export const normalizeWhatsAppMessage = (message: WhatsAppMessage, value: WhatsAppValue): IncomingEvent | undefined => {
  const from = message.from;
  const contact = value.contacts?.find(c => c.wa_id === from) ?? value.contacts?.[0];
  const user = { id: from, username: contact?.profile?.name };
  // The conversation stays keyed on the sender, who is also the reply address; group messages are flagged.
  const conversation = message.group_id ? { id: from, group: true } : { id: from };
  const messageId = message.id;
  const raw = { message, value };

  const replyId = interactiveReplyId(message);
  if (replyId) {
    const value2 =
      message.type === 'interactive' ? (message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title) : message.button?.text;
    return { channel: 'whatsapp', kind: 'action', user, conversation, messageId, action: { id: replyId, value: value2 }, raw };
  }

  if (message.type === 'text') {
    const text = message.text?.body ?? '';
    if (text.startsWith('/')) {
      const [name, ...rest] = text.split(/\s+/);
      return {
        channel: 'whatsapp',
        kind: 'command',
        user,
        conversation,
        messageId,
        text,
        command: { name: name ?? text, args: rest.join(' ').trim() },
        raw,
      };
    }
    return { channel: 'whatsapp', kind: 'message', user, conversation, messageId, text, raw };
  }

  return undefined; // media/other types stay on the native WhatsAppMessageHandlerMap
};

/** Options for {@link dispatchWhatsApp}. */
export interface DispatchWhatsAppOptions {
  /**
   * Builds the {@link Reply} handed to the router for one event; `to` is the sender's `wa_id`.
   * Override it to queue outbound messages (for example as a job inside the request's DB
   * transaction) instead of sending inline. Defaults to sending through the
   * {@link WhatsAppClient} via {@link createWhatsAppNotifier}.
   */
  reply?: (to: string, event: IncomingEvent) => Reply;
  /**
   * Called for each message {@link normalizeWhatsAppMessage} does not route (media, location,
   * reactions, …), with a {@link Reply} addressed to the sender. That reply always sends inline
   * through the {@link WhatsAppClient}, since `options.reply` needs a normalized event; to queue
   * it instead, ignore `reply` and address `message.from` yourself. Without this option, those
   * messages are skipped silently.
   */
  onUnsupported?: (message: WhatsAppMessage, value: WhatsAppValue, reply: Reply) => Promise<void> | void;
}

/**
 * Walks a parsed WhatsApp webhook body and routes each message to the
 * {@link ChannelRouter} through {@link normalizeWhatsAppMessage}. Messages it
 * does not route go to `options.onUnsupported` when given, and are skipped
 * otherwise (handle them on the whatsapp package's native handlers). Replies go
 * back to the sender through `options.reply`, or the {@link WhatsAppClient} by default.
 */
export const dispatchWhatsApp = async (
  router: ChannelRouter,
  client: WhatsAppClient,
  body: WhatsAppWebhookBody,
  options: DispatchWhatsAppOptions = {},
): Promise<void> => {
  const replyFor = (to: string, event?: IncomingEvent): Reply =>
    event && options.reply ? options.reply(to, event) : bindReply(createWhatsAppNotifier(client, router.templates), to);
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;
      for (const message of value.messages ?? []) {
        const event = normalizeWhatsAppMessage(message, value);
        if (event) await router.dispatch(event, replyFor(message.from, event));
        else if (options.onUnsupported) await options.onUnsupported(message, value, replyFor(message.from));
      }
    }
  }
};
