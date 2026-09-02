import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Settings } from 'luxon';
import { InjectKitContainerNoop, type Container } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { ServerkitError } from '@maroonedsoftware/errors';
import { DEFAULT_SHUTDOWN_GRACE_MS, ServerKitServerBuilderBase } from '../src/serverkit.server.builder.base.js';
import { ServerKitBodyParser, ServerKitParserMappings } from '../src/serverkit.bodyparser.js';
import { BinaryParser } from '../src/parsers/binary.parser.js';
import type { ServerKitModule } from '../src/serverkit.module.js';
import { openSseStream } from '../src/sse/sse.stream.js';

/** The smallest possible adapter: a bare Node http server whose handler the test can swap. */
class TestServerBuilder extends ServerKitServerBuilderBase {
  public handler: http.RequestListener = (_req, res) => res.end('ok');
  public readonly listenCalls: Array<{ port: number; signal: AbortSignal }> = [];
  private readonly server = http.createServer((req, res) => this.handler(req, res));

  protected listen(port: number, signal: AbortSignal): Promise<Server> {
    this.listenCalls.push({ port, signal });
    return new Promise((resolve, reject) => {
      const instance = this.server.listen({ port, signal }, () => resolve(instance));
      instance.once('error', reject);
    });
  }

  public readonly finalized: string[] = [];

  protected override finalizeRegistry(registry: import('injectkit').Registry): void {
    this.finalized.push(registry.isRegistered(Logger) ? 'after-core' : 'before-core');
  }

  /** Expose the protected lifecycle members for white-box assertions. */
  public get internals() {
    return { container: this.container, modules: this.modules, shutdown: () => this.shutdown() };
  }
}

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

