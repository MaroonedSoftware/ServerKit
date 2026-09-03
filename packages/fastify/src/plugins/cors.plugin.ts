import fastifyCors from '@fastify/cors';
import { serverKitPlugin, type ServerKitPlugin } from '../serverkit.plugin.js';

/**
 * CORS options for {@link corsPlugin}: `@fastify/cors`'s own options, unchanged.
 *
 * `origin` accepts everything that plugin accepts — `'*'`, a boolean, one origin string, a RegExp,
 * an array of those, or a (possibly async) function. A fixed string is sent verbatim on every
 * response; an array or RegExp reflects the caller's `Origin` when it matches and omits the header
 * when it does not.
 */
export type CorsOptions = fastifyCors.FastifyCorsOptions;

/**
 * Whether the configured origin sends a literal `*`, which browsers forbid with credentials.
 * `undefined` counts: `@fastify/cors` defaults to `'*'`. `true` does not — that reflects the
 * caller's origin, which is a valid (if permissive) credentialed policy.
 */
const allowsAnyOrigin = (origin: CorsOptions['origin']): boolean => {
  return origin === undefined || origin === '*' || (Array.isArray(origin) && origin.includes('*'));
};

/**
 * Adds CORS headers using `@fastify/cors`, whose own origin matching handles strings, RegExps, and
 * arrays; options are passed through untouched apart from a wider default method list.
 *
 * The plugin is registered from inside this one, so it loads in stack order: a preflight is
 * answered before the authentication hook runs, as long as this plugin is registered ahead of
 * {@link authenticationPlugin}.
 *
 * @param options - Optional {@link CorsOptions}. `methods` defaults to
 *   `GET,HEAD,PUT,POST,DELETE,PATCH`, wider than the plugin's own `GET,HEAD,POST`.
 * @returns A {@link ServerKitPlugin} that applies CORS handling.
 * @throws {Error} When `credentials` is combined with an origin of `'*'`.
 */
export const corsPlugin = (options?: CorsOptions): ServerKitPlugin => {
  // A wildcard origin with credentials is a policy no browser will honour, and `@fastify/cors`
  // does not reject it (it folds an array containing '*' down to '*'). Fail at construction
  // rather than shipping CORS that silently never works.
  if (options?.credentials && allowsAnyOrigin(options.origin)) {
    throw new Error('corsPlugin: origin "*" cannot be combined with credentials: true — specify explicit origin(s) instead.');
  }

  return serverKitPlugin('serverkit.cors', async app => {
    await app.register(fastifyCors, {
      ...options,
      methods: options?.methods ?? 'GET,HEAD,PUT,POST,DELETE,PATCH',
    });
  });
};
