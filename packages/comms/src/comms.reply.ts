import type { ChannelId } from './comms.event.js';
import type { OutgoingMessage } from './comms.message.js';

/**
 * Send-to-recipient outbound interface, implemented by each channel's `./comms`
 * adapter (`create<Channel>Notifier`). It is the forward-compatible seam that
 * notify-only channels (push, email) will also implement.
 */
export interface Notifier {
  /** Which channel this notifier sends on. */
  readonly channel: ChannelId;
  /** Send a portable message to a recipient (chat id / phone / token / address). */
  send(to: string, message: OutgoingMessage): Promise<void>;
  /** Render and send a registered template by name (rich per channel, portable fallback). */
  sendTemplate(to: string, name: string, data?: unknown): Promise<void>;
  /** Send a channel-native payload verbatim — the raw escape hatch. */
  sendNative(to: string, payload: unknown): Promise<void>;
}

/**
 * A {@link Notifier} pre-bound to one recipient — what handlers receive to reply
 * to the inbound event they're handling. Built by adapters via {@link bindReply}.
 */
export interface Reply {
  /** Which channel the originating event came from. */
  readonly channel: ChannelId;
  /** Reply with a portable message. */
  send(message: OutgoingMessage): Promise<void>;
  /** Reply by rendering a registered template by name. */
  sendTemplate(name: string, data?: unknown): Promise<void>;
  /** Reply with a channel-native payload verbatim. */
  sendNative(payload: unknown): Promise<void>;
}

/**
 * Binds a {@link Notifier} to a fixed recipient, yielding the {@link Reply} that
 * handlers use. Each call delegates to the notifier with the bound `to`.
 */
export const bindReply = (notifier: Notifier, to: string): Reply => ({
  channel: notifier.channel,
  send: message => notifier.send(to, message),
  sendTemplate: (name, data) => notifier.sendTemplate(to, name, data),
  sendNative: payload => notifier.sendNative(to, payload),
});
