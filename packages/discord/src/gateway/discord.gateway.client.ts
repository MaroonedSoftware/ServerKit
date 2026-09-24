import { Logger } from '@maroonedsoftware/logger';
import { DiscordError } from '../discord.error.js';
import type { SocketConnect, SocketLike } from '../discord.socket.js';

/** Gateway API version the client speaks. */
export const DISCORD_GATEWAY_VERSION = 10;
/** Default first reconnect delay (ms) after an unexpected close. */
export const GATEWAY_DEFAULT_BACKOFF_INITIAL_MS = 1_000;
/** Default ceiling (ms) the reconnect delay doubles up to. */
export const GATEWAY_DEFAULT_BACKOFF_MAX_MS = 30_000;

/** Gateway opcodes the client sends or handles. */
export const GatewayOpcode = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 6,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
} as const;

/**
 * Close codes after which reconnecting cannot help: a bad token, sharding or
 * version trouble, or intents the app may not use. The client stops and
 * reports through `onError`.
 */
export const GATEWAY_FATAL_CLOSE_CODES: ReadonlySet<number> = new Set([4004, 4010, 4011, 4012, 4013, 4014]);

/** Close codes after which the session cannot be resumed, so the next connection identifies afresh. */
const SESSION_ENDING_CLOSE_CODES: ReadonlySet<number> = new Set([4007, 4009]);

/**
 * Closing with 1000 or 1001 ends the session on Discord's side; any other code
 * keeps it resumable. The client closes with this when it means to resume.
 */
const RESUMABLE_CLOSE_CODE = 4000;

/** The bot user from `READY`. */
export type GatewayUser = { id: string; username?: string; [key: string]: unknown };

/** Options for {@link GatewayClient}. */
export type GatewayClientOptions = {
  /** Bot token, sent in Identify and Resume. Never logged. */
  token: string;
  /** Intent bits, OR'd from `Intents`. */
  intents: number;
  /** Returns the Gateway URL to identify on. Normally `async () => (await discordClient.getGatewayBot()).url`. */
  gatewayUrl: () => Promise<string>;
  /** Opens the caller's socket to a Gateway URL. */
  connect: SocketConnect;
  /**
   * Receives every dispatch (op 0) as its event name and data, including
   * `READY` and `RESUMED`. A handler that throws or rejects is logged and does
   * not stop the client.
   */
  onDispatch: (event: string, data: unknown) => unknown;
  logger: Logger;
  /** Called once when the client stops for good on its own: a fatal close code, or a failed first connect. */
  onError?: (error: DiscordError) => void;
  /** Reconnect backoff after an unexpected close: `initialMs` doubling up to `maxMs`. */
  backoff?: { initialMs?: number; maxMs?: number };
  /** `properties` for Identify. Defaults to `{ os: process.platform, browser: 'serverkit', device: 'serverkit' }`. */
  properties?: { os: string; browser: string; device: string };
  /** Source of randomness for heartbeat jitter and the Invalid Session delay, in `[0, 1)`. Defaults to `Math.random`. */
  random?: () => number;
};

type GatewayFrame = { op: number; d?: unknown; s?: number | null; t?: string | null };

/**
 * A Discord Gateway client over a socket the caller supplies. It never opens a
 * connection of its own: `gatewayUrl` names the endpoint (through whatever
 * `fetch` the caller configured), and `connect` opens the socket.
 *
 * One shard, JSON encoding, no compression: enough for a single bot on a
 * modest number of guilds.
 *
 * - Hello starts the heartbeat (the first beat jittered), then Identifies, or
 *   Resumes when a session is held.
 * - A beat that finds the last one unacknowledged means a zombie connection:
 *   it closes and resumes.
 * - Reconnect (op 7) resumes. Invalid Session (op 9) resumes when Discord says
 *   it can, and otherwise identifies afresh after 1–5 seconds.
 * - Fatal close codes (4004, 4010–4014) stop the client and report through
 *   `onError`. Any other close resumes, with backoff, until {@link stop}.
 *
 * @example
 * ```ts
 * const gateway = new GatewayClient({
 *   token: config.botToken,
 *   intents: Intents.GUILDS | Intents.GUILD_MESSAGES,
 *   gatewayUrl: async () => (await discord.getGatewayBot()).url,
 *   connect: url => host.socket(url),
 *   onDispatch: (event, data) => { if (event === 'MESSAGE_CREATE') handle(data); },
 *   logger,
 * });
 * await gateway.start();
 * ```
 */
export class GatewayClient {
  private socket?: SocketLike;
  /** Bumped for every socket, so events from a socket already replaced are ignored. */
  private generation = 0;
  private stopped = true;
  private ready = false;
  private attempts = 0;

