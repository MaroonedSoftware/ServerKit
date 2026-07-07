import cors from '@koa/cors';
import { ServerKitMiddleware } from '../../serverkit.middleware.js';
import { Context } from 'koa';

/**
 * CORS options for {@link corsMiddleware}.
 * Extends `@koa/cors` options with an `origin` that may be a string or array of strings/RegExps.
 */
export interface CorsOptions extends Omit<cors.Options, 'origin'> {
  /** Allowed origin(s): `'*'`, a single origin string, or an array of strings/RegExps to match. */
  origin?: string | (string | RegExp)[];
}

/**
 * Adds CORS headers to responses using `@koa/cors` with ServerKit-compatible origin matching.
 * Supports `'*'`, exact string origins, and RegExp patterns.
 *
 * @param options - Optional {@link CorsOptions}; defaults to `GET,HEAD,PUT,POST,DELETE,PATCH` methods.
 * @returns {@link ServerKitMiddleware} that applies CORS headers.
 */
export const corsMiddleware = (options?: CorsOptions): ServerKitMiddleware => {
  // Normalize origin to an array up front. A plain string would otherwise be iterated
  // character-by-character below, so a single-origin string could never match.
  const matchers: (string | RegExp)[] = options?.origin == null ? ['*'] : typeof options.origin === 'string' ? [options.origin] : options.origin;

  // Reflecting an arbitrary caller Origin under a wildcard while also sending
  // credentials produces a universal credentialed CORS policy, which browsers forbid
  // and which defeats the purpose of same-origin protection. Fail fast at construction.
  if (options?.credentials && matchers.some(matcher => matcher === '*')) {
    throw new Error('corsMiddleware: origin "*" cannot be combined with credentials: true — specify explicit origin(s) instead.');
  }

  // return the request origin as its own matcher to support RegExp
  const originMatcher = (ctx: Context): string => {
    const origin = ctx.get('origin');
    for (const matcher of matchers) {
      if (matcher === '*') {
        return origin;
      }

      if (typeof matcher === 'string') {
        if (matcher === origin) {
          return origin;
        }
        continue;
      }

      if (matcher.test(origin)) {
        return origin;
      }
    }

    // return the zero value to prevent matches
    return '';
  };

  return cors({
    ...options,
    origin: originMatcher,
    allowMethods: options?.allowMethods ?? 'GET,HEAD,PUT,POST,DELETE,PATCH',
    secureContext: options?.secureContext ?? false,
    keepHeadersOnError: options?.keepHeadersOnError ?? false,
    privateNetworkAccess: options?.privateNetworkAccess ?? false,
  });
};
