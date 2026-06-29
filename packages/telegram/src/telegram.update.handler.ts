/**
 * Loose typing for a Telegram `Update`. Each update carries `update_id` plus
 * exactly one optional content field (`message`, `callback_query`, …); consumers
 * narrow per handler.
 *
 * @see https://core.telegram.org/bots/api#update
 */
export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
  inline_query?: Record<string, unknown>;
  my_chat_member?: Record<string, unknown>;
  chat_member?: Record<string, unknown>;
  [key: string]: unknown;
};

/** Loose typing for a Telegram `Message`. */
export type TelegramMessage = {
  message_id: number;
  from?: TelegramUser;
  chat: { id: number; type: string; [key: string]: unknown };
  date: number;
  text?: string;
  caption?: string;
  entities?: Array<{ type: string; offset: number; length: number; [key: string]: unknown }>;
  [key: string]: unknown;
};

/** Loose typing for a Telegram `CallbackQuery` (inline-keyboard button press). */
export type TelegramCallbackQuery = {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  /** Developer-defined data attached to the pressed button (≤ 64 bytes). */
  data?: string;
  [key: string]: unknown;
};

/** Loose typing for a Telegram `User`. */
export type TelegramUser = {
  id: number;
  is_bot?: boolean;
  username?: string;
  first_name?: string;
  [key: string]: unknown;
};

/** A parsed bot command extracted from a message's text/caption. */
export type TelegramCommand = {
  /** Command name including the leading slash and lowercased, e.g. `/start`. */
  name: string;
  /** Everything after the command token, trimmed. */
  args: string;
  /** The full message text (or caption). */
  text: string;
  /** The message the command came from. */
  message: TelegramMessage;
};

/**
 * Metadata accompanying every dispatched update. Surfaces the commonly needed
 * envelope fields plus the raw update for handlers that need fields the typed
 * accessors don't expose.
 */
export type TelegramUpdateContext = {
  /** The update's `update_id`. */
  updateId: number;
  /** Chat the update relates to, if resolvable. */
  chatId?: number;
  /** User that triggered the update, if resolvable. */
  from?: TelegramUser;
  /** Original update payload, untouched. */
  update: TelegramUpdate;
};

/**
 * Handler for one bot command keyed by its name (with slash, e.g. `/start`).
 * Registered in `TelegramCommandHandlerMap`.
 */
export interface TelegramCommandHandler {
  handle(command: TelegramCommand, context: TelegramUpdateContext): Promise<void>;
}

/**
 * Handler for one inline-keyboard callback query, keyed in
 * `TelegramCallbackQueryHandlerMap` by `callback_query.data`.
 */
export interface TelegramCallbackQueryHandler {
  handle(callbackQuery: TelegramCallbackQuery, context: TelegramUpdateContext): Promise<void>;
}

/**
 * Handler for one update type (`message`, `edited_message`, `inline_query`,
 * `my_chat_member`, …), registered in `TelegramUpdateHandlerMap`. Receives any
 * update not already consumed by a command or callback-query handler.
 */
export interface TelegramUpdateHandler {
  handle(update: TelegramUpdate, context: TelegramUpdateContext): Promise<void>;
}

/** Ordered list of the update content fields the dispatcher recognises. The first present one wins. */
const UPDATE_TYPE_FIELDS = [
  'message',
  'edited_message',
  'channel_post',
  'edited_channel_post',
  'callback_query',
  'inline_query',
  'chosen_inline_result',
  'shipping_query',
  'pre_checkout_query',
  'poll',
  'poll_answer',
  'my_chat_member',
  'chat_member',
  'chat_join_request',
] as const;

/**
 * Returns the update's content type — the name of the first recognised content
 * field present on the update (`message`, `callback_query`, …), or `undefined`
 * if none match. Used as the key for `TelegramUpdateHandlerMap`.
 */
export const updateType = (update: TelegramUpdate): string | undefined => UPDATE_TYPE_FIELDS.find(field => update[field] !== undefined);

/**
 * Parses a bot command from a message. A command message's text (or caption)
 * starts with `/`; the command token may be suffixed with `@botname`, which is
 * stripped. The returned `name` includes the leading slash and is lowercased
 * (e.g. `/Start@MyBot foo` → `{ name: '/start', args: 'foo' }`).
 *
 * @returns The parsed command, or `undefined` if the message is not a command.
 */
export const parseCommand = (message: TelegramMessage): TelegramCommand | undefined => {
  const text = message.text ?? message.caption;
  if (!text || !text.startsWith('/')) return undefined;

  const [token, ...rest] = text.split(/\s+/);
  if (!token || token === '/') return undefined;

  const name = token.split('@')[0]!.toLowerCase();
  return { name, args: rest.join(' ').trim(), text, message };
};
