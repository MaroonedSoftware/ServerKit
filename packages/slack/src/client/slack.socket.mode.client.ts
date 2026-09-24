import { Logger } from '@maroonedsoftware/logger';
import type { SlackCommandPayload } from '../slack.command.handler.js';
import { SlackError } from '../slack.error.js';
import type { SlackEventCallback } from '../slack.event.handler.js';
import type { SlackInteractionPayload } from '../slack.interaction.handler.js';
import type { SocketConnect, SocketLike } from '../slack.socket.js';

/** Default first reconnect delay (ms) after an unexpected close. */
export const SOCKET_MODE_DEFAULT_BACKOFF_INITIAL_MS = 1_000;
/** Default ceiling (ms) the reconnect delay doubles up to. */
export const SOCKET_MODE_DEFAULT_BACKOFF_MAX_MS = 30_000;

/** Envelope metadata handed to every Socket Mode handler alongside the payload. */
export type SocketModeEnvelopeMeta = {
  /** The envelope id, already acknowledged by the time a handler runs. */
  envelopeId: string;
  /** How many times Slack has sent this envelope before (Events API only). */
  retryAttempt?: number;
  /** Why Slack is retrying (Events API only). */
  retryReason?: string;
};

/**
 * Handlers for the three Socket Mode payload types. Each runs **after** the envelope has been
 * acknowledged, so a slow handler never misses Slack's 3-second window, and none can shape the ack:
 * reply through the payload's `response_url` or the Web API instead. A handler that throws or
 * rejects is logged and does not stop the client.
 */
export type SocketModeHandlers = {
  /** An Events API delivery (`event_callback`). */
  onEventsApi?: (payload: SlackEventCallback, meta: SocketModeEnvelopeMeta) => unknown;
  /** A slash command. */
  onSlashCommand?: (payload: SlackCommandPayload, meta: SocketModeEnvelopeMeta) => unknown;
  /** An interactive payload (`block_actions`, `view_submission`, `shortcut`, …). */
  onInteractive?: (payload: SlackInteractionPayload, meta: SocketModeEnvelopeMeta) => unknown;
};

/** Options for {@link SocketModeClient}. */
export type SocketModeClientOptions = {
  /** Returns a fresh, single-use WebSocket URL. Normally `() => slackClient.openSocketModeUrl()`. */
  openUrl: () => Promise<string>;
  /** Opens the caller's socket to a URL `openUrl` returned. */
  connect: SocketConnect;
  /** Where each payload type goes. */
  handlers: SocketModeHandlers;
  logger: Logger;
  /** Called once when the client stops for good on its own, e.g. Slack disabling the link. */
  onError?: (error: SlackError) => void;
  /** Reconnect backoff after an unexpected close: `initialMs` doubling up to `maxMs`. */
  backoff?: { initialMs?: number; maxMs?: number };
};

type SocketModeFrame = {
  type?: string;
  envelope_id?: string;
  payload?: unknown;
  reason?: string;
  retry_attempt?: number;
  retry_reason?: string;
};

/**
 * A Slack Socket Mode client over a socket the caller supplies. It never opens a connection of its
 * own: `openUrl` fetches the URL (through whatever `fetch` the caller configured), and `connect`
 * opens the socket.
 *
 * - Every envelope is acknowledged with `{ envelope_id }` the moment it arrives, before its handler
 *   runs.
 * - `hello` marks the client ready.
 * - `disconnect` with `refresh_requested` or `warning` opens a fresh URL and moves over to it before
 *   closing the old socket. `link_disabled` stops the client and reports through `onError`.
 * - Any other close reconnects with exponential backoff, until {@link stop}.
 *
 * @example
 * ```ts
 * const socketMode = new SocketModeClient({
 *   openUrl: () => slack.openSocketModeUrl(),
 *   connect: url => host.socket(url),
 *   handlers: { onSlashCommand: payload => slack.postWebhook({ text: 'on it' }, payload.response_url) },
 *   logger,
 * });
 * await socketMode.start();
 * ```
 */
export class SocketModeClient {
  private socket?: SocketLike;
  /** Bumped for every socket, so events from a socket already replaced are ignored. */
  private generation = 0;
  private attempts = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private stopped = true;
  private ready = false;

  constructor(private readonly options: SocketModeClientOptions) {}

  /** Whether the current connection has received `hello`. */
  get isReady(): boolean {
    return this.ready;
  }

