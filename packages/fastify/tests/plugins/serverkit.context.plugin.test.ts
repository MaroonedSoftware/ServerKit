import { describe, it, expect, vi } from 'vitest';
import { Injectable, type Container } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { ServerKitContext } from '../../src/serverkit.context.js';
import { errorPlugin } from '../../src/plugins/error.plugin.js';
import { serverKitContextPlugin } from '../../src/plugins/serverkit.context.plugin.js';
import { serverKitPlugin } from '../../src/serverkit.plugin.js';
import { createTestApp } from '../test.app.js';

const UUID = /^[0-9a-f-]{36}$/;

describe('serverKitContextPlugin (fastify)', () => {
  it('populates the request context and echoes the ids on the reply', async () => {
    const { app, logger } = await createTestApp();
    let seen: Record<string, unknown> = {};
    app.get('/path/here', async request => {
      seen = {
        hasContainer: request.container !== undefined,
        logger: request.logger,
        loggerName: request.loggerName,
        userAgent: request.userAgent,
        ipAddress: request.ipAddress,
        correlationId: request.correlationId,
        requestId: request.requestId,
        headerCorrelation: request.headers['x-correlation-id'],
        reply: request.reply !== undefined,
      };
      return 'ok';
    });

    const response = await app.inject({
      method: 'GET',
      url: '/path/here?q=1',
      headers: { 'user-agent': 'vitest', 'x-correlation-id': 'corr-1', 'x-request-id': 'req-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(seen).toEqual({
      hasContainer: true,
      logger,
      loggerName: '/path/here',
      userAgent: 'vitest',
      ipAddress: '127.0.0.1',
      correlationId: 'corr-1',
      requestId: 'req-1',
      headerCorrelation: 'corr-1',
      reply: true,
    });
    expect(response.headers['x-correlation-id']).toBe('corr-1');
    expect(response.headers['x-request-id']).toBe('req-1');
  });

  it('generates ids when the headers are absent', async () => {
    const { app } = await createTestApp();
    app.get('/', async request => ({ correlationId: request.correlationId, requestId: request.requestId }));

    const response = await app.inject({ method: 'GET', url: '/' });
    const body = response.json<{ correlationId: string; requestId: string }>();

    expect(body.correlationId).toMatch(UUID);
    expect(body.requestId).toMatch(UUID);
    expect(response.headers['x-correlation-id']).toBe(body.correlationId);
  });

  it('registers the live request as the ServerKitContext token in the request scope', async () => {
    @Injectable()
    class NeedsContext {
      constructor(public readonly context: ServerKitContext) {}
    }
    const { app } = await createTestApp({
      modules: [{ name: 'test', setup: async registry => void registry.register(NeedsContext).useClass(NeedsContext) }],
    });
    let resolved: NeedsContext | undefined;
    let sameRequest = false;
    app.get('/', async request => {
      resolved = request.container.get(NeedsContext);
      sameRequest = resolved.context === request;
      return 'ok';
    });

    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(resolved).toBeInstanceOf(NeedsContext);
    expect(sameRequest).toBe(true);
  });

  it('disposes the scoped container when the raw response closes', async () => {
    const { app } = await createTestApp();
    let scoped: Container | undefined;
    app.get('/', async request => {
      scoped = request.container;
      return 'ok';
    });

    await app.inject({ method: 'GET', url: '/' });

    await vi.waitFor(() => expect(() => scoped!.get(Logger)).toThrow());
  });

  it('is usable from a plugin registered after it', async () => {
    const { app, logger } = await createTestApp({
      plugins: container => [
        errorPlugin(container),
        serverKitContextPlugin(container),
        serverKitPlugin('uses.context', async app => app.addHook('onRequest', async request => request.logger.info('hook'))),
      ],
    });
    app.get('/', async () => 'ok');

    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(logger.info).toHaveBeenCalledWith('hook');
  });
});
