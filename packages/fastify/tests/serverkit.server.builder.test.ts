import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyPluginAsync } from 'fastify';
import { Injectable, InjectKitContainerNoop, type Container } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { ServerkitError } from '@maroonedsoftware/errors';
import { ServerKitBodyParser, ServerKitParserMappings, type ServerKitModule, openSseStream } from '@maroonedsoftware/servercore';
import { ServerKitServerBuilder } from '../src/serverkit.server.builder.js';
import type { ServerKitPlugin } from '../src/serverkit.plugin.js';
import { serverKitPlugin } from '../src/serverkit.plugin.js';
import { createLogger, minimalPlugins } from './test.app.js';
import { ServerKitContext } from '../src/serverkit.context.js';
import { AuthenticationSchemeHandler, invalidAuthenticationSession } from '@maroonedsoftware/authentication';

interface Internals {
  container?: Container;
  modules: ServerKitModule[];
  shutdown(): Promise<void>;
}
const internals = (builder: ServerKitServerBuilder): Internals => builder as unknown as Internals;

const createModule = (overrides: Partial<ServerKitModule> = {}): ServerKitModule => ({
  name: 'test.module',
  setup: vi.fn(async () => {}),
  start: vi.fn(async () => {}),
  shutdown: vi.fn(async () => {}),
  ...overrides,
});

