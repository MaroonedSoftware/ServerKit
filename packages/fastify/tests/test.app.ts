import { vi } from 'vitest';
import type { Container } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import type { ServerKitModule } from '@maroonedsoftware/servercore';
import { ServerKitServerBuilder, type ServerKitFastifyOptions } from '../src/serverkit.server.builder.js';
import type { ServerKitMiddleware } from '../src/serverkit.middleware.js';
import { errorMiddleware } from '../src/middleware/server/error.middleware.js';
import { serverKitContextMiddleware } from '../src/middleware/server/serverkit.context.middleware.js';

/** Error handling and the request context only: enough for most suites, and no scheme handler needed. */
export const minimalMiddleware = (container: Container): ServerKitMiddleware[] => [errorMiddleware(container), serverKitContextMiddleware(container)];

/** A silent, spy-able logger. */
export const createLogger = (): Logger =>
  ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  }) as unknown as Logger;

export interface TestAppOptions {
  modules?: ServerKitModule[];
  logger?: Logger;
  config?: AppConfig;
  /** Middleware factory; defaults to {@link minimalMiddleware}. */
  middleware?: (container: Container) => ServerKitMiddleware[];
  builder?: ServerKitFastifyOptions;
}

/**
 * Builds a ServerKit Fastify server through `setup` and `setupMiddleware`, ready for routes and
 * `builder.app.inject()`. Nothing listens; tests drive it in-process.
 */
export const createTestApp = async (options: TestAppOptions = {}) => {
  const logger = options.logger ?? createLogger();
  const config = options.config ?? new AppConfig({});
  const builder = new ServerKitServerBuilder(options.builder);
  const container = await builder.setup(config, logger, options.modules ?? []);
  builder.setupMiddleware(options.middleware ?? minimalMiddleware);
  return { builder, app: builder.app, container, logger, config };
};
