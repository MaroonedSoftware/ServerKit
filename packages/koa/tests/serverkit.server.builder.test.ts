import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Settings } from 'luxon';
import Koa from 'koa';
import { InjectKitContainerNoop, type Container } from 'injectkit';
import type Router from '@koa/router';
import { ServerKitServerBuilder } from '../src/serverkit.server.builder.js';
import { ServerKitBodyParser, ServerKitParserMappings } from '../src/serverkit.bodyparser.js';
import { BinaryParser } from '../src/parsers/binary.parser.js';
import { RateLimiter } from '../src/middleware/server/rate.limiter.middleware.js';
import { Logger } from '@maroonedsoftware/logger';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { ServerkitError } from '@maroonedsoftware/errors';
import type { ServerKitModule } from '../src/serverkit.module.js';
import type { ServerKitMiddleware } from '../src/serverkit.middleware.js';

/** Reaches into the builder's private fields for white-box assertions. */
interface Internals {
  server: Koa & { middleware: unknown[] };
  container?: Container;
  modules: ServerKitModule[];
}
const internals = (builder: ServerKitServerBuilder): Internals => builder as unknown as Internals;

const createLogger = (): Logger =>
  ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  }) as unknown as Logger;

const createModule = (overrides: Partial<ServerKitModule> = {}): ServerKitModule => ({
  name: 'test.module',
  setup: vi.fn(async () => {}),
  start: vi.fn(async () => {}),
  shutdown: vi.fn(async () => {}),
  ...overrides,
});

