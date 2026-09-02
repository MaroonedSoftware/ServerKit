import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import http, { type Server } from 'node:http';
import { Settings } from 'luxon';
import Koa from 'koa';
import { InjectKitContainerNoop, type Container } from 'injectkit';
import type { ServerKitRouterType } from '../src/serverkit.router.js';
import { ServerKitServerBuilder } from '../src/serverkit.server.builder.js';
import { BinaryParser, openSseStream, ServerKitBodyParser, ServerKitParserMappings, type SseContext } from '@maroonedsoftware/servercore';
import { RateLimiter } from '../src/middleware/server/rate.limiter.middleware.js';
import { Logger } from '@maroonedsoftware/logger';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { ServerkitError } from '@maroonedsoftware/errors';
import type { ServerKitModule } from '@maroonedsoftware/servercore';
import type { ServerKitMiddleware } from '../src/serverkit.middleware.js';

/** Reaches into the builder's private fields for white-box assertions. */
interface Internals {
  server: Koa & { middleware: unknown[] };
  container?: Container;
  modules: ServerKitModule[];
  /** `shutdown` is protected on the builder; the tests drive it directly. */
  shutdown(): Promise<void>;
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
      } as unknown as ServerKitRouterType;
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

      await expect(internals(builder).shutdown()).rejects.toThrow(ServerkitError);
    });

    it('runs each module shutdown hook with the container and exits', async () => {
      const module = createModule();
      const builder = new ServerKitServerBuilder();
      await builder.setup(config, logger, [module]);

      await internals(builder).shutdown();

      expect(module.shutdown).toHaveBeenCalledTimes(1);
      expect(module.shutdown).toHaveBeenCalledWith(internals(builder).container);
      expect(logger.info).toHaveBeenCalledWith('Shutting down test.module');
      expect(logger.info).toHaveBeenCalledWith('Server closed');
      expect(exitSpy).toHaveBeenCalled();
    });

    it('runs the shutdown hooks in reverse registration order', async () => {
      const calls: string[] = [];
      const first = createModule({ name: 'first', shutdown: vi.fn(async () => void calls.push('first')) });
      const second = createModule({ name: 'second', shutdown: vi.fn(async () => void calls.push('second')) });
      const builder = new ServerKitServerBuilder();
      await builder.setup(config, logger, [first, second]);

      await internals(builder).shutdown();

      expect(calls).toEqual(['second', 'first']);
    });

    it('leaves the registered module order untouched while shutting down', async () => {
      const first = createModule({ name: 'first' });
      const second = createModule({ name: 'second' });
      const builder = new ServerKitServerBuilder();
      await builder.setup(config, logger, [first, second]);

      await internals(builder).shutdown();

      expect(internals(builder).modules).toEqual([first, second]);
    });

    it('skips modules without a shutdown hook', async () => {
      const module = createModule({ shutdown: undefined });
      const builder = new ServerKitServerBuilder();
      await builder.setup(config, logger, [module]);

      await expect(internals(builder).shutdown()).resolves.toBeUndefined();
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
        await new Promise<void>(resolve => server!.close(() => resolve()));
      }
      // Closing the socket fires the builder's *async* `close` handler, which runs the shutdown
      // hooks and then calls process.exit(). Yield a macrotask so that finishes while the exit
      // spy is still installed, instead of hitting the real process.exit after mockRestore.
      await new Promise(resolve => setTimeout(resolve, 0));
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

      const started = new Promise<void>(resolve => {
        (module.start as ReturnType<typeof vi.fn>).mockImplementation(async () => resolve());
      });

      server = await builder.start(0);
      await started;

      expect(server.listening).toBe(true);
      expect(module.start).toHaveBeenCalledWith(internals(builder).container, expect.any(AbortSignal));
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

    it('runs every ready hook after every start hook and after the ready log', async () => {
      const calls: string[] = [];
      const first = createModule({
        name: 'first',
        start: vi.fn(async () => void calls.push('start:first')),
        ready: vi.fn(async () => void calls.push('ready:first')),
      });
      const second = createModule({
        name: 'second',
        start: vi.fn(async () => void calls.push('start:second')),
        ready: vi.fn(async () => void calls.push('ready:second')),
      });
      const builder = new ServerKitServerBuilder();
      await builder.setup(config, logger, [first, second]);

      server = await builder.start(0);
      await builder.whenReady();

      expect(calls).toEqual(['start:first', 'start:second', 'ready:first', 'ready:second']);
      expect(first.ready).toHaveBeenCalledWith(internals(builder).container, expect.any(AbortSignal));

      const infos = (logger.info as ReturnType<typeof vi.fn>).mock.calls.map(([message]) => message as string);
      const listening = infos.findIndex(message => message.startsWith('Server is running on port'));
      expect(listening).toBeGreaterThan(-1);
      expect(infos.indexOf('Ready first')).toBeGreaterThan(listening);
      expect(infos.at(-1)).toBe('Boot complete');
    });

    it('logs a failing ready hook and still runs the remaining modules', async () => {
      const error = new Error('ready boom');
      const failing = createModule({ name: 'failing', ready: vi.fn(async () => Promise.reject(error)) });
      const second = createModule({ name: 'second', ready: vi.fn(async () => {}) });
      const builder = new ServerKitServerBuilder();
      await builder.setup(config, logger, [failing, second]);

      server = await builder.start(0);
      await builder.whenReady();

      expect(logger.error).toHaveBeenCalledWith(error);
      expect(second.ready).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith('Boot complete');
    });

    it('resolves whenReady only after the last ready hook completes', async () => {
      let finished = false;
      const module = createModule({
        ready: vi.fn(async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          finished = true;
        }),
      });
      const builder = new ServerKitServerBuilder();
      await builder.setup(config, logger, [module]);

      server = await builder.start(0);
      expect(finished).toBe(false);

      await builder.whenReady();

      expect(finished).toBe(true);
    });

    it('skips the remaining ready hooks once shutdown has begun', async () => {
      let release!: () => void;
      const inFlight = new Promise<void>(resolve => {
        release = resolve;
      });
      const first = createModule({ name: 'first', ready: vi.fn(async () => inFlight) });
      const second = createModule({ name: 'second', ready: vi.fn(async () => {}) });
      const builder = new ServerKitServerBuilder();
      await builder.setup(config, logger, [first, second]);

      server = await builder.start(0);
      await vi.waitFor(() => expect(first.ready).toHaveBeenCalled());

      const shuttingDown = internals(builder).shutdown();
      release();
      await shuttingDown;

      expect(first.ready).toHaveBeenCalledTimes(1);
      expect(second.ready).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalledWith('Boot complete');
    });

    it('aborts the lifecycle signal handed to an in-flight ready hook', async () => {
      let observed: AbortSignal | undefined;
      let release!: () => void;
      const inFlight = new Promise<void>(resolve => {
        release = resolve;
      });
      const module = createModule({
        ready: vi.fn(async (_container: Container, signal: AbortSignal) => {
          observed = signal;
          return inFlight;
        }),
      });
      const builder = new ServerKitServerBuilder();
      await builder.setup(config, logger, [module]);

      server = await builder.start(0);
      await vi.waitFor(() => expect(observed).toBeDefined());
      expect(observed!.aborted).toBe(false);

      // shutdown() aborts synchronously, before it awaits anything.
      const shuttingDown = internals(builder).shutdown();
      expect(observed!.aborted).toBe(true);

      release();
      await shuttingDown;
      expect(module.shutdown).toHaveBeenCalledTimes(1);
    });

    it('abandons a ready hook that ignores the signal once the grace period elapses', async () => {
      const stuck = createModule({ name: 'stuck', ready: vi.fn(() => new Promise<void>(() => {})) });
      const builder = new ServerKitServerBuilder();
      await builder.setup(config, logger, [stuck]);

      server = await builder.start(0, { shutdownGraceMs: 20 });
      await vi.waitFor(() => expect(stuck.ready).toHaveBeenCalled());

      await internals(builder).shutdown();

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Ready phase did not unwind within 20ms'));
      expect(stuck.shutdown).toHaveBeenCalledTimes(1);
      expect(exitSpy).toHaveBeenCalled();
    });

    it('ignores a second shutdown so the hooks do not run twice', async () => {
      const module = createModule();
      const builder = new ServerKitServerBuilder();
      await builder.setup(config, logger, [module]);

      server = await builder.start(0);
      await builder.whenReady();

      await internals(builder).shutdown();
      await internals(builder).shutdown();

      expect(module.shutdown).toHaveBeenCalledTimes(1);
    });

    it('exposes a lifecycle signal that aborts on SIGTERM, before the socket has closed', async () => {
      const builder = new ServerKitServerBuilder();
      await builder.setup(config, logger, []);
      // A request that never responds keeps a socket open, so the server's `close` event — and
      // with it shutdown() — cannot fire yet. The signal must still abort.
      builder.setupMiddleware(() => [() => new Promise<void>(() => {})]);

      server = await builder.start(0, { shutdownGraceMs: 10_000 });
      expect(builder.lifecycleSignal.aborted).toBe(false);

      const address = server.address() as AddressInfo;
      const req = http.get({ port: address.port, agent: new http.Agent({ keepAlive: true }) });
      req.on('error', () => {});
      await vi.waitFor(async () => {
        const count = await new Promise<number>(resolve => server!.getConnections((_err, c) => resolve(c)));
        expect(count).toBeGreaterThan(0);
      });

      process.emit('SIGTERM');

      expect(builder.lifecycleSignal.aborted).toBe(true);
      expect(server.listening).toBe(false);
      expect(exitSpy).not.toHaveBeenCalled(); // shutdown hasn't run: the socket is still held open

      req.destroy();
    });

    it('still runs the shutdown hooks after a signal handler aborted the lifecycle', async () => {
      const module = createModule();
      const builder = new ServerKitServerBuilder();
      await builder.setup(config, logger, [module]);

      server = await builder.start(0, { shutdownGraceMs: 0 });
      await builder.whenReady();

      const exited = new Promise<void>(resolve => {
        exitSpy.mockImplementation((() => resolve()) as never);
      });
      process.emit('SIGTERM');
      await exited;

      expect(builder.lifecycleSignal.aborted).toBe(true);
      expect(module.shutdown).toHaveBeenCalledTimes(1);
    });

    it('drains a live SSE stream on signal instead of waiting out the grace period', async () => {
      const module = createModule();
      const builder = new ServerKitServerBuilder();
      await builder.setup(config, logger, [module]);
      builder.setupMiddleware(() => [
        async ctx => {
          const stream = openSseStream(ctx as unknown as SseContext, { heartbeatMs: 0, signal: builder.lifecycleSignal });
          stream.comment('open'); // flush the headers so the client sees a response, as a real feed does
        },
      ]);

      // A 10s grace the test must never wait for: if the stream ignored the lifecycle signal it
      // would hold close() open until the force-close timer, and this test would time out.
      server = await builder.start(0, { shutdownGraceMs: 10_000 });
      const address = server.address() as AddressInfo;

      const req = http.get({ port: address.port, agent: new http.Agent({ keepAlive: true }) });
      req.on('error', () => {});
      await new Promise<void>(resolve => req.on('response', () => resolve()));

      const exited = new Promise<void>(resolve => {
        exitSpy.mockImplementation((() => resolve()) as never);
      });

      process.emit('SIGTERM');
      await exited;

      expect(module.shutdown).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith('Server closed');
    });

    it('force-closes a lingering connection on signal so shutdown runs and exits', async () => {
      const module = createModule();
      const builder = new ServerKitServerBuilder();
      await builder.setup(config, logger, [module]);
      // A middleware that never responds keeps the request in-flight, so the socket
      // stays *active* (closeIdleConnections won't reap it) — only the grace-period
      // force-close can end it. This is exactly the SSE/long-poll hang scenario.
      builder.setupMiddleware(() => [() => new Promise<void>(() => {})]);

      server = await builder.start(0, { shutdownGraceMs: 50 });
      const address = server.address() as AddressInfo;

      // Fire a request we never wait to complete; its socket is destroyed on shutdown.
      const req = http.get({ port: address.port, agent: new http.Agent({ keepAlive: true }) });
      req.on('error', () => {});

      // Wait until the server actually has the active connection open.
      await vi.waitFor(async () => {
        const count = await new Promise<number>(resolve => server!.getConnections((_err, c) => resolve(c)));
        expect(count).toBeGreaterThan(0);
      });

      const exited = new Promise<void>(resolve => {
        exitSpy.mockImplementation((() => resolve()) as never);
      });

      process.emit('SIGTERM');
      await exited;

      expect(module.shutdown).toHaveBeenCalledWith(internals(builder).container);
      expect(exitSpy).toHaveBeenCalled();
    });
  });
});
