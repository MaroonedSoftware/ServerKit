/**
 * `@maroonedsoftware/telegram/comms` — adapter binding the Telegram package to
 * the channel-agnostic `@maroonedsoftware/comms` router. Importing this subpath
 * pulls in `@maroonedsoftware/comms` (an optional peer); the telegram core does not.
 */
import { bindReply, CommsError, type ChannelRouter, type IncomingEvent, type Notifier, type OutgoingButton, type OutgoingMessage, type TemplateRegistry } from '@maroonedsoftware/comms';
import { TelegramClient } from './client/telegram.client.js';
import { parseCommand, type TelegramUpdate } from './telegram.update.handler.js';

/** Lays out reply buttons as an inline keyboard (rows of ≤5, `callback_data` = button id). */
const inlineKeyboard = (buttons: OutgoingButton[]): Array<Array<{ text: string; callback_data: string }>> => {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(buttons.slice(i, i + 5).map(b => ({ text: b.label, callback_data: b.id })));
  }
  return rows;
};

/** Builds `sendMessage` params for a portable message addressed to a chat id. */
const renderParams = (to: string, message: OutgoingMessage): Record<string, unknown> => {
  const params: Record<string, unknown> = { chat_id: to, text: message.text };
  if (message.buttons?.length) params.reply_markup = { inline_keyboard: inlineKeyboard(message.buttons) };
  return params;
};

/**
 * Builds a {@link Notifier} that sends portable messages and registered templates
 * through {@link TelegramClient}. The recipient is a chat id. Native
 * template/`sendNative` payloads are `sendMessage` params (sans `chat_id`).
 */
export const createTelegramNotifier = (client: TelegramClient, templates: TemplateRegistry): Notifier => ({
  channel: 'telegram',
  send: async (to, message) => void (await client.sendMessage(renderParams(to, message))),
  sendTemplate: async (to, name, data) => {
    const resolved = templates.render(name, 'telegram', data);
    if (!resolved) throw new CommsError(`No comms template registered for "${name}"`).withInternalDetails({ channel: 'telegram', name });
    await client.sendMessage(resolved.kind === 'native' ? { chat_id: to, ...(resolved.payload as Record<string, unknown>) } : renderParams(to, resolved.message));
  },
  sendNative: async (to, payload) => void (await client.sendMessage({ chat_id: to, ...(payload as Record<string, unknown>) })),
});

const normalize = (update: TelegramUpdate): { event: IncomingEvent; to: string } | undefined => {
  if (update.message) {
    const msg = update.message;
    const to = String(msg.chat.id);
    const user = msg.from ? { id: String(msg.from.id), username: msg.from.username } : { id: to };
    const command = parseCommand(msg);
    if (command) {
      return { event: { channel: 'telegram', kind: 'command', user, conversation: { id: to }, text: command.text, command: { name: command.name, args: command.args }, raw: update }, to };
    }
    return { event: { channel: 'telegram', kind: 'message', user, conversation: { id: to }, text: msg.text ?? msg.caption, raw: update }, to };
  }

  const cq = update.callback_query;
  if (cq?.data) {
    const to = cq.message ? String(cq.message.chat.id) : String(cq.from.id);
    return { event: { channel: 'telegram', kind: 'action', user: { id: String(cq.from.id), username: cq.from.username }, conversation: { id: to }, action: { id: cq.data }, raw: update }, to };
  }

  return undefined;
};

/**
 * Routes a parsed Telegram update to the {@link ChannelRouter}: a `/`-command
 * message → `command`, a `callback_query` → `action` (keyed by `data`, and
 * acknowledged via `answerCallbackQuery`), other messages → `message`. Other
 * update types are left to the telegram package's native handlers.
 *
 * Every `callback_query` update is acknowledged in a `finally`, so the inline
 * button spinner is always dismissed — even when the query carried no `data`
 * (nothing to route) or the handler threw (which would otherwise trigger a
 * Telegram redelivery with the spinner still hanging).
 */
export const dispatchTelegram = async (router: ChannelRouter, client: TelegramClient, update: TelegramUpdate): Promise<void> => {
  try {
    const normalized = normalize(update);
    if (!normalized) return;

    await router.dispatch(normalized.event, bindReply(createTelegramNotifier(client, router.templates), normalized.to));
  } finally {
    // Dismiss the inline-button spinner so handlers stay channel-agnostic.
    if (update.callback_query) await client.answerCallbackQuery({ callback_query_id: update.callback_query.id });
  }
};