describe('ServerKitServerBuilder (fastify)', () => {
  let logger: Logger;
  let config: AppConfig;

  beforeEach(() => {
    logger = createLogger();
    config = new AppConfig({});
  });

  describe('constructor', () => {
    it('creates a Fastify instance with a noop placeholder container', () => {
      const builder = new ServerKitServerBuilder();

      expect(builder.app).toBeDefined();
      expect(builder.app.server).toBeInstanceOf(http.Server);
      expect(internals(builder).container).toBeInstanceOf(InjectKitContainerNoop);
    });

    it('removes the built-in parsers so bodies stay unread until a route parses them', async () => {
      const builder = new ServerKitServerBuilder();
      await builder.setup(config, logger, []);
      let seen: unknown = 'not called';
      builder.app.post('/echo', async request => {
        seen = request.body;
        return { ok: true };
      });

      const response = await builder.app.inject({
        method: 'POST',
        url: '/echo',
        headers: { 'content-type': 'application/json' },
        payload: '{"a":1}',
      });

      expect(response.statusCode).toBe(200);
      expect(seen).toBeUndefined();
    });

    it('forwards Fastify options', () => {
      const builder = new ServerKitServerBuilder({ fastify: { routerOptions: { caseSensitive: false } } });

      expect(builder.app.initialConfig.routerOptions?.caseSensitive).toBe(false);
    });

    it('bridges Fastify logging to the ServerKit logger, following it across setup', async () => {
      const builder = new ServerKitServerBuilder();

      builder.app.log.warn('before setup');

      await builder.setup(config, logger, []);
      builder.app.log.warn('after setup');

      expect(logger.warn).toHaveBeenCalledWith('after setup');
    });

    it('leaves Fastify logging alone when the caller supplies a logger', async () => {
      const builder = new ServerKitServerBuilder({ fastify: { logger: false } });
      await builder.setup(config, logger, []);

      builder.app.log.warn('ignored');

      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('takes the request id from the X-Request-Id header and honours a custom genReqId', async () => {
      const builder = new ServerKitServerBuilder();
      await builder.setup(config, logger, []);
      builder.setupPlugins(minimalPlugins);
      builder.app.get('/', async request => ({ id: request.id, requestId: request.requestId }));

      const response = await builder.app.inject({ method: 'GET', url: '/', headers: { 'x-request-id': 'req-9' } });

      expect(response.json()).toEqual({ id: 'req-9', requestId: 'req-9' });

      const custom = new ServerKitServerBuilder({ fastify: { genReqId: () => 'fixed' } });
      await custom.setup(config, logger, []);
      custom.setupPlugins(minimalPlugins);
      custom.app.get('/', async request => ({ requestId: request.requestId }));

      const overridden = await custom.app.inject({ method: 'GET', url: '/', headers: { 'x-request-id': 'ignored' } });

      expect(overridden.json()).toEqual({ requestId: 'fixed' });
      expect(overridden.headers['x-request-id']).toBe('fixed');
    });
  });

  describe('setup', () => {
    it('registers the logger, config, and parsers and returns the container', async () => {
      const builder = new ServerKitServerBuilder();
      const module = createModule();

      const container = await builder.setup(config, logger, [module]);

      expect(container).toBe(internals(builder).container);
      expect(container.get(Logger)).toBe(logger);
      expect(container.get(AppConfig)).toBe(config);
      expect(container.get(ServerKitBodyParser)).toBeInstanceOf(ServerKitBodyParser);
      expect(container.get(ServerKitParserMappings).has('json')).toBe(true);
      expect(module.setup).toHaveBeenCalledWith(expect.anything(), config);
      expect(internals(builder).modules).toEqual([module]);
    });

    it('registers ServerKitContext as a scoped placeholder that only resolves inside a request', async () => {
      @Injectable()
      class NeedsContext {
        constructor(public readonly context: ServerKitContext) {}
      }
      const builder = new ServerKitServerBuilder();
      const container = await builder.setup(config, logger, [
        { name: 'm', setup: async registry => void registry.register(NeedsContext).useClass(NeedsContext).asScoped() },
      ]);
      builder.setupPlugins(minimalPlugins);
      let sameRequest = false;
      builder.app.get('/', async request => {
        sameRequest = request.container.get(NeedsContext).context === request;
        return 'ok';
      });

      expect(() => container.get(ServerKitContext)).toThrow(ServerkitError);
      await builder.app.inject({ method: 'GET', url: '/' });
      expect(sameRequest).toBe(true);
    });

    it('leaves a ServerKitContext registration a module made in place', async () => {
      const builder = new ServerKitServerBuilder();
      const own = {} as ServerKitContext;

      const container = await builder.setup(config, logger, [
        { name: 'm', setup: async registry => void registry.register(ServerKitContext).useInstance(own) },
      ]);

      expect(container.get(ServerKitContext)).toBe(own);
    });
  });

  describe('setupPlugins', () => {
    it('throws when called before setup initializes the container', () => {
      const builder = new ServerKitServerBuilder();

      expect(() => builder.setupPlugins(() => [])).toThrow(ServerkitError);
      expect(() => builder.setupPlugins(() => [])).toThrow('Container not initialized');
    });

    it('passes the built container to the factory and registers each plugin in order', async () => {
      const builder = new ServerKitServerBuilder();
      await builder.setup(config, logger, []);
      const order: string[] = [];
      const factory = vi.fn((_container: Container): ServerKitPlugin[] => [
        serverKitPlugin('first', async app => app.addHook('onRequest', async () => void order.push('first'))),
        serverKitPlugin('second', async app => app.addHook('onRequest', async () => void order.push('second'))),
      ]);

      const result = builder.setupPlugins(factory);
      builder.app.get('/', async () => 'ok');
      await builder.app.inject({ method: 'GET', url: '/' });

      expect(result).toBe(builder);
      expect(factory).toHaveBeenCalledWith(internals(builder).container);
      expect(order).toEqual(['first', 'second']);
    });

    it('applies the default stack so requests carry the ServerKit context', async () => {
      const builder = new ServerKitServerBuilder();
      const handle = vi.fn(async () => invalidAuthenticationSession);
      await builder.setup(config, logger, [
        {
          name: 'auth',
          setup: async registry =>
            void registry.register(AuthenticationSchemeHandler).useInstance({ handle } as unknown as AuthenticationSchemeHandler),
        },
      ]);
      builder.setupPlugins();
      builder.app.get('/', async request => ({
        hasContainer: request.container !== undefined,
        requestId: request.requestId,
        session: request.authenticationSession === invalidAuthenticationSession,
      }));

      const response = await builder.app.inject({ method: 'GET', url: '/', headers: { 'x-request-id': 'r1', origin: 'https://x.com' } });

      expect(response.json()).toEqual({ hasContainer: true, requestId: 'r1', session: true });
      expect(response.headers['x-request-id']).toBe('r1');
      expect(response.headers['access-control-allow-origin']).toBe('https://x.com');
      expect(handle).toHaveBeenCalledTimes(1);
    });
  });

  describe('setupRoutes', () => {
    it('registers a bare route plugin and one mounted under a prefix, and returns the builder', async () => {
      const builder = new ServerKitServerBuilder();
      await builder.setup(config, logger, []);
      builder.setupPlugins(minimalPlugins);
      const api: FastifyPluginAsync = async app => void app.get('/ping', async () => ({ pong: true }));
      const root: FastifyPluginAsync = async app => void app.get('/health', async () => 'ok');

      const result = builder.setupRoutes([{ plugin: api, prefix: '/api' }, root]);

      expect(result).toBe(builder);
      expect((await builder.app.inject({ method: 'GET', url: '/api/ping' })).json()).toEqual({ pong: true });
      expect((await builder.app.inject({ method: 'GET', url: '/health' })).body).toBe('ok');
      expect((await builder.app.inject({ method: 'GET', url: '/ping' })).statusCode).toBe(404);
    });

    it('gives route plugins the ServerKit context from the stack registered before them', async () => {
      const builder = new ServerKitServerBuilder();
      await builder.setup(config, logger, []);
      builder.setupPlugins(minimalPlugins);
      builder.setupRoutes([
        async app =>
          void app.get('/who', async request => ({ requestId: request.requestId, hasContainer: request.container !== undefined })),
      ]);

      const response = await builder.app.inject({ method: 'GET', url: '/who', headers: { 'x-request-id': 'r2' } });

      expect(response.json()).toEqual({ requestId: 'r2', hasContainer: true });
    });

    it('keeps a hook added by a route plugin encapsulated to its own routes', async () => {
      const builder = new ServerKitServerBuilder();
      await builder.setup(config, logger, []);
      builder.setupPlugins(minimalPlugins);
      const seen: string[] = [];
      builder.setupRoutes([
        async app => {
          app.addHook('onRequest', async request => void seen.push(request.url));
          app.get('/guarded', async () => 'ok');
        },
        async app => void app.get('/open', async () => 'ok'),
      ]);

      await builder.app.inject({ method: 'GET', url: '/open' });
      await builder.app.inject({ method: 'GET', url: '/guarded' });

      expect(seen).toEqual(['/guarded']);
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

    it('throws before setup and runs the hooks in reverse order afterwards', async () => {
      const calls: string[] = [];
      const first = createModule({ name: 'first', shutdown: vi.fn(async () => void calls.push('first')) });
      const second = createModule({ name: 'second', shutdown: vi.fn(async () => void calls.push('second')) });
      const builder = new ServerKitServerBuilder();

      await expect(internals(builder).shutdown()).rejects.toThrow(ServerkitError);

      await builder.setup(config, logger, [first, second]);
      await internals(builder).shutdown();

      expect(calls).toEqual(['second', 'first']);
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
      await new Promise(resolve => setTimeout(resolve, 0));
      server = undefined;
      process.removeAllListeners('SIGINT');
      process.removeAllListeners('SIGTERM');
      exitSpy.mockRestore();
    });

    it('rejects when called before the container is initialized', async () => {
      const builder = new ServerKitServerBuilder();

      await expect(builder.start(0)).rejects.toThrow(ServerkitError);
    });

    it('listens on the configured host, runs the start hooks, then serves requests', async () => {
      const module = createModule();
      const builder = new ServerKitServerBuilder({ host: '127.0.0.1' });
      await builder.setup(config, logger, [module]);
      builder.setupPlugins(minimalPlugins).setupRoutes([async app => void app.get('/', async () => ({ ok: true }))]);

      server = await builder.start(0);

      expect(server.listening).toBe(true);
      expect(module.start).toHaveBeenCalledWith(internals(builder).container, expect.any(AbortSignal));
      const { port, address } = server.address() as AddressInfo;
      expect(address).toBe('127.0.0.1');
      const response = await fetch(`http://127.0.0.1:${port}/`);
      expect(await response.json()).toEqual({ ok: true });
    });

    it('runs the ready hooks after start and resolves whenReady', async () => {
      const calls: string[] = [];
      const module = createModule({
        start: vi.fn(async () => void calls.push('start')),
        ready: vi.fn(async () => void calls.push('ready')),
      });
      const builder = new ServerKitServerBuilder({ host: '127.0.0.1' });
      await builder.setup(config, logger, [module]);

      server = await builder.start(0);
      await builder.whenReady();

      expect(calls).toEqual(['start', 'ready']);
      expect(logger.info).toHaveBeenCalledWith('Boot complete');
    });

    it('runs the shutdown hooks and exits after SIGTERM with no open connections', async () => {
      const module = createModule();
      const builder = new ServerKitServerBuilder({ host: '127.0.0.1' });
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
      expect(logger.info).toHaveBeenCalledWith('Server closed');
    });

    it('drains a hijacked SSE reply on signal instead of waiting out the grace period', async () => {
      const module = createModule();
      const builder = new ServerKitServerBuilder({ host: '127.0.0.1' });
      await builder.setup(config, logger, [module]);
      builder.setupPlugins(minimalPlugins).setupRoutes([
        async app =>
          void app.get('/feed', async (_request, reply) => {
            const stream = openSseStream({ res: reply.raw, hijack: () => reply.hijack() }, { heartbeatMs: 0, signal: builder.lifecycleSignal });
            stream.comment('open');
          }),
      ]);

      server = await builder.start(0, { shutdownGraceMs: 10_000 });
      const { port } = server.address() as AddressInfo;
      const req = http.get({ host: '127.0.0.1', port, path: '/feed', agent: new http.Agent({ keepAlive: true }) });
      req.on('error', () => {});
      await new Promise<void>(resolve => req.on('response', () => resolve()));

      const exited = new Promise<void>(resolve => {
        exitSpy.mockImplementation((() => resolve()) as never);
      });
      process.emit('SIGTERM');
      await exited;

      expect(module.shutdown).toHaveBeenCalledTimes(1);
    });

    it('force-closes a lingering connection after the grace period so shutdown runs', async () => {
      const module = createModule();
      const builder = new ServerKitServerBuilder({ host: '127.0.0.1' });
      await builder.setup(config, logger, [module]);
      builder.setupPlugins(minimalPlugins).setupRoutes([async app => void app.get('/hang', () => new Promise(() => {}))]);

      server = await builder.start(0, { shutdownGraceMs: 50 });
      const { port } = server.address() as AddressInfo;
      const req = http.get({ host: '127.0.0.1', port, path: '/hang', agent: new http.Agent({ keepAlive: true }) });
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

      expect(module.shutdown).toHaveBeenCalledWith(internals(builder).container);
    });
  });
});
