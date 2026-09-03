import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ServerFeed } from '@maroonedsoftware/serverfeed';
import { invalidAuthenticationSession, type AuthenticationSession } from '@maroonedsoftware/authentication';
import type { ServerKitModule } from '@maroonedsoftware/servercore';
import { serverFeedRouter } from '../src/serverfeed/server.feed.stream.js';
import * as subpath from '../src/serverfeed.js';
import { ServerKitServerBuilder } from '../src/serverkit.server.builder.js';
import { serverKitPlugin } from '../src/serverkit.plugin.js';
import { createLogger, createTestApp, minimalPlugins } from './test.app.js';

const session = { sessionToken: 't', subject: 'alice', factors: [], claims: {} } as unknown as AuthenticationSession;

const feedModule = (feed: ServerFeed): ServerKitModule => ({
  name: 'feed',
  setup: async registry => void registry.register(ServerFeed).useInstance(feed),
});

const withSession = (current: AuthenticationSession) => (container: Parameters<typeof minimalPlugins>[0]) => [
  ...minimalPlugins(container),
  serverKitPlugin('test.session', async app =>
    app.addHook('onRequest', async request => {
      request.authenticationSession = current;
    }),
  ),
];

describe('serverFeedRouter (fastify)', () => {
  it('streams the replayed backlog over SSE and drains on the signal', async () => {
    const feed = new ServerFeed();
    feed.status('render', 'a', 'r1');
    const controller = new AbortController();
    const { app, builder } = await createTestApp({ modules: [feedModule(feed)], plugins: withSession(session) });
    builder.setupRoutes([serverFeedRouter({ policy: false, heartbeatMs: 0, signal: controller.signal })]);

    const pending = app.inject({ method: 'GET', url: '/server/feed?source=render' });
    await new Promise(resolve => setTimeout(resolve, 20));
    controller.abort();
    const response = await pending;

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/event-stream');
    expect(response.body).toContain('event: server.feed');
    expect(response.body).toContain('"message":"r1"');
  });

  it('honors a custom path', async () => {
    const feed = new ServerFeed();
    const controller = new AbortController();
    const { app, builder } = await createTestApp({ modules: [feedModule(feed)], plugins: withSession(session) });
    builder.setupRoutes([serverFeedRouter({ path: '/ops/events', policy: false, heartbeatMs: 0, signal: controller.signal })]);

    const pending = app.inject({ method: 'GET', url: '/ops/events' });
    await new Promise(resolve => setTimeout(resolve, 20));
    controller.abort();

    expect((await pending).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/server/feed' })).statusCode).toBe(404);
  });

  it('rejects an invalid session with 401 before opening the stream', async () => {
    const feed = new ServerFeed();
    const { app, builder } = await createTestApp({ modules: [feedModule(feed)], plugins: withSession(invalidAuthenticationSession) });
    builder.setupRoutes([serverFeedRouter({ policy: false })]);

    const response = await app.inject({ method: 'GET', url: '/server/feed' });

    expect(response.statusCode).toBe(401);
  });

  it('uses resolveFeed when supplied', async () => {
    const feed = new ServerFeed();
    feed.status('llm', 'b', 'custom');
    const controller = new AbortController();
    const resolveFeed = vi.fn(() => feed);
    const { app, builder } = await createTestApp({ plugins: withSession(session) });
    builder.setupRoutes([serverFeedRouter({ policy: false, heartbeatMs: 0, signal: controller.signal, resolveFeed })]);

    const pending = app.inject({ method: 'GET', url: '/server/feed' });
    await new Promise(resolve => setTimeout(resolve, 20));
    controller.abort();
    const response = await pending;

    expect(resolveFeed).toHaveBeenCalledTimes(1);
    expect(response.body).toContain('"message":"custom"');
  });

  it('re-exports the shared handler and filter from the subpath', () => {
    expect(subpath.serverFeedRouter).toBeTypeOf('function');
    expect(subpath.handleServerFeed).toBeTypeOf('function');
    expect(subpath.serverFeedFilterFromQuery).toBeTypeOf('function');
  });

  describe('over a real socket', () => {
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

    it('streams live events and drains on SIGTERM instead of waiting out the grace period', async () => {
      const feed = new ServerFeed();
      const builder = new ServerKitServerBuilder({ host: '127.0.0.1' });
      await builder.setup({} as never, createLogger(), [feedModule(feed)]);
      builder
        .setupPlugins(withSession(session))
        .setupRoutes([serverFeedRouter({ policy: false, heartbeatMs: 0, signal: builder.lifecycleSignal })]);

      // A backlog event makes the replay write immediately, which flushes the response headers;
      // without it a client sees no response until the first live event or heartbeat.
      feed.status('render', 'a', 'backlog');
      server = await builder.start(0, { shutdownGraceMs: 10_000 });
      const { port } = server.address() as AddressInfo;
      const chunks: string[] = [];
      const req = http.get({ host: '127.0.0.1', port, path: '/server/feed', agent: new http.Agent({ keepAlive: true }) });
      req.on('error', () => {});
      const response = await new Promise<http.IncomingMessage>(resolve => req.on('response', resolve));
      response.on('data', chunk => chunks.push(String(chunk)));

      feed.status('render', 'a', 'live');
      await vi.waitFor(() => expect(chunks.join('')).toContain('"message":"live"'));

      const exited = new Promise<void>(resolve => {
        exitSpy.mockImplementation((() => resolve()) as never);
      });
      process.emit('SIGTERM');
      await exited;

      expect(response.headers['content-type']).toBe('text/event-stream');
    });
  });
});
