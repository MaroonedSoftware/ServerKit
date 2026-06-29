/**
 * Top-level webhook body Meta POSTs to the WhatsApp Cloud API webhook. A single
 * delivery can batch multiple entries, each with multiple changes, each value
 * carrying multiple messages and/or statuses.
 *
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples
 */
export type WhatsAppWebhookBody = {
  /** Always `"whatsapp_business_account"` for WhatsApp webhooks. */
  object: string;
  entry?: WhatsAppEntry[];
  [key: string]: unknown;
};

/** One entry in a webhook body; `id` is the WhatsApp Business Account (WABA) ID. */
export type WhatsAppEntry = {
  id: string;
  changes?: WhatsAppChange[];
  [key: string]: unknown;
};

/** One change within an entry. `field` is typically `"messages"`. */
export type WhatsAppChange = {
  field: string;
  value: WhatsAppValue;
  [key: string]: unknown;
};

/** The `value` payload of a change — holds metadata, contacts, messages, and statuses. */
export type WhatsAppValue = {
  messaging_product: 'whatsapp';
  metadata: { display_phone_number?: string; phone_number_id: string; [key: string]: unknown };
  contacts?: WhatsAppContact[];
  messages?: WhatsAppMessage[];
  statuses?: WhatsAppStatus[];
  [key: string]: unknown;
};

/** Sender contact info included alongside inbound messages. */
export type WhatsAppContact = {
  wa_id: string;
  profile?: { name?: string };
  [key: string]: unknown;
};

/**
 * Loose typing for an inbound message; consumers narrow per handler by `type`.
 * Every message has `from`, `id`, `timestamp`, and `type`, plus a type-specific
 * payload (`text`, `image`, `interactive`, `button`, …).
 */
export type WhatsAppMessage = {
  from: string;
  id: string;
  timestamp: string;
  /** Message type: `text`, `image`, `audio`, `video`, `document`, `sticker`, `location`, `contacts`, `interactive`, `button`, `reaction`, `order`, `system`, … */
  type: string;
  text?: { body: string };
  interactive?: {
    type: 'button_reply' | 'list_reply' | string;
    button_reply?: { id: string; title?: string };
    list_reply?: { id: string; title?: string; description?: string };
    [key: string]: unknown;
  };
  button?: { payload?: string; text?: string };
  [key: string]: unknown;
};

/** Outbound-message delivery status (`sent` / `delivered` / `read` / `failed`). */
export type WhatsAppStatus = {
  id: string;
  status: string;
  timestamp: string;
  recipient_id: string;
  [key: string]: unknown;
};

/**
 * Metadata accompanying every dispatched message — the resolved phone number,
 * sending account, and contact, plus the raw `value` for handlers that need
 * fields the typed accessors don't expose.
 */
export type WhatsAppMessageContext = {
  /** Phone number ID the message was delivered to (your number). */
  phoneNumberId: string;
  /** Display phone number, if present in metadata. */
  displayPhoneNumber?: string;
  /** WhatsApp Business Account ID (the entry `id`). */
  wabaId: string;
  /** Sender contact, matched from `value.contacts` by `message.from`. */
  contact?: WhatsAppContact;
  /** The enclosing `value` payload, untouched. */
  value: WhatsAppValue;
};

/** Metadata accompanying every dispatched status. */
export type WhatsAppStatusContext = {
  phoneNumberId: string;
  displayPhoneNumber?: string;
  wabaId: string;
  value: WhatsAppValue;
};

/**
 * Handler for one inbound message type (e.g. `text`, `image`, `location`).
 * Registered in `WhatsAppMessageHandlerMap`.
 *
 * Handlers should ack quickly — WhatsApp retries any webhook that doesn't get a
 * 2xx. For slow work, enqueue a job (`@maroonedsoftware/jobbroker`) and return.
 */
export interface WhatsAppMessageHandler {
  handle(message: WhatsAppMessage, context: WhatsAppMessageContext): Promise<void>;
}

/**
 * Handler for one interactive reply, keyed in `WhatsAppInteractiveHandlerMap` by
 * the developer-defined reply `id` (button/list reply id, or quick-reply button
 * payload) — see {@link interactiveReplyId}.
 */
export interface WhatsAppInteractiveHandler {
  handle(message: WhatsAppMessage, context: WhatsAppMessageContext): Promise<void>;
}

/** Handler for one delivery status, registered in `WhatsAppStatusHandlerMap` by status value. */
export interface WhatsAppStatusHandler {
  handle(status: WhatsAppStatus, context: WhatsAppStatusContext): Promise<void>;
}

/**
 * Extracts the developer-defined identifier from an interactive or quick-reply
 * button message, used by `WhatsAppDispatcher` to look a handler up in
 * `WhatsAppInteractiveHandlerMap`.
 *
 * - `interactive` (button_reply) → `interactive.button_reply.id`
 * - `interactive` (list_reply) → `interactive.list_reply.id`
 * - `button` (template quick-reply) → `button.payload`
 *
 * @returns The reply id, or `undefined` if the message carries no routable id.
 */
export const interactiveReplyId = (message: WhatsAppMessage): string | undefined => {
  if (message.type === 'interactive') {
    return message.interactive?.button_reply?.id ?? message.interactive?.list_reply?.id;
  }
  if (message.type === 'button') {
    return message.button?.payload;
  }
  return undefined;
};
