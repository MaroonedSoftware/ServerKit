import { vi } from 'vitest';
import type { Container } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import type { ServerKitModule } from '@maroonedsoftware/servercore';
import { ServerKitServerBuilder, type ServerKitFastifyOptions } from '../src/serverkit.server.builder.js';
import type { ServerKitPlugin } from '../src/serverkit.plugin.js';
import { errorPlugin } from '../src/plugins/error.plugin.js';
import { serverKitContextPlugin } from '../src/plugins/serverkit.context.plugin.js';
import { bodyParserPlugin } from '../src/plugins/body.parser.plugin.js';

/** Errors, the request context, and body parsing: enough for most suites, and no scheme handler needed. */
export const minimalPlugins = (container: Container): ServerKitPlugin[] => [
  errorPlugin(container),
  serverKitContextPlugin(container),
  bodyParserPlugin(),
];

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
  /** Plugin factory; defaults to {@link minimalPlugins}. */
  plugins?: (container: Container) => ServerKitPlugin[];
  builder?: ServerKitFastifyOptions;
}

/**
 * Builds a ServerKit Fastify server through `setup` and `setupPlugins`, ready for routes and
 * `builder.app.inject()`. Nothing listens; tests drive it in-process.
 */
export const createTestApp = async (options: TestAppOptions = {}) => {
  const logger = options.logger ?? createLogger();
  const config = options.config ?? new AppConfig({});
  const builder = new ServerKitServerBuilder(options.builder);
  const container = await builder.setup(config, logger, options.modules ?? []);
  builder.setupPlugins(options.plugins ?? minimalPlugins);
  return { builder, app: builder.app, container, logger, config };
};
