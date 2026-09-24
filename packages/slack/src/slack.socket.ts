/**
 * The minimal WebSocket contract {@link import('./client/slack.socket.mode.client.js').SocketModeClient}
 * drives. The caller supplies it, so ServerKit never opens a connection of its own: wrap the
 * platform `WebSocket`, the `ws` package, or a host's egress-checked socket.
 *
 * Text frames only. There is no `onOpen`: the client sends nothing until Slack speaks first, and a
 * transport error is expected to surface as a close.
 */
export interface SocketLike {
  /** Sends one text frame. */
  send(text: string): void;
  /** Closes the socket. The client does not expect `onClose` to be skipped for a close it asked for. */
  close(code?: number, reason?: string): void;
  /** Registers the listener for every inbound text frame. */
  onMessage(listener: (text: string) => void): void;
  /** Registers the listener for the socket closing, for whatever reason. */
  onClose(listener: (code?: number, reason?: string) => void): void;
}

/** Opens a {@link SocketLike} to `url`. May answer synchronously or with a promise. */
export type SocketConnect = (url: string) => SocketLike | Promise<SocketLike>;
