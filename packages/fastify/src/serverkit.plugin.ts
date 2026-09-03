import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

/**
 * A ServerKit server plugin: a Fastify plugin that installs one step of the server stack —
 * hooks, an error handler, a content-type parser, another plugin — on the **root** instance.
 *
 * Every plugin the builder applies is wrapped with `fastify-plugin`, so it escapes Fastify's
 * encapsulation and its hooks apply to every route, including routes registered later. Plugins
 * load in registration order, which is what makes the canonical stack order a contract rather
 * than a coincidence.
 */
export type ServerKitPlugin = FastifyPluginAsync;

/**
 * Wraps a plugin function with `fastify-plugin` so it applies to the root instance.
 *
 * Use it for a custom step in the stack passed to `ServerKitServerBuilder.setupPlugins`; a plain
 * (unwrapped) plugin would be encapsulated, and its hooks would never see a request.
 *
 * @param name - Plugin name, shown in `app.printPlugins()` and in Fastify's own error messages.
 * @param plugin - The plugin body: register hooks and handlers on the instance it receives.
 * @returns The wrapped {@link ServerKitPlugin}.
 *
 * @example
 * ```typescript
 * const requestTiming = serverKitPlugin('request.timing', async app => {
 *   app.addHook('onRequest', async request => request.logger.debug('start', { url: request.url }));
 * });
 *
 * builder.setupPlugins(container => [...serverKitDefaultPlugins(container), requestTiming]);
 * ```
 */
export const serverKitPlugin = (name: string, plugin: (app: FastifyInstance) => void | Promise<unknown>): ServerKitPlugin => {
  // The body's return value is discarded: a one-expression plugin body such as
  // `async app => app.addHook(...)` resolves with the instance, which is not a plugin's result.
  return fp(async app => void (await plugin(app)), { name, fastify: '5.x' });
};