  private seq?: number;
  private sessionId?: string;
  private resumeUrl?: string;
  private botUser?: GatewayUser;
  /** Whether the current connection should Resume rather than Identify once Hello arrives. */
  private resuming = false;

  private heartbeatTimer?: ReturnType<typeof setTimeout>;
  private heartbeatAcked = true;
  private reconnectTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly options: GatewayClientOptions) {}

  /** Whether the current connection has received `READY` or `RESUMED`. */
  get isReady(): boolean {
    return this.ready;
  }

  /** The bot user from the last `READY`, if one has arrived. */
  get user(): GatewayUser | undefined {
    return this.botUser;
  }

  /**
   * Opens the first connection. Resolves once the socket is open, not on
   * `READY`.
   *
   * @throws Whatever `gatewayUrl` or `connect` throws for that first attempt.
   *   Later reconnects retry with backoff instead.
   */
  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempts = 0;
    try {
      await this.open(false);
    } catch (error) {
      this.stopped = true;
      throw error;
    }
  }

  /**
   * Closes the connection with 1000, which ends the session, and cancels any
   * pending reconnect. It never reconnects after this.
   */
  stop(): void {
    this.stopped = true;
    this.ready = false;
    this.clearTimers();
    this.generation++;
    const socket = this.socket;
    this.socket = undefined;
    socket?.close(1000, 'stopped');
  }

  private get canResume(): boolean {
    return this.sessionId !== undefined && this.resumeUrl !== undefined && this.seq !== undefined;
  }

  /** Opens a socket and makes it current. Resumes on `resume_gateway_url` when asked and possible. */
  private async open(resume: boolean): Promise<void> {
    const resuming = resume && this.canResume;
    const base = resuming && this.resumeUrl ? this.resumeUrl : await this.options.gatewayUrl();
    if (this.stopped) return;
    const socket = await this.options.connect(gatewayQuery(base));
    if (this.stopped) {
      socket.close(1000, 'stopped');
      return;
    }

    const generation = ++this.generation;
    this.socket = socket;
    this.resuming = resuming;
    this.ready = false;
    socket.onMessage(text => {
      if (generation === this.generation) this.onFrame(text);
    });
    socket.onClose(code => {
      if (generation === this.generation) this.onClose(code);
    });
  }

  private onFrame(text: string): void {
    let frame: GatewayFrame;
    try {
      frame = JSON.parse(text) as GatewayFrame;
    } catch {
      this.options.logger.warn('Discord Gateway frame is not JSON', { length: text.length });
      return;
    }

    switch (frame.op) {
      case GatewayOpcode.HELLO:
        this.onHello((frame.d as { heartbeat_interval?: number } | undefined)?.heartbeat_interval);
        return;
      case GatewayOpcode.HEARTBEAT_ACK:
        this.heartbeatAcked = true;
        return;
      case GatewayOpcode.HEARTBEAT:
        this.send({ op: GatewayOpcode.HEARTBEAT, d: this.seq ?? null });
        return;
      case GatewayOpcode.DISPATCH:
        this.onDispatch(frame);
        return;
      case GatewayOpcode.RECONNECT:
        this.options.logger.info('Discord Gateway asked to reconnect');
        this.reconnect(true, 0);
        return;
      case GatewayOpcode.INVALID_SESSION:
        if (frame.d === true) {
          this.options.logger.info('Discord Gateway session invalid; resuming');
          this.reconnect(true, 0);
        } else {
          this.options.logger.info('Discord Gateway session invalid; identifying afresh');
          this.clearSession();
          this.reconnect(false, 1_000 + Math.floor(this.random() * 4_000));
        }
        return;
      default:
        this.options.logger.debug('Discord Gateway frame ignored', { op: frame.op });
    }
  }

  private onHello(interval: number | undefined): void {
    if (!interval || interval <= 0) {
      this.options.logger.warn('Discord Gateway Hello carried no heartbeat interval');
      return;
    }
    this.startHeartbeat(interval);

    if (this.resuming && this.canResume) {
      this.send({ op: GatewayOpcode.RESUME, d: { token: this.options.token, session_id: this.sessionId, seq: this.seq } });
    } else {
      this.send({
        op: GatewayOpcode.IDENTIFY,
        d: {
          token: this.options.token,
          intents: this.options.intents,
          properties: this.options.properties ?? { os: process.platform, browser: 'serverkit', device: 'serverkit' },
        },
      });
    }
  }

  private onDispatch(frame: GatewayFrame): void {
    if (typeof frame.s === 'number') this.seq = frame.s;
    const event = frame.t ?? '';

    if (event === 'READY') {
      const data = frame.d as { session_id?: string; resume_gateway_url?: string; user?: GatewayUser } | undefined;
      this.sessionId = data?.session_id;
      this.resumeUrl = data?.resume_gateway_url;
      this.botUser = data?.user;
      this.ready = true;
      this.attempts = 0;
      this.options.logger.info('Discord Gateway ready', { userId: this.botUser?.id });
    } else if (event === 'RESUMED') {
      this.ready = true;
      this.attempts = 0;
      this.options.logger.info('Discord Gateway resumed');
    }

    Promise.resolve()
      .then(() => this.options.onDispatch(event, frame.d))
      .catch((error: unknown) => {
        this.options.logger.error('Discord Gateway dispatch handler failed', { event, error });
      });
  }

  private onClose(code: number | undefined): void {
    if (this.stopped) return;
    this.ready = false;
    this.socket = undefined;
    this.clearHeartbeat();

    if (code !== undefined && GATEWAY_FATAL_CLOSE_CODES.has(code)) {
      this.fail(fatalCloseError(code));
      return;
    }
    if (code !== undefined && SESSION_ENDING_CLOSE_CODES.has(code)) {
      this.clearSession();
    }

    const delay = this.nextBackoff();
    this.options.logger.warn('Discord Gateway connection closed', { code, retryInMs: delay });
    this.scheduleOpen(true, delay);
  }

  /**
   * Drops the current socket without letting its close count as unexpected,
   * keeping the session resumable, and opens a new one after `delay` ms.
   */
  private reconnect(resume: boolean, delay: number): void {
    this.clearHeartbeat();
    this.ready = false;
    this.generation++;
    const socket = this.socket;
    this.socket = undefined;
    socket?.close(RESUMABLE_CLOSE_CODE, 'reconnecting');
    this.scheduleOpen(resume, delay);
  }

  /** Opens a new connection after `delay` ms, or at once for `0`, backing off if it fails. */
  private scheduleOpen(resume: boolean, delay: number): void {
    if (this.stopped) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    if (delay <= 0) {
      this.reopen(resume);
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.reopen(resume);
    }, delay);
  }

  private reopen(resume: boolean): void {
    this.open(resume).catch((error: unknown) => {
      const delay = this.nextBackoff();
      this.options.logger.warn('Discord Gateway reconnect failed; backing off', { error, retryInMs: delay });
      this.scheduleOpen(resume, delay);
    });
  }

  /** The next reconnect delay: `initialMs` doubling up to `maxMs`, reset by `READY` or `RESUMED`. */
  private nextBackoff(): number {
    const initial = this.options.backoff?.initialMs ?? GATEWAY_DEFAULT_BACKOFF_INITIAL_MS;
    const max = this.options.backoff?.maxMs ?? GATEWAY_DEFAULT_BACKOFF_MAX_MS;
    return Math.min(initial * 2 ** this.attempts++, max);
  }

  private startHeartbeat(interval: number): void {
    this.clearHeartbeat();
    this.heartbeatAcked = true;
    const beat = () => {
      if (!this.heartbeatAcked) {
        this.options.logger.warn('Discord Gateway heartbeat not acknowledged; reconnecting');
        this.reconnect(true, 0);
        return;
      }
      this.heartbeatAcked = false;
      this.send({ op: GatewayOpcode.HEARTBEAT, d: this.seq ?? null });
      this.heartbeatTimer = setTimeout(beat, interval);
    };
    this.heartbeatTimer = setTimeout(beat, Math.floor(interval * this.random()));
  }

  private send(frame: { op: number; d: unknown }): void {
    this.socket?.send(JSON.stringify(frame));
  }

  private random(): number {
    return (this.options.random ?? Math.random)();
  }

  private clearSession(): void {
    this.sessionId = undefined;
    this.resumeUrl = undefined;
    this.seq = undefined;
  }

  private clearHeartbeat(): void {
    clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  private clearTimers(): void {
    this.clearHeartbeat();
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private fail(error: DiscordError): void {
    this.options.logger.error(error.message, error.internalDetails);
    this.stop();
    this.options.onError?.(error);
  }
}

/** `url` with the version and encoding query the client speaks. */
const gatewayQuery = (url: string): string => {
  const parsed = new URL(url);
  parsed.searchParams.set('v', String(DISCORD_GATEWAY_VERSION));
  parsed.searchParams.set('encoding', 'json');
  return parsed.toString();
};

const fatalCloseError = (code: number): DiscordError => {
  const message =
    code === 4014
      ? 'Discord Gateway closed with 4014: disallowed intents. Enable the privileged intents in the Developer Portal, or stop requesting them'
      : code === 4004
        ? 'Discord Gateway closed with 4004: authentication failed. Check the bot token'
        : code === 4013
          ? 'Discord Gateway closed with 4013: invalid intents'
          : `Discord Gateway closed with fatal code ${code}`;
  return new DiscordError(message).withInternalDetails({ code });
};
