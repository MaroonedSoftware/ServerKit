import { Logger } from '@maroonedsoftware/logger';
import { levelRank, type ServerFeedLevel } from './server.feed.event.js';
import type { ServerFeed } from './server.feed.js';

/**
 * A logger that decorates a real one and mirrors qualifying lines onto a {@link ServerFeed}
 * bus — so the existing logger interface is one way to feed a realtime console without every
 * caller learning a new API.
 *
 * By default only `warn`+`error` are forwarded: `info`/`debug` are chatty and would drown the
 * stream, while the rich "what's happening" signal comes from explicit `feed.progress` /
 * `feed.status` publishes by producers. `trace` is never mirrored.
 *
 * `@maroonedsoftware/logger` is an optional peer of this package: the class is reachable only via
 * the `@maroonedsoftware/serverfeed/logger` subpath, so users of the bare bus never load it and
 * never need the peer installed. The bridge lives here rather than in the logger package so that
 * `@maroonedsoftware/logger` stays standalone, with no dependencies of any kind.
 *
 * @example
 * ```typescript
 * import { ServerFeed } from '@maroonedsoftware/serverfeed';
 * import { ServerFeedLogger } from '@maroonedsoftware/serverfeed/logger';
 * import { ConsoleLogger, Logger } from '@maroonedsoftware/logger';
 *
 * const feed = new ServerFeed();
 * registry.register(Logger).useInstance(new ServerFeedLogger(new ConsoleLogger(), feed));
 * ```
 */
export class ServerFeedLogger extends Logger {
  /**
   * @param inner - The underlying logger every call is delegated to.
   * @param feed - The bus qualifying lines are mirrored onto.
   * @param minBusLevel - Minimum level mirrored to the bus (inclusive). Default `'warn'`.
   */
  constructor(
    private readonly inner: Logger,
    private readonly feed: ServerFeed,
    private readonly minBusLevel: ServerFeedLevel = 'warn',
  ) {
    super();
  }

  error(message: unknown, ...params: unknown[]): void {
    this.inner.error(message, ...params);
    this.forward('error', message, params);
  }

  warn(message: unknown, ...params: unknown[]): void {
    this.inner.warn(message, ...params);
    this.forward('warn', message, params);
  }

  info(message: unknown, ...params: unknown[]): void {
    this.inner.info(message, ...params);
    this.forward('info', message, params);
  }

  debug(message: unknown, ...params: unknown[]): void {
    this.inner.debug(message, ...params);
    this.forward('debug', message, params);
  }

  trace(message: unknown, ...params: unknown[]): void {
    this.inner.trace(message, ...params); // never mirrored to the bus
  }

  private forward(level: ServerFeedLevel, message: unknown, params: unknown[]): void {
    if (levelRank(level) < levelRank(this.minBusLevel)) return;
    this.feed.log(level, 'log', stringifyMessage(message), params.length > 0 ? { params } : undefined);
  }
}

/** Flatten a log message (string, Error, or arbitrary value) to a bus-friendly string. */
function stringifyMessage(message: unknown): string {
  if (typeof message === 'string') return message;
  if (message instanceof Error) return message.message;
  return String(message);
}
