import { vi } from 'vitest';
import type { Container } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import type { ServerKitModule } from '@maroonedsoftware/servercore';
import { ServerKitServerBuilder, type ServerKitFastifyOptions } from '../src/serverkit.server.builder.js';
import type { ServerKitMiddleware } from '../src/serverkit.middleware.js';

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
  /** Middleware factory; defaults to the package's default stack. */
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
  builder.setupMiddleware(options.middleware);
  return { builder, app: builder.app, container, logger, config };
};
