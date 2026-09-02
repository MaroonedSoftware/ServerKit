/**
 * Server-Sent Events frame formatting. Pure string building with no Koa, stream, or socket
 * dependency, so the same helpers serve `openSseStream`, a test, or any other sink.
 */

/** One SSE frame. Every field is optional; a frame carrying only `data` is the common case. */
export interface SseFrame {
  /** Event id. The browser echoes the most recent one back as `Last-Event-ID` on reconnect. */
  id?: number | string;
  /** Event name the client listens for; omit for the default `message` event. */
  event?: string;
  /** Payload. A string is sent verbatim; anything else is JSON-encoded. */
  data?: unknown;
  /** Reconnection delay in ms the client should apply after a drop. */
  retry?: number;
}

/**
 * Format an {@link SseFrame} as a wire frame, terminated by the blank line that dispatches it.
 *
 * A multi-line string payload is split across several `data:` lines, as the spec requires (the
 * client rejoins them with newlines). Non-string payloads are JSON-encoded and so are always
 * single-line.
 *
 * @param frame - The frame fields to serialize; omitted fields produce no line.
 * @returns The complete SSE frame, including its terminating blank line.
 *
 * @example
 * ```typescript
 * frameEvent({ id: 7, event: 'feed', data: { message: 'hi' } });
 * // 'id: 7\nevent: feed\ndata: {"message":"hi"}\n\n'
 * ```
 */
export function frameEvent(frame: SseFrame): string {
  let out = '';
  if (frame.id !== undefined) out += `id: ${frame.id}\n`;
  if (frame.event !== undefined) out += `event: ${frame.event}\n`;
  if (frame.retry !== undefined) out += `retry: ${frame.retry}\n`;
  if (frame.data !== undefined) {
    const payload = typeof frame.data === 'string' ? frame.data : JSON.stringify(frame.data);
    for (const line of payload.split('\n')) out += `data: ${line}\n`;
  }
  return `${out}\n`;
}

/**
 * Format an SSE comment line. Clients ignore comments, so they are the standard way to keep a
 * socket (and any intermediary proxy) warm without emitting a real event.
 *
 * @param text - Comment body; must not contain a newline.
 * @returns The comment frame, including its terminating blank line.
 */
export function frameComment(text: string): string {
  return `: ${text}\n\n`;
}
