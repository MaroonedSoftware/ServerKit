/**
 * A portable reply button. Channels that support interactive buttons render it
 * natively (Slack actions, Discord components, WhatsApp interactive, Telegram
 * inline keyboard); channels without buttons degrade it (e.g. WhatsApp lists
 * for >3, SMS numbered text).
 */
export interface OutgoingButton {
  /** Developer-defined id echoed back as the {@link IncomingEvent.action} id when pressed. */
  id: string;
  /** Human-visible label. */
  label: string;
  /** Optional payload value carried back on the action. */
  value?: string;
}

/**
 * The portable outbound message — the lowest common denominator every channel
 * renderer can express. Anything richer is reached through a registered template
 * (`reply.sendTemplate`) or the raw escape hatch (`reply.sendNative`).
 */
export interface OutgoingMessage {
  /** Body text. */
  text: string;
  /** Optional subject/title — used by email (subject) and push (title); chat/SMS renderers ignore it. */
  subject?: string;
  /** Optional reply buttons. */
  buttons?: OutgoingButton[];
}
