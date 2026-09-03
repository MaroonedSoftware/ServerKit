import { serverKitPlugin, type ServerKitPlugin } from '@maroonedsoftware/fastify';
import { httpError } from '@maroonedsoftware/errors';

/**
 * A server plugin: applies to every request. `serverKitPlugin` wraps it with `fastify-plugin` so
 * the hook escapes encapsulation and runs for routes registered later.
 *
 * Register it after `serverKitContextPlugin`, which is what puts `logger` and `container` on the
 * request:
 *
 * ```typescript
 * builder.setupPlugins(container => [...serverKitDefaultPlugins(container), apiVersionPlugin()]);
 * ```
 */
export const apiVersionPlugin = (supported: string[] = ['2024-01-01']): ServerKitPlugin =>
  serverKitPlugin('api.version', async app => {
    app.addHook('onRequest', async request => {
      const version = request.headers['x-api-version'];

      if (typeof version === 'string' && !supported.includes(version)) {
        // Throwing is how a hook rejects: errorPlugin renders it with this status and details.
        throw httpError(400).withDetails({ 'x-api-version': `must be one of ${supported.join(', ')}` });
      }

      request.logger.debug('Resolved API version', { requestId: request.requestId, version: version ?? 'default' });
    });

    // Work that has to happen after the handler goes in its own hook; there is no next() to await.
    app.addHook('onSend', async (_request, reply, payload) => {
      void reply.header('x-api-version', supported[0] ?? '');
      return payload;
    });
  });
