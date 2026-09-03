import type { FastifyBaseLogger } from 'fastify';
import type { Logger } from '@maroonedsoftware/logger';

/** The levels Fastify requires of a logger instance, mapped onto {@link Logger}'s own methods. */
const LEVELS = ['info', 'warn', 'error', 'debug', 'trace'] as const;

type Level = (typeof LEVELS)[number];

/**
 * Splits a pino-style call into the arguments {@link Logger} takes.
 *
 * Pino accepts either `(message, ...interpolation)` or `(mergeObject, message?, ...interpolation)`.
 * ServerKit's `Logger` takes `(message, ...optionalParams)`, so a merge object is moved behind the
 * message and merged with the child bindings, keeping the message first wherever there is one.
 */
const toLoggerArgs = (bindings: Record<string, unknown>, args: unknown[]): unknown[] => {
  const [first, ...rest] = args;

  if (typeof first === 'object' && first !== null) {
    const merged = { ...bindings, ...(first as Record<string, unknown>) };
    const [message, ...interpolation] = rest;
    return message === undefined ? [merged] : [message, merged, ...interpolation];
  }

  return Object.keys(bindings).length === 0 ? args : [first, bindings, ...rest];
};

/**
 * Adapts a ServerKit {@link Logger} to the pino-shaped logger Fastify expects, so Fastify's own
 * output (startup, `request.log`, plugin warnings) goes wherever the application's logger goes
 * instead of to a second, separate pino instance.
 *
 * `fatal` maps to `error` — `Logger` has no fatal level, and losing the distinction is better than
 * dropping the message. `child(bindings)` returns another adapter carrying the merged bindings,
 * which Fastify calls per request to attach `reqId`.
 *
 * The builder installs this by default; pass your own `fastify.loggerInstance` (or
 * `fastify.logger`) in {@link ServerKitFastifyOptions} to opt out.
 *
 * @param logger - The ServerKit logger to forward to.
 * @param bindings - Child bindings merged into every call's parameters. Defaults to none.
 * @returns A logger satisfying Fastify's `FastifyBaseLogger`.
 */
export const createFastifyLogger = (logger: Logger, bindings: Record<string, unknown> = {}): FastifyBaseLogger => {
  const adapter = {
    level: 'info',
    silent: () => {},
    fatal: (...args: unknown[]) => logger.error(...(toLoggerArgs(bindings, args) as [unknown])),
    child: (childBindings: Record<string, unknown>) => createFastifyLogger(logger, { ...bindings, ...childBindings }),
  } as unknown as FastifyBaseLogger & Record<Level, (...args: unknown[]) => void>;

  for (const level of LEVELS) {
    adapter[level] = (...args: unknown[]) => logger[level](...(toLoggerArgs(bindings, args) as [unknown]));
  }

  return adapter;
};
