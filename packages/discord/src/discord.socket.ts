/**
 * The minimal WebSocket contract {@link import('./gateway/discord.gateway.client.js').GatewayClient}
 * drives. The caller supplies it, so ServerKit never opens a connection of its own: wrap the
 * platform `WebSocket`, the `ws` package, or a host's egress-checked socket.
 *
 * Text frames only (the client speaks JSON with no compression). There is no `onOpen`: the client
 * sends nothing until Discord's Hello arrives, and a transport error is expected to surface as a
 * close. Same shape as `@maroonedsoftware/slack/socketmode`'s `SocketLike`, so one implementation
 * serves both.
 */
export interface SocketLike {
  /** Sends one text frame. */
  send(text: string): void;
  /** Closes the socket. */
  close(code?: number, reason?: string): void;
  /** Registers the listener for every inbound text frame. */
  onMessage(listener: (text: string) => void): void;
  /** Registers the listener for the socket closing, for whatever reason, with the close code. */
  onClose(listener: (code?: number, reason?: string) => void): void;
}

/** Opens a {@link SocketLike} to `url`. May answer synchronously or with a promise. */
export type SocketConnect = (url: string) => SocketLike | Promise<SocketLike>;
