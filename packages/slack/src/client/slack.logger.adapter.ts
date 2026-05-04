import type { Logger as SlackLogger, LogLevel } from '@slack/web-api';
import { Logger } from '@maroonedsoftware/logger';

/**
 * Adapts a ServerKit {@link Logger} to the `@slack/web-api` {@link SlackLogger}
 * interface so the WebClient can route its diagnostics through the host
 * application's logger.
 *
 * The Slack SDK's logger calls `logger.info(...args)` with a variable number
 * of arguments and no separate "primary message"; the adapter forwards them
 * to ServerKit's `(message, ...optionalParams)` shape, with an empty-string
 * primary when no args are passed.
 *
 * `setLevel`, `setName`, and `getLevel` are stored locally — ServerKit
 * loggers do not expose these knobs but the SDK expects them on its logger.
 *
 * @param logger - The ServerKit logger to forward calls to.
 * @param name - Initial value for the SDK logger's name. Defaults to `'slack-web-api'`.
 * @returns A `@slack/web-api`-compatible logger object.
 */
export const adaptLogger = (logger: Logger, name = 'slack-web-api'): SlackLogger => {
  const state = { name, level: 'info' as LogLevel };
  const forward = (fn: (message: unknown, ...optionalParams: unknown[]) => void) => (...msg: unknown[]) => {
    const [first, ...rest] = msg;
    fn(first ?? '', ...rest);
  };
  return {
    debug: forward(logger.debug.bind(logger)),
    info: forward(logger.info.bind(logger)),
    warn: forward(logger.warn.bind(logger)),
    error: forward(logger.error.bind(logger)),
    setLevel: (level: LogLevel) => {
      state.level = level;
    },
    getLevel: () => state.level,
    setName: (n: string) => {
      state.name = n;
    },
  };
};
