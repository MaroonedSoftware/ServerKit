/**
 * Identifier for a wired channel. The built-in chat adapters use the four
 * literals; the open `string` keeps the type extensible for future channels
 * (sms, push, email, …).
 */
export type ChannelId = 'slack' | 'discord' | 'whatsapp' | 'telegram' | (string & {});

/**
 * The normalized kinds of inbound event the {@link ChannelRouter} routes on.
 *
 * - `command` — a slash/text command (`/deploy staging`).
 * - `action` — a pressed button / interactive component, keyed by a developer id.
 * - `message` — a free-text message with no command prefix.
 */
export type IncomingEventKind = 'command' | 'action' | 'message';

/**
 * A channel-agnostic inbound event. Each channel's `./comms` adapter normalizes
 * its native payload into this shape; handlers registered on the
 * {@link ChannelRouter} receive it regardless of the source channel.
 */
export interface IncomingEvent {
  /** Which channel produced the event. */
  channel: ChannelId;
  /** The routed kind — see {@link IncomingEventKind}. */
  kind: IncomingEventKind;
  /** The user who triggered the event. */
  user: { id: string; username?: string };
  /** The conversation/chat the event belongs to — also the address a {@link Reply} sends back to. */
  conversation: { id: string };
  /** Message text or full command text, when present. */
  text?: string;
  /** Present when `kind === 'command'`. `name` is normalized (no leading slash, lowercased). */
  command?: { name: string; args: string };
  /** Present when `kind === 'action'`. `id` is the developer-defined button/component id. */
  action?: { id: string; value?: string };
  /** The channel-native payload (and context) the adapter normalized from, untouched. */
  raw: unknown;
}