  /**
   * Opens the first connection. Resolves once the socket is open, not on `hello`.
   *
   * @throws Whatever `openUrl` or `connect` throws for that first attempt, so a bad token or a
   *   refused host surfaces to the caller. Later reconnects retry with backoff instead.
   */
  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempts = 0;
    try {
      await this.open();
    } catch (error) {
      this.stopped = true;
      throw error;
    }
  }

  /** Closes the connection and cancels any pending reconnect. It never reconnects after this. */
  stop(): void {
    this.stopped = true;
    this.ready = false;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.generation++;
    const socket = this.socket;
    this.socket = undefined;
    socket?.close(1000, 'stopped');
  }

  /** Opens a fresh URL and socket, and makes it current. Any previous socket is closed after. */
  private async open(): Promise<void> {
    const url = await this.options.openUrl();
    if (this.stopped) return;
    const socket = await this.options.connect(url);
    if (this.stopped) {
      socket.close(1000, 'stopped');
      return;
    }

    const generation = ++this.generation;
    const previous = this.socket;
    this.socket = socket;
    this.ready = false;
    // A refresh can land while a close-triggered reconnect is pending; this socket supersedes it.
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    socket.onMessage(text => {
      if (generation === this.generation) this.onFrame(socket, text);
    });
    socket.onClose((code, reason) => {
      if (generation === this.generation) this.onClose(code, reason);
    });
    previous?.close(1000, 'replaced');
  }

  private onFrame(socket: SocketLike, text: string): void {
    let frame: SocketModeFrame;
    try {
      frame = JSON.parse(text) as SocketModeFrame;
    } catch {
      this.options.logger.warn('Slack Socket Mode frame is not JSON', { length: text.length });
      return;
    }

    // Ack first, whatever the envelope holds, so no handler can make Slack wait.
    if (frame.envelope_id) {
      socket.send(JSON.stringify({ envelope_id: frame.envelope_id }));
    }

    switch (frame.type) {
      case 'hello':
        this.ready = true;
        this.attempts = 0;
        this.options.logger.info('Slack Socket Mode connected');
        return;
      case 'disconnect':
        this.onDisconnect(frame.reason);
        return;
      case 'events_api':
        this.dispatch(this.options.handlers.onEventsApi, frame);
        return;
      case 'slash_commands':
        this.dispatch(this.options.handlers.onSlashCommand, frame);
        return;
      case 'interactive':
        this.dispatch(this.options.handlers.onInteractive, frame);
        return;
      default:
        this.options.logger.debug('Slack Socket Mode frame ignored', { type: frame.type });
    }
  }

  private dispatch<T>(handler: ((payload: T, meta: SocketModeEnvelopeMeta) => unknown) | undefined, frame: SocketModeFrame): void {
    if (!handler || !frame.envelope_id) {
      this.options.logger.debug('Slack Socket Mode envelope has no handler', { type: frame.type });
      return;
    }
    const meta: SocketModeEnvelopeMeta = {
      envelopeId: frame.envelope_id,
      ...(frame.retry_attempt !== undefined ? { retryAttempt: frame.retry_attempt } : {}),
      ...(frame.retry_reason !== undefined ? { retryReason: frame.retry_reason } : {}),
    };
    // Run on a later microtask, so the ack above is always on the wire first.
    Promise.resolve()
      .then(() => handler(frame.payload as T, meta))
      .catch((error: unknown) => {
        this.options.logger.error('Slack Socket Mode handler failed', { type: frame.type, envelopeId: frame.envelope_id, error });
      });
  }

  private onDisconnect(reason: string | undefined): void {
    if (reason === 'link_disabled') {
      this.fail(new SlackError('Slack disabled the Socket Mode link').withInternalDetails({ reason }));
      return;
    }
    this.options.logger.info('Slack Socket Mode asked to reconnect', { reason });
    this.open().catch((error: unknown) => {
      this.options.logger.warn('Slack Socket Mode refresh failed; backing off', { error });
      this.scheduleReconnect();
    });
  }

  private onClose(code: number | undefined, reason: string | undefined): void {
    if (this.stopped) return;
    this.ready = false;
    this.socket = undefined;
    this.options.logger.warn('Slack Socket Mode connection closed', { code, reason });
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const initial = this.options.backoff?.initialMs ?? SOCKET_MODE_DEFAULT_BACKOFF_INITIAL_MS;
    const max = this.options.backoff?.maxMs ?? SOCKET_MODE_DEFAULT_BACKOFF_MAX_MS;
    const delay = Math.min(initial * 2 ** this.attempts, max);
    this.attempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.open().catch((error: unknown) => {
        this.options.logger.warn('Slack Socket Mode reconnect failed; backing off', { error });
        this.scheduleReconnect();
      });
    }, delay);
  }

  private fail(error: SlackError): void {
    this.options.logger.error(error.message, error.internalDetails);
    this.stop();
    this.options.onError?.(error);
  }
}