describe('ServerKitServerBuilderBase', () => {
  let logger: Logger;
  let config: AppConfig;

  beforeEach(() => {
    logger = createLogger();
    config = {} as AppConfig;
  });

  describe('constructor', () => {
    it('sets the default luxon zone to UTC and installs a noop placeholder container', () => {
      const builder = new TestServerBuilder();

      expect(Settings.defaultZone.name).toBe('UTC');
      expect(builder.internals.container).toBeInstanceOf(InjectKitContainerNoop);
    });

    it('exports the default grace period', () => {
      expect(DEFAULT_SHUTDOWN_GRACE_MS).toBe(10_000);
    });
  });

  describe('setup', () => {
    it('registers the logger and config and returns the built container', async () => {
      const builder = new TestServerBuilder();

      const container = await builder.setup(config, logger, []);

      expect(container).toBe(builder.internals.container);
      expect(container).not.toBeInstanceOf(InjectKitContainerNoop);
      expect(container.get(Logger)).toBe(logger);
      expect(container.get(AppConfig)).toBe(config);
    });

    it('invokes each module setup hook with the registry and config, skipping modules without one', async () => {
      const module = createModule();
      const bare = createModule({ name: 'bare', setup: undefined });
      const builder = new TestServerBuilder();

      await builder.setup(config, logger, [module, bare]);

      expect(module.setup).toHaveBeenCalledWith(expect.anything(), config);
      expect(logger.info).toHaveBeenCalledWith('Setting up test.module');
      expect(builder.internals.modules).toEqual([module, bare]);
    });

    it('registers the default parsers so the body parser resolves', async () => {
      const builder = new TestServerBuilder();

      const container = await builder.setup(config, logger, []);

      expect(container.get(ServerKitBodyParser)).toBeInstanceOf(ServerKitBodyParser);
      const mappings = container.get(ServerKitParserMappings);
      expect(mappings.has('json')).toBe(true);
      expect(mappings.has('multipart')).toBe(true);
    });

    it('calls finalizeRegistry after the module setup hooks and before the container is built', async () => {
      const calls: string[] = [];
      const module = createModule({ setup: vi.fn(async () => void calls.push('module')) });
      const builder = new TestServerBuilder();
      const original = builder['finalizeRegistry'].bind(builder);
      builder['finalizeRegistry'] = registry => {
        calls.push('finalize');
        original(registry);
      };

      await builder.setup(config, logger, [module]);

      expect(calls).toEqual(['module', 'finalize']);
      expect(builder.finalized).toEqual(['after-core']);
    });

    it('honors a custom parser mapping', async () => {
      const builder = new TestServerBuilder();

      const container = await builder.setup(config, logger, [], { 'application/custom': { parser: BinaryParser } });

      expect(container.get(ServerKitParserMappings).get('application/custom')).toBeInstanceOf(BinaryParser);
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
      const builder = new TestServerBuilder();

      await expect(builder.internals.shutdown()).rejects.toThrow(ServerkitError);
    });

    it('runs the shutdown hooks in reverse registration order, then exits', async () => {
      const calls: string[] = [];
      const first = createModule({ name: 'first', shutdown: vi.fn(async () => void calls.push('first')) });
      const second = createModule({ name: 'second', shutdown: vi.fn(async () => void calls.push('second')) });
      const skipped = createModule({ name: 'skipped', shutdown: undefined });
      const builder = new TestServerBuilder();
      await builder.setup(config, logger, [first, second, skipped]);

      await builder.internals.shutdown();

      expect(calls).toEqual(['second', 'first']);
      expect(first.shutdown).toHaveBeenCalledWith(builder.internals.container);
      expect(builder.internals.modules).toEqual([first, second, skipped]);
      expect(logger.info).toHaveBeenCalledWith('Server closed');
      expect(exitSpy).toHaveBeenCalled();
    });

    it('aborts the lifecycle signal synchronously', async () => {
      const builder = new TestServerBuilder();
      await builder.setup(config, logger, []);

      const shuttingDown = builder.internals.shutdown();

      expect(builder.lifecycleSignal.aborted).toBe(true);
      await shuttingDown;
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
      // The socket's `close` handler runs shutdown asynchronously and ends in process.exit();
      // yield so it lands while the spy is still installed.
      await new Promise(resolve => setTimeout(resolve, 0));
      server = undefined;
      process.removeAllListeners('SIGINT');
      process.removeAllListeners('SIGTERM');
      exitSpy.mockRestore();
    });

    it('rejects when called before the container is initialized', async () => {
      const builder = new TestServerBuilder();

      await expect(builder.start(0)).rejects.toThrow(ServerkitError);
      expect(builder.listenCalls).toHaveLength(0);
    });

    it('binds through listen, then awaits each start hook before resolving', async () => {
      const calls: string[] = [];
      const first = createModule({ name: 'first', start: vi.fn(async () => void calls.push('first')) });
      const second = createModule({ name: 'second', start: vi.fn(async () => void calls.push('second')) });
      const builder = new TestServerBuilder();
      await builder.setup(config, logger, [first, second]);

      server = await builder.start(0);

      expect(server.listening).toBe(true);
      expect((server.address() as AddressInfo).port).toBeGreaterThan(0);
      expect(builder.listenCalls).toEqual([{ port: 0, signal: expect.any(AbortSignal) }]);
      expect(calls).toEqual(['first', 'second']);
      expect(first.start).toHaveBeenCalledWith(builder.internals.container, builder.lifecycleSignal);
      expect(logger.info).toHaveBeenCalledWith('Server is running on port 0');
    });

    it('rejects when a start hook throws', async () => {
      const error = new Error('start boom');
      const failing = createModule({ name: 'failing', start: vi.fn(async () => Promise.reject(error)) });
      const builder = new TestServerBuilder();
      await builder.setup(config, logger, [failing]);

      await expect(builder.start(0)).rejects.toBe(error);
    });

    it('serves requests once started', async () => {
      const builder = new TestServerBuilder();
      await builder.setup(config, logger, []);

      server = await builder.start(0);
      const { port } = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${port}/`);

      expect(await response.text()).toBe('ok');
    });

    it('runs every ready hook after every start hook, fault-isolated, and resolves whenReady', async () => {
      const calls: string[] = [];
      const error = new Error('ready boom');
      const first = createModule({
        name: 'first',
        start: vi.fn(async () => void calls.push('start:first')),
        ready: vi.fn(async () => {
          calls.push('ready:first');
          throw error;
        }),
      });
      const second = createModule({
        name: 'second',
        start: vi.fn(async () => void calls.push('start:second')),
        ready: vi.fn(async () => void calls.push('ready:second')),
      });
      const builder = new TestServerBuilder();
      await builder.setup(config, logger, [first, second]);

      server = await builder.start(0);
      await builder.whenReady();

      expect(calls).toEqual(['start:first', 'start:second', 'ready:first', 'ready:second']);
      expect(logger.error).toHaveBeenCalledWith(error);
      expect(logger.info).toHaveBeenCalledWith('Boot complete');
    });

    it('skips the remaining ready hooks once shutdown has begun', async () => {
      let release!: () => void;
      const inFlight = new Promise<void>(resolve => {
        release = resolve;
      });
      const first = createModule({ name: 'first', ready: vi.fn(async () => inFlight) });
      const second = createModule({ name: 'second', ready: vi.fn(async () => {}) });
      const builder = new TestServerBuilder();
      await builder.setup(config, logger, [first, second]);

      server = await builder.start(0);
      await vi.waitFor(() => expect(first.ready).toHaveBeenCalled());

      const shuttingDown = builder.internals.shutdown();
      release();
      await shuttingDown;

      expect(second.ready).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalledWith('Boot complete');
    });

    it('abandons a ready hook that ignores the signal once the grace period elapses', async () => {
      const stuck = createModule({ name: 'stuck', ready: vi.fn(() => new Promise<void>(() => {})) });
      const builder = new TestServerBuilder();
      await builder.setup(config, logger, [stuck]);

      server = await builder.start(0, { shutdownGraceMs: 20 });
      await vi.waitFor(() => expect(stuck.ready).toHaveBeenCalled());

      await builder.internals.shutdown();

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Ready phase did not unwind within 20ms'));
      expect(stuck.shutdown).toHaveBeenCalledTimes(1);
    });

    it('ignores a second shutdown so the hooks do not run twice', async () => {
      const module = createModule();
      const builder = new TestServerBuilder();
      await builder.setup(config, logger, [module]);

      server = await builder.start(0);
      await builder.whenReady();

      await builder.internals.shutdown();
      await builder.internals.shutdown();

      expect(module.shutdown).toHaveBeenCalledTimes(1);
    });

    it('aborts the lifecycle signal and the listener on SIGTERM, before the socket has closed', async () => {
      const builder = new TestServerBuilder();
      await builder.setup(config, logger, []);
      builder.handler = () => {}; // never responds: keeps a socket active

      server = await builder.start(0, { shutdownGraceMs: 10_000 });
      expect(builder.lifecycleSignal.aborted).toBe(false);

      const { port } = server.address() as AddressInfo;
      const req = http.get({ port, agent: new http.Agent({ keepAlive: true }) });
      req.on('error', () => {});
      await vi.waitFor(async () => {
        const count = await new Promise<number>(resolve => server!.getConnections((_err, c) => resolve(c)));
        expect(count).toBeGreaterThan(0);
      });

      process.emit('SIGTERM');

      expect(builder.lifecycleSignal.aborted).toBe(true);
      expect(builder.listenCalls[0]?.signal.aborted).toBe(true);
      expect(server.listening).toBe(false);
      expect(exitSpy).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('SIGTERM received');

      req.destroy();
    });

    it('runs the shutdown hooks and exits after a SIGINT with no open connections', async () => {
      const module = createModule();
      const builder = new TestServerBuilder();
      await builder.setup(config, logger, [module]);

      server = await builder.start(0, { shutdownGraceMs: 0 });
      await builder.whenReady();

      const exited = new Promise<void>(resolve => {
        exitSpy.mockImplementation((() => resolve()) as never);
      });
      process.emit('SIGINT');
      await exited;

      expect(module.shutdown).toHaveBeenCalledWith(builder.internals.container);
      expect(logger.info).toHaveBeenCalledWith('SIGINT received');
    });

    it('drains a live SSE stream on signal instead of waiting out the grace period', async () => {
      const module = createModule();
      const builder = new TestServerBuilder();
      await builder.setup(config, logger, [module]);
      builder.handler = (_req, res) => {
        const stream = openSseStream({ res }, { heartbeatMs: 0, signal: builder.lifecycleSignal });
        stream.comment('open');
      };

      server = await builder.start(0, { shutdownGraceMs: 10_000 });
      const { port } = server.address() as AddressInfo;
      const req = http.get({ port, agent: new http.Agent({ keepAlive: true }) });
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

    it('force-closes a lingering connection after the grace period so shutdown runs', async () => {
      const module = createModule();
      const builder = new TestServerBuilder();
      await builder.setup(config, logger, [module]);
      builder.handler = () => {}; // in-flight forever: only the force-close can end it

      server = await builder.start(0, { shutdownGraceMs: 50 });
      const { port } = server.address() as AddressInfo;
      const req = http.get({ port, agent: new http.Agent({ keepAlive: true }) });
      req.on('error', () => {});
      await vi.waitFor(async () => {
        const count = await new Promise<number>(resolve => server!.getConnections((_err, c) => resolve(c)));
        expect(count).toBeGreaterThan(0);
      });

      const exited = new Promise<void>(resolve => {
        exitSpy.mockImplementation((() => resolve()) as never);
      });
      process.emit('SIGTERM');
      await exited;

      expect(module.shutdown).toHaveBeenCalledWith(builder.internals.container);
    });
  });
});