describe('ServerKitServerBuilder', () => {
  let logger: Logger;
  let config: AppConfig;

  beforeEach(() => {
    logger = createLogger();
    config = {} as AppConfig;
  });

  describe('constructor', () => {
    it('sets the default luxon zone to UTC', () => {
      new ServerKitServerBuilder();

      expect(Settings.defaultZone.name).toBe('UTC');
    });

    it('creates a fresh Koa server with a noop placeholder container', () => {
      const builder = new ServerKitServerBuilder();

      expect(internals(builder).server).toBeInstanceOf(Koa);
      expect(internals(builder).container).toBeInstanceOf(InjectKitContainerNoop);
    });
  });

  describe('setup', () => {
    it('registers the logger and config as resolvable instances', async () => {
      const builder = new ServerKitServerBuilder();

      await builder.setup(config, logger, []);

      const container = internals(builder).container!;
      expect(container.get(Logger)).toBe(logger);
      expect(container.get(AppConfig)).toBe(config);
    });

    it('builds and returns the container', async () => {
      const builder = new ServerKitServerBuilder();

      const result = await builder.setup(config, logger, []);

      expect(result).toBe(internals(builder).container);
      expect(result).not.toBeInstanceOf(InjectKitContainerNoop);
    });

    it('invokes each module setup hook with the registry and config', async () => {
      const module = createModule();
      const builder = new ServerKitServerBuilder();

      await builder.setup(config, logger, [module]);

      expect(module.setup).toHaveBeenCalledTimes(1);
      expect(module.setup).toHaveBeenCalledWith(expect.anything(), config);
      expect(logger.info).toHaveBeenCalledWith('Setting up test.module');
    });

    it('skips modules that do not define a setup hook', async () => {
      const module = createModule({ setup: undefined });
      const builder = new ServerKitServerBuilder();

      const result = await builder.setup(config, logger, [module]);

      expect(result).toBe(internals(builder).container);
    });

    it('stores the provided modules for later lifecycle hooks', async () => {
      const module = createModule();
      const builder = new ServerKitServerBuilder();

      await builder.setup(config, logger, [module]);

      expect(internals(builder).modules).toEqual([module]);
    });

    it('registers the default parsers so the body parser resolves', async () => {
      const builder = new ServerKitServerBuilder();

      await builder.setup(config, logger, []);

      const container = internals(builder).container!;
      expect(container.get(ServerKitBodyParser)).toBeInstanceOf(ServerKitBodyParser);

      const mappings = container.get(ServerKitParserMappings);
      expect(mappings.has('json')).toBe(true);
      expect(mappings.has('multipart')).toBe(true);
    });

    it('honors a custom parser mapping', async () => {
      const builder = new ServerKitServerBuilder();

      await builder.setup(config, logger, [], { 'application/custom': { parser: BinaryParser } });

      const container = internals(builder).container!;
      const mappings = container.get(ServerKitParserMappings);
      expect(mappings.has('application/custom')).toBe(true);
      expect(mappings.get('application/custom')).toBeInstanceOf(BinaryParser);
    });
  });

  describe('setupMiddleware', () => {
    it('throws when called before setup initializes the container', () => {
      const builder = new ServerKitServerBuilder();

      expect(() => builder.setupMiddleware(() => [])).toThrow(ServerkitError);
      expect(() => builder.setupMiddleware(() => [])).toThrow('Container not initialized');
    });

    it('passes the built container to the middleware factory', async () => {
      const builder = new ServerKitServerBuilder();
      await builder.setup(config, logger, []);
      const factory = vi.fn((_container: Container): ServerKitMiddleware[] => []);

      builder.setupMiddleware(factory);

      expect(factory).toHaveBeenCalledWith(internals(builder).container);
    });

    it('registers each returned middleware on the server and returns the builder', async () => {
      const builder = new ServerKitServerBuilder();
      await builder.setup(config, logger, []);
      const before = internals(builder).server.middleware.length;
      const m1: ServerKitMiddleware = async (_ctx, next) => next();
      const m2: ServerKitMiddleware = async (_ctx, next) => next();

      const result = builder.setupMiddleware(() => [m1, m2]);

      expect(result).toBe(builder);
      const middleware = internals(builder).server.middleware;
      expect(middleware.length).toBe(before + 2);
      expect(middleware).toContain(m1);
      expect(middleware).toContain(m2);
    });

    it('applies the default middleware stack when no factory is provided', async () => {
      const builder = new ServerKitServerBuilder();
      await builder.setup(config, logger, []);
      const before = internals(builder).server.middleware.length;

      builder.setupMiddleware();

      // error, context, cors, authentication (no RateLimiter registered -> rate limiter skipped)
      expect(internals(builder).server.middleware.length).toBe(before + 4);
    });
  });

  describe('setupRoutes', () => {
    it("mounts each router's routes() and allowedMethods() and returns the builder", () => {
      const builder = new ServerKitServerBuilder();
      const routesMw: ServerKitMiddleware = async (_ctx, next) => next();
      const allowedMw: ServerKitMiddleware = async (_ctx, next) => next();
      const router = {
        routes: vi.fn(() => routesMw),
        allowedMethods: vi.fn(() => allowedMw),
      } as unknown as Router;
      const before = internals(builder).server.middleware.length;

      const result = builder.setupRoutes([router]);

      expect(result).toBe(builder);
      expect(router.routes).toHaveBeenCalledTimes(1);
      expect(router.allowedMethods).toHaveBeenCalledTimes(1);
      const middleware = internals(builder).server.middleware;
      expect(middleware.length).toBe(before + 2);
      expect(middleware).toContain(routesMw);
      expect(middleware).toContain(allowedMw);
    });
  });

  describe('shutdown', () => {
    let exitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    });

    afterEach(() => {
      exitSpy.mockRestore();
    });

    it('throws when called before the container is initialized', async () => {
      const builder = new ServerKitServerBuilder();

      await expect(builder.shutdown()).rejects.toThrow(ServerkitError);
    });

    it('runs each module shutdown hook with the container and exits', async () => {
      const module = createModule();
      const builder = new ServerKitServerBuilder();
      await builder.setup(config, logger, [module]);

      await builder.shutdown();

      expect(module.shutdown).toHaveBeenCalledTimes(1);
      expect(module.shutdown).toHaveBeenCalledWith(internals(builder).container);
      expect(logger.info).toHaveBeenCalledWith('Shutting down test.module');
      expect(logger.info).toHaveBeenCalledWith('Server closed');
      expect(exitSpy).toHaveBeenCalled();
    });

    it('skips modules without a shutdown hook', async () => {
      const module = createModule({ shutdown: undefined });
      const builder = new ServerKitServerBuilder();
      await builder.setup(config, logger, [module]);

      await expect(builder.shutdown()).resolves.toBeUndefined();
      expect(exitSpy).toHaveBeenCalled();
    });
  });

  describe('start', () => {
    let exitSpy: ReturnType<typeof vi.spyOn>;
    let server: Server | undefined;

    beforeEach(() => {
      exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    });

    afterEach(async () => {
      if (server?.listening) {
        await new Promise<void>((resolve) => server!.close(() => resolve()));
      }
      server = undefined;
      process.removeAllListeners('SIGINT');
      process.removeAllListeners('SIGTERM');
      exitSpy.mockRestore();
    });

    it('throws when called before the container is initialized', async () => {
      const builder = new ServerKitServerBuilder();

      await expect(builder.start(0)).rejects.toThrow(ServerkitError);
    });

    it('starts listening and runs each module start hook', async () => {
      const module = createModule();
      const builder = new ServerKitServerBuilder();
      await builder.setup(config, logger, [module]);

      const started = new Promise<void>((resolve) => {
        (module.start as ReturnType<typeof vi.fn>).mockImplementation(async () => resolve());
      });

      server = await builder.start(0);
      await started;

      expect(server.listening).toBe(true);
      expect(module.start).toHaveBeenCalledWith(internals(builder).container);
      const address = server.address() as AddressInfo;
      expect(address.port).toBeGreaterThan(0);
    });

    it('logs errors emitted by the underlying server', async () => {
      const builder = new ServerKitServerBuilder();
      await builder.setup(config, logger, []);

      server = await builder.start(0);
      const error = new Error('boom');
      internals(builder).server.emit('error', error);

      expect(logger.error).toHaveBeenCalledWith(error);
    });
  });
});
