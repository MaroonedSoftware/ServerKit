import fastifyCors from '@fastify/cors';
import { CorsOrigin, createOriginMatcher, normalizeCorsOrigins } from '@maroonedsoftware/servercore';
import { ServerKitMiddleware } from '../../serverkit.middleware.js';

/**
 * CORS options for {@link corsMiddleware}.
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
 * The plugin is applied to the root instance synchronously rather than through `register`, which
 * defers loading until the server is ready: that keeps its `onRequest` hook in stack order, so a
 * preflight is answered before the authentication hook runs, as in the Koa stack.
 *
 * @param options - Optional {@link CorsOptions}; defaults to `GET,HEAD,PUT,POST,DELETE,PATCH` methods.
 * @returns {@link ServerKitMiddleware} that applies CORS handling.
 */
export const corsMiddleware = (options?: CorsOptions): ServerKitMiddleware => {
  // Normalize origin to an array up front. A plain string would otherwise be iterated
  // character-by-character, so a single-origin string could never match.
  const matchers = normalizeCorsOrigins(options?.origin);

  // Reflecting an arbitrary caller Origin under a wildcard while also sending
  // credentials produces a universal credentialed CORS policy, which browsers forbid
  // and which defeats the purpose of same-origin protection. Fail fast at construction.
  if (options?.credentials && matchers.some(matcher => matcher === '*')) {
    throw new Error('corsMiddleware: origin "*" cannot be combined with credentials: true — specify explicit origin(s) instead.');
  }

  // Reflect the request origin as its own matcher to support RegExp allow-lists; `false`
  // tells @fastify/cors to omit the header entirely.
  const matchOrigin = createOriginMatcher(matchers);
  const origin: fastifyCors.OriginFunction = (requestOrigin, callback) => {
    const reflected = matchOrigin(requestOrigin ?? '');
    callback(null, reflected === '' ? false : reflected);
  };

  return app => {
    fastifyCors(
      app,
      {
        ...options,
        origin,
        methods: options?.methods ?? 'GET,HEAD,PUT,POST,DELETE,PATCH',
      },
      () => {},
    );
  };
};
