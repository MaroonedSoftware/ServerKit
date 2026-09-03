import fastifyCors from '@fastify/cors';
import { CorsOrigin, createOriginMatcher, normalizeCorsOrigins } from '@maroonedsoftware/servercore';
import { serverKitPlugin, type ServerKitPlugin } from '../serverkit.plugin.js';

/**
 * CORS options for {@link corsPlugin}.
 * Extends `@fastify/cors` options with an `origin` that may be a string or array of strings/RegExps.
 */
export interface CorsOptions extends Omit<fastifyCors.FastifyCorsOptions, 'origin'> {
  /** Allowed origin(s): `'*'`, a single origin string, or an array of strings/RegExps to match. */
  origin?: CorsOrigin;
}

/**
 * Adds CORS headers to responses using `@fastify/cors` with ServerKit-compatible origin matching.
 * Supports `'*'`, exact string origins, and RegExp patterns.
 *
 * `@fastify/cors` is registered from inside this plugin, so it loads in stack order: a preflight
 * is answered before the authentication hook runs, as long as this plugin is registered ahead of
 * {@link authenticationPlugin}.
 *
 * @param options - Optional {@link CorsOptions}; defaults to `GET,HEAD,PUT,POST,DELETE,PATCH` methods.
 * @returns A {@link ServerKitPlugin} that applies CORS handling.
 */
export const corsPlugin = (options?: CorsOptions): ServerKitPlugin => {
  // Normalize origin to an array up front. A plain string would otherwise be iterated
  // character-by-character, so a single-origin string could never match.
  const matchers = normalizeCorsOrigins(options?.origin);

  // Reflecting an arbitrary caller Origin under a wildcard while also sending
  // credentials produces a universal credentialed CORS policy, which browsers forbid
  // and which defeats the purpose of same-origin protection. Fail fast at construction.
  if (options?.credentials && matchers.some(matcher => matcher === '*')) {
    throw new Error('corsPlugin: origin "*" cannot be combined with credentials: true — specify explicit origin(s) instead.');
  }

  // Reflect the request origin as its own matcher to support RegExp allow-lists; `false`
  // tells @fastify/cors to omit the header entirely.
  const matchOrigin = createOriginMatcher(matchers);
  const origin: fastifyCors.OriginFunction = (requestOrigin, callback) => {
    const reflected = matchOrigin(requestOrigin ?? '');
    callback(null, reflected === '' ? false : reflected);
  };

  return serverKitPlugin('serverkit.cors', async app => {
    await app.register(fastifyCors, {
      ...options,
      origin,
      methods: options?.methods ?? 'GET,HEAD,PUT,POST,DELETE,PATCH',
    });
  });
};
